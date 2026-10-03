// The swap UI, the website engine and the extension worker must stay wired together:
// the quote the user saw is sent with the swap, slippage is validated, and a 0x
// route is only reused for the slippage it was quoted with.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/load-libs");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("both UIs send the quote they showed along with TM_SWAP_EXECUTE", () => {
  for (const f of ["app.js", "popup.js"]) {
    assert.match(read(f), /TM_SWAP_EXECUTE",\s*\{[^}]*quotedAmountOutWei: ds\.amountOutWei/, f);
  }
});

test("no handler falls back to `msg.slippageBps || 100` (it hid 0 and skipped validation)", () => {
  for (const f of ["background.js", "wallet-engine.js"]) {
    assert.ok(!/msg\.slippageBps \|\| 100/.test(read(f)), f + " still uses the unchecked fallback");
    assert.match(read(f), /normalizeSlippageBps\(msg\.slippageBps\)/, f);
  }
});

test("a saved 0x route is only reused for the slippage it was quoted with", () => {
  const src = read("wallet-engine.js");
  assert.match(src, /route\.slippageBps === slippageBps/);
  assert.match(src, /slippageBps: quoteSlippageBps,\s*\n\s*spender/);
  assert.match(src, /aggregatorRouteMatches\(lastSwapRoute, network, msg\.tokenIn, msg\.tokenOut, aggNetWei, execSlippageBps\)/);
});

test("the website asks for a new quote when slippage changes, and sends it with the quote request", () => {
  const src = read("app.js");
  assert.match(src, /swap-slippage"\)\.addEventListener\("change",[\s\S]*?clearSwapQuote\(\);[\s\S]*?scheduleSwapAutoQuote\(\)/);
  assert.match(src, /"TM_SWAP_QUOTE", \{[^}]*slippageBps: Number\(\$\("swap-slippage"\)\.value\)/);
});
