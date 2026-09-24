// transak-widget-api.js
// Server-side helper that creates a signed, single-use Transak widget URL
// for the Buy and Sell screens (website and Chrome extension). Transak
// replaces MoonPay as this wallet's Buy/Sell provider.
//
// WHY THIS EXISTS
// Transak no longer accepts widget settings as plain URL query parameters.
// Every widget must be opened from a "widgetUrl" created by their Create
// Widget URL API (docs.transak.com/guides/migration-to-api-based-transak-widget-url,
// checked Sept 2026). That call needs a partner access token, which needs
// the API SECRET -- so it can only happen here on the server. The secret
// (TRANSAK_API_SECRET) is set in Railway -> Variables and never shipped to
// the website or the extension.
//
// TWO-STEP FLOW (both confirmed against docs.transak.com, Sept 2026)
// 1. POST {api}/partners/api/v2/refresh-token
//      header  api-secret: <secret>     body {"apiKey": <key>}
//      -> { data: { accessToken, expiresAt } }   (token valid 7 days)
//    Requesting a new token INVALIDATES the previous one, so the token is
//    cached in memory and only refreshed when missing / near expiry / after
//    one 401 from step 2 -- never re-minted per request.
// 2. POST {gateway}/api/v2/auth/session
//      header  access-token: <accessToken>
//      body    { widgetParams: { apiKey, referrerDomain, ... } }
//      -> { data: { widgetUrl } }   (single-use, valid 5 minutes)
//    apiKey and referrerDomain live INSIDE widgetParams, nothing else at
//    the top level.
//
// ENVIRONMENT VARIABLES (Railway -> Variables)
//   TRANSAK_API_KEY         required  (public-ish key from dashboard.transak.com -> Developers)
//   TRANSAK_API_SECRET      required  (secret -- never commit)
//   TRANSAK_ENVIRONMENT     "production" or "staging" (default "staging", so a
//                           forgotten variable can't move real money). Use the
//                           key/secret pair that matches the environment.
//   TRANSAK_REFERRER_DOMAIN optional, default "tokenswaphub.org". Must match
//                           the domain approved on your Transak dashboard.
// Until key + secret are set, the endpoint answers { configured: false } and
// the Buy/Sell buttons stay hidden -- nothing breaks.
//
// IP ALLOWLIST -- READ THIS
// Transak's Create Widget URL docs say to call it "from the partner backend,
// with partner IPs whitelisted". Railway's outbound IPs are not fixed by
// default, so if the session call starts returning 401/403 while
// refresh-token still works, the cause is likely your egress IP: either
// enable a static outbound IP on the Railway service (or route these two
// calls through one) and add that IP in the Transak dashboard.
//
// NETWORK NAMES (NETWORK_TO_TRANSAK_NETWORK)
// Only "ethereum" and "polygon" appear verbatim in Transak's docs, so only
// those are locked. Other networks (Base, Arbitrum, Optimism, BNB Chain...)
// open the widget WITHOUT a locked network and the person picks it inside
// Transak's own screen -- same "never guess an integration id" rule as the
// old MoonPay config. Add an entry only after confirming Transak's exact
// identifier for that chain in their dashboard/docs.

const TRANSAK_API_KEY = process.env.TRANSAK_API_KEY || "";
const TRANSAK_API_SECRET = process.env.TRANSAK_API_SECRET || "";
const TRANSAK_ENVIRONMENT = (process.env.TRANSAK_ENVIRONMENT || "staging").toLowerCase() === "production" ? "production" : "staging";
const TRANSAK_REFERRER_DOMAIN = process.env.TRANSAK_REFERRER_DOMAIN || "tokenswaphub.org";

const HOSTS = {
  production: { api: "https://api.transak.com", gateway: "https://api-gateway.transak.com" },
  staging: { api: "https://api-stg.transak.com", gateway: "https://api-gateway-stg.transak.com" },
};

const NETWORK_TO_TRANSAK_NETWORK = {
  ethereum: "ethereum",
  polygon: "polygon",
};

function isTransakConfigured() {
  return !!(TRANSAK_API_KEY && TRANSAK_API_SECRET);
}

// ---- access token cache ---------------------------------------------------
let cachedToken = null; // { accessToken, expiresAt (unix seconds) }
let tokenInFlight = null;
const TOKEN_REFRESH_MARGIN_S = 10 * 60;

function tokenIsFresh() {
  return cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_S > Date.now() / 1000;
}

async function fetchNewAccessToken() {
  const res = await fetch(`${HOSTS[TRANSAK_ENVIRONMENT].api}/partners/api/v2/refresh-token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-secret": TRANSAK_API_SECRET,
    },
    body: JSON.stringify({ apiKey: TRANSAK_API_KEY }),
  });
  const body = await res.json().catch(() => null);
  const data = body && body.data;
  if (!res.ok || !data || !data.accessToken) {
    const detail = (body && body.error && (body.error.message || body.error)) || (body && body.message) || `HTTP ${res.status}`;
    throw new Error(`Transak declined the credentials: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return { accessToken: data.accessToken, expiresAt: Number(data.expiresAt) || Math.floor(Date.now() / 1000) + 6 * 24 * 3600 };
}

// Concurrent callers share one refresh -- each refresh invalidates the last
// token, so two parallel refreshes would knock each other out.
async function getAccessToken(forceRefresh) {
  if (!forceRefresh && tokenIsFresh()) return cachedToken.accessToken;
  if (!tokenInFlight) {
    tokenInFlight = fetchNewAccessToken()
      .then((t) => { cachedToken = t; return t; })
      .finally(() => { tokenInFlight = null; });
  }
  return (await tokenInFlight).accessToken;
}

async function postSession(accessToken, widgetParams) {
  const res = await fetch(`${HOSTS[TRANSAK_ENVIRONMENT].gateway}/api/v2/auth/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "access-token": accessToken,
    },
    body: JSON.stringify({ widgetParams }),
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function createWidgetUrl(widgetParams) {
  let token = await getAccessToken(false);
  let { res, body } = await postSession(token, widgetParams);
  // One retry with a fresh token if the cached one was rejected -- never
  // more than one, so a persistent 401 (e.g. IP not allow-listed) can't
  // turn into a token re-mint storm.
  if (res.status === 401) {
    token = await getAccessToken(true);
    ({ res, body } = await postSession(token, widgetParams));
  }
  const url = body && body.data && body.data.widgetUrl;
  if (!res.ok || !url) {
    const detail = (body && body.error && (body.error.message || body.error)) || (body && body.message) || `HTTP ${res.status}`;
    throw new Error(`Transak declined the request: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  if (!/^https:\/\/[a-z0-9.-]*transak\.com[/?]/i.test(url)) {
    throw new Error("Transak returned an unexpected widget URL.");
  }
  return url;
}

// ---- request handling -----------------------------------------------------
const requestTimestamps = new Map();
const REQUEST_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;

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
    // Lets the extension (chrome-extension:// origin) call this too. The
    // request only carries a public address, a network name and a currency
    // code; the response is a single-use URL that only works once.
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const FIAT_RE = /^[A-Za-z]{3}$/;

// Returns true if handled (caller must not fall through to static files).
function handleTransakApi(req, res) {
  const [url] = req.url.split("?");
  if (url !== "/api/transak-session") return false;

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
  if (!isTransakConfigured()) {
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
      const product = String(body.product || "BUY").toUpperCase();
      if (product !== "BUY" && product !== "SELL") {
        sendJson(res, 400, { error: "Invalid product." });
        return;
      }
      const address = typeof body.address === "string" ? body.address.trim() : "";
      if (!EVM_ADDRESS_RE.test(address)) {
        sendJson(res, 400, { error: "Missing or invalid address." });
        return;
      }
      const network = typeof body.network === "string" ? body.network.trim().toLowerCase() : "";
      const fiat = typeof body.fiat === "string" && FIAT_RE.test(body.fiat.trim()) ? body.fiat.trim().toUpperCase() : "";

      const widgetParams = {
        apiKey: TRANSAK_API_KEY,
        referrerDomain: TRANSAK_REFERRER_DOMAIN,
        productsAvailed: product,
      };
      const transakNetwork = NETWORK_TO_TRANSAK_NETWORK[network];
      if (transakNetwork) widgetParams.network = transakNetwork;
      // A default, not a lock: the person can still change currency inside
      // Transak (an unsupported code would otherwise dead-end the flow).
      if (fiat) widgetParams.defaultFiatCurrency = fiat;
      if (product === "BUY") {
        // Pre-fill the receiving address and stop it being edited, so
        // purchased crypto can't be redirected by a tampered page.
        widgetParams.walletAddress = address;
        widgetParams.disableWalletAddressForm = true;
      }

      try {
        const widgetUrl = await createWidgetUrl(widgetParams);
        sendJson(res, 200, { configured: true, url: widgetUrl, networkLocked: !!transakNetwork });
      } catch (e) {
        sendJson(res, 502, { error: (e && e.message) || "Could not reach Transak." });
      }
    })
    .catch((e) => sendJson(res, 400, { error: (e && e.message) || "Bad request." }));

  return true;
}

module.exports = { handleTransakApi, isTransakConfigured, NETWORK_TO_TRANSAK_NETWORK };
