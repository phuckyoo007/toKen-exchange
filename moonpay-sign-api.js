// moonpay-sign-api.js
// Small server-side helper that signs MoonPay on-ramp widget URLs, so the
// Buy screen can safely pre-fill the user's wallet address instead of
// making them paste it in by hand.
//
// WHY THIS EXISTS
// MoonPay's widget refuses to load at all if a walletAddress (or
// walletAddresses) parameter is present without a valid `signature` --
// confirmed against MoonPay's own "Enhance security using signed URLs"
// docs (https://dev.moonpay.com/docs/on-ramp-enhance-security-using-signed-urls),
// checked Sept 2026: "Passing the signature parameter is mandatory if
// you're using the walletAddress or walletAddresses parameter." Producing
// that signature requires the MoonPay SECRET key (HMAC-SHA256 over the
// URL's query string), and that key must never exist in the extension or
// the website's client-side code -- see lib/buy-config.js's header
// comment for why. This tiny backend is the "future improvement" that
// comment already called out: it holds the secret key (as the
// MOONPAY_SECRET_KEY environment variable -- set in Railway's dashboard,
// never committed to this repo) and hands back a ready-to-open signed
// URL, so the secret key itself never leaves the server.
//
// WHAT YOU (THE DEVELOPER) STILL NEED TO DO
// Set MOONPAY_SECRET_KEY in this service's environment (Railway ->
// Variables), using the secret key from your MoonPay dashboard (starts
// with sk_test_ for sandbox, sk_live_ once approved for production). Set
// it there directly -- never paste a secret key into a chat or commit it
// to a file in this repo. Until it's set, isSigningConfigured() returns
// false and the client falls back to today's manual "paste your address"
// flow -- nothing breaks, the auto-fill is just unavailable.
//
// SIGNING ALGORITHM (verified against MoonPay's own docs AND their
// published test vector, Sept 2026 -- see the git history for this file
// for the local verification script): HMAC-SHA256 of the URL's query
// string (including the leading "?", excluding scheme/host/path) using
// the secret key, base64-encoded, then URL-encoded and appended as the
// URL's last parameter: `&signature=<encoded>`.
//
// WHO CAN CALL THIS
// This endpoint takes a MoonPay URL the caller already built (with its
// own apiKey/currencyCode/walletAddress params) and just appends a valid
// signature -- it doesn't accept or need any of this project's own
// secrets in the request. The `apiKey` it signs is MoonPay's PUBLISHABLE
// key, which is not sensitive (it's already visible in this project's own
// client-side lib/buy-config.js). Reachable by both the website and the
// browser extension (see the CORS header below) -- restricted to
// moonpay.com hosts and lightly rate-limited per IP, mainly to deter
// casual abuse rather than to guard a real secret.

const crypto = require("crypto");
const { URLSearchParams } = require("url");

const MOONPAY_SECRET_KEY = process.env.MOONPAY_SECRET_KEY || "";
const ALLOWED_HOST_RE = /^https:\/\/(buy|sell|sell-sandbox)\.moonpay\.com\//;

// Very small per-IP throttle, same pattern as feature-requests-api.js --
// not a real rate limiter, just enough friction to deter a naive script.
const signTimestamps = new Map(); // ip -> [timestamps]
const SIGN_LIMIT = 60;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function withinLimit(ip) {
  const now = Date.now();
  const times = (signTimestamps.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= SIGN_LIMIT) {
    signTimestamps.set(ip, times);
    return false;
  }
  times.push(now);
  signTimestamps.set(ip, times);
  return true;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function isSigningConfigured() {
  return !!MOONPAY_SECRET_KEY;
}

function signQueryString(queryStringWithLeadingQuestionMark) {
  return crypto.createHmac("sha256", MOONPAY_SECRET_KEY).update(queryStringWithLeadingQuestionMark).digest("base64");
}

// Appends a valid `signature` param to a MoonPay widget URL that already
// has its own query params (apiKey, walletAddress, etc.) set.
function signUrl(baseUrlWithParams) {
  const questionMarkIndex = baseUrlWithParams.indexOf("?");
  const urlNoQuery = baseUrlWithParams.slice(0, questionMarkIndex);
  const query = baseUrlWithParams.slice(questionMarkIndex); // includes leading "?"
  const signature = signQueryString(query);
  return `${urlNoQuery}${query}&signature=${encodeURIComponent(signature)}`;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    // Lets the browser extension (a chrome-extension:// origin) call this
    // same-project API too, so the "embed instead of a new tab" fix and
    // its address auto-fill work the same way on both the website and the
    // extension. See the header comment above for why this is safe to
    // leave open.
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

// Returns true if the request was handled here (caller should not fall
// through to the static file handler); false otherwise.
function handleMoonpaySignApi(req, res) {
  const [url, queryString] = req.url.split("?");
  if (url !== "/api/moonpay-sign") return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    res.end();
    return true;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." });
    return true;
  }

  if (!isSigningConfigured()) {
    sendJson(res, 200, { configured: false });
    return true;
  }

  if (!withinLimit(clientIp(req))) {
    sendJson(res, 429, { error: "Too many requests recently. Try again later." });
    return true;
  }

  const params = new URLSearchParams(queryString || "");
  const rawUrl = params.get("url") || "";
  if (!ALLOWED_HOST_RE.test(rawUrl)) {
    sendJson(res, 400, { error: "Missing or invalid url parameter." });
    return true;
  }

  try {
    sendJson(res, 200, { configured: true, url: signUrl(rawUrl) });
  } catch (e) {
    sendJson(res, 500, { error: "Could not sign URL." });
  }
  return true;
}

module.exports = { handleMoonpaySignApi, isSigningConfigured };
