// market-api.js
// A small, cached relay for the CoinGecko price/market calls the app makes.
//
// WHY THIS EXISTS
// lib/prices.js and lib/token-catalog.js used to call CoinGecko straight from each
// phone/browser. CoinGecko's free tier rate-limits (and sometimes blocks) by IP, and
// mobile-network IPs are shared by thousands of people, so on a phone the coin pages
// showed "Couldn't load more details for this coin right now" with no chart, no market
// stats and no description. Now the app asks THIS server first. The server asks
// CoinGecko once, keeps the answer for a short while and hands the same answer to
// everyone, so one phone's bad luck doesn't matter. If the server can't be reached the
// app still falls back to asking CoinGecko directly, exactly as before.
//
// ENDPOINT   GET /api/market/<coingecko path>?<query>
//   e.g.     /api/market/coins/usd-coin?localization=false&market_data=true...
//            /api/market/llama/prices/current/ethereum:0xA0b8...,coingecko:ethereum   (DefiLlama)
//            /api/market/coins/usd-coin/market_chart?vs_currency=usd&days=7
//   Only the specific read-only CoinGecko paths below are relayed (an allow-list, not an
//   open proxy), only known query parameters are passed on, and values are length/char
//   checked. Nothing about the wallet or its address is ever sent.
//
// CACHING     Fresh answers are reused for a per-path time (30 s - 10 min). If CoinGecko
//             fails, the last good answer (up to 24 h old) is served instead, marked with
//             an "X-Market-Stale: 1" header, rather than an error.
//
// OPTIONAL ENVIRONMENT VARIABLES
//   COINGECKO_API_KEY   free "Demo" key from coingecko.com/en/api (higher limits)
//   COINGECKO_BASE      override the CoinGecko base URL (used by the tests)
//   LLAMA_BASE          override the DefiLlama prices base URL (used by the tests)

const { clientIp } = require("./client-ip");
const { applyCors } = require("./cors");

const COINGECKO_BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";
// DefiLlama's free price service (no key): https://coins.llama.fi/prices/current/<chain:address,...>
const LLAMA_BASE = process.env.LLAMA_BASE || "https://coins.llama.fi";
const PREFIX = "/api/market";

const ID_RE = "[a-z0-9][a-z0-9._-]{0,99}";
// [pattern, fresh-for ms]. Anything not matching one of these is refused.
const ROUTES = [
  [/^\/simple\/price$/, 30 * 1000],
  [/^\/coins\/markets$/, 60 * 1000],
  [new RegExp("^/coins/" + ID_RE + "$"), 2 * 60 * 1000],
  [new RegExp("^/coins/" + ID_RE + "/market_chart$"), 5 * 60 * 1000],
  [/^\/exchange_rates$/, 5 * 60 * 1000],
  [/^\/exchanges$/, 10 * 60 * 1000],
  [/^\/search\/trending$/, 2 * 60 * 1000],
  [new RegExp("^/simple/token_price/" + ID_RE + "$"), 60 * 1000],
  // DefiLlama current prices: /llama/prices/current/<chain:address-or-coingecko:id,...> (max 60 coins)
  [/^\/llama\/prices\/current\/[A-Za-z0-9._:-]{1,80}(,[A-Za-z0-9._:-]{1,80}){0,59}$/, 30 * 1000],
];
// "coins/list" is deliberately NOT here: the big coin list is handled by token-list-api.js.

const ALLOWED_PARAMS = new Set([
  "vs_currency", "vs_currencies", "ids", "order", "per_page", "page", "price_change_percentage",
  "include_24hr_change", "contract_addresses", "days", "localization", "tickers", "market_data",
  "community_data", "developer_data", "sparkline",
]);
const VALUE_RE = /^[A-Za-z0-9_.,%:-]{0,4000}$/;
const STALE_MAX_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
const MAX_CACHE_ENTRIES = 1500;

const cache = new Map();     // key -> { at, ttl, status, body }
const inflight = new Map();  // key -> Promise<entry|null>

function routeTtl(pathname) {
  // "/coins/list" would otherwise match the "/coins/<id>" pattern below.
  if (pathname === "/coins/list" || pathname === "/coins/categories") return 0;
  for (const [re, ttl] of ROUTES) if (re.test(pathname)) return ttl;
  return 0;
}

// Build the exact upstream query string from the caller's, keeping only what we allow
// and sorting so identical requests share one cache entry.
function cleanQuery(search) {
  const params = new URLSearchParams(search || "");
  const kept = [];
  for (const [k, v] of params) {
    if (!ALLOWED_PARAMS.has(k) || !VALUE_RE.test(v)) return null;
    if (k === "per_page" && !(parseInt(v, 10) >= 1 && parseInt(v, 10) <= 250)) return null;
    if (k === "page" && !(parseInt(v, 10) >= 1 && parseInt(v, 10) <= 5)) return null;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] + "=" + a[1]).localeCompare(b[0] + "=" + b[1]));
  return kept.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
}

async function fetchUpstream(pathname, query) {
  const headers = { Accept: "application/json" };
  const isLlama = pathname.startsWith("/llama/");
  if (COINGECKO_API_KEY && !isLlama) headers["x-cg-demo-api-key"] = COINGECKO_API_KEY;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const url = isLlama ? LLAMA_BASE + pathname.slice("/llama".length) : COINGECKO_BASE + pathname + (query ? "?" + query : "");
    const res = await fetch(url, { headers, signal: ctrl ? ctrl.signal : undefined });
    const text = await res.text();
    return { status: res.status, body: text };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Returns { entry, stale } or null if nothing usable.
async function getEntry(key, pathname, query, ttl) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttl) return { entry: hit, stale: false };

  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetchUpstream(pathname, query);
        if (r.status === 200) {
          const entry = { at: Date.now(), status: 200, body: r.body };
          cache.set(key, entry);
          if (cache.size > MAX_CACHE_ENTRIES) {
            const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 300);
            oldest.forEach(([k]) => cache.delete(k));
          }
          return entry;
        }
        // 404 = CoinGecko doesn't know that coin: a real answer, pass it through (short-lived).
        if (r.status === 404) return { at: Date.now(), status: 404, body: r.body, transient: true };
        return null; // 429 / 5xx -> fall back to a stale copy below
      } catch (e) {
        return null;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  const fresh = await p;
  if (fresh) return { entry: fresh, stale: false };
  if (hit && now - hit.at < STALE_MAX_MS) return { entry: hit, stale: true };
  return null;
}

// ---- per-IP throttle (generous: one coin page opens 2-3 calls) ------------------
const requestTimestamps = new Map();
const REQUEST_LIMIT = 1500;
const WINDOW_MS = 60 * 60 * 1000;
function withinLimit(ip) {
  const now = Date.now();
  const times = (requestTimestamps.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= REQUEST_LIMIT) { requestTimestamps.set(ip, times); return false; }
  times.push(now);
  requestTimestamps.set(ip, times);
  if (requestTimestamps.size > 5000) requestTimestamps.clear();
  return true;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}

// Returns true if the request was handled here; false otherwise.
function handleMarketApi(req, res) {
  const rawUrl = String(req.url || "");
  const qIndex = rawUrl.indexOf("?");
  const pathPart = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
  if (pathPart !== PREFIX && !pathPart.startsWith(PREFIX + "/")) return false;
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET, OPTIONS" });
    res.end();
    return true;
  }
  if (req.method !== "GET") { sendJson(res, 405, { error: "Method not allowed." }); return true; }

  let pathname;
  try { pathname = decodeURIComponent(pathPart.slice(PREFIX.length)); } catch (e) { sendJson(res, 400, { error: "Bad path." }); return true; }
  const ttl = routeTtl(pathname);
  if (!ttl) { sendJson(res, 404, { error: "Unknown market path." }); return true; }
  const query = cleanQuery(qIndex === -1 ? "" : rawUrl.slice(qIndex + 1));
  if (query === null) { sendJson(res, 400, { error: "Unsupported query." }); return true; }
  if (!withinLimit(clientIp(req))) { sendJson(res, 429, { error: "Too many requests recently. Try again later." }); return true; }

  const key = pathname + "?" + query;
  getEntry(key, pathname, query, ttl)
    .then((r) => {
      if (!r) { sendJson(res, 502, { error: "Market data isn't available right now. Try again in a moment." }); return; }
      const { entry, stale } = r;
      const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(entry.body),
        "Cache-Control": entry.status === 200 && !stale ? `public, max-age=${Math.round(ttl / 1000)}` : "no-store",
      };
      if (stale) headers["X-Market-Stale"] = "1";
      res.writeHead(entry.status, headers);
      res.end(entry.body);
    })
    .catch((e) => {
      console.error("[market] request failed:", e && e.message ? e.message : e);
      if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong. Try again." });
    });
  return true;
}

module.exports = { handleMarketApi };
