// lib/buy-config.js
// "Buy crypto" on-ramp integration, via MoonPay's hosted widget.
//
// HOW THIS WORKS
// MoonPay's widget is just a web page (https://buy.moonpay.com/) that reads
// its configuration from URL query parameters. This wallet embeds that page
// in an <iframe> right inside the Buy screen (see buy.setupBuyScreen() in
// app.js/popup.js) rather than loading MoonPay's own JS SDK inside the
// extension, because:
//   1. This extension's manifest CSP is "script-src 'self'" -- it can't load
//      any script from MoonPay's servers even if we wanted to. An <iframe>
//      pointed at MoonPay's own page doesn't need that: the nested page runs
//      under its own origin and CSP, not this extension's.
//   2. The Chrome Web Store listing for this extension was submitted with
//      "No" answered to the remote-code question, on the basis that nothing
//      the extension runs is fetched from a third party at runtime. Loading
//      MoonPay's SDK script would make that answer inaccurate; embedding
//      MoonPay's own page in a frame (like any link would) does not.
//
// WHAT YOU (THE DEVELOPER) STILL NEED TO DO
// Sign up for a MoonPay account at https://dashboard.moonpay.com and put
// your PUBLISHABLE key below (starts with "pk_test_" for sandbox / testing,
// or "pk_live_" once MoonPay approves your account for production). Until
// that's filled in, the Buy button will tell the user Buy isn't configured
// yet instead of opening a broken widget.
//
// NEVER put a MoonPay SECRET key (starts with "sk_") anywhere in this file
// or anywhere else in the extension package. The secret key can sign
// requests on your account's behalf -- if it ships inside the extension,
// anyone who installs the extension can extract it (it's just a text file
// in a zip) and use it as if they were you.
//
// ADDRESS AUTO-FILL (buildSignedBuyUrl, below)
// MoonPay requires the walletAddress parameter to be part of a signed URL
// (HMAC-signed with the secret key -- confirmed against MoonPay's own docs,
// https://dev.moonpay.com/docs/on-ramp-enhance-security-using-signed-urls,
// Sept 2026: passing walletAddress without a valid signature makes the
// widget refuse to load at all, with no exception). Signing client-side
// would mean shipping the secret key in the extension, which is exactly
// what must never happen -- so this calls a small backend
// (../moonpay-sign-api.js, deployed alongside the website on Railway) that
// holds the secret key server-side and hands back a signed URL. That
// backend is a plain JSON data endpoint (it returns a URL string, nothing
// executable), so calling it from the extension doesn't touch the
// "no remote code fetched at runtime" answer above. If that backend isn't
// configured yet (no MOONPAY_SECRET_KEY set) or is unreachable,
// buildSignedBuyUrl() returns null and callers fall back to buildBuyUrl()'s
// plain unsigned URL -- same manual "paste your address" flow as before,
// nothing breaks.

const MOONPAY_WIDGET_BASE_URL = "https://buy.moonpay.com/";

// Fill this in with your own MoonPay publishable key.
const MOONPAY_PUBLISHABLE_API_KEY = "pk_test_fSOaEObQO5HnTw5tQ4qdZ1r4blZ2sZxo"; // TEST key -- sandbox only, swap for a pk_live_ key before shipping real Buy transactions

// MoonPay's currencyCode locks the widget to a specific crypto asset. This
// is only filled in for "eth" (Ethereum mainnet native ETH), because that
// exact code string is directly confirmed in MoonPay's own API examples
// (https://dev.moonpay.com/reference/getcurrencies quote-endpoint sample:
// GET /v3/currencies/eth/buy_quote). MoonPay supports 100+ assets across 40+
// networks, and many of those use a network-suffixed code (their Avalanche
// integration guide shows "avax" for native AVAX, for example), but this
// project's practice is to never hardcode a financial/integration id it
// hasn't independently verified -- guessing wrong here wouldn't error
// loudly, it would just silently point the user at the wrong asset. So
// every other network below is left unmapped on purpose: the Buy button
// still opens MoonPay's widget for them, just without a locked-in
// currencyCode, and MoonPay's own currency picker inside the widget lets the
// user choose the right asset themselves. Fill in a network's code here
// only after confirming it yourself against MoonPay's live
// GET https://api.moonpay.com/v3/currencies response or current docs.
const NETWORK_MOONPAY_CURRENCY_CODE = {
  ethereum: "eth",
  // base, polygon, bsc, arbitrum, optimism: still not verified. Actively
  // re-checked on 2026-09-07 -- MoonPay's own docs pages, the public
  // GET /v3/currencies endpoint (blocked by their robots.txt for automated
  // fetching), and several third-party integration guides were all tried,
  // and none of them turned up another exact, confirmable code string
  // beyond "eth" and Avalanche's "avax" (which isn't one of this wallet's
  // networks). Once you have your own MoonPay dashboard access, the
  // currency picker inside the widget (or MoonPay's support team) can tell
  // you the exact code for each network's native coin -- add it here once
  // you've confirmed it yourself. Until then these networks intentionally
  // open the widget without a locked-in currencyCode.
};

function isBuyConfigured() {
  return !!MOONPAY_PUBLISHABLE_API_KEY;
}

// Builds the URL to embed for the given network key (see lib/networks.js).
// Throws if no publishable key has been configured yet.
// Fiat codes passed to MoonPay's Buy widget as baseCurrencyCode. Same eight
// as the Sell side (see lib/sell-config.js) -- anything else opens the
// widget's own currency picker rather than risk an unsupported code.
const MOONPAY_BUY_FIAT_CODES = new Set(["usd", "eur", "gbp", "jpy", "cad", "aud", "inr", "brl"]);

function buyFiatParam(fiatCode) {
  const c = fiatCode ? String(fiatCode).toLowerCase() : "";
  return MOONPAY_BUY_FIAT_CODES.has(c) ? c : "";
}

function buildBuyUrl(networkKey, fiatCode) {
  if (!isBuyConfigured()) {
    throw new Error(
      "Buy isn't set up yet -- add your MoonPay publishable API key to lib/buy-config.js first (see the comment at the top of that file)."
    );
  }
  const params = new URLSearchParams();
  params.set("apiKey", MOONPAY_PUBLISHABLE_API_KEY);
  const currencyCode = NETWORK_MOONPAY_CURRENCY_CODE[networkKey];
  if (currencyCode) params.set("currencyCode", currencyCode);
  const fiat = buyFiatParam(fiatCode);
  if (fiat) params.set("baseCurrencyCode", fiat);
  return `${MOONPAY_WIDGET_BASE_URL}?${params.toString()}`;
}

// The small backend that turns an unsigned MoonPay URL into a signed one --
// see moonpay-sign-api.js at the repo root for the server side, and the
// ADDRESS AUTO-FILL comment above for why this exists. Hardcoded to this
// project's own Railway deployment; update this if that URL ever changes.
const MOONPAY_SIGN_ENDPOINT = "https://web-wallet-production.up.railway.app/api/moonpay-sign";

// Asks the backend to sign a MoonPay URL. Returns null (never throws) on
// any failure -- not configured yet, offline, CORS, unexpected response --
// so callers can always safely fall back to the plain unsigned URL.
async function trySignUrl(unsignedUrl) {
  try {
    const res = await fetch(`${MOONPAY_SIGN_ENDPOINT}?url=${encodeURIComponent(unsignedUrl)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.configured && data.url ? data.url : null;
  } catch (e) {
    return null;
  }
}

// Builds a Buy URL with the wallet address pre-filled and properly signed,
// so the user never has to paste it in manually. Returns null if signing
// isn't set up yet or the signing backend can't be reached -- callers
// should fall back to buildBuyUrl()'s plain unsigned URL (today's
// manual-paste flow) in that case. Never throws.
async function buildSignedBuyUrl(networkKey, address, fiatCode) {
  if (!isBuyConfigured() || !address) return null;
  const params = new URLSearchParams();
  params.set("apiKey", MOONPAY_PUBLISHABLE_API_KEY);
  const currencyCode = NETWORK_MOONPAY_CURRENCY_CODE[networkKey];
  if (currencyCode) params.set("currencyCode", currencyCode);
  const fiat = buyFiatParam(fiatCode);
  if (fiat) params.set("baseCurrencyCode", fiat);
  params.set("walletAddress", address);
  const unsignedUrl = `${MOONPAY_WIDGET_BASE_URL}?${params.toString()}`;
  return trySignUrl(unsignedUrl);
}

if (typeof self !== "undefined") {
  self.TM_BUY_CONFIG = {
    isBuyConfigured,
    buildBuyUrl,
    buildSignedBuyUrl,
    NETWORK_MOONPAY_CURRENCY_CODE,
    // Exposed so lib/sell-config.js can reuse the same publishable key --
    // MoonPay issues one key per account that works for both the on-ramp
    // (buy) and off-ramp (sell) widgets, so there's no reason to make the
    // developer paste it in twice and risk the two drifting apart.
    MOONPAY_PUBLISHABLE_API_KEY,
  };
}
