// security-headers.js
// Browser security headers for every response from server.js.
//
// The big one is the Content-Security-Policy: it tells the browser which places
// scripts, images, frames and network calls are allowed to come from, so an
// injected <script> or attribute handler simply won't run, and nobody can put
// the wallet inside an invisible iframe on another site (clickjacking).
//
// If a deploy ever shows something broken and you suspect the CSP, set the
// Railway variable  CSP_REPORT_ONLY=1  -- the browser then only LOGS what the
// policy would have blocked (see the DevTools console) instead of blocking it.
// Remove the variable to enforce again. No code change needed.

const CSP_DIRECTIVES = [
  "default-src 'self'",
  // Only our own script files. No inline scripts, no eval. (The service-worker
  // registration that used to be inline now lives in sw-register.js.)
  "script-src 'self'",
  // Inline style="" attributes are used all over the UI, so 'unsafe-inline' stays
  // for styles only. Fonts are self-hosted.
  "style-src 'self' 'unsafe-inline'",
  // Token / coin / NFT logos come from many https hosts (CoinGecko, Trust Wallet,
  // IPFS gateways, ...).
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Wallet RPCs are user-configurable (custom networks) and WalletConnect uses
  // wss:// relays, so calls can't be pinned to a fixed host list -- but plain
  // http:// and everything else is refused.
  "connect-src 'self' https: wss:",
  // Buy/Sell widgets only.
  "frame-src https://*.transak.com https://pay.coinbase.com https://*.coinbase.com https://buy.onramper.com https://buy.onramper.dev",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nobody may embed the wallet in a frame (clickjacking).
  "frame-ancestors 'none'",
].join("; ");

const REPORT_ONLY = process.env.CSP_REPORT_ONLY === "1";

function isHttps(req) {
  return !!(req.socket && req.socket.encrypted) ||
    String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function applySecurityHeaders(req, res) {
  res.setHeader(REPORT_ONLY ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", CSP_DIRECTIVES);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY"); // older-browser twin of frame-ancestors
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Turn off powerful browser features the wallet never uses. camera/microphone/
  // payment are deliberately NOT listed: the Transak KYC widget needs them.
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(self), usb=(), serial=(), bluetooth=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=()");
  // HSTS only over https (Railway terminates TLS and sets x-forwarded-proto).
  // No includeSubDomains / preload on purpose: they're hard to undo.
  if (isHttps(req)) res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

module.exports = { applySecurityHeaders, CSP_DIRECTIVES };
