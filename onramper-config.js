// lib/onramper-config.js
// "Buy crypto" on-ramp AND "Sell for cash" off-ramp, via Onramper -- a
// fiat-to-crypto AGGREGATOR (one integration that routes to 20+ underlying
// on-ramp providers and a separate "Offramper" off-ramp product covering
// several off-ramp providers), offered here as a third option alongside
// MoonPay (lib/buy-config.js / lib/sell-config.js) and Coinbase
// (lib/coinbase-onramp-config.js). Confirmed against Onramper's own docs
// at docs.onramper.com, checked Sept 2026.
//
// WHY THIS ONE'S SIMPLER THAN THE OTHER TWO
// MoonPay's widget refuses to load at all with a wallet address in the URL
// unless that URL is HMAC-signed with a secret key (see buy-config.js), and
// every Coinbase Onramp/Offramp request must be signed with a CDP secret
// key (see coinbase-onramp-config.js) -- both need a small backend to hold
// that secret and sign on this file's behalf. Onramper's API key
// (pk_test_.../pk_prod_...) is a PUBLISHABLE key, the same as MoonPay's own
// pk_ key: safe to ship in client-side code, and Onramper's widget loads
// fine with it directly in the URL, address included, with no signature
// and no backend required. So this file talks to Onramper's hosted widget
// entirely on its own -- there's no equivalent of moonpay-sign-api.js or
// coinbase-onramp-api.js for this provider. (Onramper does offer OPTIONAL
// URL signing as an extra tamper-proofing layer -- see "Widget - Sign a
// URL" in their docs -- but it requires contacting Onramper support for a
// separate secret key, and isn't required for the widget to work. Not
// wired up here; add it later the same way buy-config.js's signing works,
// if you want that extra layer.)
//
// EMBEDDING
// Same reasoning as MoonPay's widget (see buy-config.js's "HOW THIS WORKS"):
// this is just a web page (https://buy.onramper.com/) reading its config
// from URL query parameters, embedded in an <iframe> right on the Buy/Sell
// screens. Nothing is fetched or executed from Onramper's servers as
// extension code, so this doesn't touch the Chrome Web Store's "no remote
// code" answer any more than MoonPay's iframe does.
//
// WHAT YOU (THE DEVELOPER) STILL NEED TO DO
// Sign up for a free account at https://dashboard.onramper.com/users/sign_up
// and put your PUBLISHABLE key below (starts with "pk_test_" for the
// sandbox -- widget served from buy.onramper.dev -- or "pk_prod_" once
// you're ready to go live -- served from buy.onramper.com). Until that's
// filled in, the Buy/Sell screens simply don't show an Onramper option,
// same muting pattern as an unconfigured MoonPay.
//
// NEVER put an Onramper SECRET key anywhere in this file -- only the
// publishable pk_ key belongs in client-side code, same rule as MoonPay's
// pk_ vs sk_ split (see buy-config.js).
//
// NETWORK / ASSET PRE-FILL
// Onramper's widget can pre-fill a destination wallet via a `networkWallets`
// URL param, but the ONLY exact syntax this project has independently
// confirmed against Onramper's own docs is `networkWallets=ETHEREUM:<addr>`
// (docs.onramper.com/docs/supported-widget-parameters, Sept 2026 example).
// Following this project's practice of never guessing an integration id it
// hasn't verified (see buy-config.js's NETWORK_MOONPAY_CURRENCY_CODE
// comment for the same reasoning), every other network is left out of
// NETWORK_ONRAMPER_ID on purpose -- the Buy button still opens Onramper's
// widget for those networks, just without a pre-filled address, and the
// user pastes in the address themselves (Onramper shows its own network
// picker). Add a network here only once you've confirmed its exact
// `networkWallets` identifier yourself, e.g. via Onramper's dashboard/docs
// once you have API access.
const NETWORK_ONRAMPER_ID = {
  ethereum: "ETHEREUM",
  // base, polygon, bsc, arbitrum, optimism: not yet confirmed for this
  // specific parameter's exact casing/identifier -- see comment above.
};

const ONRAMPER_WIDGET_BASE_URL_PROD = "https://buy.onramper.com";
const ONRAMPER_WIDGET_BASE_URL_SANDBOX = "https://buy.onramper.dev";

// Fill this in with your own Onramper publishable key.
const ONRAMPER_API_KEY = ""; // e.g. "pk_test_01ABCXYZ..." (sandbox) or "pk_prod_01ABCXYZ..." (live)

function isOnramperConfigured() {
  return !!ONRAMPER_API_KEY;
}

// Mirrors buy-config.js's isBuyLive() -- true only for a real pk_prod_ key,
// not the sandbox pk_test_ placeholder, so sandbox-only setups don't show
// Onramper to real users. Flip automatically the moment ONRAMPER_API_KEY
// above is swapped for a pk_prod_ key -- nothing else needs to change.
function isOnramperLive() {
  return ONRAMPER_API_KEY.startsWith("pk_prod_");
}

function onramperWidgetBaseUrl() {
  return ONRAMPER_API_KEY.startsWith("pk_prod_")
    ? ONRAMPER_WIDGET_BASE_URL_PROD
    : ONRAMPER_WIDGET_BASE_URL_SANDBOX;
}

// Onramper's defaultFiat/sell_defaultFiat params are shown uppercase in
// their own docs examples ("USD"). Unlike MoonPay/Coinbase this project
// doesn't restrict to a fixed set of fiat codes here: this is a
// pre-selection hint for Onramper's own currency picker, not a hard
// requirement, so an unrecognized code just means Onramper falls back to
// its own default rather than the widget breaking.
function fiatParam(fiatCode) {
  return fiatCode ? String(fiatCode).toUpperCase() : "";
}

// Builds the URL to embed for Buy: the person's own address gets pre-filled
// (see NETWORK_ONRAMPER_ID comment above) so, on Ethereum today, there's
// nothing to paste -- same "auto-fill when we can, let the provider's own
// picker handle it otherwise" approach as buy-config.js.
function buildOnramperBuyUrl(networkKey, address, fiatCode) {
  if (!isOnramperConfigured()) {
    throw new Error(
      "Buy with Onramper isn't set up yet -- add your Onramper publishable API key to lib/onramper-config.js first (see the comment at the top of that file)."
    );
  }
  const params = new URLSearchParams();
  params.set("apiKey", ONRAMPER_API_KEY);
  params.set("mode", "buy");
  const fiat = fiatParam(fiatCode);
  if (fiat) params.set("defaultFiat", fiat);
  const onramperNetwork = NETWORK_ONRAMPER_ID[networkKey];
  if (onramperNetwork && address) {
    params.set("networkWallets", `${onramperNetwork}:${address}`);
  }
  return `${onramperWidgetBaseUrl()}?${params.toString()}`;
}

// Builds the URL to embed for Sell. Unlike Buy, there's no wallet address
// of ours to pre-fill here -- same reasoning as sell-config.js's
// buildSellUrl(): Onramper's sell widget is the one that hands YOU a
// deposit address to send crypto to, not the other way around, and that
// address gets pasted into this wallet's own Send screen afterwards (see
// btn-sell-onramper's handler in app.js), so the actual on-chain send is
// still reviewed and confirmed by the person, same as every other send
// this wallet makes.
function buildOnramperSellUrl(fiatCode) {
  if (!isOnramperConfigured()) {
    throw new Error(
      "Sell with Onramper isn't set up yet -- add your Onramper publishable API key to lib/onramper-config.js first (see the comment at the top of that file)."
    );
  }
  const params = new URLSearchParams();
  params.set("apiKey", ONRAMPER_API_KEY);
  params.set("mode", "sell");
  const fiat = fiatParam(fiatCode);
  if (fiat) params.set("sell_defaultFiat", fiat);
  return `${onramperWidgetBaseUrl()}?${params.toString()}`;
}

if (typeof self !== "undefined") {
  self.TM_ONRAMPER_CONFIG = {
    isOnramperConfigured,
    isOnramperLive,
    buildOnramperBuyUrl,
    buildOnramperSellUrl,
    NETWORK_ONRAMPER_ID,
  };
}
