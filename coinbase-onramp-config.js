// lib/coinbase-onramp-config.js
// "Buy crypto" on-ramp, via Coinbase's hosted Onramp -- a second option
// alongside MoonPay (see lib/buy-config.js), added specifically so Buy has
// something functional while a MoonPay production account is still
// pending approval.
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

if (typeof self !== "undefined") {
  self.TM_COINBASE_ONRAMP_CONFIG = {
    isCoinbaseOnrampSupportedNetwork,
    buildCoinbaseOnrampUrl,
  };
}
