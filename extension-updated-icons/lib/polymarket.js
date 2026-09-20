// lib/polymarket.js
// Read-only, informational display of trending Polymarket prediction
// markets (crypto up/down markets, sports moneylines, etc.) -- similar to
// the "Markets" widget MetaMask Portfolio shows. This is purely a public,
// keyless GET against Polymarket's own public Gamma API
// (https://docs.polymarket.com/) -- the same data anyone sees on
// polymarket.com. Nothing about the wallet -- no address, no balance, no
// account info -- is ever sent with these requests, and this wallet does
// NOT place bets, hold positions, or make any contract call related to
// Polymarket. It only reads and displays odds.
//
// This module is loaded directly into the popup (see popup/popup.html) and
// runs there, not in the background service worker -- same as lib/prices.js.
// Wrapped in an IIFE (unlike lib/prices.js) so its own top-level consts
// (CACHE_TTL_MS, etc.) can't collide with another script's same-named
// top-level consts sharing this popup's global scope.
(function () {
  const POLYMARKET_BASE = "https://gamma-api.polymarket.com";

  // Small in-memory cache, same reasoning as lib/prices.js: keep normal use
  // (opening the popup, switching screens) well clear of any rate limit
  // without the odds ever going noticeably stale for a display-only widget.
  const CACHE_TTL_MS = 60 * 1000;
  let marketCache = { fetchedAt: 0, limitKey: 0, data: null };

  // Polymarket's Gamma API returns `outcomes` and `outcomePrices` as
  // JSON-encoded STRINGS (e.g. the literal text '["Yes","No"]'), not actual
  // arrays -- easy to get wrong by assuming they're already parsed. Guarded
  // here so one malformed market can't break the whole list.
  function safeParseArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function toMarketSummary(m) {
    const outcomes = safeParseArray(m.outcomes);
    const prices = safeParseArray(m.outcomePrices).map((p) => Number(p));
    // The leading outcome is what Polymarket itself treats as primary (index
    // 0 is "Yes" for the near-universal Yes/No framing this wallet displays).
    const leadName = outcomes[0] != null ? String(outcomes[0]) : null;
    const leadPct = Number.isFinite(prices[0]) ? Math.round(prices[0] * 100) : null;
    return {
      id: m.id,
      question: m.question || "",
      slug: m.slug || "",
      leadName,
      leadPct,
      volume24hr: Number(m.volume24hr) || 0,
      endDate: m.endDate || null,
    };
  }

  async function fetchTrendingRaw(limit) {
    const now = Date.now();
    if (marketCache.data && marketCache.limitKey === limit && now - marketCache.fetchedAt < CACHE_TTL_MS) {
      return marketCache.data;
    }
    const url = `${POLYMARKET_BASE}/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error("Couldn't reach Polymarket for market data. Check your internet connection.");
    }
    if (!res.ok) {
      throw new Error(`Polymarket market request failed (HTTP ${res.status}).`);
    }
    const data = await res.json();
    marketCache = { fetchedAt: now, limitKey: limit, data };
    return data;
  }

  // Returns up to `limit` trending markets (highest 24h volume first),
  // summarized for display: question, the primary ("Yes") outcome name and
  // its current implied probability as a whole-number percent, and 24h
  // volume. Purely informational -- no trading, no wallet interaction.
  async function getTrendingMarkets(limit = 10) {
    const raw = await fetchTrendingRaw(limit);
    const list = Array.isArray(raw) ? raw : [];
    return list.map(toMarketSummary).filter((m) => m.question);
  }

  if (typeof self !== "undefined") {
    self.TM_POLYMARKET = {
      getTrendingMarkets,
    };
  }
})();
