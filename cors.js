// cors.js
// Shared CORS policy for the public /api/* endpoints that the extension and the
// website call cross-origin (swap quotes, Transak / Coinbase sessions).
//
// Before: every one of these answered "Access-Control-Allow-Origin: *", so ANY
// website could have a visitor's browser call them and burn your 0x / Transak /
// Coinbase quota. Now only the origins below get the header; browsers block
// every other site from reading the response.
//
// Note: CORS only constrains BROWSERS. It does not stop curl or a script, which
// is what the per-IP rate limits are for.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.tokenswaphub.org",
  "https://tokenswaphub.org",
  // The website's own code still calls the Railway hostname directly, so the
  // site origin above needs it kept working; it's also a valid way to open the app.
  "https://web-wallet-production.up.railway.app",
  // The published Chrome extension (Web Store item ID).
  "chrome-extension://adiihfpfinmhikjiopobbeigcfaoepko",
];

// Optional extras without a code change (e.g. an unpacked dev build of the
// extension, whose ID differs, or http://localhost:3000): set on Railway
//   ALLOWED_ORIGINS=chrome-extension://<dev id>,http://localhost:3000
const EXTRA = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED = new Set(DEFAULT_ALLOWED_ORIGINS.concat(EXTRA));

// Call once the request has been matched to an API route. Sets the CORS headers
// on `res` (they are merged into whatever writeHead sends later). If the caller's
// Origin isn't allowed, no Access-Control-Allow-Origin is sent.
function applyCors(req, res) {
  const origin = req.headers.origin;
  // Vary always, so a shared cache never serves one origin's answer to another.
  res.setHeader("Vary", "Origin");
  if (origin && ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
}

module.exports = { applyCors, ALLOWED_ORIGINS: ALLOWED };
