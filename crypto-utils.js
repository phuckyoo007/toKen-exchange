// lib/crypto-utils.js
// Web Crypto helpers for the encrypted vault. Password -> AES-256-GCM key via
// PBKDF2-SHA256 with a random salt and a high iteration count. This is the
// same general approach MetaMask/most wallets use for their local keystore.
// NOTE: this protects the vault at rest on disk; it does not make a weak
// password strong. Encourage a real passphrase, not a 4-digit PIN.

const PBKDF2_ITERATIONS = 310000; // OWASP 2023 recommendation for PBKDF2-SHA256

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveAesKey(password, saltBuf, iterations) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBuf, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypts a plain JS object under `password`. Returns a storable record.
async function encryptJSON(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    salt: bufToBase64(salt),
    iv: bufToBase64(iv),
    ciphertext: bufToBase64(ciphertext),
    iterations: PBKDF2_ITERATIONS,
    v: 1,
  };
}

// Decrypts a record produced by encryptJSON. Throws if the password is wrong
// (AES-GCM auth tag check fails) or the record is corrupt.
async function decryptJSON(record, password) {
  const salt = base64ToBuf(record.salt);
  const iv = base64ToBuf(record.iv);
  const key = await deriveAesKey(password, salt, record.iterations || PBKDF2_ITERATIONS);
  const ciphertext = base64ToBuf(record.ciphertext);
  let plaintextBuf;
  try {
    plaintextBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch (e) {
    throw new Error("Incorrect password.");
  }
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plaintextBuf));
}

if (typeof self !== "undefined") {
  self.TM_CRYPTO = { encryptJSON, decryptJSON, bufToBase64, base64ToBuf };
}
