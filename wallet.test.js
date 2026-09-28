const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserLibs, installFakeChromeStorage } = require("./helpers/load-libs");

loadBrowserLibs(["ethers.umd.min.js", "crypto-utils.js", "wallet.js"]);
const W = self.TM_WALLET;

// Public, well-known test vectors (Hardhat/Anvil default mnemonic, BIP44 m/44 prime/60 prime/0 prime/0/i).
const MNEMONIC = "test test test test test test test test test test test junk";
const ADDR0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ADDR1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PW = "a-decent-password";

test("creating a wallet: 12-word phrase, valid address, encrypted vault, one account", async () => {
  const store = installFakeChromeStorage();
  const { mnemonic, address } = await W.createNewVault(PW);
  assert.equal(mnemonic.split(" ").length, 12);
  assert.ok(ethers.utils.isValidMnemonic(mnemonic));
  assert.equal(ethers.utils.getAddress(address), address);
  // The vault on disk must never contain the phrase in the clear.
  const onDisk = JSON.stringify(store.tm_vault);
  assert.ok(!onDisk.includes(mnemonic.split(" ")[0] + " " + mnemonic.split(" ")[1]));
  assert.ok(store.tm_vault.ciphertext);
  assert.deepEqual(await W.getAccountsMeta(), [{ index: 0, address, name: "Account 1", type: "hd" }]);
  assert.equal(await W.hasVault(), true);
});

test("unlock: right password returns the secret, wrong password is rejected", async () => {
  installFakeChromeStorage();
  const { mnemonic } = await W.createNewVault(PW);
  assert.equal((await W.unlockVault(PW)).mnemonic, mnemonic);
  await assert.rejects(() => W.unlockVault("not-the-password"), { message: "Incorrect password." });
});

test("unlock with no wallet gives a clear error", async () => {
  installFakeChromeStorage();
  await assert.rejects(() => W.unlockVault(PW), /No wallet found/);
});

test("passwords under 8 characters are refused (create and import)", async () => {
  installFakeChromeStorage();
  await assert.rejects(() => W.createNewVault("short"), /at least 8 characters/);
  await assert.rejects(() => W.importFromMnemonic(MNEMONIC, "short"), /at least 8 characters/);
  assert.equal(await W.hasVault(), false);
});

test("cannot create or import over an existing wallet", async () => {
  installFakeChromeStorage();
  await W.createNewVault(PW);
  await assert.rejects(() => W.createNewVault(PW), /already exists/);
  await assert.rejects(() => W.importFromMnemonic(MNEMONIC, PW), /already exists/);
});

test("import: known phrase derives the known first address (BIP44 path is right)", async () => {
  installFakeChromeStorage();
  const { address } = await W.importFromMnemonic(MNEMONIC, PW);
  assert.equal(address, ADDR0);
});

test("import normalises case and extra whitespace in the phrase", async () => {
  installFakeChromeStorage();
  const messy = "  TEST test  test test test test test test test test test JUNK\n";
  assert.equal((await W.importFromMnemonic(messy, PW)).address, ADDR0);
  assert.equal((await W.unlockVault(PW)).mnemonic, MNEMONIC);
});

test("import rejects an invalid phrase", async () => {
  installFakeChromeStorage();
  await assert.rejects(() => W.importFromMnemonic("not a real recovery phrase at all", PW), /valid recovery phrase/);
  assert.equal(await W.hasVault(), false);
});

test("addHdAccount derives the next known address and records it", async () => {
  installFakeChromeStorage();
  await W.importFromMnemonic(MNEMONIC, PW);
  const secret = await W.unlockVault(PW);
  assert.equal(await W.addHdAccount(secret, PW), ADDR1);
  const meta = await W.getAccountsMeta();
  assert.equal(meta.length, 2);
  assert.deepEqual(meta[1], { index: 1, address: ADDR1, name: "Account 2", type: "hd" });
});

test("getSigningWallet returns the wallet whose address matches the account", async () => {
  installFakeChromeStorage();
  await W.importFromMnemonic(MNEMONIC, PW);
  const secret = await W.unlockVault(PW);
  const meta = await W.getAccountsMeta();
  const w = W.getSigningWallet(secret, meta[0]);
  assert.equal(w.address, ADDR0);
  assert.equal(w.privateKey, KEY0);
});

test("importPrivateKey: adds an account, survives re-unlock, rejects duplicates and garbage", async () => {
  installFakeChromeStorage();
  await W.createNewVault(PW);
  const secret = await W.unlockVault(PW);
  const address = await W.importPrivateKey(secret, PW, KEY0);
  assert.equal(address, ADDR0);
  const meta = await W.getAccountsMeta();
  assert.equal(meta[1].type, "imported");
  // Persisted encrypted: a fresh unlock still has the key.
  const again = await W.unlockVault(PW);
  assert.deepEqual(again.importedKeys, [KEY0]);
  assert.equal(W.getSigningWallet(again, meta[1]).address, ADDR0);
  // Same account twice, and a non-key, are both refused.
  await assert.rejects(() => W.importPrivateKey(again, PW, KEY0), /already in this wallet/);
  await assert.rejects(() => W.importPrivateKey(again, PW, "0x1234"), /valid private key/);
});

test("resetWallet removes the vault and account list", async () => {
  const store = installFakeChromeStorage();
  await W.createNewVault(PW);
  await W.resetWallet();
  assert.equal(await W.hasVault(), false);
  assert.deepEqual(await W.getAccountsMeta(), []);
  assert.deepEqual(Object.keys(store), []);
});
