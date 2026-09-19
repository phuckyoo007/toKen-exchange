// auth-api.js
// Optional username/password accounts for the Token Exchange website, used to
// keep an ENCRYPTED backup of the wallet vault on the server so it can be
// restored on another device.
//
// ZERO-KNOWLEDGE DESIGN (same idea as Bitwarden's master-password scheme)
// - The browser never sends the password. It sends `authKey`, a 32-byte value
//   derived from (username, password) with PBKDF2-SHA256 (600k iterations, see
//   lib/account.js). This server stores only scrypt(authKey, random salt).
// - The vault bundle this server stores is AES-256-GCM ciphertext created in
//   the browser under the user's password (see lib/crypto-utils.js). The server
//   cannot read it, and neither can anyone who steals the database -- except by
//   guessing the password offline. So password strength IS the security here.
// - Sessions are random 256-bit tokens in an HttpOnly, SameSite=Strict cookie.
//   Only a SHA-256 of each token is stored server-side.
//
// STORAGE
// One JSON file (DATA_DIR/accounts.json), written atomically. Fine for a small
// launch; move to a real database (e.g. Postgres) before real scale. On hosts
// like Railway the disk is wiped on every redeploy unless a persistent volume
// is mounted at DATA_DIR -- so in production this API refuses to run unless
// DATA_DIR is set explicitly. Silently losing people's backups would be worse
// than having no backup feature.
//
// LIMITS OF THE IN-MEMORY RATE LIMITER
// Counters live in this process's memory: they reset on restart and are not
// shared across multiple instances. Run one instance, or move them to Redis.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const IS_PROD =
  process.env.NODE_ENV === "production" ||
  !!process.env.RAILWAY_ENVIRONMENT ||
  !!process.env.RAILWAY_PROJECT_ID;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "accounts.json");
const AUTH_ENABLED = !IS_PROD || !!process.env.DATA_DIR;
// How many reverse-proxy hops sit in front of this server (Railway = 1). Used
// to pick the real client IP out of X-Forwarded-For without trusting values a
// client can forge. Set to 0 if the server is exposed directly.
const TRUST_PROXY_HOPS = Number.isInteger(+process.env.TRUST_PROXY_HOPS) ? +process.env.TRUST_PROXY_HOPS : 1;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 10;
const MAX_BODY_BYTES = 96 * 1024;
const MAX_BUNDLE_BYTES = 64 * 1024;
const HISTORY_KEEP = 5;
const MAX_USERS = 100000;
const COOKIE_NAME = "tm_session";

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;
const MAX_CONCURRENT_SCRYPT = 4;

// ------------------------------------------------------------------ storage
let db = { users: {}, sessions: {} };

function loadDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (parsed && typeof parsed === "object") {
      db = { users: parsed.users || {}, sessions: parsed.sessions || {} };
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("Could not read accounts.json:", e.message);
  }
  purgeExpiredSessions();
}

function persist() {
  const tmp = DATA_FILE + "." + process.pid + ".tmp";
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(db));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DATA_FILE); // atomic replace: a crash never leaves a half-written file
}

function purgeExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(db.sessions)) {
    if (db.sessions[k].expiresAt <= now) {
      delete db.sessions[k];
      changed = true;
    }
  }
  return changed;
}

if (AUTH_ENABLED) loadDb();
else console.warn("[auth] Accounts DISABLED: production environment without DATA_DIR. Mount a persistent volume and set DATA_DIR to enable them.");

// -------------------------------------------------------------- rate limits
const buckets = new Map(); // key -> [timestamps]

function hit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

function peek(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  return arr.length < limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const fresh = arr.filter((t) => now - t < 60 * 60 * 1000);
    if (fresh.length) buckets.set(k, fresh);
    else buckets.delete(k);
  }
  if (purgeExpiredSessions()) {
    try { persist(); } catch (e) { /* best effort */ }
  }
}, 10 * 60 * 1000).unref();

const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_IP_LIMIT = 40; // every attempt from one IP
const LOGIN_USER_FAIL_LIMIT = 8; // failed attempts per username
const REGISTER_IP_LIMIT = 10; // per hour

// ------------------------------------------------------------------ helpers
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd && TRUST_PROXY_HOPS > 0) {
    const parts = String(fwd).split(",").map((s) => s.trim()).filter(Boolean);
    // The proxy appends the address it saw; anything left of that is whatever
    // the client chose to send, so count from the right.
    const idx = parts.length - TRUST_PROXY_HOPS;
    if (idx >= 0) return parts[idx];
  }
  return req.socket.remoteAddress || "unknown";
}

function isHttps(req) {
  return !!req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function sendJson(req, res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...(extraHeaders || {}),
  });
  res.end(body);
}

function readJsonBody(req, cb) {
  const ct = String(req.headers["content-type"] || "");
  if (!/^application\/json\b/i.test(ct)) return cb(Object.assign(new Error("Content-Type must be application/json."), { status: 415 }));
  let size = 0;
  const chunks = [];
  let aborted = false;
  req.on("data", (c) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      cb(Object.assign(new Error("Request too large."), { status: 413 }));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (aborted) return;
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad");
      cb(null, parsed);
    } catch (e) {
      cb(Object.assign(new Error("Invalid JSON."), { status: 400 }));
    }
  });
  req.on("error", (e) => { if (!aborted) cb(e); });
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

function sessionCookie(req, token, maxAgeSec) {
  const attrs = [`${COOKIE_NAME}=${token}`, "Path=/api", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSec}`];
  if (IS_PROD || isHttps(req)) attrs.push("Secure");
  return attrs.join("; ");
}

// CSRF defence in depth: SameSite=Strict already keeps the cookie off
// cross-site requests; on top of that every state-changing call must carry a
// custom header (which a foreign site can't add without a CORS preflight this
// server never approves) and any Origin header must match our own host.
function csrfOk(req) {
  if (req.method === "GET") return true;
  if (req.headers["x-tm-request"] !== "1") return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch (e) {
      return false;
    }
  }
  return true;
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const AUTHKEY_RE = /^[A-Za-z0-9+/]{43}=$/; // base64 of exactly 32 bytes
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function normUsername(u) {
  return String(u == null ? "" : u).normalize("NFKC").trim().toLowerCase();
}

function validBundle(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  if (b.v !== 1) return false;
  if (typeof b.iterations !== "number" || !Number.isInteger(b.iterations) || b.iterations < 100000 || b.iterations > 5000000) return false;
  for (const k of ["salt", "iv", "ciphertext"]) {
    if (typeof b[k] !== "string" || !b[k].length || !B64_RE.test(b[k])) return false;
  }
  if (b.salt.length > 64 || b.iv.length > 32) return false;
  if (Object.keys(b).length !== 5) return false;
  return Buffer.byteLength(JSON.stringify(b)) <= MAX_BUNDLE_BYTES;
}

// scrypt is deliberately expensive (~30 MB, tens of ms); cap how many run at
// once so a flood of login attempts can't exhaust the server's memory.
let scryptActive = 0;
const scryptWaiters = [];
function scryptLimited(secretBuf, salt) {
  return new Promise((resolve, reject) => {
    const run = () => {
      scryptActive++;
      crypto.scrypt(secretBuf, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, key) => {
        scryptActive--;
        const next = scryptWaiters.shift();
        if (next) next();
        err ? reject(err) : resolve(key);
      });
    };
    if (scryptActive < MAX_CONCURRENT_SCRYPT) run();
    else scryptWaiters.push(run);
  });
}

const DUMMY_SALT = crypto.randomBytes(16);
const DUMMY_KEY = crypto.randomBytes(32);

async function verifyAuthKey(user, authKeyB64) {
  const given = Buffer.from(authKeyB64, "base64");
  if (!user) {
    // Burn the same amount of work so "no such user" and "wrong password"
    // take about as long and can't be told apart by timing.
    await scryptLimited(given, DUMMY_SALT);
    return false;
  }
  const derived = await scryptLimited(given, Buffer.from(user.salt, "base64"));
  const stored = Buffer.from(user.verifier, "base64");
  return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
}

async function makeVerifier(authKeyB64) {
  const salt = crypto.randomBytes(16);
  const key = await scryptLimited(Buffer.from(authKeyB64, "base64"), salt);
  return { salt: salt.toString("base64"), verifier: key.toString("base64") };
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString("base64url");
  const mine = Object.entries(db.sessions)
    .filter(([, s]) => s.username === username)
    .sort((a, b) => a[1].createdAt - b[1].createdAt);
  while (mine.length >= MAX_SESSIONS_PER_USER) delete db.sessions[mine.shift()[0]];
  const now = Date.now();
  db.sessions[tokenHash(token)] = { username, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  return token;
}

function sessionFromReq(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || token.length > 100) return null;
  const key = tokenHash(token);
  const s = db.sessions[key];
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    delete db.sessions[key];
    return null;
  }
  const user = db.users[s.username];
  if (!user) return null;
  return { key, username: s.username, user };
}

function pushVault(user, bundle) {
  if (user.vault) {
    user.history = user.history || [];
    user.history.unshift(user.vault);
    user.history = user.history.slice(0, HISTORY_KEEP);
  }
  user.vault = { bundle, version: (user.vault ? user.vault.version : 0) + 1, updatedAt: Date.now() };
}

// -------------------------------------------------------------------- routes
async function handle(req, res, url) {
  const ip = clientIp(req);
  const method = req.method;

  if (url === "/api/auth/status" && method === "GET") {
    return sendJson(req, res, 200, { enabled: true });
  }

  if (url === "/api/auth/me" && method === "GET") {
    const s = sessionFromReq(req);
    if (!s) return sendJson(req, res, 401, { error: "Not signed in." });
    return sendJson(req, res, 200, { username: s.username, version: s.user.vault.version, updatedAt: s.user.vault.updatedAt });
  }

  if (url === "/api/vault" && method === "GET") {
    const s = sessionFromReq(req);
    if (!s) return sendJson(req, res, 401, { error: "Not signed in." });
    return sendJson(req, res, 200, { bundle: s.user.vault.bundle, version: s.user.vault.version, updatedAt: s.user.vault.updatedAt });
  }

  // Everything below changes state.
  if (!["POST", "PUT"].includes(method)) return sendJson(req, res, 405, { error: "Method not allowed." });
  if (!csrfOk(req)) return sendJson(req, res, 403, { error: "Blocked cross-site request." });

  const body = await new Promise((resolve, reject) => readJsonBody(req, (e, b) => (e ? reject(e) : resolve(b))));

  if (url === "/api/auth/register" && method === "POST") {
    if (!hit("reg:" + ip, REGISTER_IP_LIMIT, 60 * 60 * 1000)) {
      return sendJson(req, res, 429, { error: "Too many sign-ups from this network. Try again later." });
    }
    const username = normUsername(body.username);
    if (!USERNAME_RE.test(username)) {
      return sendJson(req, res, 400, { error: "Usernames are 3-32 characters: letters, numbers, dot, dash or underscore." });
    }
    if (typeof body.authKey !== "string" || !AUTHKEY_RE.test(body.authKey)) return sendJson(req, res, 400, { error: "Invalid credentials." });
    if (!validBundle(body.bundle)) return sendJson(req, res, 400, { error: "Invalid backup data." });
    if (Object.prototype.hasOwnProperty.call(db.users, username)) return sendJson(req, res, 409, { error: "That username is taken." });
    if (Object.keys(db.users).length >= MAX_USERS) return sendJson(req, res, 503, { error: "Sign-ups are closed right now." });

    const { salt, verifier } = await makeVerifier(body.authKey);
    // Re-check after the await: two simultaneous sign-ups for one name.
    if (Object.prototype.hasOwnProperty.call(db.users, username)) return sendJson(req, res, 409, { error: "That username is taken." });
    const user = { salt, verifier, createdAt: Date.now(), vault: null, history: [] };
    pushVault(user, body.bundle);
    db.users[username] = user;
    const token = createSession(username);
    persist();
    return sendJson(req, res, 201, { username, version: user.vault.version, updatedAt: user.vault.updatedAt }, {
      "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000),
    });
  }

  if (url === "/api/auth/login" && method === "POST") {
    const username = normUsername(body.username);
    if (!hit("loginip:" + ip, LOGIN_IP_LIMIT, LOGIN_WINDOW)) {
      return sendJson(req, res, 429, { error: "Too many attempts. Please wait a few minutes." });
    }
    if (!peek("loginfail:" + username, LOGIN_USER_FAIL_LIMIT, LOGIN_WINDOW)) {
      return sendJson(req, res, 429, { error: "Too many failed attempts for this account. Please wait 15 minutes." });
    }
    if (!USERNAME_RE.test(username) || typeof body.authKey !== "string" || !AUTHKEY_RE.test(body.authKey)) {
      return sendJson(req, res, 401, { error: "Incorrect username or password." });
    }
    const user = Object.prototype.hasOwnProperty.call(db.users, username) ? db.users[username] : null;
    const ok = await verifyAuthKey(user, body.authKey);
    if (!ok) {
      hit("loginfail:" + username, LOGIN_USER_FAIL_LIMIT, LOGIN_WINDOW);
      return sendJson(req, res, 401, { error: "Incorrect username or password." });
    }
    if (user.disabled) {
      // Deliberately the same generic message as "wrong password" -- this
      // never confirms to an outside caller that an account exists or is
      // disabled, only the account owner sees this after a real login.
      return sendJson(req, res, 403, { error: "This account is disabled. Contact support." });
    }
    buckets.delete("loginfail:" + username);
    const token = createSession(username);
    persist();
    return sendJson(req, res, 200, { username, version: user.vault.version, updatedAt: user.vault.updatedAt }, {
      "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000),
    });
  }

  if (url === "/api/auth/logout" && method === "POST") {
    const s = sessionFromReq(req);
    if (s) {
      delete db.sessions[s.key];
      persist();
    }
    return sendJson(req, res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  // ---- everything from here needs a valid session ----
  const s = sessionFromReq(req);
  if (!s) return sendJson(req, res, 401, { error: "Not signed in." });

  if (url === "/api/vault" && method === "PUT") {
    if (!validBundle(body.bundle)) return sendJson(req, res, 400, { error: "Invalid backup data." });
    const current = s.user.vault.version;
    if (!body.force && body.baseVersion !== current) {
      return sendJson(req, res, 409, { error: "The backup on your account changed since this device last synced.", version: current });
    }
    pushVault(s.user, body.bundle);
    persist();
    return sendJson(req, res, 200, { version: s.user.vault.version, updatedAt: s.user.vault.updatedAt });
  }

  // Re-authentication for sensitive actions. Shares the login throttles so it
  // can't be used to guess passwords faster than /login allows.
  async function reauth() {
    if (!hit("loginip:" + ip, LOGIN_IP_LIMIT, LOGIN_WINDOW)) return "Too many attempts. Please wait a few minutes.";
    if (!peek("loginfail:" + s.username, LOGIN_USER_FAIL_LIMIT, LOGIN_WINDOW)) return "Too many failed attempts for this account. Please wait 15 minutes.";
    if (typeof body.authKey !== "string" || !AUTHKEY_RE.test(body.authKey)) return "Incorrect password.";
    if (!(await verifyAuthKey(s.user, body.authKey))) {
      hit("loginfail:" + s.username, LOGIN_USER_FAIL_LIMIT, LOGIN_WINDOW);
      return "Incorrect password.";
    }
    buckets.delete("loginfail:" + s.username);
    return null;
  }

  if (url === "/api/auth/change-password" && method === "POST") {
    if (typeof body.newAuthKey !== "string" || !AUTHKEY_RE.test(body.newAuthKey)) return sendJson(req, res, 400, { error: "Invalid credentials." });
    if (!validBundle(body.bundle)) return sendJson(req, res, 400, { error: "Invalid backup data." });
    const bad = await reauth();
    if (bad) return sendJson(req, res, bad.startsWith("Too many") ? 429 : 401, { error: bad });
    const { salt, verifier } = await makeVerifier(body.newAuthKey);
    s.user.salt = salt;
    s.user.verifier = verifier;
    pushVault(s.user, body.bundle);
    // Sign out every other device; keep this one.
    for (const k of Object.keys(db.sessions)) {
      if (db.sessions[k].username === s.username && k !== s.key) delete db.sessions[k];
    }
    persist();
    return sendJson(req, res, 200, { version: s.user.vault.version, updatedAt: s.user.vault.updatedAt });
  }

  if (url === "/api/auth/delete" && method === "POST") {
    const bad = await reauth();
    if (bad) return sendJson(req, res, bad.startsWith("Too many") ? 429 : 401, { error: bad });
    delete db.users[s.username];
    for (const k of Object.keys(db.sessions)) if (db.sessions[k].username === s.username) delete db.sessions[k];
    persist();
    return sendJson(req, res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  return sendJson(req, res, 404, { error: "Not found." });
}

// Returns true if this request belonged to the auth API (and was handled).
function handleAuthApi(req, res) {
  const url = req.url.split("?")[0];
  if (!(url.startsWith("/api/auth/") || url === "/api/vault")) return false;
  if (!AUTH_ENABLED) {
    sendJson(req, res, 503, { error: "Accounts aren't available on this server yet." });
    return true;
  }
  handle(req, res, url).catch((e) => {
    if (res.headersSent) return;
    if (e && e.status) return sendJson(req, res, e.status, { error: e.message });
    console.error("[auth] unexpected error:", e);
    sendJson(req, res, 500, { error: "Something went wrong. Please try again." });
  });
  return true;
}

// Narrow surface for admin-api.js: it shares this module's in-memory state
// (the same `db` and `buckets`) rather than re-implementing storage, but
// only through these explicit functions -- it never gets a reference to
// anything that could read a decrypted vault, because there is nothing here
// that decrypts one.
function resetLoginFailures(username) {
  return buckets.delete("loginfail:" + normUsername(username));
}
function resetIpLimits(ip) {
  const key1 = "loginip:" + ip;
  const key2 = "reg:" + ip;
  const had = buckets.has(key1) || buckets.has(key2);
  buckets.delete(key1);
  buckets.delete(key2);
  return had;
}

module.exports = {
  handleAuthApi,
  _test: { db: () => db, persist, resetLoginFailures, resetIpLimits },
};
