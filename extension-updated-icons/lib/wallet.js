// lib/wallet.js
// Wallet core: mnemonic/key generation, HD derivation, and the encrypted
// vault that lives in chrome.storage.local. Depends on `ethers` (vendor/
// ethers.umd.min.js) and TM_CRYPTO (lib/crypto-utils.js) being loaded first.
//
// SECURITY MODEL:
// - The vault on disk is ALWAYS encrypted (see crypto-utils.js). Nothing
//   secret is ever written to storage in plaintext.
// - The DECRYPTED secret (mnemonic + imported keys) is held only in the
//   background service worker's in-memory variable, never in chrome.storage.
//   It is cleared on browser restart, extension reload, or explicit lock.
// - The popup never holds private keys itself; it asks the background worker
//   to sign/send via chrome.runtime.sendMessage.
//
// This is an MVP implementation for personal/test use. It has not been
// professionally security-audited. Do not store large amounts of real funds
// in it without an independent audit first.

const VAULT_KEY = "tm_vault";
const ACCOUNTS_META_KEY = "tm_accounts_meta"; // public info only: [{index, address, name}]
const HD_PATH_PREFIX = "m/44'/60'/0'/0"; // BIP44 Ethereum, same as MetaMask

function deriveAddressAndKeyFromMnemonic(mnemonic, index) {
  const node = ethers.utils.HDNode.fromMnemonic(mnemonic).derivePath(`${HD_PATH_PREFIX}/${index}`);
  return { address: node.address, privateKey: node.privateKey };
}

async function hasVault() {
  const stored = await chrome.storage.local.get(VAULT_KEY);
  return !!stored[VAULT_KEY];
}

async function getAccountsMeta() {
  const stored = await chrome.storage.local.get(ACCOUNTS_META_KEY);
  return stored[ACCOUNTS_META_KEY] || [];
}

async function setAccountsMeta(meta) {
  await chrome.storage.local.set({ [ACCOUNTS_META_KEY]: meta });
}

// Creates a brand-new HD wallet, encrypts it under `password`.
// Returns { mnemonic, address } -- caller (popup) MUST show the mnemonic to
// the user exactly once for backup and never persist it anywhere itself.
async function createNewVault(password) {
  if (await hasVault()) throw new Error("A wallet already exists. Reset it first if you want to replace it.");
  if (!password || password.length < 8) throw new Error("Choose a password of at least 8 characters.");

  const randomWallet = ethers.Wallet.createRandom();
  const mnemonic = randomWallet.mnemonic.phrase;
  const { address } = deriveAddressAndKeyFromMnemonic(mnemonic, 0);

  const secret = { mnemonic, importedKeys: [] };
  const record = await TM_CRYPTO.encryptJSON(secret, password);
  await chrome.storage.local.set({ [VAULT_KEY]: record });
  await setAccountsMeta([{ index: 0, address, name: "Account 1", type: "hd" }]);

  return { mnemonic, address };
}

// Imports an existing 12/24-word mnemonic under a new password.
async function importFromMnemonic(mnemonic, password) {
  if (await hasVault()) throw new Error("A wallet already exists. Reset it first if you want to replace it.");
  const trimmed = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!ethers.utils.isValidMnemonic(trimmed)) throw new Error("That doesn't look like a valid recovery phrase.");
  if (!password || password.length < 8) throw new Error("Choose a password of at least 8 characters.");

  const { address } = deriveAddressAndKeyFromMnemonic(trimmed, 0);
  const secret = { mnemonic: trimmed, importedKeys: [] };
  const record = await TM_CRYPTO.encryptJSON(secret, password);
  await chrome.storage.local.set({ [VAULT_KEY]: record });
  await setAccountsMeta([{ index: 0, address, name: "Account 1", type: "hd" }]);

  return { address };
}

// Decrypts the vault. Returns the secret object { mnemonic, importedKeys }.
// Throws "Incorrect password." on bad password.
async function unlockVault(password) {
  const stored = await chrome.storage.local.get(VAULT_KEY);
  const record = stored[VAULT_KEY];
  if (!record) throw new Error("No wallet found. Create or import one first.");
  return TM_CRYPTO.decryptJSON(record, password);
}

// Re-encrypts an updated secret object back into storage with the same
// password (used after adding an account or importing a private key).
async function persistVault(secret, password) {
  const record = await TM_CRYPTO.encryptJSON(secret, password);
  await chrome.storage.local.set({ [VAULT_KEY]: record });
}

// Adds the next HD account (index = current count) to the vault + meta.
async function addHdAccount(secret, password) {
  const meta = await getAccountsMeta();
  const hdCount = meta.filter((a) => a.type === "hd").length;
  const { address } = deriveAddressAndKeyFromMnemonic(secret.mnemonic, hdCount);
  meta.push({ index: hdCount, address, name: `Account ${meta.length + 1}`, type: "hd" });
  await setAccountsMeta(meta);
  await persistVault(secret, password); // secret itself is unchanged, but re-save to confirm password path stays consistent
  return address;
}

// Imports a raw private key as an additional account (not derived from the
// seed phrase -- must be backed up separately by the user).
async function importPrivateKey(secret, password, privateKey) {
  let wallet;
  try {
    wallet = new ethers.Wallet(privateKey.trim());
  } catch (e) {
    throw new Error("That doesn't look like a valid private key.");
  }
  const meta = await getAccountsMeta();
  if (meta.some((a) => a.address.toLowerCase() === wallet.address.toLowerCase())) {
    throw new Error("That account is already in this wallet.");
  }
  secret.importedKeys.push(wallet.privateKey);
  meta.push({ index: secret.importedKeys.length - 1, address: wallet.address, name: `Imported ${secret.importedKeys.length}`, type: "imported" });
  await setAccountsMeta(meta);
  await persistVault(secret, password);
  return wallet.address;
}

// Returns an ethers.Wallet (unconnected) for a given account meta entry.
function getSigningWallet(secret, accountMeta) {
  if (accountMeta.type === "hd") {
    const { privateKey } = deriveAddressAndKeyFromMnemonic(secret.mnemonic, accountMeta.index);
    return new ethers.Wallet(privateKey);
  }
  return new ethers.Wallet(secret.importedKeys[accountMeta.index]);
}

async function resetWallet() {
  await chrome.storage.local.remove([VAULT_KEY, ACCOUNTS_META_KEY]);
}

if (typeof self !== "undefined") {
  self.TM_WALLET = {
    hasVault,
    getAccountsMeta,
    createNewVault,
    importFromMnemonic,
    unlockVault,
    persistVault,
    addHdAccount,
    importPrivateKey,
    getSigningWallet,
    resetWallet,
  };
}
