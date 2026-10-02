const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadBrowserLibs } = require("./helpers/load-libs");

loadBrowserLibs(["ethers.umd.min.js", "known-tokens.js"]);
const K = self.TM_KNOWN_TOKENS;

// Chain ids the wallet ships with, read straight from networks.js.
const builtinChainIds = new Set([...fs.readFileSync(path.join(ROOT, "networks.js"), "utf8").matchAll(/^\s*chainId:\s*(\d+),/gm)].map((m) => Number(m[1])));

test("every address is a valid, correctly-checksummed EVM address", () => {
  for (const [chain, list] of Object.entries(K.byChain)) {
    for (const t of list) assert.equal(ethers.utils.getAddress(t.address), t.address, `${t.symbol} on ${chain}`);
  }
});

test("only wallet networks, only the three verified symbols, no duplicates", () => {
  const seen = new Set();
  for (const [chain, list] of Object.entries(K.byChain)) {
    assert.ok(builtinChainIds.has(Number(chain)), "chain " + chain + " is not a built-in network");
    const symbols = new Set();
    for (const t of list) {
      assert.ok(["USDC", "USDT", "EURC"].includes(t.symbol), t.symbol);
      assert.ok(!symbols.has(t.symbol), `duplicate ${t.symbol} on ${chain}`);
      symbols.add(t.symbol);
      const id = chain + ":" + t.address.toLowerCase();
      assert.ok(!seen.has(id));
      seen.add(id);
    }
  }
});

test("pinned to the issuers' published addresses (Circle, Tether)", () => {
  const by = (chain, sym) => K.byChain[chain].find((t) => t.symbol === sym)?.address;
  assert.equal(by(1, "USDC"), "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(by(1, "USDT"), "0xdAC17F958D2ee523a2206206994597C13D831ec7");
  assert.equal(by(1, "EURC"), "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c");
  assert.equal(by(8453, "USDC"), "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(by(8453, "EURC"), "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42");
  assert.equal(by(43114, "USDT"), "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7");
});

test("USDT is only listed where Tether publishes it", () => {
  const withUsdt = Object.keys(K.byChain).filter((c) => K.byChain[c].some((t) => t.symbol === "USDT")).map(Number).sort((a, b) => a - b);
  assert.deepEqual(withUsdt, [1, 42220, 43114]);
});

test("forChain returns a copy and [] for unknown chains", () => {
  assert.deepEqual(K.forChain(999999), []);
  const a = K.forChain(1);
  a.pop();
  assert.equal(K.forChain(1).length, 3);
});

test("suggested() skips held tokens, the other side of the swap, and filters by query", () => {
  const usdc = K.byChain[1][0].address;
  const usdt = K.byChain[1][1].address;
  assert.deepEqual(K.suggested(1).map((t) => t.symbol), ["USDC", "USDT", "EURC"]);
  assert.deepEqual(K.suggested(1, { heldAddresses: [usdc.toLowerCase()] }).map((t) => t.symbol), ["USDT", "EURC"]);
  assert.deepEqual(K.suggested(1, { excludeAddress: usdt }).map((t) => t.symbol), ["USDC", "EURC"]);
  assert.deepEqual(K.suggested(1, { query: "eur" }).map((t) => t.symbol), ["EURC"]);
  assert.deepEqual(K.suggested(1, { query: "tether" }).map((t) => t.symbol), ["USDT"]);
  assert.deepEqual(K.suggested(137, { heldAddresses: [K.byChain[137][0].address] }), []);
});

// ---- renderQuickAddChips (ui-common.js), run against a tiny fake DOM
const vm = require("node:vm");
function fakeEl() {
  const el = { children: [], className: "", textContent: "", innerHTML: "", title: "", type: "", listeners: {}, _hidden: false };
  el.classList = { toggle: (c, on) => { if (c === "hidden") el._hidden = !!on; } };
  el.appendChild = (c) => { el.children.push(c); return c; };
  el.addEventListener = (e, fn) => { el.listeners[e] = fn; };
  return el;
}
function runChips(chainId) {
  const box = fakeEl();
  const ctx = {
    document: { createElement: fakeEl, getElementById: () => box },
    TM_I18N: { t: (k) => ({ "addToken.quickAddLabel": "Quick add:", "addToken.quickAddChip": "+ {symbol}" }[k]) },
    TM_KNOWN_TOKENS: K,
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "ui-common.js"), "utf8"), ctx);
  const picked = [];
  ctx.renderQuickAddChips(chainId, (t) => picked.push(t));
  return { box, picked };
}

test("quick-add chips: one per verified token, tap reports that token, hidden when none", () => {
  const { box, picked } = runChips(1);
  assert.equal(box._hidden, false);
  const chips = box.children.filter((c) => c.className === "quick-add-chip");
  assert.deepEqual(chips.map((c) => c.textContent), ["+ USDC", "+ USDT", "+ EURC"]);
  chips[1].listeners.click();
  assert.equal(picked[0].address, "0xdAC17F958D2ee523a2206206994597C13D831ec7");

  const none = runChips(534352); // Scroll: no issuer-published tokens
  assert.equal(none.box._hidden, true);
  assert.equal(none.box.children.length, 0);
});
