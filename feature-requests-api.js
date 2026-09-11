// feature-requests-api.js
// Minimal, dependency-free backend for the public "feature request board"
// (see lib/feature-requests.js for the client side). No accounts, no
// auth -- anyone can post or upvote, same as a public suggestion box.
// Storage is a flat JSON file rather than a real database: traffic here
// is expected to be light, and this keeps the whole feature to two small
// files with nothing new to provision.
//
// IMPORTANT: on Railway (or most hosts) the filesystem a service writes
// to is wiped on every redeploy unless a persistent volume is mounted at
// DATA_DIR. Until one is attached, requests/upvotes will reset whenever
// this service redeploys. Set the DATA_DIR env var to a mounted volume's
// path to persist across deploys.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "feature-requests.json");

const MAX_TITLE_LEN = 140;
const MAX_DESC_LEN = 2000;
const MAX_REQUESTS_STORED = 2000;

// Very small per-IP throttle to deter spam -- not a real rate limiter,
// just enough friction to stop a naive script. Resets on redeploy along
// with everything else in memory.
const submitTimestamps = new Map(); // ip -> [timestamps]
const upvoteTimestamps = new Map();
const SUBMIT_LIMIT = 5;
const UPVOTE_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function withinLimit(map, ip, limit) {
  const now = Date.now();
  const times = (map.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= limit) {
    map.set(ip, times);
    return false;
  }
  times.push(now);
  map.set(ip, times);
  return true;
}

function loadRequests() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

let requests = loadRequests();

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(requests));
  } catch (e) {
    console.warn("Could not persist feature-requests.json:", e.message);
  }
}

function sanitize(str, maxLen) {
  return String(str || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip control chars, keep \t\n\r
    .trim()
    .slice(0, maxLen);
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function readJsonBody(req, maxBytes, cb) {
  let body = "";
  let tooLarge = false;
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > maxBytes) {
      tooLarge = true;
      req.destroy();
    }
  });
  req.on("end", () => {
    if (tooLarge) return cb(new Error("payload too large"));
    try {
      cb(null, body ? JSON.parse(body) : {});
    } catch (e) {
      cb(new Error("invalid JSON"));
    }
  });
  req.on("error", (e) => cb(e));
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// Returns true if the request was handled here (caller should not fall
// through to the static file handler); false otherwise.
function handleFeatureRequestsApi(req, res) {
  const url = req.url.split("?")[0];

  if (url === "/api/feature-requests" && req.method === "GET") {
    sendJson(res, 200, { requests });
    return true;
  }

  if (url === "/api/feature-requests" && req.method === "POST") {
    const ip = clientIp(req);
    if (!withinLimit(submitTimestamps, ip, SUBMIT_LIMIT)) {
      sendJson(res, 429, { error: "Too many requests posted recently. Try again later." });
      return true;
    }
    readJsonBody(req, 10 * 1024, (err, data) => {
      if (err) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      const title = sanitize(data.title, MAX_TITLE_LEN);
      const description = sanitize(data.description, MAX_DESC_LEN);
      if (!title) {
        sendJson(res, 400, { error: "Title is required." });
        return;
      }
      const entry = {
        id: crypto.randomUUID(),
        title,
        description,
        votes: 0,
        createdAt: Date.now(),
      };
      requests.push(entry);
      if (requests.length > MAX_REQUESTS_STORED) {
        // Drop the oldest, lowest-signal entries first rather than
        // growing the file forever.
        requests.sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
        requests = requests.slice(0, MAX_REQUESTS_STORED);
      }
      persist();
      sendJson(res, 201, entry);
    });
    return true;
  }

  const upvoteMatch = url.match(/^\/api\/feature-requests\/([^/]+)\/upvote$/);
  if (upvoteMatch && req.method === "POST") {
    const ip = clientIp(req);
    if (!withinLimit(upvoteTimestamps, ip, UPVOTE_LIMIT)) {
      sendJson(res, 429, { error: "Too many upvotes recently. Try again later." });
      return true;
    }
    const id = upvoteMatch[1];
    const entry = requests.find((r) => r.id === id);
    if (!entry) {
      sendJson(res, 404, { error: "Not found." });
      return true;
    }
    entry.votes += 1;
    persist();
    sendJson(res, 200, entry);
    return true;
  }

  return false;
}

module.exports = { handleFeatureRequestsApi };
