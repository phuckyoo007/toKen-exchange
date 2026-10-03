// lib/token-catalog.js
// Two read-only helpers backed by CoinGecko's free, keyless public API (the
// same source lib/prices.js already uses; nothing about the wallet is sent):
//
//   TM_CATALOG.getTrendingCoins(limit, currency)
//       The coins trending on CoinGecko right now, with price + 24h change
//       in the person's display currency. Replaces the old Polymarket card.
//
//   TM_CATALOG.top(networkKey, n)        -> the n biggest tokens (by market
//   TM_CATALOG.search(networkKey, query)    cap) that exist on that network,
//                                           or a name/symbol/address search.
//
// SAFETY: contract addresses come only from CoinGecko's own per-chain
// platform data (never typed in here), are EIP-55 checksummed before use,
// and a NAME search only returns tokens that have a real market-cap rank --
// that hides the swarms of same-named fake tokens. A pasted contract address
// is matched exactly and is allowed even without a rank (the picker's own
// "use this address" row still handles addresses CoinGecko doesn't know).
//
// Only networks with a verified CoinGecko platform id
// (TM_PRICES.NETWORK_COINGECKO_PLATFORM) are supported; others return [].
(function () {
  const BASE = "https://api.coingecko.com/api/v3";
  const TTL_MS = 6 * 60 * 60 * 1000;
  const TRENDING_TTL_MS = 60 * 1000;

  async function getJson(url) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error("Couldn't reach CoinGecko. Check your internet connection.");
    }
    if (!res.ok) throw new Error(`CoinGecko request failed (HTTP ${res.status}).`);
    return res.json();
  }

  function platformFor(networkKey) {
    const map = (typeof TM_PRICES !== "undefined" && TM_PRICES.NETWORK_COINGECKO_PLATFORM) || {};
    return map[networkKey] || null;
  }
  function supports(networkKey) { return !!platformFor(networkKey); }

  function checksum(addr) {
    try { return ethers.utils.getAddress(String(addr)); } catch (e) { return null; }
  }

  // ---- full coin list, sliced per platform (one big download, cached) -----
  let listCache = null; // { at, byPlatform: { [platform]: { entries: [], byId: Map } } }
  let listPromise = null;
  async function loadList() {
    if (listCache && Date.now() - listCache.at < TTL_MS) return listCache;
    if (listPromise) return listPromise;
    listPromise = (async () => {
      const wanted = new Set(Object.values((typeof TM_PRICES !== "undefined" && TM_PRICES.NETWORK_COINGECKO_PLATFORM) || {}));
      const raw = await getJson(`${BASE}/coins/list?include_platform=true`);
      const byPlatform = {};
      wanted.forEach((p) => { byPlatform[p] = { entries: [], byId: new Map() }; });
      (Array.isArray(raw) ? raw : []).forEach((c) => {
        const platforms = c && c.platforms;
        if (!platforms) return;
        wanted.forEach((p) => {
          const a = platforms[p];
          if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) return;
          const addr = checksum(a);
          if (!addr) return;
          const entry = { id: c.id, symbol: String(c.symbol || "").toUpperCase(), name: String(c.name || ""), address: addr };
          byPlatform[p].entries.push(entry);
          byPlatform[p].byId.set(c.id, entry);
        });
      });
      listCache = { at: Date.now(), byPlatform };
      return listCache;
    })();
    try { return await listPromise; } finally { listPromise = null; }
  }

  // ---- market-cap ranking for the top ~500 coins (two pages, cached) ------
  let topCache = null; // { at, order: [id], info: Map id -> {rank, image} }
  async function loadTop() {
    if (topCache && Date.now() - topCache.at < TTL_MS) return topCache;
    const order = [];
    const info = new Map();
    for (const page of [1, 2]) {
      const rows = await getJson(`${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`);
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        if (!r || !r.id || info.has(r.id)) return;
        order.push(r.id);
        info.set(r.id, { rank: r.market_cap_rank || null, image: r.image || null });
      });
    }
    topCache = { at: Date.now(), order, info };
    return topCache;
  }

  async function top(networkKey, n) {
    const platform = platformFor(networkKey);
    if (!platform) return [];
    const [list, topData] = await Promise.all([loadList(), loadTop()]);
    const slice = list.byPlatform[platform];
    if (!slice) return [];
    const out = [];
    for (const id of topData.order) {
      const e = slice.byId.get(id);
      if (!e) continue;
      const i = topData.info.get(id) || {};
      out.push({ symbol: e.symbol, name: e.name, address: e.address, image: i.image, rank: i.rank });
      if (out.length >= (n || 25)) break;
    }
    return out;
  }

  async function search(networkKey, query, limit) {
    const platform = platformFor(networkKey);
    const q = String(query || "").trim().toLowerCase();
    if (!platform || q.length < 2) return [];
    const [list, topData] = await Promise.all([loadList(), loadTop()]);
    const slice = list.byPlatform[platform];
    if (!slice) return [];

    // Exact contract-address match (allowed without a market-cap rank).
    if (/^0x[0-9a-f]{40}$/.test(q)) {
      const e = slice.entries.find((x) => x.address.toLowerCase() === q);
      if (!e) return [];
      const i = topData.info.get(e.id) || {};
      return [{ symbol: e.symbol, name: e.name, address: e.address, image: i.image || null, rank: i.rank || null }];
    }

    // Name / symbol match: best matches first, capped before the rank lookup.
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

    // Rank: use the cached top list, ask CoinGecko for the rest.
    const info = new Map();
    const missing = [];
    cands.forEach((e) => {
      const i = topData.info.get(e.id);
      if (i) info.set(e.id, i); else missing.push(e.id);
    });
    if (missing.length) {
      try {
        const rows = await getJson(`${BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(missing.join(","))}&per_page=250`);
        (Array.isArray(rows) ? rows : []).forEach((r) => info.set(r.id, { rank: r.market_cap_rank || null, image: r.image || null }));
      } catch (e) { /* unranked candidates are dropped below */ }
    }
    return cands
      .filter((e) => info.get(e.id) && info.get(e.id).rank)
      .sort((a, b) => info.get(a.id).rank - info.get(b.id).rank)
      .slice(0, limit || 15)
      .map((e) => ({ symbol: e.symbol, name: e.name, address: e.address, image: info.get(e.id).image, rank: info.get(e.id).rank }));
  }

  // ---- trending coins ------------------------------------------------------
  let trendCache = { at: 0, key: "", data: null };
  async function getTrendingCoins(limit, currency) {
    const sup = (typeof TM_PRICES !== "undefined" && TM_PRICES.SUPPORTED_CURRENCIES) || {};
    const vs = sup[currency] ? currency : ((typeof TM_PRICES !== "undefined" && TM_PRICES.DEFAULT_CURRENCY) || "usd");
    const key = `${vs}|${limit}`;
    if (trendCache.data && trendCache.key === key && Date.now() - trendCache.at < TRENDING_TTL_MS) return trendCache.data;
    const t = await getJson(`${BASE}/search/trending`);
    const items = ((t && t.coins) || []).map((c) => c && c.item).filter((i) => i && i.id).slice(0, limit || 10);
    if (!items.length) return [];
    const byId = {};
    try {
      const rows = await getJson(`${BASE}/coins/markets?vs_currency=${vs}&ids=${encodeURIComponent(items.map((i) => i.id).join(","))}&per_page=250&price_change_percentage=24h`);
      (Array.isArray(rows) ? rows : []).forEach((r) => { byId[r.id] = r; });
    } catch (e) { /* show the names without prices rather than nothing */ }
    const data = items.map((i) => {
      const m = byId[i.id] || {};
      return {
        id: i.id,
        name: String(i.name || m.name || ""),
        symbol: String(i.symbol || m.symbol || "").toUpperCase(),
        image: m.image || i.small || i.thumb || null,
        price: typeof m.current_price === "number" ? m.current_price : null,
        change24h: typeof m.price_change_percentage_24h === "number" ? m.price_change_percentage_24h : null,
        url: `https://www.coingecko.com/en/coins/${encodeURIComponent(i.id)}`,
      };
    });
    trendCache = { at: Date.now(), key, data };
    return data;
  }

  self.TM_CATALOG = { getTrendingCoins, top, search, supports };
})();
