// coinbase-onramp-api.js
// Small server-side helper that generates a Coinbase Onramp "session
// token", so the Buy screen can offer Coinbase as a second on-ramp
// alongside MoonPay while MoonPay's own account approval is pending.
//
// WHY THIS EXISTS
// Every call to Coinbase's Onramp API must be authenticated with a CDP
// Secret API Key -- a JWT signed with an Ed25519 private key (confirmed
// against Coinbase's own docs, https://docs.cdp.coinbase.com/api-reference/v2/authentication
// and the official coinbase/onramp-demo-application repo, checked Sept
// 2026). That secret must never exist in client-side code (website or
// extension) -- same reasoning as moonpay-sign-api.js right next to this
// file. This backend holds the secret (as the COINBASE_CDP_API_KEY_ID /
// COINBASE_CDP_API_SECRET environment variables -- set in Railway's
// dashboard, never committed to this repo) and hands back a short-lived,
// single-use session token instead. The secret itself never leaves the
// server.
//
// WHAT YOU (THE DEVELOPER) STILL NEED TO DO
// Create a free account at https://portal.cdp.coinbase.com, create a
// Secret API Key (Ed25519), and set COINBASE_CDP_API_KEY_ID (the key's ID)
// and COINBASE_CDP_API_SECRET (the key's secret) in this service's
// environment (Railway -> Variables). Until both are set,
// isCoinbaseOnrampConfigured() returns false and the Buy screen simply
// doesn't show the Coinbase option -- nothing breaks.
//
// NETWORK SUPPORT (NETWORK_TO_COINBASE_BLOCKCHAIN, below)
// Only networks independently confirmed against Coinbase's own docs are
// mapped (checked Sept 2026: docs.cdp.coinbase.com/api-reference/networks
// and docs.cdp.coinbase.com/onramp/additional-resources/layer-2-networks).
// BNB Smart Chain is deliberately left out -- no Coinbase documentation
// found lists it as a supported Onramp destination chain, and this
// project's practice is to never guess an integration id it hasn't
// independently verified (see lib/buy-config.js's header comment for the
// same rule applied to MoonPay's currency codes). Guessing wrong here
// wouldn't error loudly on our end -- Coinbase's API would just reject the
// unrecognized blockchain string -- but it's still better to know a
// network isn't supported than to find out from a failed request. Add a
// network here only after confirming its exact blockchain identifier
// yourself against current Coinbase docs.
//
// SESSION TOKEN FLOW
// 1. Client POSTs { address, network } to /api/coinbase-onramp-session.
// 2. This signs a JWT (via @coinbase/cdp-sdk/auth) and POSTs to Coinbase's
//    https://api.developer.coinbase.com/onramp/v1/token with the address
//    and the mapped blockchain id.
// 3. Coinbase returns a single-use token (good for 5 minutes). This
//    endpoint hands that straight back to the client, which opens
//    https://pay.coinbase.com/buy/select-asset?sessionToken=<token> in a
//    NEW TAB. Coinbase's hosted Onramp is a full-page experience, not an
//    embeddable widget (unlike MoonPay's <iframe>-based one) -- confirmed
//    via Coinbase's own docs and issue tracker discussion of the separate,
//    approval-gated "headless" API being what adds inline/embedded
//    support. So this follows the same "open a new tab" pattern already
//    used for the Polymarket market links, not the Buy screen's
//    <iframe> pattern.

const { generateJwt } = require("@coinbase/cdp-sdk/auth");

const COINBASE_CDP_API_KEY_ID = process.env.COINBASE_CDP_API_KEY_ID || "";
const COINBASE_CDP_API_SECRET = process.env.COINBASE_CDP_API_SECRET || "";
const ONRAMP_TOKEN_HOST = "api.developer.coinbase.com";
const ONRAMP_TOKEN_PATH = "/onramp/v1/token";

// See the "NETWORK SUPPORT" header comment above.
const NETWORK_TO_COINBASE_BLOCKCHAIN = {
  ethereum: "ethereum",
  base: "base",
  polygon: "polygon",
  arbitrum: "arbitrum",
  optimism: "optimism",
};

function isCoinbaseOnrampConfigured() {
  return !!(COINBASE_CDP_API_KEY_ID && COINBASE_CDP_API_SECRET);
}

// Same simple per-IP throttle pattern as moonpay-sign-api.js -- not a real
// rate limiter, just enough friction to deter a naive script from burning
// through Coinbase's API quota.
const requestTimestamps = new Map(); // ip -> [timestamps]
const REQUEST_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function withinLimit(ip) {
  const now = Date.now();
  const times = (requestTimestamps.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= REQUEST_LIMIT) {
    requestTimestamps.set(ip, times);
    return false;
  }
  times.push(now);
  requestTimestamps.set(ip, times);
  return true;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    // Same reasoning as moonpay-sign-api.js: lets the browser extension
    // (a chrome-extension:// origin) call this same-project API too, so
    // Buy works the same way on both the website and the extension. The
    // request itself only carries a public wallet address and a network
    // name -- nothing sensitive -- so an open CORS policy here doesn't
    // expose anything.
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 10000) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Every currently-mapped chain (see NETWORK_TO_COINBASE_BLOCKCHAIN) is EVM,
// so this basic shape check is enough to reject obvious junk before it
// ever reaches Coinbase's API.
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

async function requestSessionToken(address, blockchain) {
  const jwt = await generateJwt({
    apiKeyId: COINBASE_CDP_API_KEY_ID,
    apiKeySecret: COINBASE_CDP_API_SECRET,
    requestMethod: "POST",
    requestHost: ONRAMP_TOKEN_HOST,
    requestPath: ONRAMP_TOKEN_PATH,
    expiresIn: 120,
  });

  const res = await fetch(`https://${ONRAMP_TOKEN_HOST}${ONRAMP_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ addresses: [{ address, blockchains: [blockchain] }] }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.token) {
    const detail = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new Error(`Coinbase declined the request: ${detail}`);
  }
  return data.token;
}

// Returns true if the request was handled here (caller should not fall
// through to the static file handler); false otherwise.
function handleCoinbaseOnrampApi(req, res) {
  const [url] = req.url.split("?");
  if (url !== "/api/coinbase-onramp-session") return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return true;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return true;
  }

  if (!isCoinbaseOnrampConfigured()) {
    sendJson(res, 200, { configured: false });
    return true;
  }

  if (!withinLimit(clientIp(req))) {
    sendJson(res, 429, { error: "Too many requests recently. Try again later." });
    return true;
  }

  readBody(req)
    .then(async (raw) => {
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch (e) {
        sendJson(res, 400, { error: "Invalid JSON body." });
        return;
      }
      const address = typeof body.address === "string" ? body.address.trim() : "";
      const network = typeof body.network === "string" ? body.network.trim().toLowerCase() : "";
      const blockchain = NETWORK_TO_COINBASE_BLOCKCHAIN[network];

      // Not a hard error -- this network just isn't one Coinbase Onramp is
      // confirmed to support yet. The client hides the Coinbase button in
      // this case rather than showing an error.
      if (!blockchain) {
        sendJson(res, 200, { configured: true, supported: false });
        return;
      }
      if (!EVM_ADDRESS_RE.test(address)) {
        sendJson(res, 400, { error: "Missing or invalid address." });
        return;
      }

      try {
        const token = await requestSessionToken(address, blockchain);
        sendJson(res, 200, { configured: true, supported: true, token });
      } catch (e) {
        sendJson(res, 502, { error: (e && e.message) || "Could not reach Coinbase." });
      }
    })
    .catch((e) => {
      sendJson(res, 400, { error: (e && e.message) || "Bad request." });
    });

  return true;
}

module.exports = { handleCoinbaseOnrampApi, isCoinbaseOnrampConfigured, NETWORK_TO_COINBASE_BLOCKCHAIN };
