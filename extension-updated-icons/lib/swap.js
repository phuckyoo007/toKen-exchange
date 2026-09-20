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
  };
}
