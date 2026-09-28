// client-ip.js
// One shared way to work out the real client IP for rate limiting.
//
// Behind a reverse proxy (Railway = 1 hop) the proxy APPENDS the address it saw
// to X-Forwarded-For. Anything to the left of that is whatever the client chose
// to send, so it can be forged. Taking the first entry (as several of the API
// files used to) lets anyone dodge a per-IP limit just by sending their own
// "X-Forwarded-For: <random>" header. We therefore count from the right.
//
// TRUST_PROXY_HOPS = how many proxies sit in front of this server.
//   Railway: 1 (the default)    Exposed directly to the internet: 0
const TRUST_PROXY_HOPS = Number.isInteger(+process.env.TRUST_PROXY_HOPS) && process.env.TRUST_PROXY_HOPS !== ""
  ? +process.env.TRUST_PROXY_HOPS
  : 1;

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd && TRUST_PROXY_HOPS > 0) {
    const parts = String(fwd).split(",").map((s) => s.trim()).filter(Boolean);
    const idx = parts.length - TRUST_PROXY_HOPS;
    if (idx >= 0) return parts[idx];
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

module.exports = { clientIp, TRUST_PROXY_HOPS };
