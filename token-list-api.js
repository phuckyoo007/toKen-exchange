// token-list-api.js
// One shared, cached token list for the whole app (Buy, Swap, the token scanner).
//
// WHY THIS EXISTS
// The token pickers (Buy, Swap, the token scanner) need ONE reliable, consistent list of tokens per
// network. This server builds it and every device reads the same small, fast answer.
//
// WHERE THE LIST COMES FROM
//   1. MAIN SOURCE: the standard Uniswap-format token lists (https://tokens.uniswap.org by default).
//      Curated, no API key, per-chain, with logos. The picker's tokens come from here.
//   2. COINGECKO (kept, in a supporting role): market-cap ranking + logos for the tokens above,
//      fills networks where the standard list is thin (e.g. Linea, Scroll, Monad), and lets a search
//      find a ranked coin the standard list doesn't have. It is downloaded here once every few hours,
//      never from each phone, and if CoinGecko is down the lists still work (and vice versa).
//   Both are kept in memory and on disk, so a restart or an outage doesn't empty the pickers.
//   The app itself still falls back to asking CoinGecko directly if this server can't be reached.
//
// ENDPOINT   GET /api/token-list?network=<key>&limit=<n>
//            GET /api/token-list?network=<key>&q=<name|symbol|0xaddress>&limit=<n>
//            GET /api/token-list?network=<key>&id=<coingecko id>        (its address on that network)
//   -> { ok: true, network, stale, updatedAt, sources: ["lists","coingecko"], tokens: [{ id, symbol, name, address, image, rank }] }
//   -> { ok: true, supported: false, tokens: [] }   for networks CoinGecko has no platform id for
//   -> 503 { ok: false, error } only when there is no data from EITHER source yet
//
// SAFETY
//   * Contract addresses come only from the curated lists or CoinGecko's own per-chain platform data.
//   * Tokens from the standard lists are shown as-is (they are curated). A name search that falls
//     through to CoinGecko only returns coins with a real market-cap rank, which hides fake look-alikes.
//     A pasted contract address is matched exactly and is allowed without a rank.
//   * Addresses are sent lower-case; the client checksums them (EIP-55) before use.
//
// OPTIONAL ENVIRONMENT VARIABLES (all optional)
//   TOKEN_LIST_URLS     comma-separated standard token-list URLs. Default: https://tokens.uniswap.org
//   COINGECKO_API_KEY   a free "Demo" key from coingecko.com/en/api -> higher rate limits
//   COINGECKO_BASE      override the CoinGecko base URL (used by the tests)
//   DATA_DIR            where the on-disk snapshots live (same variable accounts use)

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { clientIp } = require("./client-ip");
const { applyCors } = require("./cors");

const COINGECKO_BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SNAPSHOT_PATH = path.join(DATA_DIR, "token-list-cache.json");        // CoinGecko copy
const LISTS_SNAPSHOT_PATH = path.join(DATA_DIR, "token-lists-cache.json");  // standard-list copy

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
const LIST_URLS = String(process.env.TOKEN_LIST_URLS || "https://tokens.uniswap.org")
  .split(",").map((u) => u.trim()).filter(Boolean);
const THIN_LIST_MIN = Number.isInteger(+process.env.TOKEN_LIST_THIN_MIN) && process.env.TOKEN_LIST_THIN_MIN !== "" ? +process.env.TOKEN_LIST_THIN_MIN : 40; // a network whose standard list has fewer tokens than this is topped up from CoinGecko

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NETWORK_RE = /^[a-z0-9-]{1,40}$/;

// ---- in-memory state --------------------------------------------------------
// CoinGecko: { at, byPlatform: { [platform]: { entries, byId: Map, byAddress: Map } }, order: [id], info: Map id -> {rank,image} }
let cg = null;
let cgRefreshing = null;
let cgLastFailAt = 0;
// Standard lists: { at, byPlatform: { [platform]: { entries: [{id,symbol,name,address,image,idx}], byAddress: Map } } }
let lists = null;
let listsRefreshing = null;
let listsLastFailAt = 0;
let snapshotsTried = false;
const extraInfo = new Map(); // coingecko id -> { at, rank, image } for coins outside the top 500
const viewCache = new Map(); // platform -> { key, entries }

async function getJson(url, plain) {
  const headers = { Accept: "application/json" };
  if (COINGECKO_API_KEY && !plain) headers["x-cg-demo-api-key"] = COINGECKO_API_KEY;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, { headers, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error((plain ? "list" : "CoinGecko") + " HTTP " + res.status);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- CoinGecko state ----------------------------------------------------------
function buildCgState(rawList, marketRows, at) {
  const byPlatform = {};
  PLATFORMS.forEach((p) => { byPlatform[p] = { entries: [], byId: new Map(), byAddress: new Map() }; });
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
      if (!byPlatform[p].byAddress.has(entry.address)) byPlatform[p].byAddress.set(entry.address, entry);
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

function saveCgSnapshot(rawList, marketRows, at) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const list = (Array.isArray(rawList) ? rawList : [])
      .filter((c) => c && c.platforms && PLATFORMS.some((p) => c.platforms[p]))
      .map((c) => {
        const platforms = {};
        PLATFORMS.forEach((p) => { if (c.platforms[p]) platforms[p] = c.platforms[p]; });
        return { id: c.id, symbol: c.symbol, name: c.name, platforms };
      });
    const markets = (Array.isArray(marketRows) ? marketRows : []).map((r) => ({ id: r.id, market_cap_rank: r.market_cap_rank, image: r.image }));
    const tmp = SNAPSHOT_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ at, list, markets }));
    fs.renameSync(tmp, SNAPSHOT_PATH);
  } catch (e) { /* a read-only disk just means no snapshot */ }
}

async function refreshCg() {
  const rawList = await getJson(`${COINGECKO_BASE}/coins/list?include_platform=true`);
  const marketRows = [];
  for (const page of [1, 2]) {
    const rows = await getJson(`${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`);
    if (Array.isArray(rows)) rows.forEach((r) => marketRows.push(r));
  }
  if (!Array.isArray(rawList) || !rawList.length || !marketRows.length) throw new Error("CoinGecko returned an empty list");
  const at = Date.now();
  cg = buildCgState(rawList, marketRows, at);
  saveCgSnapshot(rawList, marketRows, at);
  cgLastFailAt = 0;
}

function startCgRefresh() {
  if (cgRefreshing) return cgRefreshing;
  if (cgLastFailAt && Date.now() - cgLastFailAt < RETRY_AFTER_FAIL_MS) return Promise.resolve();
  cgRefreshing = refreshCg()
    .catch((e) => {
      cgLastFailAt = Date.now();
      console.error("[token-list] CoinGecko refresh failed (using the previous copy if there is one):", e && e.message ? e.message : e);
    })
    .finally(() => { cgRefreshing = null; });
  return cgRefreshing;
}

// ---- standard token lists (the main source) ------------------------------------
const rawListsByUrl = new Map(); // url -> { tokens: [{chainId,address,symbol,name,logoURI}] } (trimmed to chains we use)

function trimList(json) {
  const out = [];
  (Array.isArray(json && json.tokens) ? json.tokens : []).forEach((t) => {
    if (!t || !PLATFORM_BY_CHAIN_ID[t.chainId] || !ADDRESS_RE.test(String(t.address || ""))) return;
    out.push({
      chainId: t.chainId,
      address: String(t.address),
      symbol: String(t.symbol || ""),
      name: String(t.name || ""),
      logoURI: typeof t.logoURI === "string" ? t.logoURI : null,
    });
  });
  return { tokens: out };
}

function buildListsState(at) {
  const byPlatform = {};
  PLATFORMS.forEach((p) => { byPlatform[p] = { entries: [], byAddress: new Map() }; });
  let idx = 0;
  LIST_URLS.forEach((url) => {
    const raw = rawListsByUrl.get(url);
    if (!raw) return;
    raw.tokens.forEach((t) => {
      const platform = PLATFORM_BY_CHAIN_ID[t.chainId];
      const address = t.address.toLowerCase();
      const slice = byPlatform[platform];
      const symbol = t.symbol.toUpperCase().slice(0, 40);
      if (!slice || !symbol || slice.byAddress.has(address)) return;
      const entry = {
        id: platform + ":" + address,
        symbol,
        name: t.name.slice(0, 120),
        address,
        image: t.logoURI && /^https:\/\//i.test(t.logoURI) ? t.logoURI.slice(0, 500) : null,
        idx: idx++,
      };
      slice.entries.push(entry);
      slice.byAddress.set(address, entry);
    });
  });
  return { at, byPlatform };
}

function loadSnapshotsOnce() {
  if (snapshotsTried) return;
  snapshotsTried = true;
  // CoinGecko copy. Served immediately and refreshed in the background.
  try {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    if (snap && Array.isArray(snap.list) && Array.isArray(snap.markets) && snap.list.length) {
      cg = buildCgState(snap.list, snap.markets, Number(snap.at) || 1);
    }
  } catch (e) { /* none yet -- normal on first boot */ }
  try {
    const snap = JSON.parse(fs.readFileSync(LISTS_SNAPSHOT_PATH, "utf8"));
    if (snap && snap.byUrl && typeof snap.byUrl === "object") {
      Object.keys(snap.byUrl).forEach((u) => { if (LIST_URLS.includes(u)) rawListsByUrl.set(u, trimList(snap.byUrl[u])); });
      if (rawListsByUrl.size) lists = buildListsState(Number(snap.at) || 1);
    }
  } catch (e) { /* none yet */ }
}

function saveListsSnapshot(at) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const byUrl = {};
    rawListsByUrl.forEach((v, k) => { byUrl[k] = v; });
    const tmp = LISTS_SNAPSHOT_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ at, byUrl }));
    fs.renameSync(tmp, LISTS_SNAPSHOT_PATH);
  } catch (e) { /* ignore */ }
}

async function refreshLists() {
  let got = 0;
  for (const url of LIST_URLS) {
    try {
      const trimmed = trimList(await getJson(url, true));
      if (!trimmed.tokens.length) throw new Error("no tokens for our networks");
      rawListsByUrl.set(url, trimmed);
      got++;
    } catch (e) {
      console.error("[token-list] standard list failed (" + url + "):", e && e.message ? e.message : e);
    }
  }
  if (!got) throw new Error("no standard list could be loaded");
  const at = Date.now();
  lists = buildListsState(at);
  saveListsSnapshot(at);
  listsLastFailAt = 0;
}

function startListsRefresh() {
  if (listsRefreshing) return listsRefreshing;
  if (listsLastFailAt && Date.now() - listsLastFailAt < RETRY_AFTER_FAIL_MS) return Promise.resolve();
  listsRefreshing = refreshLists()
    .catch((e) => { listsLastFailAt = Date.now(); console.error("[token-list] standard-list refresh failed:", e && e.message ? e.message : e); })
    .finally(() => { listsRefreshing = null; });
  return listsRefreshing;
}

// Both sources are refreshed independently. A stale copy is served straight away while a
// refresh runs in the background; we only wait when we have nothing at all.
async function getSources() {
  loadSnapshotsOnce();
  const now = Date.now();
  const waits = [];
  if (!lists) waits.push(startListsRefresh()); else if (now - lists.at >= TTL_MS) startListsRefresh();
  if (!cg) waits.push(startCgRefresh()); else if (now - cg.at >= TTL_MS) startCgRefresh();
  if (waits.length) await Promise.all(waits);
  return { lists, cg };
}

function warm() {
  loadSnapshotsOnce();
  if (!lists || Date.now() - lists.at >= TTL_MS) startListsRefresh();
  if (!cg || Date.now() - cg.at >= TTL_MS) startCgRefresh();
}

// ---- merged view of one network ---------------------------------------------------
function platformFor(networkKey) { return PLATFORM_BY_NETWORK[networkKey] || null; }
const UNRANKED = 1e9;

function shape(e) {
  return { id: e.id, symbol: e.symbol, name: e.name, address: e.address, image: e.image || null, rank: e.rank || null };
}

// All tokens for a network, best first: ranked coins by market cap, then the rest in list order.
// Standard-list tokens are the base; CoinGecko adds rank + logos, and tops up thin networks.
function viewFor(src, platform) {
  const key = (src.lists ? src.lists.at : 0) + "|" + (src.cg ? src.cg.at : 0);
  const hit = viewCache.get(platform);
  if (hit && hit.key === key) return hit.entries;

  const listSlice = src.lists && src.lists.byPlatform[platform];
  const cgSlice = src.cg && src.cg.byPlatform[platform];
  const entries = [];
  const seen = new Set();
  if (listSlice) {
    listSlice.entries.forEach((e) => {
      const c = cgSlice && cgSlice.byAddress.get(e.address);
      const ci = c && src.cg.info.get(c.id);
      entries.push({
        id: c ? c.id : e.id, symbol: e.symbol, name: e.name, address: e.address,
        image: e.image || (ci && ci.image) || null,
        rank: (ci && ci.rank) || null,
        idx: e.idx,
      });
      seen.add(e.address);
    });
  }
  const thin = !listSlice || listSlice.entries.length < THIN_LIST_MIN;
  if (thin && cgSlice) {
    src.cg.order.forEach((id) => {
      const e = cgSlice.byId.get(id);
      if (!e || seen.has(e.address)) return;
      const i = src.cg.info.get(id) || {};
      entries.push({ id: e.id, symbol: e.symbol, name: e.name, address: e.address, image: i.image || null, rank: i.rank || null, idx: UNRANKED });
      seen.add(e.address);
    });
  }
  entries.sort((a, b) => (a.rank || UNRANKED) - (b.rank || UNRANKED) || a.idx - b.idx);
  viewCache.set(platform, { key, entries });
  return entries;
}

async function rankInfoFor(src, ids) {
  const info = new Map();
  const missing = [];
  const now = Date.now();
  ids.forEach((id) => {
    const i = src.cg && src.cg.info.get(id);
    if (i) { info.set(id, i); return; }
    const x = extraInfo.get(id);
    if (x && now - x.at < EXTRA_INFO_TTL_MS) { if (x.rank) info.set(id, x); return; }
    missing.push(id);
  });
  if (missing.length && src.cg) {
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
    } catch (e) { /* unranked candidates are dropped by the caller */ }
    if (extraInfo.size > 5000) extraInfo.clear();
  }
  return info;
}

function topTokens(src, platform, limit) {
  return viewFor(src, platform).slice(0, limit).map(shape);
}

async function searchTokens(src, platform, query, limit) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const view = viewFor(src, platform);
  const cgSlice = src.cg && src.cg.byPlatform[platform];

  // Pasted contract address: exact match, allowed without a rank.
  if (/^0x[0-9a-f]{40}$/.test(q)) {
    const e = view.find((x) => x.address === q);
    if (e) return [shape(e)];
    const c = cgSlice && cgSlice.byAddress.get(q);
    if (!c) return [];
    const i = (src.cg.info.get(c.id)) || extraInfo.get(c.id) || {};
    return [shape({ ...c, image: i.image || null, rank: i.rank || null })];
  }

  const score = (e) => {
    const s = e.symbol.toLowerCase(), n = e.name.toLowerCase();
    if (s === q || n === q) return 0;
    if (s.startsWith(q) || n.startsWith(q)) return 1;
    return 2;
  };
  const out = view
    .filter((e) => e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
    .sort((a, b) => score(a) - score(b) || (a.rank || UNRANKED) - (b.rank || UNRANKED) || a.idx - b.idx)
    .slice(0, limit)
    .map(shape);
  if (out.length >= limit || !cgSlice) return out;

  // Not enough from the curated lists: add ranked CoinGecko coins we don't already show.
  const have = new Set(out.map((e) => e.address));
  const viewAddrs = new Set(view.map((e) => e.address));
  const cands = cgSlice.entries
    .filter((e) => !have.has(e.address) && !viewAddrs.has(e.address) && (e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)))
    .sort((a, b) => score(a) - score(b))
    .slice(0, 60);
  if (!cands.length) return out;
  const info = await rankInfoFor(src, cands.map((e) => e.id));
  cands
    .filter((e) => info.get(e.id) && info.get(e.id).rank)
    .sort((a, b) => info.get(a.id).rank - info.get(b.id).rank)
    .slice(0, limit - out.length)
    .forEach((e) => out.push(shape({ ...e, image: info.get(e.id).image, rank: info.get(e.id).rank })));
  return out;
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

  getSources()
    .then(async (src) => {
      if (!src.lists && !src.cg) { sendJson(res, 503, { ok: false, error: "The token list isn't available right now. Try again in a minute." }); return; }
      let tokens;
      if (id) {
        // A CoinGecko coin id (from the trending list) -> its address on this network.
        const e = src.cg && src.cg.byPlatform[platform] && src.cg.byPlatform[platform].byId.get(id);
        const i = e && src.cg.info.get(id);
        tokens = e ? [shape({ ...e, image: (i && i.image) || null, rank: (i && i.rank) || null })] : [];
      } else if (q) {
        tokens = await searchTokens(src, platform, q, clampInt(params.get("limit"), 15, 1, 50));
      } else {
        tokens = topTokens(src, platform, clampInt(params.get("limit"), 40, 1, 500));
      }
      const times = [src.lists && src.lists.at, src.cg && src.cg.at].filter(Boolean);
      sendJson(res, 200, {
        ok: true,
        supported: true,
        network,
        stale: times.every((t) => Date.now() - t >= TTL_MS),
        updatedAt: Math.max.apply(null, times),
        sources: [src.lists ? "lists" : null, src.cg ? "coingecko" : null].filter(Boolean),
        tokens,
      }, q ? 60 : 300);
    })
    .catch((e) => {
      console.error("[token-list] request failed:", e && e.message ? e.message : e);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Something went wrong. Try again." });
    });
  return true;
}

module.exports = { handleTokenListApi, warm, PLATFORM_BY_NETWORK };
