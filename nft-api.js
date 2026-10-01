// nft-api.js
// Server-side proxy for Alchemy's NFT API (docs.alchemy.com/reference/nft-api-quickstart),
// so the wallet can show someone's NFTs automatically -- discovered directly
// from the address they're already holding -- instead of only the manual
// "type in a contract address and token ID" flow that TM_LOOKUP_NFT /
// TM_ADD_TRACKED_NFT (see wallet-engine.js) already offered. Same reasoning
// as every other file in this directory: Alchemy issues one API key per
// app, meant to be called from a trusted backend, and the extension has no
// server of its own while the website's app.js/wallet-engine.js run as a
// plain in-page <script> fully visible via dev tools -- so the key can
// never live in client-side code. This backend holds it (as the
// ALCHEMY_API_KEY environment variable -- set in Railway's dashboard, never
// committed to this repo, never pasted into chat) and the client only ever
// talks to these two endpoints.
//
// WHAT YOU (THE DEVELOPER) STILL NEED TO DO
// Create a free account at https://dashboard.alchemy.com, create an app,
// grab its API key, and set it as the ALCHEMY_API_KEY environment variable
// in this service's environment (Railway -> Variables). Until it's set,
// isAlchemyConfigured() returns false and lib/nft.js's calls get back
// {configured: false} -- the NFT screen just doesn't offer auto-detection,
// same graceful "not configured yet" pattern as every other optional
// integration here (Coinbase Onramp, the 0x aggregator).
//
// NETWORK SUPPORT (NETWORK_TO_ALCHEMY_SUBDOMAIN, below)
// Only the chains this wallet actually configures (see lib/networks.js) are
// mapped, each to its own Alchemy NFT API subdomain -- confirmed against
// Alchemy's own "Supported Chains" docs (Sept 2026). A request for any
// other network key is rejected here rather than forwarded.
//
// WHAT THESE ENDPOINTS DO
// GET /api/nft-list?network=&owner=&pageKey=
//   Forwards to Alchemy's getNFTsForOwner (withMetadata=true, pageSize=50)
//   and hands back a flattened list: contract address, token id, standard,
//   name, image, and collection name for each NFT -- plus a pageKey to ask
//   for the next page, if there is one. Alchemy's own spam heuristic
//   (contract.isSpam) is filtered out server-side, since the query
//   parameter that does this upstream (excludeFilters) is paid-tier only
//   (confirmed against Alchemy's docs, Sept 2026) -- filtering the same
//   flag ourselves after the fact costs nothing extra and works on the
//   free tier too.
// GET /api/nft-metadata?network=&contractAddress=&tokenId=
//   Forwards to Alchemy's getNFTMetadata for a single NFT. Not currently
//   called by anything (TM_LOOKUP_NFT still reads tokenURI directly
//   on-chain, which needs no API key and already works) -- kept here for
//   symmetry with nft-list and as a ready-made faster path if that ever
//   changes. Never used to override the on-chain lookup's own result.
//
// As with swap-quote-api.js, an upstream miss (bad contract, wrong
// network, no NFTs at that address) is not an error on our end -- it's
// reported back as a clean {ok: false} rather than an HTTP error.

const { URLSearchParams } = require("url");

const { clientIp } = require("./client-ip");
const { applyCors } = require("./cors");
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";

// See the "NETWORK SUPPORT" header comment above.
const NETWORK_TO_ALCHEMY_SUBDOMAIN = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  polygon: "polygon-mainnet",
  bsc: "bnb-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
};

function isAlchemyConfigured() {
  return !!ALCHEMY_API_KEY;
}

function alchemyNftBase(subdomain) {
  return `https://${subdomain}.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}`;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TOKEN_ID_RE = /^[0-9]+$/;
const PAGE_KEY_RE = /^[A-Za-z0-9+/=_.:-]{1,4096}$/; // opaque token Alchemy hands back; just bound its shape

function isValidAddress(addr) {
  return typeof addr === "string" && ADDRESS_RE.test(addr);
}

// Same small per-IP throttle as swap-quote-api.js/coinbase-onramp-api.js --
// not a real rate limiter, just enough friction to deter a naive script
// from burning through the Alchemy quota.
const requestTimestamps = new Map(); // ip -> [timestamps]
const REQUEST_LIMIT = 120;
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

// clientIp() lives in ./client-ip.js (proxy-aware; ignores forged X-Forwarded-For).

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    // Same reasoning as the other API proxies in this directory: lets the
    // extension's chrome-extension:// origin call this same-project API
    // too. Requests here only ever carry a public wallet/contract address
    // and token id -- nothing sensitive -- so an open CORS policy doesn't
    // expose anything.
  });
  res.end(body);
}

// A clean "nothing to report" response -- never an HTTP error, so the
// client's own fallback/empty-state logic stays simple.
function sendNoResult(res, extra) {
  sendJson(res, 200, { configured: true, ok: false, ...(extra || {}) });
}

// Pulls the handful of fields the client actually renders out of one of
// Alchemy's (much larger) NFT objects. Never passes through the raw
// object -- same "treat NFT metadata as untrusted input" stance
// wallet-engine.js's own sanitizeNftImageUrl() takes, just applied to
// Alchemy's response instead of a tokenURI fetch.
function flattenAlchemyNft(item) {
  if (!item || typeof item !== "object") return null;
  const contract = item.contract || {};
  const image = item.image || {};
  const tokenId = item.tokenId != null ? String(item.tokenId) : "";
  if (!isValidAddress(contract.address) || !TOKEN_ID_RE.test(tokenId)) return null;
  const rawName = typeof item.name === "string" ? item.name : "";
  const rawCollectionName = typeof contract.name === "string" ? contract.name : "";
  const rawImage =
    (typeof image.cachedUrl === "string" && image.cachedUrl) ||
    (typeof image.pngUrl === "string" && image.pngUrl) ||
    (typeof image.thumbnailUrl === "string" && image.thumbnailUrl) ||
    (typeof image.originalUrl === "string" && image.originalUrl) ||
    "";
  return {
    contractAddress: contract.address,
    tokenId,
    standard: String(item.tokenType || contract.tokenType || "").toLowerCase() === "erc1155" ? "erc1155" : "erc721",
    name: rawName.slice(0, 200),
    collectionName: rawCollectionName.slice(0, 200),
    // Left for the client's own sanitizeNftImageUrl() allowlist to accept
    // or reject -- this proxy only trims which field to look at, not
    // whether the URL is safe to hand to an <img> tag.
    image: rawImage.slice(0, 2000) || null,
    isSpam: contract.isSpam === true,
  };
}

// Returns true if the request was handled here (caller should not fall
// through to the static file handler); false otherwise.
function handleNftListApi(req, res) {
  const [url, queryString] = req.url.split("?");
  if (url !== "/api/nft-list") return false;
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET, OPTIONS" });
    res.end();
    return true;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." });
    return true;
  }
  if (!isAlchemyConfigured()) {
    sendJson(res, 200, { configured: false });
    return true;
  }
  if (!withinLimit(clientIp(req))) {
    sendJson(res, 429, { error: "Too many requests recently. Try again later." });
    return true;
  }

  const params = new URLSearchParams(queryString || "");
  const network = (params.get("network") || "").trim().toLowerCase();
  const owner = (params.get("owner") || "").trim();
  const pageKey = params.get("pageKey") || "";

  const subdomain = NETWORK_TO_ALCHEMY_SUBDOMAIN[network];
  if (!subdomain) {
    sendJson(res, 200, { configured: true, supported: false, nfts: [] });
    return true;
  }
  if (!isValidAddress(owner)) {
    sendJson(res, 400, { error: "Missing or invalid owner address." });
    return true;
  }
  if (pageKey && !PAGE_KEY_RE.test(pageKey)) {
    sendJson(res, 400, { error: "Invalid pageKey." });
    return true;
  }

  const upstreamParams = new URLSearchParams({ owner, withMetadata: "true", pageSize: "50" });
  if (pageKey) upstreamParams.set("pageKey", pageKey);

  fetch(`${alchemyNftBase(subdomain)}/getNFTsForOwner?${upstreamParams.toString()}`)
    .then(async (upstreamRes) => {
      const data = await upstreamRes.json().catch(() => null);
      if (!upstreamRes.ok || !data || !Array.isArray(data.ownedNfts)) {
        sendNoResult(res, { nfts: [] });
        return;
      }
      const nfts = data.ownedNfts
        .map(flattenAlchemyNft)
        .filter((n) => n && !n.isSpam)
        .map(({ isSpam, ...rest }) => rest); // isSpam was only needed to filter; don't bother the client with it
      sendJson(res, 200, {
        configured: true,
        ok: true,
        supported: true,
        nfts,
        pageKey: typeof data.pageKey === "string" && data.pageKey ? data.pageKey : null,
      });
    })
    .catch(() => {
      sendNoResult(res, { nfts: [] });
    });

  return true;
}

// Returns true if the request was handled here (caller should not fall
// through to the static file handler); false otherwise.
function handleNftMetadataApi(req, res) {
  const [url, queryString] = req.url.split("?");
  if (url !== "/api/nft-metadata") return false;
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET, OPTIONS" });
    res.end();
    return true;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." });
    return true;
  }
  if (!isAlchemyConfigured()) {
    sendJson(res, 200, { configured: false });
    return true;
  }
  if (!withinLimit(clientIp(req))) {
    sendJson(res, 429, { error: "Too many requests recently. Try again later." });
    return true;
  }

  const params = new URLSearchParams(queryString || "");
  const network = (params.get("network") || "").trim().toLowerCase();
  const contractAddress = (params.get("contractAddress") || "").trim();
  const tokenId = (params.get("tokenId") || "").trim();

  const subdomain = NETWORK_TO_ALCHEMY_SUBDOMAIN[network];
  if (!subdomain) {
    sendJson(res, 200, { configured: true, supported: false });
    return true;
  }
  if (!isValidAddress(contractAddress) || !TOKEN_ID_RE.test(tokenId)) {
    sendJson(res, 400, { error: "Missing or invalid contractAddress/tokenId." });
    return true;
  }

  const upstreamParams = new URLSearchParams({ contractAddress, tokenId });

  fetch(`${alchemyNftBase(subdomain)}/getNFTMetadata?${upstreamParams.toString()}`)
    .then(async (upstreamRes) => {
      const data = await upstreamRes.json().catch(() => null);
      if (!upstreamRes.ok || !data) {
        sendNoResult(res);
        return;
      }
      const flat = flattenAlchemyNft({ ...data, contract: { ...(data.contract || {}), address: contractAddress } });
      if (!flat) {
        sendNoResult(res);
        return;
      }
      const { isSpam, ...rest } = flat;
      sendJson(res, 200, { configured: true, ok: true, supported: true, ...rest, isSpam: isSpam === true });
    })
    .catch(() => {
      sendNoResult(res);
    });

  return true;
}

// Returns true if the request was handled here (caller should not fall
// through to the static file handler); false otherwise.
function handleNftApi(req, res) {
  if (handleNftListApi(req, res)) return true;
  if (handleNftMetadataApi(req, res)) return true;
  return false;
}

module.exports = { handleNftApi, isAlchemyConfigured, NETWORK_TO_ALCHEMY_SUBDOMAIN };
