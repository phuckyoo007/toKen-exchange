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
// `stablecoin` is set only where a real, currently-circulating,
// non-negligible stablecoin actually exists for that currency (checked
// against issuer sites, exchange listings and news coverage, Sept 2026,
// re-checked 2026-09-20 specifically to look for anything new since the
// first pass) -- most currencies below have none, and none is invented
// for them. A currency stays unmapped when the only options found are
// still in a regulatory sandbox/pilot rather than open circulation (CHF's
// CHFD, Malaysia's RMJDT), haven't actually launched despite announcements
// (India's ARC, Taiwan/Thailand's planned tokens), or come from an
// issuer whose legitimacy couldn't be verified (Chile's CLPX, dormant
// since a 2021 announcement) -- an unverifiable or pre-launch pick is
// worse than none. HKDAP (HKD) is real and live but currently
// institutional-only (retail access is planned, not yet open) -- still
// listed since it's genuinely circulating, not merely announced.
// Every one of these regional/non-USD stablecoins is far smaller and less
// liquid than USDC -- collectively they're under 0.5% of total stablecoin
// market share -- so this is shown as informational context on the
// Currencies tab (see coin.stablecoinNote), never as a swap option this
// wallet actually offers or a recommendation to hold one.
const SUPPORTED_CURRENCIES = {
  // ---- Fiat (national currencies). Every code below is in CoinGecko's own
  // /simple/supported_vs_currencies list (checked Sept 2026). `decimals`
  // defaults to 2; currencies with no minor unit in everyday use show 0,
  // and the Gulf dinars that split into 1000ths show 3.
  usd: { symbol: "$", label: "USD", name: "US Dollar", type: "fiat", stablecoin: "USDC" },
  eur: { symbol: "€", label: "EUR", name: "Euro", type: "fiat", stablecoin: "EURC" },
  gbp: { symbol: "£", label: "GBP", name: "British Pound", type: "fiat", stablecoin: "tGBP" },
  jpy: { symbol: "¥", label: "JPY", name: "Japanese Yen", type: "fiat", decimals: 0, stablecoin: "JPYC" },
  cad: { symbol: "CA$", label: "CAD", name: "Canadian Dollar", type: "fiat", stablecoin: "QCAD" },
  aud: { symbol: "AU$", label: "AUD", name: "Australian Dollar", type: "fiat", stablecoin: "AUDD" },
  inr: { symbol: "₹", label: "INR", name: "Indian Rupee", type: "fiat" },
  brl: { symbol: "R$", label: "BRL", name: "Brazilian Real", type: "fiat", stablecoin: "BRZ" },
  aed: { symbol: "AED", label: "AED", name: "UAE Dirham", type: "fiat", stablecoin: "AE Coin" },
  ars: { symbol: "AR$", label: "ARS", name: "Argentine Peso", type: "fiat", stablecoin: "wARS" },
  bdt: { symbol: "৳", label: "BDT", name: "Bangladeshi Taka", type: "fiat" },
  bhd: { symbol: "BHD", label: "BHD", name: "Bahraini Dinar", type: "fiat", decimals: 3 },
  bmd: { symbol: "BD$", label: "BMD", name: "Bermudian Dollar", type: "fiat" },
  chf: { symbol: "CHF", label: "CHF", name: "Swiss Franc", type: "fiat" },
  clp: { symbol: "CL$", label: "CLP", name: "Chilean Peso", type: "fiat", decimals: 0 },
  cny: { symbol: "CN¥", label: "CNY", name: "Chinese Yuan", type: "fiat" },
  czk: { symbol: "Kč", label: "CZK", name: "Czech Koruna", type: "fiat" },
  dkk: { symbol: "kr", label: "DKK", name: "Danish Krone", type: "fiat" },
  gel: { symbol: "₾", label: "GEL", name: "Georgian Lari", type: "fiat" },
  hkd: { symbol: "HK$", label: "HKD", name: "Hong Kong Dollar", type: "fiat", stablecoin: "HKDAP" },
  huf: { symbol: "Ft", label: "HUF", name: "Hungarian Forint", type: "fiat", decimals: 0 },
  idr: { symbol: "Rp", label: "IDR", name: "Indonesian Rupiah", type: "fiat", decimals: 0, stablecoin: "IDRX" },
  ils: { symbol: "₪", label: "ILS", name: "Israeli Shekel", type: "fiat", stablecoin: "BILS" },
  krw: { symbol: "₩", label: "KRW", name: "South Korean Won", type: "fiat", decimals: 0, stablecoin: "KRWQ" },
  kwd: { symbol: "KWD", label: "KWD", name: "Kuwaiti Dinar", type: "fiat", decimals: 3 },
  lkr: { symbol: "Rs", label: "LKR", name: "Sri Lankan Rupee", type: "fiat" },
  mmk: { symbol: "K", label: "MMK", name: "Myanmar Kyat", type: "fiat", decimals: 0 },
  mxn: { symbol: "MX$", label: "MXN", name: "Mexican Peso", type: "fiat", stablecoin: "MXNe" },
  myr: { symbol: "RM", label: "MYR", name: "Malaysian Ringgit", type: "fiat" },
  ngn: { symbol: "₦", label: "NGN", name: "Nigerian Naira", type: "fiat", stablecoin: "cNGN" },
  nok: { symbol: "kr", label: "NOK", name: "Norwegian Krone", type: "fiat" },
  nzd: { symbol: "NZ$", label: "NZD", name: "New Zealand Dollar", type: "fiat", stablecoin: "NZDS" },
  php: { symbol: "₱", label: "PHP", name: "Philippine Peso", type: "fiat", stablecoin: "PHPC" },
  pkr: { symbol: "Rs", label: "PKR", name: "Pakistani Rupee", type: "fiat" },
  pln: { symbol: "zł", label: "PLN", name: "Polish Zloty", type: "fiat" },
  // No stablecoin listed for the Russian ruble: the one that exists
  // (A7A5) is tied to sanctions-evasion reporting, not something this
  // wallet associates a currency with even informationally.
  rub: { symbol: "₽", label: "RUB", name: "Russian Ruble", type: "fiat" },
  sar: { symbol: "SAR", label: "SAR", name: "Saudi Riyal", type: "fiat" },
  sek: { symbol: "kr", label: "SEK", name: "Swedish Krona", type: "fiat" },
  sgd: { symbol: "S$", label: "SGD", name: "Singapore Dollar", type: "fiat", stablecoin: "XSGD" },
  thb: { symbol: "฿", label: "THB", name: "Thai Baht", type: "fiat" },
  try: { symbol: "₺", label: "TRY", name: "Turkish Lira", type: "fiat", stablecoin: "TRYB" },
  twd: { symbol: "NT$", label: "TWD", name: "New Taiwan Dollar", type: "fiat" },
  uah: { symbol: "₴", label: "UAH", name: "Ukrainian Hryvnia", type: "fiat" },
  vnd: { symbol: "₫", label: "VND", name: "Vietnamese Dong", type: "fiat", decimals: 0 },
  zar: { symbol: "R", label: "ZAR", name: "South African Rand", type: "fiat", stablecoin: "ZARP" },

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

// Compact form for big numbers (market cap, volume): $1.2T, CHF 340B, 12.5M.
function formatMoneyCompact(amount, currency) {
  const info = SUPPORTED_CURRENCIES[currency] || SUPPORTED_CURRENCIES[DEFAULT_CURRENCY];
  const symbol = /^[A-Za-z]{2,}$/.test(info.symbol) ? info.symbol + "\u00A0" : info.symbol;
  const n = Number(amount);
  if (!isFinite(n)) return symbol + "0";
  return symbol + n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
}

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
      // Public CoinGecko page for this coin; the Prices screen links each row to it.
      url: `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`,
    });
  });
  return rows;
}

// ---- In-app coin detail (the screen a Prices row opens) ---------------
// One CoinGecko /coins/{id} call per coin gives price, market stats and a
// text description; a second /market_chart call draws the price chart.
// Both are keyless, cached briefly, and only fired when someone opens a coin.
const coinDetailCache = new Map();
const coinChartCache = new Map();

function plainTextFromHtml(html) {
  return String(html || "")
    .replace(/<(br|\/p|\/li)[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// First couple of sentences, capped in length -- this is a summary card,
// not the whole write-up (the CoinGecko link has the rest).
function shortDescription(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastStop > maxLen * 0.5 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, "") + "...").trim();
}

async function getCoinDetail(symbol, currency) {
  const id = COINGECKO_IDS[symbol];
  if (!id) throw new Error("Unknown coin.");
  const vs = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const key = id + "|" + vs;
  const now = Date.now();
  const hit = coinDetailCache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.data;

  let res;
  try {
    res = await fetch(`${COINGECKO_BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`);
  } catch (e) {
    throw new Error("Couldn't reach CoinGecko. Check your internet connection.");
  }
  if (!res.ok) throw new Error(`CoinGecko request failed (HTTP ${res.status}).`);
  const json = await res.json();
  const md = json.market_data || {};
  const pick = (o) => (o && typeof o[vs] === "number" ? o[vs] : null);
  const change = md.price_change_percentage_24h_in_currency && typeof md.price_change_percentage_24h_in_currency[vs] === "number"
    ? md.price_change_percentage_24h_in_currency[vs]
    : (typeof md.price_change_percentage_24h === "number" ? md.price_change_percentage_24h : null);
  const homepage = json.links && Array.isArray(json.links.homepage)
    ? json.links.homepage.find((u) => typeof u === "string" && /^https:\/\//i.test(u)) || null
    : null;
  const data = {
    id,
    rank: typeof json.market_cap_rank === "number" ? json.market_cap_rank : null,
    price: pick(md.current_price),
    change24h: change,
    marketCap: pick(md.market_cap),
    volume: pick(md.total_volume),
    high24h: pick(md.high_24h),
    low24h: pick(md.low_24h),
    ath: pick(md.ath),
    athChange: pick(md.ath_change_percentage),
    circulatingSupply: typeof md.circulating_supply === "number" ? md.circulating_supply : null,
    description: shortDescription(plainTextFromHtml(json.description && json.description.en), 420),
    homepage,
  };
  coinDetailCache.set(key, { fetchedAt: now, data });
  return data;
}

// days: 1 (24H), 7, 30, or 365. Returns [[timestampMs, price], ...] thinned
// to at most ~120 points, plenty for a phone-width line chart.
async function getCoinChart(symbol, currency, days) {
  const id = COINGECKO_IDS[symbol];
  if (!id) throw new Error("Unknown coin.");
  const vs = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const key = id + "|" + vs + "|" + days;
  const now = Date.now();
  const hit = coinChartCache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.data;

  let res;
  try {
    res = await fetch(`${COINGECKO_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${vs}&days=${days}`);
  } catch (e) {
    throw new Error("Couldn't reach CoinGecko. Check your internet connection.");
  }
  if (!res.ok) throw new Error(`CoinGecko chart request failed (HTTP ${res.status}).`);
  const json = await res.json();
  const raw = Array.isArray(json.prices) ? json.prices.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])) : [];
  const step = Math.max(1, Math.ceil(raw.length / 120));
  const data = raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  coinChartCache.set(key, { fetchedAt: now, data });
  return data;
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
    out.push({ code: info.label, name: info.name, rate: base.value / r.value, stablecoin: info.stablecoin || null });
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
    getCoinDetail,
    getCoinChart,
    formatMoney,
    formatMoneyCompact,
    getNativePriceForNetwork,
    getTokenPricesByContract,
    COINGECKO_IDS,
    NETWORK_NATIVE_COINGECKO_ID,
    NETWORK_COINGECKO_PLATFORM,
    SUPPORTED_CURRENCIES,
    DEFAULT_CURRENCY,
  };
}
