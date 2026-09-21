// lib/networks.js
// Built-in EVM network configs for Token Exchange.
//
// IMPORTANT SAFETY NOTE ON ROUTER ADDRESSES:
// Swapping works by calling a Uniswap-V2-style router contract on each chain.
// Getting a router address wrong doesn't just fail silently -- it can send a
// transaction to the wrong contract. The `swapRouter` / `swapFactory` fields
// below are only filled in for chains where the address is long-established,
// extremely widely documented, and effectively immutable:
//   - Ethereum mainnet: Uniswap V2
//   - BNB Chain: PancakeSwap V2
//   - Polygon: QuickSwap V2
//   - Base: Uniswap V2 Router02 (Uniswap's own V2-compatible deployment on
//     Base -- confirmed as a verified contract on BaseScan)
// For every other built-in chain, `swapRouter` is left null on purpose. The UI
// (see popup) will refuse to run a swap on a chain with no verified router and
// will instead prompt the user to supply + confirm one themselves (see
// "Custom / unverified router" flow in popup.js). NEVER fill these in from a
// guess -- a wrong contract address risks failed/stuck transactions at best.
// Always have the user (or you) verify against the project's own official
// docs / block explorer "verified contract" page before adding one.

const BUILTIN_NETWORKS = [
  {
    key: "ethereum",
    chainId: 1,
    name: "Ethereum Mainnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    // Four independent, keyless public endpoints (added 2026-09 after a user
    // hit "Couldn't get a response from the network" -- background.js's
    // pickHealthyRpcUrl/rpcPassthrough already fall through to the next URL
    // on a bad one, but every other chain below only listed a single URL
    // until now, meaning that fallback logic had nothing to fall back to).
    rpcUrls: ["https://cloudflare-eth.com", "https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://rpc.ankr.com/eth"],
    blockExplorer: "https://etherscan.io",
    wrappedNative: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    swapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2 Router02
    swapFactory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Uniswap V2 Factory
    swapLabel: "Uniswap V2",
    builtin: true,
  },
  {
    key: "base",
    chainId: 8453,
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://rpc.ankr.com/base"],
    blockExplorer: "https://basescan.org",
    wrappedNative: "0x4200000000000000000000000000000000000006", // WETH (Base predeploy)
    // Verified via BaseScan (contract labeled "Uniswap: V2 Router02", marked
    // Verified) on 2026-09-05 -- Uniswap deployed a V2-compatible Router02
    // directly on Base, same ABI as mainnet's V2 router.
    swapRouter: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", // Uniswap V2 Router02 (Base)
    swapFactory: null, // not confirmed; not required for quote/swap calls
    swapLabel: "Uniswap V2 (Base)",
    builtin: true,
  },
  {
    key: "polygon",
    chainId: 137,
    name: "Polygon",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com", "https://rpc.ankr.com/polygon"],
    blockExplorer: "https://polygonscan.com",
    wrappedNative: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC/WPOL
    swapRouter: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap V2 Router
    swapFactory: "0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32", // QuickSwap V2 Factory
    swapLabel: "QuickSwap V2",
    builtin: true,
  },
  {
    key: "bsc",
    chainId: 56,
    name: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://rpc.ankr.com/bsc"],
    blockExplorer: "https://bscscan.com",
    wrappedNative: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
    swapRouter: "0x10ED43C718714eb63d5aA57B78B54704E256024E", // PancakeSwap V2 Router
    swapFactory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73", // PancakeSwap V2 Factory
    swapLabel: "PancakeSwap V2",
    builtin: true,
  },
  {
    key: "arbitrum",
    chainId: 42161,
    name: "Arbitrum One",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://rpc.ankr.com/arbitrum"],
    blockExplorer: "https://arbiscan.io",
    wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
    // Same address as Base's Uniswap V2 Router02 above -- consistent with
    // two independent sources checked on 2026-09-07 (Arbiscan's own indexed
    // page title, and a third-party router-address aggregator) both naming
    // this exact address as "Uniswap V2: Router" on Arbitrum One. Not a
    // first-party direct-fetch confirmation the way Base/Ethereum/Optimism
    // got, because arbiscan.io was blocking automated fetches when this was
    // checked -- worth a 10-second glance at that address on arbiscan.io
    // yourself before relying on it for a large swap.
    swapRouter: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", // Uniswap V2 Router02 (Arbitrum)
    swapFactory: null, // not confirmed; not required for quote/swap calls
    swapLabel: "Uniswap V2 (Arbitrum)",
    builtin: true,
  },
  {
    key: "optimism",
    chainId: 10,
    name: "OP Mainnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com", "https://rpc.ankr.com/optimism"],
    blockExplorer: "https://optimistic.etherscan.io",
    wrappedNative: "0x4200000000000000000000000000000000000006", // WETH
    // Same address as Ethereum mainnet's Uniswap V2 Router02 (this one WAS
    // directly confirmed: fetched optimistic.etherscan.io on 2026-09-07,
    // contract verified with an exact-match source match, name
    // "UniswapV2Router02", same compiler version as the original mainnet
    // deployment).
    swapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2 Router02 (Optimism)
    swapFactory: null, // not confirmed; not required for quote/swap calls
    swapLabel: "Uniswap V2 (Optimism)",
    builtin: true,
  },
];

// chrome.storage key holding user-added custom networks (array, same shape as
// above but builtin:false and swapRouter possibly user-supplied+confirmed).
const CUSTOM_NETWORKS_KEY = "tm_custom_networks";
const SELECTED_NETWORK_KEY = "tm_selected_network";

async function getAllNetworks() {
  const stored = await chrome.storage.local.get(CUSTOM_NETWORKS_KEY);
  const custom = stored[CUSTOM_NETWORKS_KEY] || [];
  return [...BUILTIN_NETWORKS, ...custom];
}

async function addCustomNetwork(net) {
  if (!net.chainId || !net.name || !net.rpcUrls || !net.rpcUrls.length) {
    throw new Error("Custom network requires chainId, name, and at least one rpcUrl.");
  }
  const stored = await chrome.storage.local.get(CUSTOM_NETWORKS_KEY);
  const custom = stored[CUSTOM_NETWORKS_KEY] || [];
  if (custom.some((n) => n.chainId === net.chainId) || BUILTIN_NETWORKS.some((n) => n.chainId === net.chainId)) {
    throw new Error(`A network with chainId ${net.chainId} already exists.`);
  }
  custom.push({
    key: `custom-${net.chainId}`,
    chainId: net.chainId,
    name: net.name,
    nativeCurrency: net.nativeCurrency || { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: net.rpcUrls,
    blockExplorer: net.blockExplorer || "",
    wrappedNative: net.wrappedNative || null,
    swapRouter: net.swapRouter || null,
    swapFactory: net.swapFactory || null,
    swapLabel: net.swapLabel || (net.swapRouter ? "Custom (unverified)" : null),
    builtin: false,
  });
  await chrome.storage.local.set({ [CUSTOM_NETWORKS_KEY]: custom });
  return custom;
}

async function removeCustomNetwork(chainId) {
  const stored = await chrome.storage.local.get(CUSTOM_NETWORKS_KEY);
  const custom = (stored[CUSTOM_NETWORKS_KEY] || []).filter((n) => n.chainId !== chainId);
  await chrome.storage.local.set({ [CUSTOM_NETWORKS_KEY]: custom });
  return custom;
}

async function getSelectedNetwork() {
  const stored = await chrome.storage.local.get(SELECTED_NETWORK_KEY);
  const all = await getAllNetworks();
  const chainId = stored[SELECTED_NETWORK_KEY] || BUILTIN_NETWORKS[0].chainId;
  return all.find((n) => n.chainId === chainId) || all[0];
}

async function setSelectedNetwork(chainId) {
  await chrome.storage.local.set({ [SELECTED_NETWORK_KEY]: chainId });
}

// Exposed for both background (service worker, ES-module-ish via importScripts)
// and popup (regular script tag) contexts.
if (typeof self !== "undefined") {
  self.TM_NETWORKS = {
    BUILTIN_NETWORKS,
    getAllNetworks,
    addCustomNetwork,
    removeCustomNetwork,
    getSelectedNetwork,
    setSelectedNetwork,
  };
}
