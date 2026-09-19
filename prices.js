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

  // ---- Extra coins (added later; see EXTRA_PRICE_BOARD below) ----
  // These follow CoinGecko's usual id conventions but were NOT each checked
  // against a live coin page the way the 18 above were, so they are flagged
  // `optional` on the board: if CoinGecko doesn't return one of them (a wrong
  // or retired id), that row is quietly left out instead of showing "n/a".
  BCH: "bitcoin-cash",
  XLM: "stellar",
  XMR: "monero",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  ICP: "internet-computer",
  FIL: "filecoin",
  HBAR: "hedera-hashgraph",
  VET: "vechain",
  ALGO: "algorand",
  AAVE: "aave",
  MKR: "maker",
  GRT: "the-graph",
  INJ: "injective-protocol",
  RENDER: "render-token",
  PEPE: "pepe",
  DAI: "dai",
  WBTC: "wrapped-bitcoin",
  ETC: "ethereum-classic",
  KAS: "kaspa",
  XTZ: "tezos",
  EOS: "eos",
  BONK: "bonk",
  FLOKI: "floki",
  SAND: "the-sandbox",
  MANA: "decentraland",
  LDO: "lido-dao",
  CRV: "curve-dao-token",
  STX: "blockstack",
  CRO: "crypto-com-chain",
  WIF: "dogwifcoin",
  TAO: "bittensor",
  WLD: "worldcoin-wld",
  PAXG: "pax-gold",
  TIA: "celestia",
  SEI: "sei-network",
  MNT: "mantle",
  PYTH: "pyth-network",
  ONDO: "ondo-finance",
  FET: "fetch-ai",
  THETA: "theta-token",
  FLOW: "flow",
  GALA: "gala",
  CHZ: "chiliz",
  COMP: "compound-governance-token",
  SNX: "havven",
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

// Extra coins shown on the Prices screen (searchable). `optional: true` means
// "leave this row out if CoinGecko doesn't return it" -- see the note above.
const EXTRA_PRICE_BOARD = [
  ["BCH", "Bitcoin Cash"], ["XLM", "Stellar"], ["XMR", "Monero"], ["ATOM", "Cosmos"],
  ["NEAR", "NEAR Protocol"], ["APT", "Aptos"], ["ARB", "Arbitrum"], ["OP", "Optimism"],
  ["SUI", "Sui"], ["ICP", "Internet Computer"], ["FIL", "Filecoin"], ["HBAR", "Hedera"],
  ["VET", "VeChain"], ["ALGO", "Algorand"], ["AAVE", "Aave"], ["MKR", "Maker"],
  ["GRT", "The Graph"], ["INJ", "Injective"], ["RENDER", "Render"], ["PEPE", "Pepe"],
  ["DAI", "Dai"], ["WBTC", "Wrapped Bitcoin"], ["ETC", "Ethereum Classic"], ["KAS", "Kaspa"],
  ["XTZ", "Tezos"], ["EOS", "EOS"], ["BONK", "Bonk"], ["FLOKI", "Floki"],
  ["SAND", "The Sandbox"], ["MANA", "Decentraland"], ["LDO", "Lido DAO"], ["CRV", "Curve DAO"],
  ["STX", "Stacks"], ["CRO", "Cronos"], ["WIF", "dogwifhat"], ["TAO", "Bittensor"],
  ["WLD", "Worldcoin"], ["PAXG", "PAX Gold"], ["TIA", "Celestia"], ["SEI", "Sei"],
  ["MNT", "Mantle"], ["PYTH", "Pyth Network"], ["ONDO", "Ondo"], ["FET", "Fetch.ai"],
  ["THETA", "Theta Network"], ["FLOW", "Flow"], ["GALA", "Gala"], ["CHZ", "Chiliz"],
  ["COMP", "Compound"], ["SNX", "Synthetix"],
].map(([symbol, name]) => ({ symbol, name, optional: true }));

const FULL_PRICE_BOARD = PRICE_BOARD.concat(EXTRA_PRICE_BOARD);

// Fiat currencies this wallet offers in Settings, all of which CoinGecko's
// keyless API can price directly (no separate FX-rate lookup needed) -- see
// https://docs.coingecko.com/reference/simple-supported-vs-currencies.
// Symbol is just for display; the code is what's actually sent to CoinGecko.
const SUPPORTED_CURRENCIES = {
  // ---- Fiat (national currencies). Every code below is in CoinGecko's own
  // /simple/supported_vs_currencies list (checked Sept 2026). `decimals`
  // defaults to 2; currencies with no minor unit in everyday use show 0,
  // and the Gulf dinars that split into 1000ths show 3.
  usd: { symbol: "$", label: "USD", name: "US Dollar", type: "fiat" },
  eur: { symbol: "€", label: "EUR", name: "Euro", type: "fiat" },
  gbp: { symbol: "£", label: "GBP", name: "British Pound", type: "fiat" },
  jpy: { symbol: "¥", label: "JPY", name: "Japanese Yen", type: "fiat", decimals: 0 },
  cad: { symbol: "CA$", label: "CAD", name: "Canadian Dollar", type: "fiat" },
  aud: { symbol: "AU$", label: "AUD", name: "Australian Dollar", type: "fiat" },
  inr: { symbol: "₹", label: "INR", name: "Indian Rupee", type: "fiat" },
  brl: { symbol: "R$", label: "BRL", name: "Brazilian Real", type: "fiat" },
  aed: { symbol: "AED", label: "AED", name: "UAE Dirham", type: "fiat" },
  ars: { symbol: "AR$", label: "ARS", name: "Argentine Peso", type: "fiat" },
  bdt: { symbol: "৳", label: "BDT", name: "Bangladeshi Taka", type: "fiat" },
  bhd: { symbol: "BHD", label: "BHD", name: "Bahraini Dinar", type: "fiat", decimals: 3 },
  bmd: { symbol: "BD$", label: "BMD", name: "Bermudian Dollar", type: "fiat" },
  chf: { symbol: "CHF", label: "CHF", name: "Swiss Franc", type: "fiat" },
  clp: { symbol: "CL$", label: "CLP", name: "Chilean Peso", type: "fiat", decimals: 0 },
  cny: { symbol: "CN¥", label: "CNY", name: "Chinese Yuan", type: "fiat" },
  czk: { symbol: "Kč", label: "CZK", name: "Czech Koruna", type: "fiat" },
  dkk: { symbol: "kr", label: "DKK", name: "Danish Krone", type: "fiat" },
  gel: { symbol: "₾", label: "GEL", name: "Georgian Lari", type: "fiat" },
  hkd: { symbol: "HK$", label: "HKD", name: "Hong Kong Dollar", type: "fiat" },
  huf: { symbol: "Ft", label: "HUF", name: "Hungarian Forint", type: "fiat", decimals: 0 },
  idr: { symbol: "Rp", label: "IDR", name: "Indonesian Rupiah", type: "fiat", decimals: 0 },
  ils: { symbol: "₪", label: "ILS", name: "Israeli Shekel", type: "fiat" },
  krw: { symbol: "₩", label: "KRW", name: "South Korean Won", type: "fiat", decimals: 0 },
  kwd: { symbol: "KWD", label: "KWD", name: "Kuwaiti Dinar", type: "fiat", decimals: 3 },
  lkr: { symbol: "Rs", label: "LKR", name: "Sri Lankan Rupee", type: "fiat" },
  mmk: { symbol: "K", label: "MMK", name: "Myanmar Kyat", type: "fiat", decimals: 0 },
  mxn: { symbol: "MX$", label: "MXN", name: "Mexican Peso", type: "fiat" },
  myr: { symbol: "RM", label: "MYR", name: "Malaysian Ringgit", type: "fiat" },
  ngn: { symbol: "₦", label: "NGN", name: "Nigerian Naira", type: "fiat" },
  nok: { symbol: "kr", label: "NOK", name: "Norwegian Krone", type: "fiat" },
  nzd: { symbol: "NZ$", label: "NZD", name: "New Zealand Dollar", type: "fiat" },
  php: { symbol: "₱", label: "PHP", name: "Philippine Peso", type: "fiat" },
  pkr: { symbol: "Rs", label: "PKR", name: "Pakistani Rupee", type: "fiat" },
  pln: { symbol: "zł", label: "PLN", name: "Polish Zloty", type: "fiat" },
  rub: { symbol: "₽", label: "RUB", name: "Russian Ruble", type: "fiat" },
  sar: { symbol: "SAR", label: "SAR", name: "Saudi Riyal", type: "fiat" },
  sek: { symbol: "kr", label: "SEK", name: "Swedish Krona", type: "fiat" },
  sgd: { symbol: "S$", label: "SGD", name: "Singapore Dollar", type: "fiat" },
  thb: { symbol: "฿", label: "THB", name: "Thai Baht", type: "fiat" },
  try: { symbol: "₺", label: "TRY", name: "Turkish Lira", type: "fiat" },
  twd: { symbol: "NT$", label: "TWD", name: "New Taiwan Dollar", type: "fiat" },
  uah: { symbol: "₴", label: "UAH", name: "Ukrainian Hryvnia", type: "fiat" },
  vnd: { symbol: "₫", label: "VND", name: "Vietnamese Dong", type: "fiat", decimals: 0 },
  zar: { symbol: "R", label: "ZAR", name: "South African Rand", type: "fiat" },

  // ---- Crypto (also valid CoinGecko vs_currencies, so balances and prices
  // can be shown in them directly). Shown with significant digits rather
  // than fixed decimals -- see formatMoney().
  btc: { symbol: "₿", label: "BTC", name: "Bitcoin", type: "crypto" },
  eth: { symbol: "Ξ", label: "ETH", name: "Ethereum", type: "crypto" },
  bnb: { symbol: "BNB", label: "BNB", name: "BNB", type: "crypto" },
  sol: { symbol: "SOL", label: "SOL", name: "Solana", type: "crypto" },
  xrp: { symbol: "XRP", label: "XRP", name: "XRP", type: "crypto" },
};
const DEFAULT_CURRENCY = "usd";

// Formats an amount in the given display currency code. `opts.price` is for
// per-unit coin prices, which keep extra precision under 1 (a $0.0000123
// meme coin shouldn't read as $0.00). Alphabetic symbols ("CHF", "SAR") get
// a space before the number; symbol-style ones ("$", "€") don't.
function formatMoney(amount, currency, opts) {
  const info = SUPPORTED_CURRENCIES[currency] || SUPPORTED_CURRENCIES[DEFAULT_CURRENCY];
  const symbol = /^[A-Za-z]{2,}$/.test(info.symbol) ? info.symbol + "\u00A0" : info.symbol;
  const n = Number(amount);
  if (!isFinite(n)) return symbol + "0";
  let body;
  if (info.type === "crypto") {
    body = n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
  } else {
    const base = typeof info.decimals === "number" ? info.decimals : 2;
    const isPrice = opts && opts.price;
    if (isPrice && n !== 0 && Math.abs(n) < 0.01) {
      // Sub-cent unit prices (PEPE, SHIB, BONK...) need significant digits,
      // not fixed decimals, or they collapse to 0.0000.
      body = n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
    } else {
      const digits = isPrice && Math.abs(n) < 1 ? Math.max(base, 4) : base;
      body = n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
  }
  return symbol + body;
}

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
    return { data: priceCache.data, currency: vsCurrency };
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

// Separate small in-memory cache for the price BOARD specifically (kept
// apart from fetchPrices()'s cache above, and calling a different
// endpoint) -- CoinGecko's /coins/markets returns price, 24h change, AND
// each coin's own logo image in one call, which /simple/price above
// doesn't provide. Isolating this to its own function/cache means the
// board's request shape can't affect fetchPrices()'s existing callers
// (native-coin balance pricing, token pricing, the send-fee USD estimate).
let priceBoardCache = { fetchedAt: 0, cacheKey: "", data: null };

async function fetchPriceBoardMarkets(ids, currency) {
  const vsCurrency = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const idsKey = [...new Set(ids)].sort().join(",");
  const cacheKey = `${idsKey}|${vsCurrency}`;
  const now = Date.now();
  if (priceBoardCache.data && priceBoardCache.cacheKey === cacheKey && now - priceBoardCache.fetchedAt < CACHE_TTL_MS) {
    return priceBoardCache.data;
  }
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=${vsCurrency}&ids=${encodeURIComponent(idsKey)}&per_page=250&price_change_percentage=24h`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error("Couldn't reach CoinGecko for live prices. Check your internet connection.");
  }
  if (!res.ok) {
    throw new Error(`CoinGecko price request failed (HTTP ${res.status}).`);
  }
  const rows = await res.json();
  const byId = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    byId[r.id] = r;
  });
  priceBoardCache = { fetchedAt: now, cacheKey, data: byId };
  return byId;
}

// Returns the fixed PRICE_BOARD list, each entry filled in with its live
// price (in the given display currency, USD by default), 24h change, and a
// real logo image URL straight from CoinGecko (null for any of these if
// CoinGecko didn't return that coin, e.g. a request that partially fails).
async function getPriceBoard(currency) {
  const ids = FULL_PRICE_BOARD.map((c) => COINGECKO_IDS[c.symbol]);
  const byId = await fetchPriceBoardMarkets(ids, currency);
  const rows = [];
  FULL_PRICE_BOARD.forEach((c) => {
    const id = COINGECKO_IDS[c.symbol];
    const entry = byId[id];
    // An optional (extra) coin CoinGecko didn't return is left out entirely
    // rather than shown as "n/a" -- see the note on the extra ids above.
    if (!entry && c.optional) return;
    rows.push({
      symbol: c.symbol,
      name: c.name,
      price: entry ? entry.current_price : null,
      change24h: entry && typeof entry.price_change_percentage_24h === "number" ? entry.price_change_percentage_24h : null,
      image: entry ? entry.image : null,
    });
  });
  return rows;
}

// Fiat exchange rates: what 1 unit of each supported national currency is
// worth in the given display currency. Uses CoinGecko's keyless
// /exchange_rates endpoint, which prices everything against 1 BTC, so any
// pair is just a ratio: 1 X = rates[display].value / rates[X].value.
// Purely informational, same as the coin prices. Cached like the others.
let fiatRatesCache = { fetchedAt: 0, data: null };

async function fetchExchangeRates() {
  const now = Date.now();
  if (fiatRatesCache.data && now - fiatRatesCache.fetchedAt < CACHE_TTL_MS) return fiatRatesCache.data;
  let res;
  try {
    res = await fetch(`${COINGECKO_BASE}/exchange_rates`);
  } catch (e) {
    throw new Error("Couldn't reach CoinGecko for currency rates. Check your internet connection.");
  }
  if (!res.ok) throw new Error(`CoinGecko exchange-rate request failed (HTTP ${res.status}).`);
  const json = await res.json();
  const rates = (json && json.rates) || {};
  fiatRatesCache = { fetchedAt: now, data: rates };
  return rates;
}

async function getFiatRates(currency) {
  const display = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const rates = await fetchExchangeRates();
  const base = rates[display];
  if (!base || !base.value) return [];
  const out = [];
  Object.keys(SUPPORTED_CURRENCIES).forEach((code) => {
    const info = SUPPORTED_CURRENCIES[code];
    if (info.type !== "fiat" || code === display) return;
    const r = rates[code];
    if (!r || !r.value) return;
    out.push({ code: info.label, name: info.name, rate: base.value / r.value });
  });
  return out;
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
    getFiatRates,
    formatMoney,
    getNativePriceForNetwork,
    getTokenPricesByContract,
    COINGECKO_IDS,
    NETWORK_NATIVE_COINGECKO_ID,
    NETWORK_COINGECKO_PLATFORM,
    SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY,
  };
}
