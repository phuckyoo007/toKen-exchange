// swap-quote-api.js
// Server-side proxy for 0x's Swap API (https://0x.org), so the wallet can
// offer aggregated multi-DEX quotes -- shopping a trade across many
// liquidity sources for a better price than any single router -- without
// the API key 0x requires ever living in client-side code. The extension
// has no server of its own, and even on the website, anything in app.js
// or lib/*.js is visible to anyone who opens dev tools, so the key has to
// stay back here, same reasoning as moonpay-sign-api.js.
//
// WHAT YOU (THE DEVELOPER) STILL NEED TO DO
// Create a free account at https://dashboard.0x.org/create-account, grab
// an API key from the dashboard, and set it as the ZEROEX_API_KEY
// environment variable in this service's environment (Railway ->
// Variables) -- never paste it into a chat or commit it to a file in this
// repo. Until it's set, isAggregatorConfigured() returns false and
// lib/swap.js's tryAggregatorQuote() gets back {configured: false} and
// falls back to the existing direct-router swap path -- nothing breaks,
// the better pricing just isn't available yet.
//
// WHAT THIS ENDPOINT DOES
// GET /api/swap-quote?chainId=&sellToken=&buyToken=&sellAmount=&taker=&slippageBps=
// forwards to 0x's /swap/allowance-holder/quote (a FIRM quote, not just
// indicative -- lib/swap.js only ever calls this right before the wallet
// is about to actually swap) with our server-held API key attached, and
// hands back just the fields the client needs: the amounts, the
// allowance-holder contract to approve, and the ready-to-sign
// transaction. Reachable by both the website and the browser extension
// (see the CORS header below), and lightly rate-limited per IP the same
// way moonpay-sign-api.js is.
//
// "No route found" or "chain not supported" from 0x is not an error on
// our end -- it just means the aggregator can't help with this pair right
// now -- so those cases are reported back as a clean {ok: false} rather
// than an HTTP error, and lib/swap.js treats that the same as "not
// configured": fall back to the direct router path.

const { URLSearchParams } = require("url");

const ZEROEX_API_KEY = process.env.ZEROEX_API_KEY || "";
const ZEROEX_QUOTE_URL = "https://api.0x.org/swap/allowance-holder/quote";

// The chain ids this wallet knows about (see lib/networks.js) that 0x's
// Swap API also covers -- checked against 0x's own supported-chains docs,
// Sept 2026. A request for any other chainId is rejected here rather than
// forwarded, since 0x would just error on it anyway.
const SUPPORTED_CHAIN_IDS = new Set([1, 8453, 137, 56, 42161, 10]);

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const AMOUNT_RE = /^[0-9]+$/;

// Same small per-IP throttle as moonpay-sign-api.js -- not a real rate
// limiter, just enough friction to deter a naive script from burning
// through the 0x API quota.
const quoteTimestamps = new Map(); // ip -> [timestamps]
const QUOTE_LIMIT = 60;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function withinLimit(ip) {
  const now = Date.now();
  const times = (quoteTimestamps.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= QUOTE_LIMIT) {
    quoteTimestamps.set(ip, times);
    return false;
  }
  times.push(now);
  quoteTimestamps.set(ip, times);
  return true;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function isAggregatorConfigured() {
  return !!ZEROEX_API_KEY;
}

function isValidAddress(addr) {
  return typeof addr === "string" && ADDRESS_RE.test(addr);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    // Same reasoning as moonpay-sign-api.js: lets the extension's
    // chrome-extension:// origin call this same-project API too.
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

// A clean "the aggregator can't help right now" response -- never an
// HTTP error, so the client's fallback-to-router logic stays simple.
function sendNoRoute(res) {
  sendJson(res, 200, { configured: true, ok: false, liquidityAvailable: false });
}

// Returns true if the request was handled here (caller should not fall
// through to the static file handler); false otherwise. Does its real
// work asynchronously (the fetch to 0x) and calls res.end() once that
// settles -- the caller only needs the synchronous true/false to decide
// whether to keep handling this request itself.
function handleSwapQuoteApi(req, res) {
  const [url, queryString] = req.url.split("?");
  if (url !== "/api/swap-quote") return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    res.end();
    return true;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." });
    return true;
  }

  if (!isAggregatorConfigured()) {
    sendJson(res, 200, { configured: false });
    return true;
  }

  if (!withinLimit(clientIp(req))) {
    sendJson(res, 429, { error: "Too many requests recently. Try again later." });
    return true;
  }

  const params = new URLSearchParams(queryString || "");
  const chainId = parseInt(params.get("chainId") || "", 10);
  const sellToken = params.get("sellToken") || "";
  const buyToken = params.get("buyToken") || "";
  const sellAmount = params.get("sellAmount") || "";
  const taker = params.get("taker") || "";
  const slippageBps = parseInt(params.get("slippageBps") || "100", 10);

  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    sendJson(res, 400, { error: "Unsupported chainId." });
    return true;
  }
  if (!isValidAddress(sellToken) || !isValidAddress(buyToken)) {
    sendJson(res, 400, { error: "Missing or invalid sellToken/buyToken." });
    return true;
  }
  if (!AMOUNT_RE.test(sellAmount) || sellAmount === "0") {
    sendJson(res, 400, { error: "Missing or invalid sellAmount." });
    return true;
  }
  if (!isValidAddress(taker)) {
    sendJson(res, 400, { error: "Missing or invalid taker." });
    return true;
  }
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 5000) {
    sendJson(res, 400, { error: "Invalid slippageBps." });
    return true;
  }

  const upstreamParams = new URLSearchParams({
    chainId: String(chainId),
    sellToken,
    buyToken,
    sellAmount,
    taker,
    slippageBps: String(slippageBps),
  });

  fetch(`${ZEROEX_QUOTE_URL}?${upstreamParams.toString()}`, {
    headers: {
      "0x-api-key": ZEROEX_API_KEY,
      "0x-version": "v2",
    },
  })
    .then(async (upstreamRes) => {
      const data = await upstreamRes.json().catch(() => null);
      if (!upstreamRes.ok || !data) {
        sendNoRoute(res);
        return;
      }
      if (data.liquidityAvailable === false || !data.transaction || !data.transaction.to || !data.transaction.data) {
        sendNoRoute(res);
        return;
      }
      sendJson(res, 200, {
        configured: true,
        ok: true,
        liquidityAvailable: true,
        buyAmount: data.buyAmount,
        minBuyAmount: data.minBuyAmount,
        allowanceTarget: (data.issues && data.issues.allowance && data.issues.allowance.spender) || null,
        transaction: {
          to: data.transaction.to,
          data: data.transaction.data,
          value: data.transaction.value,
          gas: data.transaction.gas,
          gasPrice: data.transaction.gasPrice,
        },
      });
    })
    .catch(() => {
      sendNoRoute(res);
    });

  return true;
}

module.exports = { handleSwapQuoteApi, isAggregatorConfigured };
