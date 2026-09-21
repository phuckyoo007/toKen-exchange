// lib/coinbase-onramp-config.js
// "Buy crypto" on-ramp AND "Sell for cash" off-ramp, via Coinbase's hosted
// Onramp/Offramp -- a second option alongside MoonPay (see lib/buy-config.js
// and lib/sell-config.js), added specifically so Buy and Sell have
// something functional while a MoonPay production account is still
// pending approval.
//
// SELL/OFFRAMP FLOW -- different shape than Buy, worth reading before
// touching this file. Confirmed against Coinbase's own Offramp
// Integration Guide (docs.cdp.coinbase.com/onramp/offramp/offramp-integration-guide,
// checked Sept 2026): Coinbase's documented pattern has the INTEGRATING
// APP (this wallet) fetch the sell's deposit address/amount itself, via a
// separate status lookup keyed by a `partnerUserRef` this file makes up
// and passes when opening the hosted sell page -- it's not something
// Coinbase assigns, just an id we choose so we can find our own session
// again afterwards. So the Sell flow here is two steps:
//   1. buildCoinbaseOfframpUrl() opens Coinbase's hosted sell page in a
//      new tab, where the person picks an asset/amount and completes the
//      sell on Coinbase's own page.
//   2. Once they come back to this wallet, checkCoinbaseOfframpStatus()
//      asks our backend (which asks Coinbase) for that same
//      partnerUserRef's latest transaction -- the deposit address and
//      amount Coinbase actually wants sent. Those get fed into this
//      wallet's EXISTING "paste deposit details -> Review in Send" UI
//      (see btn-sell-coinbase-check in app.js), so the actual on-chain
//      send is still reviewed and confirmed by the person, same as every
//      other send this wallet makes -- this file never signs or sends
//      anything itself.
//
// HOW THIS WORKS
// Unlike MoonPay's widget (an <iframe> embedded right in the Buy screen),
// Coinbase's hosted Onramp is a full-page experience, not something meant
// to be embedded in a frame (Coinbase's own docs and issue tracker point
// to a separate, approval-gated "headless" API as what adds inline
// support -- confirmed Sept 2026). So this opens in a NEW TAB instead,
// the same pattern this wallet already uses for Polymarket market links.
//
// Every request to Coinbase's Onramp API must be signed with a CDP Secret
// API Key -- a secret that must never exist in this client-side file (same
// reasoning as MoonPay's secret key, see lib/buy-config.js). So the actual
// signing happens server-side: see ../coinbase-onramp-api.js (deployed
// alongside this website on Railway) for that half. This file just calls
// that backend to get a one-time session token, then builds the URL to
// open.
//
// WHAT YOU (THE DEVELOPER) STILL NEED TO DO
// Create a free account at https://portal.cdp.coinbase.com, create a
// Secret API Key, and set COINBASE_CDP_API_KEY_ID / COINBASE_CDP_API_SECRET
// in the backend's environment (Railway -> Variables -- see
// ../coinbase-onramp-api.js's header comment). Until those are set, the
// backend reports itself as unconfigured and this file's functions surface
// that as a normal error, same as an unconfigured MoonPay does.
//
// NETWORK SUPPORT
// Mirrors NETWORK_TO_COINBASE_BLOCKCHAIN in ../coinbase-onramp-api.js --
// kept in sync manually since one is server-side Node and the other is
// client-side. Only networks independently confirmed against Coinbase's
// own docs (checked Sept 2026) are listed; see that file's header comment
// for the full explanation of why BNB Smart Chain isn't included. This
// list only controls whether the "Buy with Coinbase" button is shown for
// the current network -- the backend independently re-validates it, so
// there's no safety issue if the two ever drift, just a button that's
// wrongly shown or hidden until fixed.
const COINBASE_ONRAMP_SUPPORTED_NETWORKS = new Set(["ethereum", "base", "polygon", "arbitrum", "optimism"]);

const COINBASE_ONRAMP_SESSION_ENDPOINT = "https://web-wallet-production.up.railway.app/api/coinbase-onramp-session";
const COINBASE_ONRAMP_WIDGET_BASE_URL = "https://pay.coinbase.com/buy/select-asset";

function isCoinbaseOnrampSupportedNetwork(networkKey) {
  return COINBASE_ONRAMP_SUPPORTED_NETWORKS.has(networkKey);
}

// Asks the backend for a one-time Coinbase Onramp session token for this
// address/network, and returns the full URL to open in a new tab. Throws
// with a user-facing message on any failure (not configured yet, network
// not supported, address invalid, Coinbase itself declined the request) --
// callers should catch this and show it the same way buy-config.js's
// buildBuyUrl()'s errors are shown.
async function buildCoinbaseOnrampUrl(networkKey, address) {
  if (!address) throw new Error("No receiving address to buy into yet.");
  if (!isCoinbaseOnrampSupportedNetwork(networkKey)) {
    throw new Error("Coinbase Buy isn't available on this network yet.");
  }

  let res;
  try {
    res = await fetch(COINBASE_ONRAMP_SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, network: networkKey }),
    });
  } catch (e) {
    throw new Error("Couldn't reach Coinbase. Check your internet connection.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error((data && data.error) || "Coinbase Buy isn't available right now.");
  }
  if (!data.configured) {
    throw new Error("Coinbase Buy isn't set up yet.");
  }
  if (!data.supported) {
    throw new Error("Coinbase Buy isn't available on this network yet.");
  }
  if (!data.token) {
    throw new Error("Coinbase didn't return a session token.");
  }

  const params = new URLSearchParams();
  params.set("sessionToken", data.token);
  params.set("defaultNetwork", networkKey);
  return `${COINBASE_ONRAMP_WIDGET_BASE_URL}?${params.toString()}`;
}

// ---- Sell / Offramp -----------------------------------------------------
const COINBASE_OFFRAMP_STATUS_ENDPOINT = "https://web-wallet-production.up.railway.app/api/coinbase-offramp-status";
const COINBASE_OFFRAMP_WIDGET_BASE_URL = "https://pay.coinbase.com/v3/sell/input";

// Remembers the partnerUserRef from the most recent buildCoinbaseOfframpUrl()
// call, so checkCoinbaseOfframpStatus() knows which sell session to ask
// about without the caller having to pass it back in. Page-lifetime only
// (a plain variable, not stored) -- if the page reloads before checking,
// the person just needs to click "Sell with Coinbase" again.
let lastOfframpPartnerUserRef = null;

function generatePartnerUserRef() {
  // Matches the backend's PARTNER_USER_REF_RE (A-Za-z0-9_- , 8-64 chars) --
  // see coinbase-onramp-api.js. Not a secret, just needs to be unique
  // enough to not collide with another session.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Asks the backend for a one-time Coinbase Offramp session token, and
// returns the full URL to open in a new tab. Same error-throwing contract
// as buildCoinbaseOnrampUrl() above -- callers should catch and display
// e.message. Generates and remembers a fresh partnerUserRef each call, for
// checkCoinbaseOfframpStatus() to use afterwards.
async function buildCoinbaseOfframpUrl(networkKey, address) {
  if (!address) throw new Error("No address to sell from yet.");
  if (!isCoinbaseOnrampSupportedNetwork(networkKey)) {
    throw new Error("Coinbase Sell isn't available on this network yet.");
  }

  let res;
  try {
    res = await fetch(COINBASE_ONRAMP_SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, network: networkKey }),
    });
  } catch (e) {
    throw new Error("Couldn't reach Coinbase. Check your internet connection.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error((data && data.error) || "Coinbase Sell isn't available right now.");
  }
  if (!data.configured) {
    throw new Error("Coinbase Sell isn't set up yet.");
  }
  if (!data.supported) {
    throw new Error("Coinbase Sell isn't available on this network yet.");
  }
  if (!data.token) {
    throw new Error("Coinbase didn't return a session token.");
  }

  const partnerUserRef = generatePartnerUserRef();
  lastOfframpPartnerUserRef = partnerUserRef;

  const params = new URLSearchParams();
  params.set("sessionToken", data.token);
  params.set("partnerUserRef", partnerUserRef);
  return `${COINBASE_OFFRAMP_WIDGET_BASE_URL}?${params.toString()}`;
}

// Looks up the deposit address/amount for the most recent
// buildCoinbaseOfframpUrl() call. Returns null (not an error) if Coinbase
// doesn't have a completed sell for it yet -- the person may still be
// mid-flow on Coinbase's page, or just needs to try again in a few
// seconds. Throws only on a real failure (not configured, network error,
// no sell session started yet this page load).
async function checkCoinbaseOfframpStatus() {
  if (!lastOfframpPartnerUserRef) {
    throw new Error("Start a sell with Coinbase first, then check back here.");
  }

  let res;
  try {
    res = await fetch(`${COINBASE_OFFRAMP_STATUS_ENDPOINT}?partnerUserRef=${encodeURIComponent(lastOfframpPartnerUserRef)}`);
  } catch (e) {
    throw new Error("Couldn't reach Coinbase. Check your internet connection.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error((data && data.error) || "Coinbase Sell isn't available right now.");
  }
  if (!data.configured) {
    throw new Error("Coinbase Sell isn't set up yet.");
  }
  if (!data.found || !data.transaction) return null;
  return data.transaction; // { toAddress, amount, asset, network }
}

if (typeof self !== "undefined") {
  self.TM_COINBASE_ONRAMP_CONFIG = {
    isCoinbaseOnrampSupportedNetwork,
    buildCoinbaseOnrampUrl,
    buildCoinbaseOfframpUrl,
    checkCoinbaseOfframpStatus,
  };
}
