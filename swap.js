// lib/swap.js
// On-chain swap logic using a Uniswap-V2-compatible router (getAmountsOut /
// swapExact...Tokens). No off-chain aggregator API/key needed -- everything
// is a direct read/write against the router contract configured for the
// active network (see lib/networks.js). Swaps are only enabled on networks
// with a verified `swapRouter` address, or one the user has explicitly
// supplied and confirmed for a custom network.

const NATIVE_PSEUDO_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // convention (matches most aggregator UIs) for "the chain's native coin"

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

// Price impact of a trade against a V2-style pool, in basis points (100 = 1%).
// Compares the quoted price for this trade with the quoted price for a tiny
// (1/1000-size) reference trade, which sees almost the un-moved pool price. A big
// number means a thin pool: you'd get far less than the going rate. Returns null
// when it can't be worked out -- it never throws, it's an advisory number only.
async function getPriceImpactBps({ network, provider, tokenIn, tokenOut, amountInWei, amountOutWei }) {
  try {
    const inBn = ethers.BigNumber.from(amountInWei);
    const outBn = ethers.BigNumber.from(amountOutWei);
    const refIn = inBn.div(1000);
    if (inBn.lte(0) || outBn.lte(0) || refIn.lt(1000)) return null;
    const ref = await getQuote({ network, provider, tokenIn, tokenOut, amountInWei: refIn });
    if (ref.amountOutWei.lte(0)) return null;
    const ratioBps = outBn.mul(refIn).mul(10000).div(inBn.mul(ref.amountOutWei)); // 10000 = no impact
    if (ratioBps.gt(20000)) return null; // nonsense from rounding on dust -- don't show
    return Math.max(0, Math.min(10000, 10000 - ratioBps.toNumber()));
  } catch (e) {
    return null;
  }
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

// Slippage tolerance arrives from the UI as basis points (100 = 1%). Missing
// means "use the default"; anything else must be a whole number from 1 to
// 5000. This used to be `msg.slippageBps || 100`, which silently turned an
// explicit 0 (or any falsy value) into 1% and never rejected a nonsense
// value such as -500 or 90000.
const DEFAULT_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 5000;
function normalizeSlippageBps(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_SLIPPAGE_BPS;
  // Only numbers and plain decimal strings count; booleans, arrays, "0x10",
  // "1e2" and the like are rejected rather than coerced.
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLIPPAGE_BPS) {
    throw new Error("Slippage tolerance must be a whole number of basis points from 1 to " + MAX_SLIPPAGE_BPS + ".");
  }
  return n;
}

// Applies slippage tolerance (basis points, e.g. 100 = 1%) to a quoted output.
function applySlippage(amountOutWei, slippageBps) {
  const bn = ethers.BigNumber.from(amountOutWei);
  return bn.mul(10000 - slippageBps).div(10000);
}

const PRICE_MOVED_MESSAGE = "The price moved more than your slippage tolerance since the quote. Nothing was swapped -- get a new quote and try again.";

// Checks, BEFORE anything is paid or sent, that the router would still give
// at least `shown quote - slippage`. Callers run this before taking the app
// fee so a swap that is going to be refused never costs the user a fee.
async function assertQuoteStillHolds({ network, provider, tokenIn, tokenOut, amountInWei, quotedAmountOutWei, slippageBps }) {
  if (quotedAmountOutWei === undefined || quotedAmountOutWei === null) return;
  assertSwapSupported(network);
  const router = new ethers.Contract(network.swapRouter, ROUTER_ABI, provider);
  const amounts = await router.getAmountsOut(amountInWei, buildPath(network, tokenIn, tokenOut));
  const freshOut = amounts[amounts.length - 1];
  if (freshOut.lt(applySlippage(quotedAmountOutWei, normalizeSlippageBps(slippageBps)))) {
    throw new Error(PRICE_MOVED_MESSAGE);
  }
}

// signer: ethers.Wallet connected to the network provider.
// quotedAmountOutWei (optional): the output the user was SHOWN. When given, the
// minimum accepted output is derived from it, not from a fresh quote taken a
// moment before sending -- otherwise the tolerance quietly re-bases on
// whatever the price has become, and the user can receive less than the
// screen promised.
async function executeSwap({ network, signer, tokenIn, tokenOut, amountInWei, slippageBps = DEFAULT_SLIPPAGE_BPS, quotedAmountOutWei, recipient, deadlineSeconds = 600 }) {
  assertSwapSupported(network);
  const router = new ethers.Contract(network.swapRouter, ROUTER_ABI, signer);
  const path = buildPath(network, tokenIn, tokenOut);
  const amounts = await router.getAmountsOut(amountInWei, path);
  const amountOutWei = amounts[amounts.length - 1];
  const hasShownQuote = quotedAmountOutWei !== undefined && quotedAmountOutWei !== null;
  const amountOutMin = applySlippage(hasShownQuote ? quotedAmountOutWei : amountOutWei, normalizeSlippageBps(slippageBps));
  if (amountOutWei.lt(amountOutMin)) throw new Error(PRICE_MOVED_MESSAGE);
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

// ---------------------------------------------------------------- AGGREGATOR
// Client-side wrapper around this project's own backend endpoint
// (/api/swap-quote, see swap-quote-api.js at the repo root), which itself
// proxies to 0x's Swap API (https://api.0x.org/swap/allowance-holder/quote).
// Absolute URL, not a relative fetch -- this file is shared between the
// website and the Chrome extension, and a relative "/api/..." path only
// resolves correctly on the website's own origin (see the same pattern in
// lib/transak-config.js and lib/coinbase-onramp-config.js).
//
// Was previously called from wallet-engine.js's TM_SWAP_QUOTE handler but
// never actually defined here -- every swap attempt with a selected account
// was throwing "TM_SWAP.tryAggregatorQuote is not a function" before ever
// reaching the plain router quote below, which is why swaps were failing
// across the board (not just for illiquid/custom tokens like a freshly
// deployed one 0x has no route for).
//
// Returns null whenever an aggregator-routed quote isn't available for any
// reason at all (feature not configured, no liquidity/route for this pair,
// an unsupported chain, a bad response, or any network failure) -- this
// function NEVER throws. The caller relies on that: a null return means
// "fall back to the plain on-chain router quote" (getQuote() above), which
// is also exactly the right behavior for a token 0x has no liquidity data
// for at all.
const SWAP_QUOTE_ENDPOINT = "https://web-wallet-production.up.railway.app/api/swap-quote";

async function tryAggregatorQuote({ network, tokenIn, tokenOut, amountInWei, taker, slippageBps = DEFAULT_SLIPPAGE_BPS }) {
  try {
    if (!network || !network.chainId || !taker) return null;
    const sellToken = isNative(tokenIn) ? NATIVE_PSEUDO_ADDRESS : tokenIn;
    const buyToken = isNative(tokenOut) ? NATIVE_PSEUDO_ADDRESS : tokenOut;
    const params = new URLSearchParams({
      chainId: String(network.chainId),
      sellToken,
      buyToken,
      sellAmount: amountInWei.toString(),
      taker,
      slippageBps: String(slippageBps),
    });
    let res;
    try {
      res = await fetch(`${SWAP_QUOTE_ENDPOINT}?${params.toString()}`);
    } catch (e) {
      return null; // offline/unreachable -- just fall back to the router quote
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.configured || !data.ok || !data.liquidityAvailable) return null;
    if (!data.transaction || !data.buyAmount || !data.minBuyAmount) return null;
    return {
      allowanceTarget: data.allowanceTarget || null,
      transaction: data.transaction,
      amountOutWei: ethers.BigNumber.from(data.buyAmount),
      minAmountOutWei: ethers.BigNumber.from(data.minBuyAmount),
    };
  } catch (e) {
    return null; // never let an aggregator hiccup break the whole swap flow
  }
}

// Broadcasts the raw transaction the backend's /api/swap-quote call already
// prepared via 0x (transaction.to/data/value/gas/gasPrice, saved on
// lastSwapRoute.transaction by TM_SWAP_QUOTE) -- this is what actually
// carries out an aggregator-routed swap once TM_SWAP_ALLOWANCE/
// TM_SWAP_APPROVE have made sure the sell token is approved for
// lastSwapRoute.spender. Was called from wallet-engine.js's TM_SWAP_EXECUTE
// case but, like tryAggregatorQuote above, never actually defined here --
// every aggregator-quoted swap was silently falling through to a plain
// router execution (see the try/catch around this call in TM_SWAP_EXECUTE)
// while still being charged the higher aggregator fee rate, since that fee
// is sent before this call happens. Fixing this means that fallback goes
// back to being the rare edge case it was designed for (a stale quote/gas
// mismatch) instead of the thing that happens on every single aggregator
// swap.
//
// signer: ethers.Wallet connected to the network provider
async function executeAggregatorSwap({ signer, transaction }) {
  if (!transaction || !transaction.to || !transaction.data) {
    throw new Error("Aggregator swap is missing its prepared transaction -- request a fresh quote and try again.");
  }
  const txRequest = { to: transaction.to, data: transaction.data };
  if (transaction.value) txRequest.value = ethers.BigNumber.from(transaction.value);
  if (transaction.gas) txRequest.gasLimit = ethers.BigNumber.from(transaction.gas);
  if (transaction.gasPrice) txRequest.gasPrice = ethers.BigNumber.from(transaction.gasPrice);
  return signer.sendTransaction(txRequest); // caller awaits tx.wait() if it wants confirmation, same as executeSwap() above
}

if (typeof self !== "undefined") {
  self.TM_SWAP = {
    NATIVE_PSEUDO_ADDRESS,
    isNative,
    getQuote,
    getPriceImpactBps,
    getErc20Info,
    getAllowance,
    sendApprove,
    executeSwap,
    applySlippage,
    normalizeSlippageBps,
    assertQuoteStillHolds,
    tryAggregatorQuote,
    executeAggregatorSwap,
    ERC20_ABI,
  };
}
