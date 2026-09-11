// lib/sell-config.js
// "Sell crypto for cash" off-ramp integration, via MoonPay's hosted sell
// widget -- the mirror of lib/buy-config.js's on-ramp integration. Load
// buy-config.js before this file (see index.html); this reuses its
// publishable key and its NETWORK_MOONPAY_CURRENCY_CODE mapping rather than
// duplicating either.
//
// WHY THIS OPENS A NEW TAB INSTEAD OF EMBEDDING THE WIDGET
// Same reasons as Buy: this app's CSP doesn't allow loading a third-party
// script, and (for the Chrome extension build of this codebase) the Web
// Store listing was submitted on the basis that nothing here fetches
// remote code at runtime. See lib/buy-config.js for the full explanation.
//
// HOW SELLING ACTUALLY WORKS HERE
// MoonPay's sell widget quotes a cash payout for an amount of crypto, then
// gives you a MoonPay-controlled deposit address to send that crypto to --
// once it arrives on-chain, MoonPay converts it and pays out to your linked
// bank account/card. This wallet can't automate that on-chain send for you
// (doing so would mean either shipping a secret key client-side to
// pre-fill/sign the widget URL, or silently sending funds off-device
// without the user reviewing the destination first -- both are worse than
// one extra manual step): the widget shows you the deposit address and
// amount, and you paste that address into this wallet's own Send screen
// yourself, the same way you would send to any other address.
//
// SANDBOX VS PRODUCTION DOMAIN
// Unlike a lot of hosted widgets, MoonPay's sell widget lives on a
// different hostname per environment -- sell-sandbox.moonpay.com for a
// pk_test_ key, sell.moonpay.com for a pk_live_ key (confirmed against
// MoonPay's own "Off-ramp: URL integration" docs, Sept 2026). Picking the
// domain from the key prefix means this keeps working automatically the
// day the placeholder pk_test_ key in buy-config.js is swapped for a real
// pk_live_ one -- nothing here needs to change by hand.
const MOONPAY_SELL_WIDGET_BASE_URL_SANDBOX = "https://sell-sandbox.moonpay.com/";
const MOONPAY_SELL_WIDGET_BASE_URL_LIVE = "https://sell.moonpay.com/";

function moonpaySellApiKey() {
  return (self.TM_BUY_CONFIG && self.TM_BUY_CONFIG.MOONPAY_PUBLISHABLE_API_KEY) || "";
}

function isSellConfigured() {
  return !!moonpaySellApiKey();
}

function sellWidgetBaseUrl(apiKey) {
  return apiKey.startsWith("pk_live_")
    ? MOONPAY_SELL_WIDGET_BASE_URL_LIVE
    : MOONPAY_SELL_WIDGET_BASE_URL_SANDBOX;
}

// Builds the URL to open in a new tab for the given network key (see
// lib/networks.js) and the wallet's current display currency (see app.js'
// currentCurrency, e.g. "usd"). Throws if no publishable key has been
// configured yet.
function buildSellUrl(networkKey, quoteCurrency) {
  const apiKey = moonpaySellApiKey();
  if (!apiKey) {
    throw new Error(
      "Sell isn't set up yet -- add your MoonPay publishable API key to lib/buy-config.js first (Sell reuses the same key -- see the comment at the top of that file)."
    );
  }
  const params = new URLSearchParams();
  params.set("apiKey", apiKey);
  const baseCurrencyCode =
    self.TM_BUY_CONFIG && self.TM_BUY_CONFIG.NETWORK_MOONPAY_CURRENCY_CODE[networkKey];
  if (baseCurrencyCode) params.set("baseCurrencyCode", baseCurrencyCode);
  if (quoteCurrency) params.set("quoteCurrencyCode", quoteCurrency);
  return `${sellWidgetBaseUrl(apiKey)}?${params.toString()}`;
}

if (typeof self !== "undefined") {
  self.TM_SELL_CONFIG = {
    isSellConfigured,
    buildSellUrl,
  };
}
