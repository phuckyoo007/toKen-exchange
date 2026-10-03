// Slippage handling in swap.js: validation, and "the minimum you accept comes
// from the quote you were shown", not from a fresh quote taken at send time.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserLibs } = require("./helpers/load-libs");

loadBrowserLibs(["ethers.umd.min.js", "swap.js"]);
const S = self.TM_SWAP;
const BN = ethers.BigNumber;

const NET = { name: "Base", chainId: 8453, swapRouter: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", wrappedNative: "0x4200000000000000000000000000000000000006" };
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// A real ethers Contract talking to a fake chain: eth_call answers getAmountsOut
// with [amountIn, freshOut], and the signer records the swap it is asked to send.
const ROUTER_IFACE = new ethers.utils.Interface([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])",
]);
async function withRouter(freshOut, fn) {
  const provider = new ethers.providers.StaticJsonRpcProvider("http://127.0.0.1:1", { chainId: 8453, name: "base" });
  provider.send = async (method, params) => {
    if (method !== "eth_call") throw new Error("unexpected rpc call: " + method);
    // The only view call is getAmountsOut(amountIn, path): echo amountIn, return freshOut.
    const [amountIn] = ethers.utils.defaultAbiCoder.decode(["uint256", "address[]"], "0x" + params[0].data.slice(10));
    return ethers.utils.defaultAbiCoder.encode(["uint256[]"], [[amountIn, freshOut]]);
  };
  const sent = [];
  class FakeSigner extends ethers.Signer {
    constructor() { super(); ethers.utils.defineReadOnly(this, "provider", provider); }
    async getAddress() { return "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; }
    async signMessage() { throw new Error("n/a"); }
    async signTransaction() { throw new Error("n/a"); }
    connect() { return this; }
    async sendTransaction(tx) {
      const [minOut] = ROUTER_IFACE.decodeFunctionData("swapExactETHForTokens", tx.data);
      sent.push({ minOut: minOut.toString() });
      return { hash: "0xabc", wait: async () => ({ status: 1 }) };
    }
  }
  await fn({ signer: new FakeSigner(), provider, sent });
}

test("normalizeSlippageBps: missing means the 1% default", () => {
  for (const v of [undefined, null, ""]) assert.equal(S.normalizeSlippageBps(v), 100);
});

test("normalizeSlippageBps: accepts whole numbers 1..5000, including numeric strings", () => {
  assert.equal(S.normalizeSlippageBps(50), 50);
  assert.equal(S.normalizeSlippageBps("300"), 300);
  assert.equal(S.normalizeSlippageBps(5000), 5000);
});

test("normalizeSlippageBps: an explicit 0 is rejected, not silently turned into 1%", () => {
  assert.throws(() => S.normalizeSlippageBps(0), /Slippage/);
});

test("normalizeSlippageBps: negatives, fractions, huge values and junk are rejected", () => {
  for (const bad of [-1, -500, 0.5, 5001, 90000, NaN, "abc", {}, [], true]) {
    assert.throws(() => S.normalizeSlippageBps(bad), /Slippage/, String(JSON.stringify(bad)));
  }
});

test("executeSwap: the minimum output comes from the quote the user was shown", async () => {
  // Shown 1000, price drifted up to 1100: min is still 1% under what was SHOWN.
  await withRouter(1100, async ({ signer, sent }) => {
    const r = await S.executeSwap({ network: NET, signer, tokenIn: "", tokenOut: USDC, amountInWei: 5, slippageBps: 100, quotedAmountOutWei: 1000 });
    assert.equal(r.minAmountOutWei.toString(), "990");
    assert.equal(sent[0].minOut, "990");
  });
});

test("executeSwap: with no shown quote it still falls back to the fresh quote", async () => {
  await withRouter(2000, async ({ signer }) => {
    const r = await S.executeSwap({ network: NET, signer, tokenIn: "", tokenOut: USDC, amountInWei: 5, slippageBps: 100 });
    assert.equal(r.minAmountOutWei.toString(), "1980");
  });
});

test("executeSwap: refuses, without sending, when the price already fell past the tolerance", async () => {
  await withRouter(900, async ({ signer, sent }) => {
    await assert.rejects(
      () => S.executeSwap({ network: NET, signer, tokenIn: "", tokenOut: USDC, amountInWei: 5, slippageBps: 100, quotedAmountOutWei: 1000 }),
      /price moved/i
    );
    assert.equal(sent.length, 0);
  });
});

test("executeSwap: an invalid slippage is rejected before anything is sent", async () => {
  await withRouter(1000, async ({ signer, sent }) => {
    for (const bad of [0, -5, 99999]) {
      await assert.rejects(() => S.executeSwap({ network: NET, signer, tokenIn: "", tokenOut: USDC, amountInWei: 5, slippageBps: bad }), /Slippage/);
    }
    assert.equal(sent.length, 0);
  });
});

test("assertQuoteStillHolds: passes inside the tolerance, throws outside it, skips with no shown quote", async () => {
  const base = { network: NET, tokenIn: "", tokenOut: USDC, amountInWei: 5, slippageBps: 100 };
  await withRouter(995, async ({ provider }) => { await S.assertQuoteStillHolds({ ...base, provider, quotedAmountOutWei: 1000 }); });
  await withRouter(980, async ({ provider }) => {
    await assert.rejects(() => S.assertQuoteStillHolds({ ...base, provider, quotedAmountOutWei: 1000 }), /price moved/i);
  });
  await withRouter(1, async ({ provider }) => { await S.assertQuoteStillHolds({ ...base, provider }); });
});

test("tryAggregatorQuote sends the slippage it was given to the quote endpoint", async () => {
  const real = globalThis.fetch;
  let url = "";
  globalThis.fetch = async (u) => { url = u; return { ok: false, status: 500, json: async () => null }; };
  try {
    await S.tryAggregatorQuote({ network: NET, tokenIn: "", tokenOut: USDC, amountInWei: 5, taker: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", slippageBps: 50 });
  } finally { globalThis.fetch = real; }
  assert.match(url, /slippageBps=50(&|$)/);
});
