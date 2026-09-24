// lib/transak-config.js
// Client-side helper for Buy / Sell through Transak (replaces MoonPay).
// Same file is used by the website (lib/) and the Chrome extension (lib/).
//
// It holds NO secrets. It asks this project's own backend (see
// transak-widget-api.js at the repo root -- the backend holds the Transak
// API secret and does the two-step token -> widget-session calls) for a
// single-use, 5-minute Transak widget URL, and returns that URL for the
// caller to open in a NEW TAB. Because the URL is single-use, always call
// buildTransakUrl() again for each click -- never cache or reuse one.
//
// The backend is a plain JSON endpoint (returns a URL string, nothing
// executable), so calling it from the extension doesn't conflict with the
// extension's "no remote code fetched at runtime" store answer.

const TRANSAK_SESSION_ENDPOINT = "https://web-wallet-production.up.railway.app/api/transak-session";

// Returns the URL to open. Throws Error with a user-facing message on any
// failure (not configured yet, offline, Transak declined the request).
//   product: "BUY" | "SELL"
//   networkKey: this wallet's network key (see lib/networks.js)
//   address: the wallet's selected address
//   fiatCode: optional 3-letter currency code, used only as a default
async function buildTransakUrl(product, networkKey, address, fiatCode) {
  const label = product === "SELL" ? "Sell" : "Buy";
  if (!address) throw new Error("No wallet address available yet.");

  let res;
  try {
    res = await fetch(TRANSAK_SESSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, network: networkKey, address, fiat: fiatCode || "" }),
    });
  } catch (e) {
    throw new Error("Couldn't reach Transak. Check your internet connection.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error((data && data.error) || `Transak ${label} isn't available right now.`);
  }
  if (!data.configured) throw new Error(`Transak ${label} isn't set up yet.`);
  if (!data.url) throw new Error("Transak didn't return a link.");
  return data.url;
}

if (typeof self !== "undefined") {
  self.TM_TRANSAK_CONFIG = { buildTransakUrl };
}
