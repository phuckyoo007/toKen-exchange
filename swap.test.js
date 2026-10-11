const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserLibs } = require("./helpers/load-libs");

loadBrowserLibs(["ethers.umd.min.js", "swap.js"]);
const S = self.TM_SWAP;
const BN = ethers.BigNumber;

const BASE = { name: "Base", chainId: 8453, swapRouter: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", wrappedNative: "0x4200000000000000000000000000000000000006" };
const TAKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Replaces global fetch for one test, records calls, restores afterwards.
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(url); return impl(url, opts); };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}
const jsonRes = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
const GOOD = { configured: true, ok: true, liquidityAvailable: true, buyAmount: "2000000", minBuyAmount: "1980000", allowanceTarget: "0xabc", transaction: { to: "0x0000000000000000000000000000000000000001", data: "0x1234", value: "0" } };

test("isNative: empty, undefined and the 0xEeee pseudo-address all mean the native coin", () => {
  assert.ok(S.isNative(undefined));
  assert.ok(S.isNative(""));
  assert.ok(S.isNative(S.NATIVE_PSEUDO_ADDRESS));
  assert.ok(S.isNative(S.NATIVE_PSEUDO_ADDRESS.toLowerCase()));
  assert.ok(!S.isNative(USDC));
});

test("applySlippage: 1% off, 0% off, rounds down", () => {
  assert.equal(S.applySlippage(1000, 100).toString(), "990");
  assert.equal(S.applySlippage(1000, 0).toString(), "1000");
  assert.equal(S.applySlippage(999, 100).toString(), "989"); // 989.01 -> 989
  assert.equal(S.applySlippage(BN.from("1000000000000000000"), 50).toString(), "995000000000000000");
});

test("getQuote refuses networks with no verified router", async () => {
  await assert.rejects(
    () => S.getQuote({ network: { name: "Custom" }, provider: null, tokenIn: "", tokenOut: USDC, amountInWei: 1 }),
    /isn.t enabled for Custom/
  );
});

test("executeSwap refuses a network with no wrapped-native address", async () => {
  const signer = new ethers.VoidSigner(TAKER);
  await assert.rejects(
    () => S.executeSwap({ network: { name: "X", swapRouter: BASE.swapRouter }, signer, tokenIn: "", tokenOut: USDC, amountInWei: 1 }),
    /no wrapped-native address/
  );
});

test("tryAggregatorQuote: builds the right request (native mapped to the pseudo address)", async () => {
  await withFetch(async () => jsonRes(GOOD), async (calls) => {
    await S.tryAggregatorQuote({ network: BASE, tokenIn: "", tokenOut: USDC, amountInWei: BN.from("1000000000000000"), taker: TAKER, slippageBps: 50 });
    assert.equal(calls.length, 1);
    const u = new URL(calls[0]);
    assert.equal(u.origin + u.pathname, "https://www.tokenswaphub.org/api/swap-quote");
    assert.equal(u.searchParams.get("chainId"), "8453");
    assert.equal(u.searchParams.get("sellToken"), S.NATIVE_PSEUDO_ADDRESS);
    assert.equal(u.searchParams.get("buyToken"), USDC);
    assert.equal(u.searchParams.get("sellAmount"), "1000000000000000");
    assert.equal(u.searchParams.get("taker"), TAKER);
    assert.equal(u.searchParams.get("slippageBps"), "50");
  });
});

test("tryAggregatorQuote: slippage defaults to 100 bps", async () => {
  await withFetch(async () => jsonRes(GOOD), async (calls) => {
    await S.tryAggregatorQuote({ network: BASE, tokenIn: USDC, tokenOut: "", amountInWei: 5, taker: TAKER });
    assert.equal(new URL(calls[0]).searchParams.get("slippageBps"), "100");
  });
});

test("tryAggregatorQuote: a good response comes back as BigNumbers", async () => {
  await withFetch(async () => jsonRes(GOOD), async () => {
    const q = await S.tryAggregatorQuote({ network: BASE, tokenIn: "", tokenOut: USDC, amountInWei: 1, taker: TAKER });
    assert.equal(q.amountOutWei.toString(), "2000000");
    assert.equal(q.minAmountOutWei.toString(), "1980000");
    assert.equal(q.allowanceTarget, "0xabc");
    assert.equal(q.transaction.data, "0x1234");
  });
});

test("tryAggregatorQuote returns null (never throws) whenever no aggregator route exists", async () => {
  const args = { network: BASE, tokenIn: "", tokenOut: USDC, amountInWei: 1, taker: TAKER };
  const cases = {
    "network error": () => { throw new Error("offline"); },
    "HTTP 500": () => jsonRes(GOOD, false, 500),
    "not configured": () => jsonRes({ configured: false }),
    "no liquidity": () => jsonRes({ configured: true, ok: false, liquidityAvailable: false }),
    "missing transaction": () => jsonRes({ ...GOOD, transaction: undefined }),
    "missing amounts": () => jsonRes({ ...GOOD, buyAmount: undefined }),
    "malformed JSON": () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }),
  };
  for (const [name, impl] of Object.entries(cases)) {
    await withFetch(async () => impl(), async () => {
      assert.equal(await S.tryAggregatorQuote(args), null, name);
    });
  }
});

test("tryAggregatorQuote returns null without a taker, a network, or a chainId (and never calls the API)", async () => {
  await withFetch(async () => jsonRes(GOOD), async (calls) => {
    assert.equal(await S.tryAggregatorQuote({ network: BASE, tokenIn: "", tokenOut: USDC, amountInWei: 1 }), null);
    assert.equal(await S.tryAggregatorQuote({ tokenIn: "", tokenOut: USDC, amountInWei: 1, taker: TAKER }), null);
    assert.equal(await S.tryAggregatorQuote({ network: { name: "x" }, tokenIn: "", tokenOut: USDC, amountInWei: 1, taker: TAKER }), null);
    assert.equal(calls.length, 0);
  });
});

test("executeAggregatorSwap sends exactly the prepared transaction", async () => {
  let sent;
  const signer = { sendTransaction: async (tx) => { sent = tx; return { hash: "0xhash" }; } };
  const out = await S.executeAggregatorSwap({ signer, transaction: { to: "0x0000000000000000000000000000000000000001", data: "0xdead", value: "1000", gas: "210000", gasPrice: "3000000000" } });
  assert.equal(out.hash, "0xhash");
  assert.equal(sent.to, "0x0000000000000000000000000000000000000001");
  assert.equal(sent.data, "0xdead");
  assert.equal(sent.value.toString(), "1000");
  assert.equal(sent.gasLimit.toString(), "210000");
  assert.equal(sent.gasPrice.toString(), "3000000000");
});

test("executeAggregatorSwap omits optional fields that were not provided", async () => {
  let sent;
  const signer = { sendTransaction: async (tx) => { sent = tx; return {}; } };
  await S.executeAggregatorSwap({ signer, transaction: { to: "0x0000000000000000000000000000000000000001", data: "0xdead" } });
  assert.deepEqual(Object.keys(sent).sort(), ["data", "to"]);
});

test("executeAggregatorSwap throws a clear error if the prepared transaction is missing or incomplete", async () => {
  const signer = { sendTransaction: async () => { throw new Error("must not be called"); } };
  await assert.rejects(() => S.executeAggregatorSwap({ signer }), /missing its prepared transaction/);
  await assert.rejects(() => S.executeAggregatorSwap({ signer, transaction: { to: "0x1" } }), /missing its prepared transaction/);
});
