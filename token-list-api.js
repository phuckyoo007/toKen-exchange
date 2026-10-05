// token-list-api.js
// One shared, cached token list for the whole app (Buy, Swap, the token scanner).
//
// WHY THIS EXISTS
// lib/token-catalog.js used to download CoinGecko's full coin list (several MB)
// plus the top-500 market list straight from every phone/browser. CoinGecko's
// free tier rate-limits by IP, mobile networks and the Android WebView often
// failed that download, and the pickers then showed an empty list. Now THIS
// server downloads it once every few hours, keeps it in memory (and on disk,
// so a restart or a CoinGecko outage doesn't empty it) and hands every client
// a small, fast answer. The client still falls back to CoinGecko directly if
// this endpoint is unreachable, so nothing gets worse.
//
// ENDPOINT   GET /api/token-list?network=<key>&limit=<n>
//            GET /api/token-list?network=<key>&q=<name|symbol|0xaddress>&limit=<n>
//            GET /api/token-list?network=<key>&id=<coingecko id>        (its address on that network)
//   -> { ok: true, network, stale, updatedAt, tokens: [{ id, symbol, name, address, image, rank }] }
//   -> { ok: true, supported: false, tokens: [] }   for networks CoinGecko has no platform id for
//   -> 503 { ok: false, error } only when there is no list at all yet (first boot AND CoinGecko down)
//
// SAFETY (same rules the client always applied)
//   * Contract addresses come only from CoinGecko's own per-chain platform data.
//   * A NAME search only returns tokens with a real market-cap rank, which hides
//     the swarms of same-named fake tokens. A pasted contract address is matched
//     exactly and is allowed without a rank.
//   * Addresses are sent lower-case; the client checksums them (EIP-55) before use.
//
// OPTIONAL ENVIRONMENT VARIABLES (all optional)
//   COINGECKO_API_KEY   a free "Demo" key from coingecko.com/en/api -> higher rate limits
//   COINGECKO_BASE      override the CoinGecko base URL (used by the tests)
//   DATA_DIR            where the on-disk snapshot lives (same variable accounts use)
//   TOKEN_LIST_URLS     comma-separated standard "token list" URLs (Uniswap token-lists format) used
//                       as the BACKUP source when CoinGecko can't be reached and there is no saved
//                       copy yet. Default: https://tokens.uniswap.org
//
// BACKUP SOURCE
// If CoinGecko is down or rate-limiting this server on first boot (no snapshot on disk), the picker
// would be empty. Instead we load the standard token lists above (curated, no API key, no market-cap
// data -- list order is used as the ranking). The CoinGecko list always takes over as soon as it loads.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { clientIp } = require("./client-ip");
const { applyCors } = require("./cors");

const COINGECKO_BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SNAPSHOT_PATH = path.join(DATA_DIR, "token-list-cache.json");

const TTL_MS = 6 * 60 * 60 * 1000; // refresh every 6 hours
const RETRY_AFTER_FAIL_MS = 5 * 60 * 1000; // after a failed refresh, wait 5 min
const EXTRA_INFO_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30 * 1000;

// ---- which CoinGecko platform each network uses: single source of truth is lib/prices.js
function loadPlatformMap() {
  try {
    const src = fs.readFileSync(path.join(__dirname, "prices.js"), "utf8");
    const sandbox = { self: {}, console: { log() {}, warn() {}, error() {} } };
    vm.runInNewContext(src, sandbox, { timeout: 2000 });
    const map = sandbox.self.TM_PRICES && sandbox.self.TM_PRICES.NETWORK_COINGECKO_PLATFORM;
    if (map && typeof map === "object") return map;
  } catch (e) {
    console.error("[token-list] couldn't read the platform map from prices.js:", e && e.message ? e.message : e);
  }
  return {};
}
const PLATFORM_BY_NETWORK = loadPlatformMap();
const PLATFORMS = Array.from(new Set(Object.values(PLATFORM_BY_NETWORK)));

// chainId -> CoinGecko platform, for reading standard token lists (they are keyed by chainId).
// Built from lib/networks.js so there is still one source of truth for the chains.
function loadPlatformByChainId() {
  const out = {};
  try {
    const src = fs.readFileSync(path.join(__dirname, "networks.js"), "utf8");
    const sandbox = { self: {}, chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } }, console: { log() {}, warn() {}, error() {} } };
    vm.runInNewContext(src, sandbox, { timeout: 2000 });
    const nets = sandbox.self.TM_NETWORKS && sandbox.self.TM_NETWORKS.BUILTIN_NETWORKS;
    (nets || []).forEach((n) => {
      if (n && n.chainId && PLATFORM_BY_NETWORK[n.key]) out[n.chainId] = PLATFORM_BY_NETWORK[n.key];
    });
  } catch (e) {
    console.error("[token-list] couldn't read chain ids from networks.js:", e && e.message ? e.message : e);
  }
  return out;
}
const PLATFORM_BY_CHAIN_ID = loadPlatformByChainId();
const FALLBACK_LIST_URLS = String(process.env.TOKEN_LIST_URLS || "https://tokens.uniswap.org")
  .split(",").map((u) => u.trim()).filter(Boolean);
const FALLBACK_TTL_MS = 60 * 60 * 1000;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NETWORK_RE = /^[a-z0-9-]{1,40}$/;

// ---- in-memory state --------------------------------------------------------
// state = { at, byPlatform: { [platform]: { entries: [{id,symbol,name,address}], byId: Map } },
//           order: [id], info: Map id -> { rank, image } }
let state = null;
let refreshing = null;
let lastFailAt = 0;
let snapshotTried = false;
let fallbackState = null; // built from standard token lists; only used while there is no CoinGecko list
let fallbackPromise = null;
let fallbackFailAt = 0;
const extraInfo = new Map(); // id -> { at, rank, image } for coins outside the top 500

async function getJson(url, plain) {
  const headers = { Accept: "application/json" };
  if (COINGECKO_API_KEY && !plain) headers["x-cg-demo-api-key"] = COINGECKO_API_KEY;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, { headers, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error("CoinGecko HTTP " + res.status);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildState(rawList, marketRows, at) {
  const byPlatform = {};
  PLATFORMS.forEach((p) => { byPlatform[p] = { entries: [], byId: new Map() }; });
  (Array.isArray(rawList) ? rawList : []).forEach((c) => {
    const platforms = c && c.platforms;
    if (!platforms || !c.id) return;
    PLATFORMS.forEach((p) => {
      const a = platforms[p];
      if (!a || !ADDRESS_RE.test(a)) return;
      const entry = {
        id: String(c.id),
        symbol: String(c.symbol || "").toUpperCase().slice(0, 40),
        name: String(c.name || "").slice(0, 120),
        address: String(a).toLowerCase(),
      };
      byPlatform[p].entries.push(entry);
      byPlatform[p].byId.set(entry.id, entry);
    });
  });
  const order = [];
  const info = new Map();
  (Array.isArray(marketRows) ? marketRows : []).forEach((r) => {
    if (!r || !r.id || info.has(r.id)) return;
    order.push(String(r.id));
    info.set(String(r.id), { rank: r.market_cap_rank || null, image: typeof r.image === "string" ? r.image : null });
  });
  return { at, byPlatform, order, info };
}

// ---- disk snapshot (best effort) ------------------------------------------
function loadSnapshotOnce() {
  if (snapshotTried) return;
  snapshotTried = true;
  try {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    if (!snap || !Array.isArray(snap.list) || !Array.isArray(snap.markets) || !snap.list.length) return;
    // Old on purpose (at: 0 would mean "never"): it is served immediately and refreshed in the background.
    state = buildState(snap.list, snap.markets, Number(snap.at) || 1);
  } catch (e) { /* no snapshot yet -- normal on first boot */ }
}
function saveSnapshot(rawList, marketRows, at) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Store only what we use, so the file stays small.
    const list = (Array.isArray(rawList) ? rawList : [])
      .filter((c) => c && c.platforms && PLATFORMS.some((p) => c.platforms[p]))
      .map((c) => {
        const platforms = {};
        PLATFORMS.forEach((p) => { if (c.platforms[p]) platforms[p] = c.platforms[p]; });
        return { id: c.id, symbol: c.symbol, name: c.name, platforms };
      });
    const markets = (Array.isArray(marketRows) ? marketRows : []).map((r) => ({
      id: r.id, market_cap_rank: r.market_cap_rank, image: r.image,
    }));
    const tmp = SNAPSHOT_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ at, list, markets }));
    fs.renameSync(tmp, SNAPSHOT_PATH);
  } catch (e) { /* a read-only disk just means no snapshot */ }
}

// ---- refresh ------------------------------------------------------------------
async function refresh() {
  const rawList = await getJson(`${COINGECKO_BASE}/coins/list?include_platform=true`);
  const marketRows = [];
  for (const page of [1, 2]) {
    const rows = await getJson(`${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`);
    if (Array.isArray(rows)) rows.forEach((r) => marketRows.push(r));
  }
  if (!Array.isArray(rawList) || !rawList.length || !marketRows.length) throw new Error("CoinGecko returned an empty list");
  const at = Date.now();
  state = buildState(rawList, marketRows, at);
  saveSnapshot(rawList, marketRows, at);
  lastFailAt = 0;
}

function startRefresh() {
  if (refreshing) return refreshing;
  if (lastFailAt && Date.now() - lastFailAt < RETRY_AFTER_FAIL_MS) return Promise.resolve();
  refreshing = refresh()
    .catch((e) => {
      lastFailAt = Date.now();
      console.error("[token-list] refresh failed (serving the previous list if there is one):", e && e.message ? e.message : e);
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}


// ---- backup source: standard token lists -------------------------------------
function buildFallbackState(lists, at) {
  const byPlatform = {};
  PLATFORMS.forEach((p) => { byPlatform[p] = { entries: [], byId: new Map() }; });
  const order = [];
  const info = new Map();
  lists.forEach((list) => {
    (Array.isArray(list && list.tokens) ? list.tokens : []).forEach((t) => {
      const platform = t && PLATFORM_BY_CHAIN_ID[t.chainId];
      if (!platform || !ADDRESS_RE.test(String(t.address || ""))) return;
      const address = String(t.address).toLowerCase();
      const id = platform + ":" + address;
      if (byPlatform[platform].byId.has(id)) return;
      const entry = {
        id,
        symbol: String(t.symbol || "").toUpperCase().slice(0, 40),
        name: String(t.name || "").slice(0, 120),
        address,
      };
      if (!entry.symbol) return;
      byPlatform[platform].entries.push(entry);
      byPlatform[platform].byId.set(id, entry);
      order.push(id);
      const logo = typeof t.logoURI === "string" && /^https:\/\//i.test(t.logoURI) ? t.logoURI.slice(0, 500) : null;
      info.set(id, { rank: order.length, image: logo });
    });
  });
  return { at, byPlatform, order, info, fallback: true };
}

async function loadFallback() {
  if (fallbackState && Date.now() - fallbackState.at < FALLBACK_TTL_MS) return fallbackState;
  if (fallbackFailAt && Date.now() - fallbackFailAt < RETRY_AFTER_FAIL_MS) return fallbackState;
  if (!fallbackPromise) {
    fallbackPromise = (async () => {
      const lists = [];
      for (const url of FALLBACK_LIST_URLS) {
        try { lists.push(await getJson(url, true)); } catch (e) {
          console.error("[token-list] backup list failed (" + url + "):", e && e.message ? e.message : e);
        }
      }
      const st = buildFallbackState(lists, Date.now());
      if (st.order.length) { fallbackState = st; fallbackFailAt = 0; } else { fallbackFailAt = Date.now(); }
      return fallbackState;
    })().finally(() => { fallbackPromise = null; });
  }
  return fallbackPromise;
}

// Resolves with a usable state, or null if there is none at all. A stale list is
// returned straight away while a refresh runs in the background.
async function getState() {
  loadSnapshotOnce();
  const fresh = state && Date.now() - state.at < TTL_MS;
  if (fresh) return state;
  if (state) { startRefresh(); return state; }
  await startRefresh();
  if (state) return state;
  return loadFallback(); // CoinGecko unreachable and nothing saved: use the backup lists
}

function warm() { loadSnapshotOnce(); if (!state || Date.now() - state.at >= TTL_MS) startRefresh(); }

// ---- queries --------------------------------------------------------------------
function platformFor(networkKey) { return PLATFORM_BY_NETWORK[networkKey] || null; }

function shape(e, i) {
  return { id: e.id, symbol: e.symbol, name: e.name, address: e.address, image: (i && i.image) || null, rank: (i && i.rank) || null };
}

function topTokens(st, platform, limit) {
  const slice = st.byPlatform[platform];
  const out = [];
  if (!slice) return out;
  for (const id of st.order) {
    const e = slice.byId.get(id);
    if (!e) continue;
    out.push(shape(e, st.info.get(id)));
    if (out.length >= limit) break;
  }
  return out;
}

async function rankInfoFor(st, ids) {
  const info = new Map();
  const missing = [];
  const now = Date.now();
  ids.forEach((id) => {
    const i = st.info.get(id);
    if (i) { info.set(id, i); return; }
    const x = extraInfo.get(id);
    if (x && now - x.at < EXTRA_INFO_TTL_MS) { if (x.rank) info.set(id, x); return; }
    missing.push(id);
  });
  if (missing.length && !st.fallback) {
    try {
      const rows = await getJson(`${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(missing.join(","))}&per_page=250`);
      const seen = new Set();
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        if (!r || !r.id) return;
        seen.add(r.id);
        const v = { at: now, rank: r.market_cap_rank || null, image: typeof r.image === "string" ? r.image : null };
        extraInfo.set(r.id, v);
        if (v.rank) info.set(r.id, v);
      });
      missing.forEach((id) => { if (!seen.has(id)) extraInfo.set(id, { at: now, rank: null, image: null }); });
    } catch (e) { /* unranked candidates are dropped below */ }
    if (extraInfo.size > 5000) extraInfo.clear();
  }
  return info;
}

async function searchTokens(st, platform, query, limit) {
  const q = String(query || "").trim().toLowerCase();
  const slice = st.byPlatform[platform];
  if (!slice || q.length < 2) return [];

  if (/^0x[0-9a-f]{40}$/.test(q)) {
    const e = slice.entries.find((x) => x.address === q);
    if (!e) return [];
    const i = st.info.get(e.id) || (extraInfo.get(e.id) || null);
    return [shape(e, i)];
  }

  const score = (e) => {
    const s = e.symbol.toLowerCase(), n = e.name.toLowerCase();
    if (s === q || n === q) return 0;
    if (s.startsWith(q) || n.startsWith(q)) return 1;
    return 2;
  };
  const cands = slice.entries
    .filter((e) => e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
    .sort((a, b) => score(a) - score(b))
    .slice(0, 60);
  if (!cands.length) return [];
  const info = await rankInfoFor(st, cands.map((e) => e.id));
  return cands
    .filter((e) => info.get(e.id) && info.get(e.id).rank)
    .sort((a, b) => info.get(a.id).rank - info.get(b.id).rank)
    .slice(0, limit)
    .map((e) => shape(e, info.get(e.id)));
}

// ---- HTTP -------------------------------------------------------------------------
const requestTimestamps = new Map();
const REQUEST_LIMIT = 900; // per IP per hour; typing a search sends a few requests
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

function sendJson(res, status, obj, cacheSeconds) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store",
  });
  res.end(body);
}

function clampInt(v, dflt, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

// Returns true if the request was handled here; false otherwise.
function handleTokenListApi(req, res) {
  const [url, queryString] = String(req.url || "").split("?");
  if (url !== "/api/token-list") return false;
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET, OPTIONS" });
    res.end();
    return true;
  }
  if (req.method !== "GET") { sendJson(res, 405, { error: "Method not allowed." }); return true; }
  if (!withinLimit(clientIp(req))) { sendJson(res, 429, { error: "Too many requests recently. Try again later." }); return true; }

  const params = new URLSearchParams(queryString || "");
  const network = (params.get("network") || "").trim().toLowerCase();
  const q = (params.get("q") || "").trim().slice(0, 100);
  const id = (params.get("id") || "").trim().slice(0, 100);
  if (!NETWORK_RE.test(network)) { sendJson(res, 400, { error: "Missing or invalid network." }); return true; }
  const platform = platformFor(network);
  if (!platform) { sendJson(res, 200, { ok: true, supported: false, network, tokens: [] }, 300); return true; }

  getState()
    .then(async (st) => {
      if (!st) { sendJson(res, 503, { ok: false, error: "The token list isn't available right now. Try again in a minute." }); return; }
      let tokens;
      if (id) {
        const e = st.byPlatform[platform] && st.byPlatform[platform].byId.get(id);
        tokens = e ? [shape(e, st.info.get(id))] : [];
      } else if (q) {
        tokens = await searchTokens(st, platform, q, clampInt(params.get("limit"), 15, 1, 50));
      } else {
        tokens = topTokens(st, platform, clampInt(params.get("limit"), 40, 1, 500));
      }
      sendJson(res, 200, {
        ok: true,
        supported: true,
        network,
        stale: Date.now() - st.at >= TTL_MS,
        updatedAt: st.at,
        tokens,
      }, q ? 60 : 300);
    })
    .catch((e) => {
      console.error("[token-list] request failed:", e && e.message ? e.message : e);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Something went wrong. Try again." });
    });
  return true;
}

module.exports = { handleTokenListApi, warm, PLATFORM_BY_NETWORK, _test: { buildState, searchTokens, topTokens } };
