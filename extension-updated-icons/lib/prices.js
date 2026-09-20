// lib/prices.js
// Live USD price lookups via CoinGecko's free, keyless public API --
// https://docs.coingecko.com/docs/keyless-public-api -- no API key, no auth
// header, no account needed, just a plain GET request. This is purely
// informational and read-only: the only thing sent to CoinGecko is "what's
// the USD price of coin X right now", the same request any price-ticker
// website makes. Nothing about the wallet -- no address, no balance, no
// account info -- is ever included in these requests.
//
// This module is loaded directly into the popup (see popup/popup.html) and
// runs there, not in the background service worker -- prices are a
// display-only concern and don't need to survive the popup closing.

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// CoinGecko's own per-coin "id" strings. These are NOT the same as ticker
// symbols and are easy to get subtly wrong (e.g. Polygon's native token
// migrated from "matic-network" to "polygon-ecosystem-token" when MATIC
// rebranded to POL) -- verified against CoinGecko's own coin pages before
// being hardcoded here, per this project's practice of never guessing an
// integration parameter. A wrong id here doesn't crash anything, it just
// silently returns no price, so keep this list accurate if CoinGecko ever
// changes an id again.
const COINGECKO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  POL: "polygon-ecosystem-token", // formerly "matic-network" (MATIC)
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  USDT: "tether",
  USDC: "usd-coin",
  AVAX: "avalanche-2", // NOT "avalanche" -- CoinGecko's own quirk, verified on their coin page
  LINK: "chainlink",
  DOT: "polkadot",
  TRX: "tron",
  UNI: "uniswap",
  LTC: "litecoin",
  SHIB: "shiba-inu",
  TON: "the-open-network", // NOT "toncoin" -- CoinGecko's own quirk, verified on their coin page
};

// Maps this wallet's internal network `key` (see lib/networks.js) to the
// CoinGecko id of THAT NETWORK'S NATIVE COIN, so the main screen can show
// roughly what the connected account's balance is worth.
const NETWORK_NATIVE_COINGECKO_ID = {
  ethereum: COINGECKO_IDS.ETH,
  base: COINGECKO_IDS.ETH, // Base's native coin is ETH, not a separate token
  polygon: COINGECKO_IDS.POL,
  bsc: COINGECKO_IDS.BNB,
  arbitrum: COINGECKO_IDS.ETH,
  optimism: COINGECKO_IDS.ETH,
  // Custom networks (key starts with "custom-") intentionally have no entry
  // here -- we don't know what their native coin actually is, so
  // getNativePriceForNetwork() below returns null for them rather than
  // guessing a price that would be wrong.
};

// The "Prices" screen shows this fixed list: the coins this wallet actually
// moves, plus a handful of the most-tracked cryptocurrencies in general,
// since the ask was to see prices of "different cryptocurrencies", not only
// the ones this wallet supports.
const PRICE_BOARD = [
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "BNB", name: "BNB" },
  { symbol: "POL", name: "Polygon" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "XRP", name: "XRP" },
  { symbol: "DOGE", name: "Dogecoin" },
  { symbol: "ADA", name: "Cardano" },
  { symbol: "USDT", name: "Tether" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "AVAX", name: "Avalanche" },
  { symbol: "LINK", name: "Chainlink" },
  { symbol: "DOT", name: "Polkadot" },
  { symbol: "TRX", name: "TRON" },
  { symbol: "UNI", name: "Uniswap" },
  { symbol: "LTC", name: "Litecoin" },
  { symbol: "SHIB", name: "Shiba Inu" },
  { symbol: "TON", name: "Toncoin" },
];

// Fiat currencies this wallet offers in Settings, all of which CoinGecko's
// keyless API can price directly (no separate FX-rate lookup needed) -- see
// https://docs.coingecko.com/reference/simple-supported-vs-currencies.
// Symbol is just for display; the code is what's actually sent to CoinGecko.
const SUPPORTED_CURRENCIES = {
  usd: { symbol: "$", label: "USD" },
  eur: { symbol: "€", label: "EUR" },
  gbp: { symbol: "£", label: "GBP" },
  jpy: { symbol: "¥", label: "JPY" },
  cad: { symbol: "CA$", label: "CAD" },
  aud: { symbol: "AU$", label: "AUD" },
  inr: { symbol: "₹", label: "INR" },
  brl: { symbol: "R$", label: "BRL" },
};
const DEFAULT_CURRENCY = "usd";

// Small in-memory cache. CoinGecko's keyless tier is IP-rate-limited to
// roughly 10-30 requests/minute -- a 45s TTL keeps normal use (opening the
// popup, switching screens) well under that without the price ever going
// noticeably stale for a display-only ticker. Keyed by currency too, since
// switching the display currency in Settings needs a fresh request.
const CACHE_TTL_MS = 45 * 1000;
let priceCache = { fetchedAt: 0, cacheKey: "", data: null };

async function fetchPrices(ids, currency) {
  const vsCurrency = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const idsKey = [...new Set(ids)].sort().join(",");
  const cacheKey = `${idsKey}|${vsCurrency}`;
  const now = Date.now();
  if (priceCache.data && priceCache.cacheKey === cacheKey && now - priceCache.fetchedAt < CACHE_TTL_MS) {
    return priceCache.data;
  }
  const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(idsKey)}&vs_currencies=${vsCurrency}&include_24hr_change=true`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error("Couldn't reach CoinGecko for live prices. Check your internet connection.");
  }
  if (!res.ok) {
    throw new Error(`CoinGecko price request failed (HTTP ${res.status}).`);
  }
  const data = await res.json();
  priceCache = { fetchedAt: now, cacheKey, data };
  return { data, currency: vsCurrency };
}

// Returns the fixed PRICE_BOARD list, each entry filled in with its live
// price (in the given display currency, USD by default) and 24h change
// (null if CoinGecko didn't return that coin, e.g. a request that partially
// fails).
async function getPriceBoard(currency) {
  const ids = PRICE_BOARD.map((c) => COINGECKO_IDS[c.symbol]);
  const { data, currency: vsCurrency } = await fetchPrices(ids, currency);
  return PRICE_BOARD.map((c) => {
    const id = COINGECKO_IDS[c.symbol];
    const entry = data[id];
    return {
      symbol: c.symbol,
      name: c.name,
      price: entry ? entry[vsCurrency] : null,
      change24h: entry ? entry[`${vsCurrency}_24h_change`] : null,
    };
  });
}

// Returns the live price of the given network's native coin (in the given
// display currency), or null if this wallet doesn't have a verified
// CoinGecko id for that network (e.g. a user-added custom network).
async function getNativePriceForNetwork(networkKey, currency) {
  const id = NETWORK_NATIVE_COINGECKO_ID[networkKey];
  if (!id) return null;
  const { data, currency: vsCurrency } = await fetchPrices([id], currency);
  return data[id] ? data[id][vsCurrency] : null;
}

// Maps this wallet's internal network `key` to CoinGecko's "asset platform"
// id, used by the /simple/token_price/{platform} endpoint to price an
// arbitrary ERC-20 by its CONTRACT ADDRESS rather than a per-coin id. This
// is what makes pricing user-added tokens possible at all without
// maintaining our own address->CoinGecko-id mapping (which would mean
// guessing an id for every token someone adds -- exactly what this
// project avoids). Verified on 2026-09-08 by loading each chain's actual
// CoinGecko chain page at https://www.coingecko.com/en/chains/<id> and
// confirming it resolves (a wrong slug 404s -- that's how "optimism" was
// caught as wrong; the real id is "optimistic-ethereum").
const NETWORK_COINGECKO_PLATFORM = {
  ethereum: "ethereum",
  base: "base",
  polygon: "polygon-pos",
  bsc: "binance-smart-chain",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  // Custom networks intentionally unmapped -- see NETWORK_NATIVE_COINGECKO_ID above.
};

// Returns { [lowercased contract address]: { price: number } } (in the
// given display currency) for whichever of the given addresses CoinGecko
// recognizes on this network (addresses it doesn't know are simply absent
// from the result, not an error). Returns {} for a network with no known
// CoinGecko platform id, or an empty address list. Not cached -- callers
// are expected to call this only when showing the token list, not on every
// keystroke.
async function getTokenPricesByContract(networkKey, addresses, currency) {
  const platform = NETWORK_COINGECKO_PLATFORM[networkKey];
  if (!platform || !addresses || !addresses.length) return {};
  const vsCurrency = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const url = `${COINGECKO_BASE}/simple/token_price/${platform}?contract_addresses=${encodeURIComponent(addresses.join(","))}&vs_currencies=${vsCurrency}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error("Couldn't reach CoinGecko for token prices. Check your internet connection.");
  }
  if (!res.ok) {
    throw new Error(`CoinGecko token price request failed (HTTP ${res.status}).`);
  }
  const raw = await res.json();
  const result = {};
  Object.keys(raw).forEach((addr) => {
    const entry = raw[addr];
    result[addr] = { price: entry ? entry[vsCurrency] : null };
  });
  return result;
}

if (typeof self !== "undefined") {
  self.TM_PRICES = {
    getPriceBoard,
    getNativePriceForNetwork,
    getTokenPricesByContract,
    COINGECKO_IDS,
    NETWORK_NATIVE_COINGECKO_ID,
    NETWORK_COINGECKO_PLATFORM,
    SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY,
  };
}
