const test = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { loadBrowserLibs } = require("./helpers/load-libs");

loadBrowserLibs(["crypto-utils.js"]);
const { encryptJSON, decryptJSON, bufToBase64, base64ToBuf } = self.TM_CRYPTO;

const SECRET = { mnemonic: "test test test test test test test test test test test junk", importedKeys: [] };

test("base64 helpers round-trip arbitrary bytes", () => {
  const bytes = new Uint8Array(256).map((_, i) => i);
  const back = new Uint8Array(base64ToBuf(bufToBase64(bytes)));
  assert.deepEqual([...back], [...bytes]);
});

test("encrypt then decrypt returns the original object", async () => {
  const rec = await encryptJSON(SECRET, "correct horse battery");
  assert.deepEqual(await decryptJSON(rec, "correct horse battery"), SECRET);
});

test("record has the expected shape and does not contain the plaintext", async () => {
  const rec = await encryptJSON(SECRET, "correct horse battery");
  assert.equal(rec.v, 1);
  assert.equal(rec.iterations, 310000);
  assert.equal(new Uint8Array(base64ToBuf(rec.salt)).length, 16);
  assert.equal(new Uint8Array(base64ToBuf(rec.iv)).length, 12);
  assert.ok(!JSON.stringify(rec).includes("junk"));
});

test("two encryptions of the same data differ (fresh salt and IV each time)", async () => {
  const a = await encryptJSON(SECRET, "pw-pw-pw-pw");
  const b = await encryptJSON(SECRET, "pw-pw-pw-pw");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test("wrong password is rejected with a clear message", async () => {
  const rec = await encryptJSON(SECRET, "right-password");
  await assert.rejects(() => decryptJSON(rec, "wrong-password"), { message: "Incorrect password." });
});

test("tampered ciphertext is rejected (AES-GCM authentication)", async () => {
  const rec = await encryptJSON(SECRET, "right-password");
  const bytes = new Uint8Array(base64ToBuf(rec.ciphertext));
  bytes[0] ^= 0xff;
  await assert.rejects(() => decryptJSON({ ...rec, ciphertext: bufToBase64(bytes) }, "right-password"), { message: "Incorrect password." });
});

test("tampered IV is rejected", async () => {
  const rec = await encryptJSON(SECRET, "right-password");
  const iv = new Uint8Array(base64ToBuf(rec.iv));
  iv[0] ^= 0x01;
  await assert.rejects(() => decryptJSON({ ...rec, iv: bufToBase64(iv) }, "right-password"), { message: "Incorrect password." });
});

test("a record without an iterations field falls back to the current default", async () => {
  const rec = await encryptJSON(SECRET, "right-password");
  const { iterations, ...legacy } = rec;
  assert.deepEqual(await decryptJSON(legacy, "right-password"), SECRET);
});

test("decryption honours the iteration count stored IN the record (older vaults keep working)", async () => {
  // Build a vault independently with Node crypto at a LOWER iteration count.
  const iterations = 5000;
  const salt = nodeCrypto.randomBytes(16);
  const iv = nodeCrypto.randomBytes(12);
  const key = nodeCrypto.pbkdf2Sync("old-password", salt, iterations, 32, "sha256");
  const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(SECRET), "utf8"), cipher.final()]);
  const ciphertext = Buffer.concat([ct, cipher.getAuthTag()]); // WebCrypto appends the tag
  const rec = { salt: salt.toString("base64"), iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), iterations, v: 1 };
  assert.deepEqual(await decryptJSON(rec, "old-password"), SECRET);
});
