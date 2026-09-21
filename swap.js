// lib/swap.js
// Two ways to get a swap done, tried in this order:
//
// 1. The 0x aggregator, via our own server (see swap-quote-api.js at the
//    repo root for why -- 0x requires an API key that can't live in this
//    client-side file). Shops the trade across many DEXs/liquidity
//    sources for a better price than any single router. tryAggregatorQuote()
//    below is the only thing that talks to it, and it returns null on ANY
//    failure -- not configured yet, no route, network hiccup -- so callers
//    always have a plain, uniform "did this work or not" to check.
// 2. The original direct on-chain path: a single Uniswap-V2-compatible
//    router (getAmountsOut / swapExact...Tokens) configured per network in
//    lib/networks.js. This is the fallback whenever the aggregator can't
//    help, and it's also the ONLY path on a network without a
//    aggregator-supported chain id -- swaps stay enabled there exactly as
//    before.
//
// Both paths are only enabled on networks with a verified `swapRouter`
// address (or one the user has explicitly supplied and confirmed for a
// custom network) -- the aggregator doesn't change that gate, since a
// network with no verified router is a network this wallet has made no
// safety claims about at all.

const NATIVE_PSEUDO_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // convention (matches most aggregator UIs and 0x itself) for "the chain's own coin"

// Deployed alongside the website on Railway -- see swap-quote-api.js at
// the repo root for the server side. Same cross-context pattern as
// MOONPAY_SIGN_ENDPOINT in lib/buy-config.js: the extension has no
// server of its own, so both the website and the extension call this one
// absolute URL.
const SWAP_QUOTE_ENDPOINT = "https://web-wallet-production.up.railway.app/api/swap-quote";

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

function isNative(tokenAddress) {
  return !tokenAddress || tokenAddress.toLowerCase() === NATIVE_PSEUDO_ADDRESS.toLowerCase();
}

// The chain ids this wallet knows about (see lib/networks.js) that 0x's
// Swap API also covers. Checking this client-side too just saves a round
// trip to our own server for a chain it would reject anyway -- the real
// gate is server-side, in swap-quote-api.js.
const AGGREGATOR_CHAIN_IDS = new Set([1, 8453, 137, 56, 42161, 10]);

// Asks our own server (see swap-quote-api.js) for a firm 0x quote, shaped
// so callers never need to know WHY it didn't work: not configured yet,
// unsupported chain, no liquidity for this pair, or a network hiccup all
// come back as a plain `null`, meaning "fall back to the direct router
// path." Only ever called right before a real swap (the quote is firm,
// not indicative, and 0x treats these as more expensive/rate-limited than
// price checks).
async function tryAggregatorQuote({ network, tokenIn, tokenOut, amountInWei, taker, slippageBps }) {
  if (!network || !AGGREGATOR_CHAIN_IDS.has(network.chainId)) return null;
  if (!taker) return null;
  try {
    const params = new URLSearchParams({
      chainId: String(network.chainId),
      sellToken: isNative(tokenIn) ? NATIVE_PSEUDO_ADDRESS : tokenIn,
      buyToken: isNative(tokenOut) ? NATIVE_PSEUDO_ADDRESS : tokenOut,
      sellAmount: ethers.BigNumber.from(amountInWei).toString(),
      taker,
      slippageBps: String(slippageBps || 100),
    });
    const res = await fetch(`${SWAP_QUOTE_ENDPOINT}?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.configured || !data.ok || !data.liquidityAvailable) return null;
    if (!data.transaction || !data.transaction.to || !data.transaction.data || !data.buyAmount) return null;
    return {
      amountOutWei: ethers.BigNumber.from(data.buyAmount),
      minAmountOutWei: ethers.BigNumber.from(data.minBuyAmount || data.buyAmount),
      allowanceTarget: data.allowanceTarget || null,
      transaction: data.transaction,
    };
  } catch (e) {
    return null; // offline, bad JSON, CORS hiccup, etc -- fall back silently
  }
}

// Broadcasts the exact transaction a prior tryAggregatorQuote() call
// returned. Callers are responsible for making sure the quote is still
// fresh and for the same tokenIn/tokenOut/amount they're now executing --
// see the lastSwapRoute matching logic in wallet-engine.js/background.js,
// which never reuses a quote across a different pair or amount.
async function executeAggregatorSwap({ signer, transaction }) {
  const txRequest = { to: transaction.to, data: transaction.data };
  if (transaction.value) txRequest.value = ethers.BigNumber.from(transaction.value);
  if (transaction.gas) txRequest.gasLimit = ethers.BigNumber.from(transaction.gas);
  const tx = await signer.sendTransaction(txRequest);
  return tx;
}

function assertSwapSupported(network) {
  if (!network.swapRouter) {
    throw new Error(
      `Swapping isn't enabled for ${network.name} yet -- there's no verified router configured. ` +
      `Add one for this network in Settings first (see the safety note in lib/networks.js).`
    );
  }
}

function buildPath(network, tokenIn, tokenOut) {
  const inAddr = isNative(tokenIn) ? network.wrappedNative : tokenIn;
  const outAddr = isNative(tokenOut) ? network.wrappedNative : tokenOut;
  if (!inAddr || !outAddr) throw new Error("This network has no wrapped-native address configured; can't route a swap.");
  return [inAddr, outAddr];
}

// provider: ethers.providers.JsonRpcProvider for the active network
async function getQuote({ network, provider, tokenIn, tokenOut, amountInWei }) {
  assertSwapSupported(network);
  const router = new ethers.Contract(network.swapRouter, ROUTER_ABI, provider);
  const path = buildPath(network, tokenIn, tokenOut);
  const amounts = await router.getAmountsOut(amountInWei, path);
  return { amountOutWei: amounts[amounts.length - 1], path };
}

async function getErc20Info(provider, tokenAddress) {
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [decimals, symbol] = await Promise.all([c.decimals(), c.symbol().catch(() => "TOKEN")]);
  return { decimals, symbol };
}

async function getAllowance({ provider, tokenAddress, owner, spender }) {
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return c.allowance(owner, spender);
}

// signer: ethers.Wallet connected to the network provider
async function sendApprove({ signer, tokenAddress, spender, amountWei }) {
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await c.approve(spender, amountWei);
  return tx; // caller awaits tx.wait() if it wants confirmation
}

// Applies slippage tolerance (basis points, e.g. 100 = 1%) to a quoted output.
function applySlippage(amountOutWei, slippageBps) {
  const bn = ethers.BigNumber.from(amountOutWei);
  return bn.mul(10000 - slippageBps).div(10000);
}

// signer: ethers.Wallet connected to the network provider
async function executeSwap({ network, signer, tokenIn, tokenOut, amountInWei, slippageBps = 100, recipient, deadlineSeconds = 600 }) {
  assertSwapSupported(network);
  const router = new ethers.Contract(network.swapRouter, ROUTER_ABI, signer);
  const path = buildPath(network, tokenIn, tokenOut);
  const amounts = await router.getAmountsOut(amountInWei, path);
  const amountOutWei = amounts[amounts.length - 1];
  const amountOutMin = applySlippage(amountOutWei, slippageBps);
  const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
  const to = recipient || (await signer.getAddress());

  let tx;
  if (isNative(tokenIn)) {
    tx = await router.swapExactETHForTokens(amountOutMin, path, to, deadline, { value: amountInWei });
  } else if (isNative(tokenOut)) {
    tx = await router.swapExactTokensForETH(amountInWei, amountOutMin, path, to, deadline);
  } else {
    tx = await router.swapExactTokensForTokens(amountInWei, amountOutMin, path, to, deadline);
  }
  return { tx, quotedAmountOutWei: amountOutWei, minAmountOutWei: amountOutMin };
}

if (typeof self !== "undefined") {
  self.TM_SWAP = {
    NATIVE_PSEUDO_ADDRESS,
    isNative,
    getQuote,
    getErc20Info,
    getAllowance,
    sendApprove,
    executeSwap,
    applySlippage,
    ERC20_ABI,
    tryAggregatorQuote,
    executeAggregatorSwap,
  };
}
