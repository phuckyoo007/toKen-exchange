// admin-api.js
// A small, token-protected admin surface for the person running this server.
//
// SCOPE / WHAT THIS DOES NOT DO
// This never exposes anything that would let the operator (or anyone who
// steals this token) touch user funds or read a user's decrypted vault:
// - No private keys, recovery phrases, or wallet passwords ever touch this
//   server (see auth-api.js) -- there is nothing here to leak.
// - The encrypted vault `bundle` itself is never returned by any admin route,
//   only metadata (username, timestamps, vault version, session count).
// - There is no "master key" that decrypts a user's backup. Password
//   strength remains the only thing protecting a user's backup, by design.
//
// AUTH
// A single bearer token, ADMIN_TOKEN, set as a server environment variable
// (e.g. a Railway variable) -- never hard-coded, never shipped to the
// browser bundle. Requests must send `Authorization: Bearer <token>`.
// If ADMIN_TOKEN isn't set, every admin route responds 503: there is no
// "default" admin password.

"use strict";

const crypto = require("crypto");
const { _test } = require("./auth-api");
const db = _test.db;
const persist = _test.persist;
const resetLoginFailures = _test.resetLoginFailures;
const resetIpLimits = _test.resetIpLimits;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// Constant-time compare so token-checking can't be timed to guess it.
function tokenMatches(supplied) {
  if (!ADMIN_TOKEN || typeof supplied !== "string") return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authOk(req) {
  const h = String(req.headers["authorization"] || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? tokenMatches(m[1]) : false;
}

// crude in-memory throttle on wrong tokens, per-process
const failures = new Map(); // ip -> [timestamps]
function tooManyFailures(ip) {
  const now = Date.now();
  const arr = (failures.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  failures.set(ip, arr);
  return arr.length >= 20;
}
function recordFailure(ip) {
  const arr = failures.get(ip) || [];
  arr.push(Date.now());
  failures.set(ip, arr);
}

function readJsonBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > 8 * 1024) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
    catch (e) { cb(e); }
  });
}

function activeSessionCounts() {
  const state = db();
  const counts = {};
  for (const s of Object.values(state.sessions)) {
    counts[s.username] = (counts[s.username] || 0) + 1;
  }
  return counts;
}

function userSummary() {
  const state = db();
  const sessionCounts = activeSessionCounts();
  return Object.keys(state.users).sort().map((username) => {
    const u = state.users[username];
    return {
      username,
      createdAt: u.createdAt,
      vaultVersion: u.vault ? u.vault.version : 0,
      updatedAt: u.vault ? u.vault.updatedAt : null,
      activeSessions: sessionCounts[username] || 0,
      backupHistoryCount: (u.history || []).length,
      disabled: !!u.disabled,
    };
  });
}

async function handle(req, res, url, method, ip) {
  if (url === "/api/admin/stats" && method === "GET") {
    const users = userSummary();
    const state = db();
    return sendJson(res, 200, {
      totalUsers: users.length,
      totalActiveSessions: Object.keys(state.sessions).length,
      users,
    });
  }

  if (url === "/api/admin/sign-out-all" && method === "POST") {
    const body = await new Promise((resolve) => readJsonBody(req, (e, b) => resolve(e ? {} : b)));
    const username = String(body.username || "");
    const state = db();
    if (!Object.prototype.hasOwnProperty.call(state.users, username)) {
      return sendJson(res, 404, { error: "No such account." });
    }
    let removed = 0;
    for (const k of Object.keys(state.sessions)) {
      if (state.sessions[k].username === username) { delete state.sessions[k]; removed++; }
    }
    persist();
    return sendJson(res, 200, { ok: true, sessionsRemoved: removed });
  }

  if (url === "/api/admin/set-disabled" && method === "POST") {
    const body = await new Promise((resolve) => readJsonBody(req, (e, b) => resolve(e ? {} : b)));
    const username = String(body.username || "");
    const disabled = !!body.disabled;
    const state = db();
    if (!Object.prototype.hasOwnProperty.call(state.users, username)) {
      return sendJson(res, 404, { error: "No such account." });
    }
    state.users[username].disabled = disabled;
    let removed = 0;
    if (disabled) {
      // Disabling kicks the account off every device immediately, the same
      // as sign-out-all -- otherwise an already-signed-in session would keep
      // working until it naturally expired.
      for (const k of Object.keys(state.sessions)) {
        if (state.sessions[k].username === username) { delete state.sessions[k]; removed++; }
      }
    }
    persist();
    return sendJson(res, 200, { ok: true, disabled, sessionsRemoved: removed });
  }

  if (url === "/api/admin/reset-login-limits" && method === "POST") {
    const body = await new Promise((resolve) => readJsonBody(req, (e, b) => resolve(e ? {} : b)));
    const username = String(body.username || "");
    if (!username) return sendJson(res, 400, { error: "username is required." });
    const had = resetLoginFailures(username);
    return sendJson(res, 200, { ok: true, hadLimit: had });
  }

  if (url === "/api/admin/reset-ip-limits" && method === "POST") {
    const body = await new Promise((resolve) => readJsonBody(req, (e, b) => resolve(e ? {} : b)));
    const targetIp = String(body.ip || "");
    if (!targetIp) return sendJson(res, 400, { error: "ip is required." });
    const had = resetIpLimits(targetIp);
    return sendJson(res, 200, { ok: true, hadLimit: had });
  }

  if (url === "/api/admin/delete-account" && method === "POST") {
    const body = await new Promise((resolve) => readJsonBody(req, (e, b) => resolve(e ? {} : b)));
    const username = String(body.username || "");
    const state = db();
    if (!Object.prototype.hasOwnProperty.call(state.users, username)) {
      return sendJson(res, 404, { error: "No such account." });
    }
    delete state.users[username];
    for (const k of Object.keys(state.sessions)) {
      if (state.sessions[k].username === username) delete state.sessions[k];
    }
    persist();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: "Not found." });
}

function handleAdminApi(req, res) {
  const url = req.url.split("?")[0];
  if (!url.startsWith("/api/admin/")) return false;

  if (!ADMIN_TOKEN) {
    sendJson(res, 503, { error: "Admin access isn't configured on this server (ADMIN_TOKEN not set)." });
    return true;
  }

  const ip = req.socket.remoteAddress || "unknown";
  if (tooManyFailures(ip)) {
    sendJson(res, 429, { error: "Too many failed admin attempts from this network. Try again later." });
    return true;
  }
  if (!authOk(req)) {
    recordFailure(ip);
    sendJson(res, 401, { error: "Invalid or missing admin token." });
    return true;
  }

  if (!["GET", "POST"].includes(req.method)) {
    sendJson(res, 405, { error: "Method not allowed." });
    return true;
  }

  handle(req, res, url, req.method, ip).catch((e) => {
    if (res.headersSent) return;
    console.error("[admin] unexpected error:", e);
    sendJson(res, 500, { error: "Something went wrong." });
  });
  return true;
}

module.exports = { handleAdminApi };
