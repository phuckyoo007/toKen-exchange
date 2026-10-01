// lib/nft.js
// Thin client for this project's own /api/nft-list and /api/nft-metadata
// endpoints (see nft-api.js), which proxy Alchemy's NFT API server-side so
// the ALCHEMY_API_KEY never has to exist in this file or anywhere else
// client-side. Same absolute-Railway-URL pattern as lib/swap.js's
// SWAP_QUOTE_ENDPOINT, and for the same reason: this file is shared between
// the website (where a relative /api/... would work) and the extension's
// background.js (which has no server of its own and must cross-origin
// fetch the hosted site).
//
// Every call degrades the same way lib/swap.js's tryAggregatorQuote()
// does: not configured yet, offline, or a bad response all just come back
// as {configured:false}/{ok:false} rather than throwing, so a caller can
// always fall back to the wallet's existing manual "type in a contract
// address and token ID" flow (TM_LOOKUP_NFT / TM_ADD_TRACKED_NFT in
// wallet-engine.js and background.js) instead of showing an error.
const NFT_LIST_ENDPOINT = "https://web-wallet-production.up.railway.app/api/nft-list";
const NFT_METADATA_ENDPOINT = "https://web-wallet-production.up.railway.app/api/nft-metadata";

// Returns { configured, supported, ok, nfts, pageKey } -- nfts is always an
// array (empty on any failure), so a caller can render it directly without
// a separate empty-state branch for "not configured" vs. "no NFTs found".
async function fetchNftsForOwner({ networkKey, owner, pageKey }) {
  try {
    if (!networkKey || !owner) return { configured: false, supported: false, ok: false, nfts: [], pageKey: null };
    const params = new URLSearchParams({ network: networkKey, owner });
    if (pageKey) params.set("pageKey", pageKey);
    let res;
    try {
      res = await fetch(`${NFT_LIST_ENDPOINT}?${params.toString()}`);
    } catch (e) {
      return { configured: true, supported: true, ok: false, nfts: [], pageKey: null }; // offline/unreachable
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.configured) return { configured: false, supported: false, ok: false, nfts: [], pageKey: null };
    if (!data.supported) return { configured: true, supported: false, ok: false, nfts: [], pageKey: null };
    if (!data.ok || !Array.isArray(data.nfts)) return { configured: true, supported: true, ok: false, nfts: [], pageKey: null };
    return { configured: true, supported: true, ok: true, nfts: data.nfts, pageKey: data.pageKey || null };
  } catch (e) {
    return { configured: true, supported: true, ok: false, nfts: [], pageKey: null };
  }
}

// Returns { configured, supported, ok, nft } -- nft is null on any failure.
// Not currently called from the UI (see nft-api.js's header comment); kept
// for symmetry and as a ready-made faster path if the on-chain lookup ever
// needs one.
async function fetchNftMetadata({ networkKey, contractAddress, tokenId }) {
  try {
    if (!networkKey || !contractAddress || tokenId === undefined || tokenId === null) {
      return { configured: false, supported: false, ok: false, nft: null };
    }
    const params = new URLSearchParams({ network: networkKey, contractAddress, tokenId: String(tokenId) });
    let res;
    try {
      res = await fetch(`${NFT_METADATA_ENDPOINT}?${params.toString()}`);
    } catch (e) {
      return { configured: true, supported: true, ok: false, nft: null };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.configured) return { configured: false, supported: false, ok: false, nft: null };
    if (!data.supported) return { configured: true, supported: false, ok: false, nft: null };
    if (!data.ok) return { configured: true, supported: true, ok: false, nft: null };
    const { configured, ok, supported, ...nft } = data;
    return { configured: true, supported: true, ok: true, nft };
  } catch (e) {
    return { configured: true, supported: true, ok: false, nft: null };
  }
}

if (typeof self !== "undefined") {
  self.TM_NFT = { fetchNftsForOwner, fetchNftMetadata };
}
