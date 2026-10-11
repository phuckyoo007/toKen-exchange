// explore-ui.js: the wallet conveniences shared by the website and the extension popup.
// Checks the pure pieces (sorting, payment links, receipts), that every wording key the
// module asks for exists in all nine languages, and that both pages and the server load it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT } = require("./helpers/load-libs");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const src = read("explore-ui.js");

function load(globals) {
  const win = {};
  const doc = { readyState: "complete", getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const ctx = vm.createContext(Object.assign({ window: win, document: doc, console }, globals || {}));
  vm.runInContext(src, ctx, { filename: "explore-ui.js" });
  return { api: win.TM_EXPLORE, ctx };
}

test("loads cleanly on a page where none of its anchor elements exist", () => {
  const { api } = load();
  assert.ok(api && typeof api.sortMarkets === "function");
});

const MARKETS = [
  { symbol: "A", change24h: 1.5, volume: 10 },
  { symbol: "B", change24h: -4, volume: 500 },
  { symbol: "C", change24h: null, volume: null },
  { symbol: "D", change24h: 9, volume: 50 },
];

test("sortMarkets: top keeps the order; gainers, losers and volume sort with missing data last", () => {
  const { api, ctx } = load({ predictionsTab: "top" });
  assert.deepEqual(api.sortMarkets(MARKETS).map((m) => m.symbol), ["A", "B", "C", "D"]);
  api.setSortMode("gainers");
  assert.deepEqual(api.sortMarkets(MARKETS).map((m) => m.symbol), ["D", "A", "B", "C"]);
  api.setSortMode("losers");
  assert.deepEqual(api.sortMarkets(MARKETS).map((m) => m.symbol), ["B", "A", "D", "C"]);
  api.setSortMode("volume");
  assert.deepEqual(api.sortMarkets(MARKETS).map((m) => m.symbol), ["B", "D", "A", "C"]);
  assert.deepEqual(MARKETS.map((m) => m.symbol), ["A", "B", "C", "D"], "the input array is not mutated");
  ctx.predictionsTab = "stable";
  assert.deepEqual(api.sortMarkets(MARKETS).map((m) => m.symbol), ["A", "B", "C", "D"], "only the top-coins tab is re-sorted");
});

const ME = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

test("buildPaymentLink makes EIP-681 links for the coin and for a token", () => {
  const { api } = load();
  assert.equal(api.buildPaymentLink({ address: null }, ME, 8453, null), "ethereum:" + ME + "@8453");
  assert.equal(api.buildPaymentLink({ address: null }, ME, 1, "1500000000000000000"), "ethereum:" + ME + "@1?value=1500000000000000000");
  assert.equal(api.buildPaymentLink({ address: USDC }, ME, 8453, "2500000"), "ethereum:" + USDC + "@8453/transfer?address=" + ME + "&uint256=2500000");
  assert.equal(api.buildPaymentLink({ address: USDC }, ME, 8453, null), "ethereum:" + USDC + "@8453/transfer?address=" + ME);
});

test("receiptText lists what happened, to whom, and the transaction", () => {
  const { api } = load();
  const out = api.receiptText({ direction: "out", amount: "0.5", asset: "ETH", to: ME, txHash: "0xabc", ts: 0, networkName: "Base" }, "https://basescan.org/tx/0xabc");
  assert.match(out, /Token Exchange receipt/);
  assert.match(out, /0\.5/);
  assert.ok(out.includes(ME) && out.includes("Base") && out.includes("0xabc") && out.includes("https://basescan.org/tx/0xabc"));
  const inc = api.receiptText({ direction: "in", amount: "3", asset: "USDC", ts: 0 }, null);
  assert.ok(!inc.includes("To:"), "an incoming entry has no recipient line");
});

test("every explore.* key the module asks for exists in all nine languages with matching placeholders", () => {
  const keys = new Set([...src.matchAll(/\btr\(\s*"(explore\.[\w.]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith(".")));
  for (const m of src.matchAll(/"(explore\.cat\.)" \+ a\[2\]/g)) ["swap", "lending", "staking", "nft", "names", "bridge", "explorer"].forEach((c) => keys.add(m[1] + c));
  assert.ok(keys.size > 40, "found the keys the module uses");
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
  const LANGS = ["en", "es", "fr", "pt", "ru", "zh", "ja", "hi", "ar"];
  globalThis.self = globalThis;
  for (const l of LANGS) vm.runInThisContext(read(l + ".js"), { filename: l + ".js" });
  const load2 = (l) => globalThis.TM_I18N_DATA[l].strings;
  const EN = load2("en");
  for (const k of keys) assert.ok(k in EN, "en.js is missing " + k);
  for (const l of ["es", "fr", "pt", "ru", "zh", "ja", "hi", "ar"]) {
    const S = load2(l);
    for (const k of keys) {
      assert.ok(k in S, l + ".js is missing " + k);
      assert.equal(ph(S[k]), ph(EN[k]), l + ":" + k + " placeholders differ");
    }
  }
});

test("both pages, the service worker and the server load lib/explore-ui.js", () => {
  assert.ok(read("index.html").includes('src="lib/explore-ui.js"'));
  assert.ok(read("popup.html").includes('src="../lib/explore-ui.js"'));
  assert.ok(read("sw.js").includes('"/lib/explore-ui.js"'));
  assert.ok(/"explore-ui\.js"/.test(read("server.js")), "server.js LIB_FILES must list explore-ui.js");
});
