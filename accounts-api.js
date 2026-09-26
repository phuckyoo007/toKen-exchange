// accounts-api.js
// Optional username/password accounts for the WEBSITE, used to sync a few
// harmless display settings (currency, language, watchlist) between devices.
// It is deliberately NOT a wallet backup: no keys, recovery phrases,
// addresses, balances or contacts are ever accepted or stored here, and the
// settings endpoint rejects anything outside a tiny whitelist. Losing an
// account (or having this server breached) can therefore never cost anyone
// their funds -- the recovery phrase on the person's own device stays the
// only thing that controls them.
//
// HOW LOGIN WORKS
// The browser never sends the raw password. It derives a 256-bit "auth key"
// from (username, password) with PBKDF2 and sends only that. The server
// stores scrypt(authKey, per-user random salt). So even someone who reads
// the database gets nothing that unlocks a wallet or reveals the password
// in one step, and a server log that captures a login request doesn't
// capture the password itself.
//
// SESSIONS
// A random 32-byte token in an HttpOnly, SameSite=Lax cookie (Secure when
// served over https). Only its SHA-256 is stored server-side. Thirty-day
// lifetime; logout and account deletion revoke it immediately.
//
// CSRF
// Every state-changing call must be JSON and carry X-TM-Requested-With
// (a custom header a cross-site form can't send), and any Origin header
// present must match this site's own host. There are no CORS headers here:
// the API is same-origin only. (The Chrome extension can't use it yet --
// that would need bearer-token CORS support, planned for later.)
//
// SWITCHED OFF BY DEFAULT
// Nothing here runs unless ACCOUNTS_ENABLED=1 AND the database opens. Set
// ACCOUNTS_DB_PATH (or DATA_DIR) to a path on a persistent volume first --
// on Railway the container filesystem is wiped on every redeploy.
//
// STORAGE
// Node's built-in SQLite (node:sqlite, Node 22.13+): no extra packages.
// If the runtime doesn't have it, accounts stay disabled and the rest of
// the site is unaffected.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
  DatabaseSync = null;
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.ACCOUNTS_DB_PATH || path.join(DATA_DIR, "accounts.db");

const SESSION_COOKIE = "tm_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SETTINGS_BYTES = 8 * 1024;
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const RESERVED = new Set(["admin", "administrator", "root", "support", "help", "system", "moderator", "tokenexchange", "token_exchange", "staff", "official"]);
const AUTH_KEY_RE = /^[0-9a-f]{64}$/;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

// ---- Database ------------------------------------------------------------
let db = null;
let dbTried = false;

function getDb() {
  if (db || dbTried) return db;
  dbTried = true;
  if (process.env.ACCOUNTS_ENABLED !== "1") return null;
  if (!DatabaseSync) {
    console.warn("[accounts] ACCOUNTS_ENABLED=1 but this Node has no node:sqlite (needs 22.13+). Accounts stay off.");
    return null;
  }
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const d = new DatabaseSync(DB_PATH);
    d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    d.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        salt BLOB NOT NULL,
        hash BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        settings TEXT,
        settings_updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);
    db = d;
    console.log("[accounts] Enabled. Database at", DB_PATH);
  } catch (e) {
    console.error("[accounts] Could not open database; accounts stay off:", e && e.message);
    db = null;
  }
  return db;
}

function isEnabled() {
  return !!getDb();
}

// ---- Small helpers -------------------------------------------------------
function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  }, extraHeaders || {}));
  res.end(body);
}

function fail(res, status, code, extraHeaders) {
  sendJson(res, status, { error: code }, extraHeaders);
}

// Railway (and most hosts) append the real client address as the LAST
// X-Forwarded-For entry; earlier entries can be forged by the client.
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : (req.socket && req.socket.remoteAddress) || "unknown";
}

function isHttps(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" || !!(req.socket && req.socket.encrypted);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function sessionCookie(req, token, maxAgeSec) {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

// ---- Rate limiting (in memory; fine for a single instance) ---------------
const buckets = new Map(); // "name:key" -> [timestamps]

function allow(name, key, limit, windowMs) {
  const k = name + ":" + key;
  const now = Date.now();
  const arr = (buckets.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(k, arr);
    return false;
  }
  arr.push(now);
  buckets.set(k, arr);
  return true;
}

const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const fresh = arr.filter((t) => now - t < 60 * 60 * 1000);
    if (fresh.length) buckets.set(k, fresh);
    else buckets.delete(k);
  }
}, 10 * 60 * 1000);
if (pruneTimer.unref) pruneTimer.unref();

// ---- Request parsing & guards --------------------------------------------
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("too_large"), { code: "too_large" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(Object.assign(new Error("bad_request"), { code: "bad_request" }));
      }
    });
    req.on("error", () => reject(Object.assign(new Error("bad_request"), { code: "bad_request" })));
  });
}

// Returns an error code string if the request fails the CSRF checks.
function csrfProblem(req) {
  if (req.headers["x-tm-requested-with"] !== "web") return "csrf";
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return "csrf";
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch (e) { return "csrf"; }
    const mine = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    if (host !== mine) return "csrf";
  }
  return null;
}

// ---- Credentials ---------------------------------------------------------
function validUsername(u) {
  return typeof u === "string" && USERNAME_RE.test(u) && !RESERVED.has(u);
}

async function hashAuthKey(authKeyHex, salt) {
  return scrypt(Buffer.from(authKeyHex, "hex"), salt, 32, SCRYPT_PARAMS);
}

const DUMMY_SALT = crypto.randomBytes(16);
const DUMMY_HASH = crypto.randomBytes(32);

// ---- Sessions ------------------------------------------------------------
function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  getDb().prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha256Hex(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

function tokenFromRequest(req) {
  const c = parseCookies(req)[SESSION_COOKIE];
  if (c) return c;
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

function sessionUser(req) {
  const token = tokenFromRequest(req);
  if (!token || token.length > 100) return null;
  const row = getDb().prepare(
    "SELECT u.id AS id, u.username AS username, u.settings AS settings, u.settings_updated_at AS settingsUpdatedAt, s.expires_at AS expiresAt " +
    "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?"
  ).get(sha256Hex(token));
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
    return null;
  }
  return row;
}

// ---- Settings whitelist --------------------------------------------------
// Only these display preferences sync. Security-relevant settings (auto-lock,
// send delay) are deliberately excluded so an account can never weaken the
// protection on another device.
function normalizeSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out = {};
  if (input.currency !== undefined) {
    if (typeof input.currency !== "string" || !/^[a-z]{2,5}$/.test(input.currency)) return null;
    out.currency = input.currency;
  }
  if (input.language !== undefined) {
    if (typeof input.language !== "string" || !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(input.language)) return null;
    out.language = input.language;
  }
  if (input.watchlist !== undefined) {
    if (!Array.isArray(input.watchlist) || input.watchlist.length > 200) return null;
    const seen = new Set();
    for (const s of input.watchlist) {
      if (typeof s !== "string" || !/^[A-Za-z0-9]{1,12}$/.test(s)) return null;
      seen.add(s.toUpperCase());
    }
    out.watchlist = Array.from(seen);
  }
  const json = JSON.stringify(out);
  if (Buffer.byteLength(json) > MAX_SETTINGS_BYTES) return null;
  return out;
}

function parseStoredSettings(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

// ---- Route handlers ------------------------------------------------------
async function handleRegister(req, res) {
  if (!allow("register-ip", clientIp(req), 5, 60 * 60 * 1000)) return fail(res, 429, "rate_limited");
  const body = await readJson(req);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!validUsername(username) || typeof body.authKey !== "string" || !AUTH_KEY_RE.test(body.authKey)) {
    return fail(res, 400, "bad_request");
  }
  const d = getDb();
  if (d.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) return fail(res, 409, "username_taken");
  const salt = crypto.randomBytes(16);
  const hash = await hashAuthKey(body.authKey, salt);
  let userId;
  try {
    const r = d.prepare("INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)").run(username, salt, hash, Date.now());
    userId = Number(r.lastInsertRowid);
  } catch (e) {
    return fail(res, 409, "username_taken"); // lost a race for the same name
  }
  const token = createSession(userId);
  sendJson(res, 201, { username, settings: null, settingsUpdatedAt: null }, { "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
}

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (!allow("login-ip", ip, 20, 15 * 60 * 1000)) return fail(res, 429, "rate_limited");
  const body = await readJson(req);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!validUsername(username) || typeof body.authKey !== "string" || !AUTH_KEY_RE.test(body.authKey)) {
    return fail(res, 401, "bad_credentials");
  }
  if (!allow("login-user", username, 8, 15 * 60 * 1000)) return fail(res, 429, "rate_limited");
  const d = getDb();
  const user = d.prepare("SELECT id, username, salt, hash, settings, settings_updated_at AS settingsUpdatedAt FROM users WHERE username = ?").get(username);
  // Do the same amount of work whether or not the user exists, so response
  // time doesn't reveal which usernames are registered.
  const salt = user ? Buffer.from(user.salt) : DUMMY_SALT;
  const expected = user ? Buffer.from(user.hash) : DUMMY_HASH;
  const got = await hashAuthKey(body.authKey, salt);
  if (!user || !crypto.timingSafeEqual(got, expected)) return fail(res, 401, "bad_credentials");
  d.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  const token = createSession(user.id);
  sendJson(res, 200, {
    username: user.username,
    settings: parseStoredSettings(user.settings),
    settingsUpdatedAt: user.settingsUpdatedAt || null,
  }, { "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
}

function handleLogout(req, res) {
  const token = tokenFromRequest(req);
  if (token) getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
  sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
}

function handleMe(req, res) {
  const user = sessionUser(req);
  if (!user) return fail(res, 401, "unauthorized");
  sendJson(res, 200, {
    username: user.username,
    settings: parseStoredSettings(user.settings),
    settingsUpdatedAt: user.settingsUpdatedAt || null,
  });
}

async function handleSettingsPut(req, res) {
  const user = sessionUser(req);
  if (!user) return fail(res, 401, "unauthorized");
  if (!allow("settings-user", String(user.id), 60, 60 * 1000)) return fail(res, 429, "rate_limited");
  const body = await readJson(req);
  const settings = normalizeSettings(body.settings);
  if (!settings) return fail(res, 400, "bad_request");
  const now = Date.now();
  getDb().prepare("UPDATE users SET settings = ?, settings_updated_at = ? WHERE id = ?").run(JSON.stringify(settings), now, user.id);
  sendJson(res, 200, { settings, settingsUpdatedAt: now });
}

async function handleDelete(req, res) {
  const user = sessionUser(req);
  if (!user) return fail(res, 401, "unauthorized");
  if (!allow("delete-user", String(user.id), 5, 15 * 60 * 1000)) return fail(res, 429, "rate_limited");
  const body = await readJson(req);
  if (typeof body.authKey !== "string" || !AUTH_KEY_RE.test(body.authKey)) return fail(res, 400, "bad_request");
  const row = getDb().prepare("SELECT salt, hash FROM users WHERE id = ?").get(user.id);
  const got = await hashAuthKey(body.authKey, Buffer.from(row.salt));
  if (!crypto.timingSafeEqual(got, Buffer.from(row.hash))) return fail(res, 401, "bad_credentials");
  getDb().prepare("DELETE FROM users WHERE id = ?").run(user.id); // sessions go with it (ON DELETE CASCADE)
  sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
}

// Returns true if the request was handled here; false to fall through to the
// static file server.
function handleAccountsApi(req, res) {
  const url = (req.url || "").split("?")[0];
  if (!url.startsWith("/api/account/")) return false;

  const route = url.slice("/api/account/".length);

  if (route === "status" && req.method === "GET") {
    sendJson(res, 200, { enabled: isEnabled() });
    return true;
  }

  if (!isEnabled()) {
    fail(res, 503, "unavailable");
    return true;
  }

  const routes = {
    "POST register": handleRegister,
    "POST login": handleLogin,
    "POST logout": handleLogout,
    "GET me": handleMe,
    "PUT settings": handleSettingsPut,
    "POST delete": handleDelete,
  };
  const handler = routes[req.method + " " + route];
  if (!handler) {
    fail(res, 404, "not_found");
    return true;
  }

  if (req.method !== "GET") {
    const problem = csrfProblem(req);
    if (problem) {
      fail(res, 403, problem);
      return true;
    }
  }

  Promise.resolve()
    .then(() => handler(req, res))
    .catch((e) => {
      if (res.headersSent) return;
      if (e && e.code === "too_large") return fail(res, 413, "too_large");
      if (e && e.code === "bad_request") return fail(res, 400, "bad_request");
      console.error("[accounts] Unexpected error:", e && e.message);
      fail(res, 500, "server_error");
    });
  return true;
}

module.exports = { handleAccountsApi, isEnabled, normalizeSettings };
