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
// Our own server relays (and caches) these CoinGecko calls -- see market-api.js. CoinGecko
// rate-limits by IP and phones on mobile data share IPs, so asking it directly often failed
// and the coin pages came up empty. We ask our server first and fall back to CoinGecko
// directly if our server can't be reached, so nothing gets worse.
const MARKET_PROXY_BASE = "https://web-wallet-production.up.railway.app/api/market";
const MARKET_PROXY_TIMEOUT_MS = 12000;

// `path` is the CoinGecko path + query, e.g. "/coins/usd-coin/market_chart?vs_currency=usd&days=7".
async function cgFetch(path) {
  try {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), MARKET_PROXY_TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetch(MARKET_PROXY_BASE + path, ctrl ? { signal: ctrl.signal } : undefined);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res && res.ok) return res;
  } catch (e) { /* fall through to CoinGecko directly */ }
  return fetch(COINGECKO_BASE + path);
}

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
  EURC: "euro-coin", // Circle's EUR stablecoin -- NOT independently re-verified against a live
                      // CoinGecko coin page the way the ids above were; spot-check before relying on it.
  JPYC: "jpycoin", // JPYC Inc.'s JPY-pegged stablecoin -- verified live against CoinGecko's /coins/jpycoin endpoint.
  BRZ: "brz", // Transfero's BRL-pegged stablecoin -- verified live against CoinGecko's /coins/brz endpoint
             // (NOT "brazilian-digital-token" -- that id doesn't exist on CoinGecko despite matching its display name).
  AVAX: "avalanche-2", // NOT "avalanche" -- CoinGecko's own quirk, verified on their coin page
  LINK: "chainlink",
  DOT: "polkadot",
  TRX: "tron",
  UNI: "uniswap",
  LTC: "litecoin",
  SHIB: "shiba-inu",
  TON: "the-open-network", // NOT "toncoin" -- CoinGecko's own quirk, verified on their coin page

  // Native gas tokens for networks this wallet supports that aren't already
  // covered above. Each id is CoinGecko's own `native_coin_id` for that
  // chain's asset-platform entry (GET /api/v3/asset_platforms), not guessed
  // from the display symbol, and confirmed live against /simple/price on
  // 2026-10-04.
  MNT: "mantle", // Mantle's native gas token
  XDAI: "xdai", // Gnosis Chain's native gas token (a USD-pegged bridge token, not Dai itself)
  CELO: "celo", // Celo's native gas token
  MON: "monad", // Monad's native gas token

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
  robinhood: COINGECKO_IDS.ETH, // Robinhood Chain gas token is ETH
  avalanche: COINGECKO_IDS.AVAX,
  linea: COINGECKO_IDS.ETH,
  scroll: COINGECKO_IDS.ETH,
  zksync: COINGECKO_IDS.ETH,
  mantle: COINGECKO_IDS.MNT,
  gnosis: COINGECKO_IDS.XDAI,
  celo: COINGECKO_IDS.CELO,
  monad: COINGECKO_IDS.MON,
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

// Maps a fiat currency code (as used in SUPPORTED_CURRENCIES above) to the
// symbol of the major, well-established stablecoin pegged 1:1 to it -- what
// the Prices > Currencies tab's row links out to when tapped. Deliberately
// small: most fiat currencies have no widely-used, liquid pegged stablecoin,
// and a wrong or obscure pick here would be actively misleading, so a
// currency with no confident entry just isn't clickable rather than
// guessing. Extend this list only with ids verified the same way the ones
// in COINGECKO_IDS above are.
const FIAT_STABLECOIN_PEG = {
  usd: "USDT",
  eur: "EURC",
  jpy: "JPYC",
  brl: "BRZ",
  // gbp and mxn deliberately left out: "GBPT"/"poundtoken" and "MXNT" both
  // came back "coin not found" (zero hits, even by name) when re-checked
  // live against CoinGecko's own API and search endpoint -- so per the
  // policy above, they stay non-clickable rather than link to a dead page.
};

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
  const url = `/simple/price?ids=${encodeURIComponent(idsKey)}&vs_currencies=${vsCurrency}&include_24hr_change=true`;
  let res;
  try {
    res = await cgFetch(url);
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


// ---- DefiLlama prices (free, no key) ---------------------------------------------------
// Token and native-coin prices are asked of DefiLlama FIRST (https://coins.llama.fi, through
// our server's cached relay, then directly), and only the ones it doesn't know go on to
// CoinGecko. DefiLlama quotes US dollars, so non-USD display currencies are converted with
// the exchange-rate table already used for the Currencies screen; if that isn't available
// we simply skip DefiLlama and use CoinGecko as before. Chain prefixes below were checked
// against the live API on 2026-10-05; a network that isn't listed (e.g. robinhood) just
// goes straight to CoinGecko.
const LLAMA_CHAIN = {
  ethereum: "ethereum", base: "base", polygon: "polygon", bsc: "bsc", arbitrum: "arbitrum",
  optimism: "optimism", avalanche: "avax", linea: "linea", scroll: "scroll", zksync: "era",
  mantle: "mantle", gnosis: "xdai", celo: "celo", monad: "monad",
};
const LLAMA_DIRECT_BASE = "https://coins.llama.fi/prices/current/";
const LLAMA_PROXY_BASE = MARKET_PROXY_BASE + "/llama/prices/current/";
const LLAMA_BATCH = 40;
let llamaCache = new Map(); // coin id -> { at, price }

// coinIds: ["ethereum:0x...", "coingecko:ethereum"]. Returns Map coinId(lower-case) -> USD price.
// Never throws: any failure just returns what it has (maybe nothing).
async function llamaUsdPrices(coinIds) {
  const out = new Map();
  const now = Date.now();
  const want = [];
  [...new Set(coinIds)].forEach((id) => {
    const hit = llamaCache.get(id.toLowerCase());
    if (hit && now - hit.at < CACHE_TTL_MS) { if (hit.price != null) out.set(id.toLowerCase(), hit.price); }
    else want.push(id);
  });
  for (let i = 0; i < want.length; i += LLAMA_BATCH) {
    const batch = want.slice(i, i + LLAMA_BATCH).filter((id) => /^[A-Za-z0-9._:-]{1,80}$/.test(id));
    if (!batch.length) continue;
    const list = batch.join(",");
    let json = null;
    for (const base of [LLAMA_PROXY_BASE, LLAMA_DIRECT_BASE]) {
      try {
        const ctrl = typeof AbortController === "function" ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), MARKET_PROXY_TIMEOUT_MS) : null;
        let res;
        try { res = await fetch(base + list, ctrl ? { signal: ctrl.signal } : undefined); } finally { if (timer) clearTimeout(timer); }
        if (res && res.ok) { json = await res.json(); break; }
      } catch (e) { /* try the next route */ }
    }
    if (!json || !json.coins) continue;
    const seen = new Set();
    Object.keys(json.coins).forEach((k) => {
      const price = json.coins[k] && json.coins[k].price;
      if (typeof price === "number" && isFinite(price) && price > 0) {
        out.set(k.toLowerCase(), price);
        llamaCache.set(k.toLowerCase(), { at: now, price });
        seen.add(k.toLowerCase());
      }
    });
    batch.forEach((id) => { if (!seen.has(id.toLowerCase())) llamaCache.set(id.toLowerCase(), { at: now, price: null }); });
  }
  if (llamaCache.size > 3000) llamaCache = new Map();
  return out;
}

// 1 US dollar in the display currency, or null if we can't tell.
async function usdToDisplayRate(vsCurrency) {
  if (vsCurrency === "usd") return 1;
  try {
    const rates = await fetchExchangeRates();
    const target = rates[vsCurrency], usd = rates.usd;
    if (target && usd && target.value && usd.value) return target.value / usd.value;
  } catch (e) { /* fall through */ }
  return null;
}

// ---- DefiLlama history + % change (coin pages) -----------------------------------------
// The coin page's chart and its 24h / 7d / 30d changes are asked of DefiLlama FIRST; CoinGecko
// is the backup (and still supplies market cap, volume, supply, rank and the description, which
// DefiLlama doesn't have). DefiLlama quotes US dollars, so prices are converted with
// usdToDisplayRate() like the other DefiLlama lookups.
const LLAMA_DIRECT_ROOT = "https://coins.llama.fi";
const LLAMA_PROXY_ROOT = MARKET_PROXY_BASE + "/llama";
// days -> how many points to ask for and how far apart (span x period covers the whole range).
const LLAMA_CHART_SHAPES = {
  1: { span: 48, period: "30m" },
  7: { span: 84, period: "2h" },
  30: { span: 120, period: "6h" },
  365: { span: 122, period: "3d" },
};

// GET <root><path> as JSON, our server's cached relay first and DefiLlama directly second.
// Returns null (never throws) if neither answers.
async function llamaJson(path) {
  for (const root of [LLAMA_PROXY_ROOT, LLAMA_DIRECT_ROOT]) {
    try {
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), MARKET_PROXY_TIMEOUT_MS) : null;
      let res;
      try { res = await fetch(root + path, ctrl ? { signal: ctrl.signal } : undefined); } finally { if (timer) clearTimeout(timer); }
      if (res && res.ok) return await res.json();
    } catch (e) { /* try the next route */ }
  }
  return null;
}

const CG_ID_SAFE = /^[A-Za-z0-9._-]{1,100}$/;

// [[timestampMs, price in display currency], ...] from DefiLlama, or null if it has no usable history.
async function llamaCoinChart(id, days, vs) {
  const shape = LLAMA_CHART_SHAPES[days];
  if (!shape || !CG_ID_SAFE.test(id)) return null;
  const rate = await usdToDisplayRate(vs);
  if (rate == null) return null;
  const coin = "coingecko:" + id;
  const start = Math.floor(Date.now() / 1000) - days * 86400;
  const json = await llamaJson(`/chart/${coin}?start=${start}&span=${shape.span}&period=${shape.period}`);
  const row = json && json.coins && json.coins[coin];
  const prices = row && Array.isArray(row.prices) ? row.prices : [];
  const pts = prices
    .filter((p) => p && isFinite(p.timestamp) && typeof p.price === "number" && isFinite(p.price) && p.price > 0)
    .map((p) => [p.timestamp * 1000, p.price * rate]);
  return pts.length >= 8 ? pts : null;
}

// { change24h, change7d, change30d } in percent (any of them null if DefiLlama doesn't know).
async function llamaPercentChanges(id) {
  const out = { change24h: null, change7d: null, change30d: null };
  if (!CG_ID_SAFE.test(id)) return out;
  const coin = "coingecko:" + id;
  await Promise.all([["change24h", "1d"], ["change7d", "7d"], ["change30d", "30d"]].map(async ([key, period]) => {
    const json = await llamaJson(`/percentage/${coin}?period=${period}`);
    const v = json && json.coins ? json.coins[coin] : null;
    if (typeof v === "number" && isFinite(v)) out[key] = v;
  }));
  return out;
}

// Value of the issuer-verified stablecoins (USDC / USDT = 1 US dollar, EURC = 1 euro) in the
// display currency, for balances whose price no service returned -- so they still show a dollar
// value instead of a blank. Matched by CONTRACT ADDRESS against TM_KNOWN_TOKENS (the issuers' own
// published lists), never by symbol, so a look-alike token never gets a value. Returns
// { [lower-case address]: { price } } for just the ones it can value. Never throws.
async function stablecoinFallbackPrices(chainId, addresses, currency) {
  const out = {};
  try {
    if (typeof TM_KNOWN_TOKENS === "undefined" || !addresses || !addresses.length) return out;
    const known = TM_KNOWN_TOKENS.forChain(chainId) || [];
    const want = new Map(); // lower-case address -> currency it is pegged to
    addresses.forEach((a) => {
      const k = known.find((t) => t.address.toLowerCase() === String(a || "").toLowerCase());
      if (k && (k.symbol === "USDC" || k.symbol === "USDT" || k.symbol === "EURC")) want.set(k.address.toLowerCase(), k.symbol === "EURC" ? "EUR" : "USD");
    });
    if (!want.size) return out;
    const display = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
    let rates = null;
    const rateFor = async (code) => {
      if (code.toLowerCase() === String(display).toLowerCase()) return 1;
      if (!rates) rates = await getFiatRates(display);
      const r = rates.find((x) => String(x.code).toUpperCase() === code);
      return r ? r.rate : null;
    };
    for (const [addr, code] of want) {
      let p = null;
      try { p = await rateFor(code); } catch (e) { p = null; }
      if (typeof p === "number" && p > 0) out[addr] = { price: p };
    }
  } catch (e) { /* best-effort */ }
  return out;
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
  const url = `/coins/markets?vs_currency=${vsCurrency}&ids=${encodeURIComponent(idsKey)}&per_page=250&price_change_percentage=24h`;
  let res;
  try {
    res = await cgFetch(url);
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

async function getCoinDetail(symbol, currency, idOverride) {
  const id = idOverride || COINGECKO_IDS[symbol];
  if (!id) throw new Error("Unknown coin.");
  const vs = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const key = id + "|" + vs;
  const now = Date.now();
  const hit = coinDetailCache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.data;

  // DefiLlama's price changes are asked in parallel with CoinGecko's market data.
  const changesP = llamaPercentChanges(id);
  let json = null;
  let failure = null;
  try {
    const res = await cgFetch(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`);
    if (res.ok) json = await res.json();
    else failure = new Error(`CoinGecko request failed (HTTP ${res.status}).`);
  } catch (e) {
    failure = new Error("Couldn't reach CoinGecko. Check your internet connection.");
  }
  const changes = await changesP;

  let data;
  if (json) {
    const md = json.market_data || {};
    const pick = (o) => (o && typeof o[vs] === "number" ? o[vs] : null);
    const cgChange = md.price_change_percentage_24h_in_currency && typeof md.price_change_percentage_24h_in_currency[vs] === "number"
      ? md.price_change_percentage_24h_in_currency[vs]
      : (typeof md.price_change_percentage_24h === "number" ? md.price_change_percentage_24h : null);
    const homepage = json.links && Array.isArray(json.links.homepage)
      ? json.links.homepage.find((u) => typeof u === "string" && /^https:\/\//i.test(u)) || null
      : null;
    data = {
      id,
      rank: typeof json.market_cap_rank === "number" ? json.market_cap_rank : null,
      price: pick(md.current_price),
      change24h: cgChange != null ? cgChange : changes.change24h,
      change7d: changes.change7d != null ? changes.change7d : (typeof md.price_change_percentage_7d === "number" ? md.price_change_percentage_7d : null),
      change30d: changes.change30d != null ? changes.change30d : (typeof md.price_change_percentage_30d === "number" ? md.price_change_percentage_30d : null),
      marketCap: pick(md.market_cap),
      volume: pick(md.total_volume),
      high24h: pick(md.high_24h),
      low24h: pick(md.low_24h),
      ath: pick(md.ath),
      athChange: pick(md.ath_change_percentage),
      circulatingSupply: typeof md.circulating_supply === "number" ? md.circulating_supply : null,
      description: shortDescription(plainTextFromHtml(json.description && json.description.en), 420),
      homepage,
      source: "coingecko",
    };
    // CoinGecko answered but had no price: DefiLlama's fills the gap.
    if (data.price == null) {
      try {
        const usd = (await llamaUsdPrices(["coingecko:" + id])).get(("coingecko:" + id).toLowerCase());
        const rate = usd != null ? await usdToDisplayRate(vs) : null;
        if (usd != null && rate != null) data.price = usd * rate;
      } catch (e) { /* leave it null */ }
    }
  } else {
    // CoinGecko is down or rate-limiting: show what DefiLlama knows (price + changes) rather than an error.
    let price = null;
    try {
      const usd = (await llamaUsdPrices(["coingecko:" + id])).get(("coingecko:" + id).toLowerCase());
      const rate = usd != null ? await usdToDisplayRate(vs) : null;
      if (usd != null && rate != null) price = usd * rate;
    } catch (e) { /* handled below */ }
    if (price == null) throw failure || new Error("Couldn't load this coin right now.");
    data = {
      id, rank: null, price,
      change24h: changes.change24h, change7d: changes.change7d, change30d: changes.change30d,
      marketCap: null, volume: null, high24h: null, low24h: null, ath: null, athChange: null,
      circulatingSupply: null, description: "", homepage: null, source: "defillama",
    };
  }
  // Only a complete (CoinGecko) answer is cached for the full period; a DefiLlama-only one is retried sooner.
  coinDetailCache.set(key, { fetchedAt: data.source === "coingecko" ? now : now - CACHE_TTL_MS + 15000, data });
  return data;
}

// days: 1 (24H), 7, 30, or 365. Returns [[timestampMs, price], ...] thinned
// to at most ~120 points, plenty for a phone-width line chart.
async function getCoinChart(symbol, currency, days, idOverride) {
  const id = idOverride || COINGECKO_IDS[symbol];
  if (!id) throw new Error("Unknown coin.");
  const vs = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const key = id + "|" + vs + "|" + days;
  const now = Date.now();
  const hit = coinChartCache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.data;

  const thin = (raw) => {
    const step = Math.max(1, Math.ceil(raw.length / 120));
    return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  };

  // 1) DefiLlama first.
  try {
    const pts = await llamaCoinChart(id, days, vs);
    if (pts) {
      const data = thin(pts);
      coinChartCache.set(key, { fetchedAt: now, data });
      return data;
    }
  } catch (e) { /* CoinGecko below */ }

  // 2) CoinGecko if DefiLlama had nothing.
  let res;
  try {
    res = await cgFetch(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${vs}&days=${days}`);
  } catch (e) {
    throw new Error("Couldn't load the chart. Check your internet connection.");
  }
  if (!res.ok) throw new Error(`Chart request failed (HTTP ${res.status}).`);
  const json = await res.json();
  const raw = Array.isArray(json.prices) ? json.prices.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])) : [];
  const data = thin(raw);
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
    res = await cgFetch(`/exchange_rates`);
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

// "Hottest" exchanges: CoinGecko's own keyless /exchanges endpoint, which
// ranks centralized exchanges by a trust score it computes from liquidity,
// API/data coverage, regulation, and other factors -- the same ranking
// CoinGecko's own "Exchanges" page is built from. No API key, no backend
// proxy, same as every other lookup in this file. CoinGecko already returns
// this list sorted by trust_score_rank (1 = most trusted); sorted again
// client-side as a safety net in case that ever changes. Cached the same
// way as the other lookups above, so "keep it updated" just means this
// re-fetches on its own the next time it's asked for, no polling needed.
let topExchangesCache = { fetchedAt: 0, data: null };

async function getTopExchanges(count) {
  const now = Date.now();
  if (!topExchangesCache.data || now - topExchangesCache.fetchedAt >= CACHE_TTL_MS) {
    let res;
    try {
      res = await cgFetch(`/exchanges?per_page=100&page=1`);
    } catch (e) {
      throw new Error("Couldn't reach CoinGecko for exchange rankings. Check your internet connection.");
    }
    if (!res.ok) throw new Error(`CoinGecko exchanges request failed (HTTP ${res.status}).`);
    const json = await res.json();
    const list = Array.isArray(json) ? json : [];
    const mapped = list
      .filter((x) => x && x.name)
      .map((x) => ({
        id: x.id,
        name: x.name,
        image: x.image || null,
        country: x.country || null,
        yearEstablished: x.year_established || null,
        trustScore: typeof x.trust_score === "number" ? x.trust_score : null,
        trustScoreRank: typeof x.trust_score_rank === "number" ? x.trust_score_rank : null,
        volume24hBtc: typeof x.trade_volume_24h_btc === "number" ? x.trade_volume_24h_btc : null,
        url: x.url || null,
      }))
      .sort((a, b) => (a.trustScoreRank == null ? 999 : a.trustScoreRank) - (b.trustScoreRank == null ? 999 : b.trustScoreRank));
    topExchangesCache = { fetchedAt: now, data: mapped };
  }
  return topExchangesCache.data.slice(0, count || 25);
}

// Returns the live price of the given network's native coin (in the given
// display currency), or null if this wallet doesn't have a verified
// CoinGecko id for that network (e.g. a user-added custom network).
async function getNativePriceForNetwork(networkKey, currency) {
  const id = NETWORK_NATIVE_COINGECKO_ID[networkKey];
  if (!id) return null;
  const vs = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  // DefiLlama first (see above); CoinGecko if it has no answer.
  try {
    const usd = (await llamaUsdPrices(["coingecko:" + id])).get(("coingecko:" + id).toLowerCase());
    if (usd != null) {
      const rate = await usdToDisplayRate(vs);
      if (rate != null) return usd * rate;
    }
  } catch (e) { /* use CoinGecko */ }
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
  avalanche: "avalanche",
  // linea/scroll/zksync/mantle/gnosis/celo were added 2026-10-03 from memory
  // of CoinGecko's asset-platform ids; robinhood/monad added 2026-10-04 --
  // all eight since confirmed (2026-10-04) against the live
  // GET /api/v3/asset_platforms response, matched by chain_identifier
  // against each network's chainId in networks.js, not eyeballed from the
  // chain pages like the ones above. A wrong id fails soft (no suggestions /
  // no prices on that chain), which is how robinhood and monad were found
  // missing here entirely -- their token picker and USD prices were always
  // empty on those two networks.
  linea: "linea",
  scroll: "scroll",
  zksync: "zksync",
  mantle: "mantle",
  gnosis: "xdai",
  celo: "celo",
  robinhood: "robinhood",
  monad: "monad",
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
  const result = {};

  // 1) DefiLlama first (free, no key; batched, and not rate-limited the way CoinGecko is on phones).
  const chain = LLAMA_CHAIN[networkKey];
  if (chain) {
    try {
      const ids = addresses.map((a) => chain + ":" + a);
      const usd = await llamaUsdPrices(ids);
      if (usd.size) {
        const rate = await usdToDisplayRate(vsCurrency);
        if (rate != null) {
          addresses.forEach((a) => {
            const p = usd.get((chain + ":" + a).toLowerCase());
            if (p != null) result[a.toLowerCase()] = { price: p * rate };
          });
        }
      }
    } catch (e) { /* CoinGecko below covers anything missing */ }
  }

  // 2) CoinGecko for whatever DefiLlama didn't have. If this fails we keep what we already got.
  const missing = addresses.filter((a) => !result[a.toLowerCase()]);
  if (!missing.length) return result;
  const url = `/simple/token_price/${platform}?contract_addresses=${encodeURIComponent(missing.join(","))}&vs_currencies=${vsCurrency}`;
  try {
    let res;
    try {
      res = await cgFetch(url);
    } catch (e) {
      throw new Error("Couldn't reach CoinGecko for token prices. Check your internet connection.");
    }
    if (!res.ok) {
      throw new Error(`CoinGecko token price request failed (HTTP ${res.status}).`);
    }
    const raw = await res.json();
    Object.keys(raw).forEach((addr) => {
      const entry = raw[addr];
      result[addr] = { price: entry ? entry[vsCurrency] : null };
    });
  } catch (e) {
    if (!Object.keys(result).length) throw e;
  }
  return result;
}

// ---- Currencies & their stablecoins (the main-screen card + its full screen) --------------
// National currencies each paired with the well-known stablecoin(s) pegged to them. Every coin id
// below was confirmed on 2026-10-05 against DefiLlama's live price API (it returned a price AND
// the matching symbol), and each price was checked to be in line with that currency's market
// rate. A currency with no confident, liquid, priced stablecoin is deliberately NOT listed (GBP,
// MXN, CHF, CAD, AUD, TRY... -- their candidates either didn't resolve or weren't priced).
const CURRENCY_STABLECOINS = [
  { fiat: "usd", coins: [{ id: "usd-coin", symbol: "USDC", name: "USD Coin" }, { id: "tether", symbol: "USDT", name: "Tether" }] },
  { fiat: "eur", coins: [{ id: "euro-coin", symbol: "EURC", name: "Euro Coin" }, { id: "stasis-eurs", symbol: "EURS", name: "STASIS EURS" }] },
  { fiat: "jpy", coins: [{ id: "jpycoin", symbol: "JPYC", name: "JPY Coin" }, { id: "gyen", symbol: "GYEN", name: "GYEN" }] },
  { fiat: "brl", coins: [{ id: "brz", symbol: "BRZ", name: "Brazilian Digital" }] },
  { fiat: "sgd", coins: [{ id: "xsgd", symbol: "XSGD", name: "XSGD" }] },
  { fiat: "zar", coins: [{ id: "zarp-stablecoin", symbol: "ZARP", name: "ZARP Stablecoin" }] },
  { fiat: "idr", coins: [{ id: "idrx", symbol: "IDRX", name: "IDRX" }] },
];

// One flat list, grouped by currency in order, each stablecoin with its live price in the display
// currency and how far it sits from its peg ("peg" in percent, null if we can't tell):
// [{ id, cgId, symbol, name, fiat: "EUR", fiatName, price, peg, change24h: null, image: null, url }]
// DefiLlama first, CoinGecko for any coin it doesn't price. Rows without a price are left out.
const stablecoinListCache = { fetchedAt: 0, key: "", data: null };
async function getCurrencyStablecoins(currency) {
  const vs = SUPPORTED_CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  const now = Date.now();
  if (stablecoinListCache.data && stablecoinListCache.key === vs && now - stablecoinListCache.fetchedAt < CACHE_TTL_MS) return stablecoinListCache.data;

  const ids = [];
  CURRENCY_STABLECOINS.forEach((g) => g.coins.forEach((c) => ids.push(c.id)));
  const priceById = {}; // id -> price in the display currency

  // 1) DefiLlama (US dollars, converted).
  try {
    const usd = await llamaUsdPrices(ids.map((id) => "coingecko:" + id));
    if (usd.size) {
      const rate = await usdToDisplayRate(vs);
      if (rate != null) ids.forEach((id) => { const p = usd.get(("coingecko:" + id).toLowerCase()); if (p != null) priceById[id] = p * rate; });
    }
  } catch (e) { /* CoinGecko below */ }

  // 2) CoinGecko for any it didn't have.
  const missing = ids.filter((id) => priceById[id] == null);
  if (missing.length) {
    try {
      const res = await cgFetch(`/simple/price?ids=${encodeURIComponent(missing.join(","))}&vs_currencies=${vs}`);
      if (res.ok) {
        const raw = await res.json();
        missing.forEach((id) => { if (raw[id] && typeof raw[id][vs] === "number") priceById[id] = raw[id][vs]; });
      }
    } catch (e) { /* keep what we have */ }
  }
  if (!Object.keys(priceById).length) throw new Error("Couldn't load stablecoin prices. Check your internet connection.");

  // What 1 unit of each pegged currency is worth in the display currency, to measure the peg.
  let rateRows = [];
  try { rateRows = await getFiatRates(vs); } catch (e) { rateRows = []; }
  const fiatInDisplay = (code) => {
    if (code.toLowerCase() === String(vs).toLowerCase()) return 1;
    const r = rateRows.find((x) => String(x.code).toUpperCase() === code.toUpperCase());
    return r ? r.rate : null;
  };

  const data = [];
  CURRENCY_STABLECOINS.forEach((g) => {
    const info = SUPPORTED_CURRENCIES[g.fiat] || { label: g.fiat.toUpperCase(), name: g.fiat.toUpperCase() };
    const unit = fiatInDisplay(info.label);
    g.coins.forEach((c) => {
      const price = priceById[c.id];
      if (price == null) return;
      data.push({
        id: c.id, cgId: c.id, symbol: c.symbol, name: c.name,
        fiat: info.label, fiatName: info.name,
        price,
        peg: unit && unit > 0 ? (price / unit - 1) * 100 : null,
        change24h: null, image: null,
        url: `https://www.coingecko.com/en/coins/${encodeURIComponent(c.id)}`,
      });
    });
  });
  stablecoinListCache.fetchedAt = now; stablecoinListCache.key = vs; stablecoinListCache.data = data;
  return data;
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
    stablecoinFallbackPrices,
    getCurrencyStablecoins,
    CURRENCY_STABLECOINS,
    getTopExchanges,
    COINGECKO_IDS,
    NETWORK_NATIVE_COINGECKO_ID,
    NETWORK_COINGECKO_PLATFORM,
    SUPPORTED_CURRENCIES,
    FIAT_STABLECOIN_PEG,
    DEFAULT_CURRENCY,
  };
}
