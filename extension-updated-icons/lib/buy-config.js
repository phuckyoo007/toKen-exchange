// lib/buy-config.js
// "Buy crypto" on-ramp integration, via MoonPay's hosted widget.
//
// HOW THIS WORKS
// MoonPay's widget is just a web page (https://buy.moonpay.com/) that reads
// its configuration from URL query parameters. This wallet opens that page
// in a new browser tab (chrome.tabs.create) rather than embedding MoonPay's
// own JS SDK inside the extension, because:
//   1. This extension's manifest CSP is "script-src 'self'" -- it can't load
//      any script from MoonPay's servers even if we wanted to.
//   2. The Chrome Web Store listing for this extension was submitted with
//      "No" answered to the remote-code question, on the basis that nothing
//      the extension runs is fetched from a third party at runtime. Loading
//      MoonPay's SDK script would make that answer inaccurate.
// Opening the same underlying widget page in a normal tab avoids both
// problems and needs zero extra permissions.
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
// in a zip) and use it as if they were you. This is also why the wallet
// address is NOT pre-filled into the widget URL below: MoonPay requires the
// walletAddress parameter to be part of a signed URL (HMAC-signed with the
// secret key -- see https://dev.moonpay.com/docs/off-ramp-enhance-security-using-signed-urls),
// and signing client-side would mean shipping the secret key in the
// extension, which is exactly what must never happen. Practically, this
// means MoonPay's own widget will ask the user to paste in their wallet
// address once it opens -- one extra step, in exchange for the secret key
// never existing outside your own server. A future improvement could add a
// small backend that signs the URL server-side (keeping the secret key off
// the client) and hands back a ready-to-open signed link instead.

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

// Builds the URL to open in a new tab for the given network key (see
// lib/networks.js). Throws if no publishable key has been configured yet.
function buildBuyUrl(networkKey) {
  if (!isBuyConfigured()) {
    throw new Error(
      "Buy isn't set up yet -- add your MoonPay publishable API key to lib/buy-config.js first (see the comment at the top of that file)."
    );
  }
  const params = new URLSearchParams();
  params.set("apiKey", MOONPAY_PUBLISHABLE_API_KEY);
  const currencyCode = NETWORK_MOONPAY_CURRENCY_CODE[networkKey];
  if (currencyCode) params.set("currencyCode", currencyCode);
  return `${MOONPAY_WIDGET_BASE_URL}?${params.toString()}`;
}

if (typeof self !== "undefined") {
  self.TM_BUY_CONFIG = {
    isBuyConfigured,
    buildBuyUrl,
    NETWORK_MOONPAY_CURRENCY_CODE,
  };
}
