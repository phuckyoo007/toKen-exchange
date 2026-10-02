// lib/known-tokens.js
// Hand-verified issuer contract addresses for the stablecoins people most often
// want to add or swap into. Used for the "Quick add" chips on the Add Token
// screen and the "Suggested" rows in the swap token picker.
//
// RULES FOR EDITING THIS FILE
//  * Every address must be copied from the issuer's own published list -- never
//    from a block explorer search, an aggregator, or memory:
//      USDC, EURC : https://developers.circle.com/stablecoins/usdc-contract-addresses
//                   https://developers.circle.com/stablecoins/eurc-contract-addresses
//      USDT       : https://tether.to/en/supported-protocols
//  * A chain gets an entry ONLY if the issuer lists that token there. A chain
//    the issuer does not list is left out on purpose (e.g. Tether lists USD₮ on
//    Ethereum, Avalanche and Celo -- not on Base, Arbitrum, Optimism or Polygon).
//  * Addresses are EIP-55 checksummed; tests/known-tokens.test.js enforces it.
//  * Decimals are not stored: the lookup that runs before anything is added
//    reads them (and the name and symbol) from the contract itself.
//
// Keyed by chainId. Last checked against the issuer pages: 2026-10-02.
const TM_KNOWN_TOKENS_BY_CHAIN = {
  1: [
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    { symbol: "EURC", name: "Euro Coin", address: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c" },
  ],
  8453: [
    { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    { symbol: "EURC", name: "Euro Coin", address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" },
  ],
  137: [{ symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" }],
  42161: [{ symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" }],
  10: [{ symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" }],
  43114: [
    { symbol: "USDC", name: "USD Coin", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
    { symbol: "USDT", name: "Tether USD", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" },
    { symbol: "EURC", name: "Euro Coin", address: "0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD" },
  ],
  143: [{ symbol: "USDC", name: "USD Coin", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" }],
  59144: [{ symbol: "USDC", name: "USD Coin", address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff" }],
  324: [{ symbol: "USDC", name: "USD Coin", address: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4" }],
  42220: [
    { symbol: "USDC", name: "USD Coin", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" },
    { symbol: "USDT", name: "Tether USD", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" },
  ],
};

// The verified tokens for a network (empty array if none).
function knownTokensForChain(chainId) {
  return (TM_KNOWN_TOKENS_BY_CHAIN[Number(chainId)] || []).slice();
}

// Tokens worth suggesting right now: verified for this chain, not already
// listed among the held assets, not the token on the other side of the swap,
// and matching what the person has typed (symbol or name; empty = all).
function suggestedKnownTokens(chainId, opts) {
  const o = opts || {};
  const skip = new Set((o.heldAddresses || []).concat(o.excludeAddress ? [o.excludeAddress] : []).map((a) => String(a || "").toLowerCase()));
  const q = String(o.query || "").trim().toLowerCase();
  return knownTokensForChain(chainId).filter((t) => {
    if (skip.has(t.address.toLowerCase())) return false;
    if (!q) return true;
    return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
  });
}

if (typeof self !== "undefined") {
  self.TM_KNOWN_TOKENS = { byChain: TM_KNOWN_TOKENS_BY_CHAIN, forChain: knownTokensForChain, suggested: suggestedKnownTokens };
}
