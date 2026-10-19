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
  // Keys chosen by variable (frequency titles, activity lines) rather than a literal tr("...") call.
  for (const m of src.matchAll(/"(explore\.(?:rem|sum|alert|pulse|coll|fav|range)[A-Za-z]+)"/g)) keys.add(m[1]);
  keys.add("predictions.tabTrending");
  assert.ok(keys.size > 80, "found the keys the module uses");
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

test("convertAmount and formatConverted", () => {
  const { api } = load();
  const usd = { symbol: "USD", price: 1 }, eth = { symbol: "ETH", price: 2000 }, btc = { symbol: "BTC", price: 60000 };
  assert.equal(api.convertAmount(1, eth, usd), 2000);
  assert.equal(api.convertAmount(30, eth, btc), 1);
  assert.equal(api.convertAmount(1, eth, { symbol: "X", price: 0 }), null, "no price, no answer");
  assert.equal(api.convertAmount(NaN, eth, usd), null);
  assert.equal(api.formatConverted(1234.5678), "1,234.57");
  assert.equal(api.formatConverted(2.5), "2.5");
  assert.equal(api.formatConverted(0.000123), "0.000123");
  assert.equal(api.formatConverted(0), "0");
  assert.equal(api.formatConverted(Infinity), "");
});

test("advanceReminder moves past now; dueReminders ignores future and malformed ones", () => {
  const { api } = load();
  const J = (v) => JSON.parse(JSON.stringify(v));
  const day = 864e5;
  const t0 = Date.UTC(2026, 0, 31, 12);
  const w = api.advanceReminder({ id: "a", freq: "weekly", next: t0 }, t0 + 15 * day);
  assert.equal(w.next, t0 + 21 * day, "three weekly steps lands after now");
  const b = api.advanceReminder({ id: "b", freq: "biweekly", next: t0 }, t0 + 1);
  assert.equal(b.next, t0 + 14 * day);
  const m = api.advanceReminder({ id: "c", freq: "monthly", next: t0 }, t0 + 1);
  assert.ok(m.next > t0 + 27 * day && m.next < t0 + 32 * day);
  const list = [{ id: "1", freq: "weekly", next: t0 + 5 }, { id: "2", freq: "weekly", next: t0 - 5 }, { id: "3", freq: "bogus", next: t0 - 9 }, null];
  assert.deepEqual(J(api.dueReminders(list, t0).map((r) => r.id)), ["2"]);
  assert.deepEqual(J(api.dueReminders("nope", t0)), []);
});

test("portfolio history: points are spaced, capped and summarised as a percent", () => {
  const { api } = load();
  const J = (v) => JSON.parse(JSON.stringify(v));
  const H = 3600 * 1000;
  let pts = api.addHistoryPoint([], 0, 100, 5);
  pts = api.addHistoryPoint(pts, 1 * H, 110, 5);
  assert.equal(pts.length, 1, "a second reading inside six hours replaces the first");
  assert.deepEqual(J(pts[0]), [0, 110]);
  pts = api.addHistoryPoint(pts, 7 * H, 121, 5);
  assert.equal(pts.length, 2);
  assert.deepEqual(J(api.addHistoryPoint(pts, 99 * H, 0, 5)), J(pts), "a zero or missing total is never recorded");
  assert.deepEqual(J(api.addHistoryPoint(pts, 99 * H, NaN, 5)), J(pts));
  let many = [];
  for (let i = 0; i < 10; i++) many = api.addHistoryPoint(many, i * 10 * H, 100 + i, 4);
  assert.equal(many.length, 4);
  const day = 864e5;
  const ch = api.historyChange([[0, 100], [10 * day, 125]], 12 * day, 30 * day);
  assert.equal(Math.round(ch.pct * 100) / 100, 25);
  assert.equal(api.historyChange([[0, 100]], day, 30 * day), null, "one point is not a trend");
  assert.equal(api.historyChange([[0, 100], [40 * day, 110]], 41 * day, 30 * day), null, "old points fall out of the window");
});

test("sciToInt reads whole numbers, including scientific notation, and refuses fractions", () => {
  const { api } = load();
  assert.equal(api.sciToInt("1500000"), "1500000");
  assert.equal(api.sciToInt("1.5e18"), "1500000000000000000");
  assert.equal(api.sciToInt("2e6"), "2000000");
  assert.equal(api.sciToInt("1e0"), "1");
  assert.equal(api.sciToInt("0.5"), null);
  assert.equal(api.sciToInt("1.234e2"), null, "1.234e2 is 123.4, not whole");
  assert.equal(api.sciToInt("abc"), null);
  assert.equal(api.sciToInt("-5"), null);
  assert.equal(api.sciToInt("1e90"), null, "absurdly large values are refused");
});

test("parsePaymentLink understands EIP-681 coin and token links and rejects junk", () => {
  const { api } = load();
  assert.deepEqual(JSON.parse(JSON.stringify(api.parsePaymentLink(ME))), { to: ME, chainId: null });
  const coin = api.parsePaymentLink("ethereum:" + ME + "@8453?value=2.5e17");
  assert.equal(coin.to, ME);
  assert.equal(coin.chainId, 8453);
  assert.equal(coin.valueWei, "250000000000000000");
  assert.equal(api.parsePaymentLink("ethereum:pay-" + ME + "@1").to, ME);
  const tok = api.parsePaymentLink("ethereum:" + USDC + "@8453/transfer?address=" + ME + "&uint256=2500000");
  assert.equal(tok.token, USDC);
  assert.equal(tok.to, ME);
  assert.equal(tok.units, "2500000");
  assert.equal(api.parsePaymentLink("ethereum:" + USDC + "@8453/transfer"), null, "a transfer needs a recipient");
  assert.equal(api.parsePaymentLink("ethereum:" + ME + "/approve?address=" + ME), null, "only plain sends and transfers");
  assert.equal(api.parsePaymentLink("ethereum:" + ME + "?value=0.5"), null);
  assert.equal(api.parsePaymentLink("https://example.com/pay"), null);
  assert.equal(api.parsePaymentLink(""), null);
  assert.equal(api.parsePaymentLink("ethereum:" + ME + "?value=%E0%A4%A"), null, "bad escapes do not throw");
});

test("summarizeActivity counts only this month, split by direction, and sums per coin", () => {
  const { api } = load();
  const now = new Date(2026, 9, 15, 12).getTime();
  const inMonth = (d) => new Date(2026, 9, d, 9).getTime();
  const list = [
    { ts: inMonth(2), direction: "out", amount: "0.5", asset: "ETH" },
    { ts: inMonth(3), direction: "out", amount: "0.25", asset: "ETH" },
    { ts: inMonth(4), direction: "in", amount: "100", asset: "USDC" },
    { ts: new Date(2026, 8, 30, 9).getTime(), direction: "out", amount: "9", asset: "ETH" },
    { ts: inMonth(5), direction: "out", amount: "junk", asset: "DAI" },
    null,
  ];
  const s = api.summarizeActivity(list, now);
  assert.equal(s.sent.count, 3);
  assert.equal(s.sent.by.ETH, 0.75);
  assert.ok(!("DAI" in s.sent.by), "an unreadable amount is counted but not summed");
  assert.equal(s.recv.count, 1);
  assert.equal(s.recv.by.USDC, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(api.summarizeActivity(undefined, now))), { sent: { count: 0, by: {} }, recv: { count: 0, by: {} } });
});

test("the QR scanner hands ethereum: links to the payment-link filler", () => {
  const extras = read("extras.js");
  assert.ok(/TM_EXPLORE\.applyPaymentLink/.test(extras));
});

test("marketPulse totals the list: cap, cap-weighted 24h move, BTC/ETH share, breadth", () => {
  const { api } = load();
  const J = (v) => JSON.parse(JSON.stringify(v));
  const rows = [
    { symbol: "BTC", marketCap: 600, change24h: 10 },
    { symbol: "ETH", marketCap: 300, change24h: -10 },
    { symbol: "XRP", marketCap: 100, change24h: 0 },
    { symbol: "ODD", marketCap: null, change24h: 50 },
  ];
  const p = J(api.marketPulse(rows));
  assert.equal(p.count, 3, "a coin with no market cap is left out");
  assert.equal(p.cap, 1000);
  assert.equal(p.btc, 60);
  assert.equal(p.eth, 30);
  assert.equal(p.up, 1);
  assert.equal(p.down, 1);
  // before: 600/1.1 + 300/0.9 + 100 = 545.45 + 333.33 + 100 = 978.79; now 1000 -> +2.17%
  assert.ok(Math.abs(p.change - 2.1672) < 0.01, "change was " + p.change);
  assert.equal(api.marketPulse([rows[0]]), null, "one coin is not a market");
  assert.equal(api.marketPulse(undefined), null);
  const noChange = J(api.marketPulse([{ symbol: "A", marketCap: 5 }, { symbol: "B", marketCap: 5 }]));
  assert.equal(noChange.change, null);
  assert.equal(noChange.btc, null);
});

test("sortMarkets can sort by market cap", () => {
  const { api } = load({ predictionsTab: "top" });
  const rows = [{ symbol: "A", marketCap: 5 }, { symbol: "B", marketCap: 50 }, { symbol: "C", marketCap: null }];
  api.setSortMode("cap");
  assert.deepEqual(api.sortMarkets(rows).map((m) => m.symbol), ["B", "A", "C"]);
});

test("parseAlertValue accepts positive numbers and caps percentages", () => {
  const { api } = load();
  assert.equal(api.parseAlertValue("3000", "above"), 3000);
  assert.equal(api.parseAlertValue(" 0,5 ", "below"), 0.5);
  assert.equal(api.parseAlertValue("5", "move"), 5);
  assert.equal(api.parseAlertValue("1000", "move"), 1000);
  assert.equal(api.parseAlertValue("1001", "move"), null);
  for (const bad of ["", "0", "-3", "abc", "1e5", "1.2.3", null, undefined]) assert.equal(api.parseAlertValue(bad, "above"), null, String(bad));
});

test("alertState: above, below and percent-move alerts fire at the right price", () => {
  const { api } = load();
  assert.equal(api.alertState({ kind: "above", value: 100 }, 100), "hit");
  assert.equal(api.alertState({ kind: "above", value: 100 }, 99.9), "wait");
  assert.equal(api.alertState({ kind: "below", value: 100 }, 100), "hit");
  assert.equal(api.alertState({ kind: "below", value: 100 }, 100.1), "wait");
  const mv = { kind: "move", value: 5, base: 200 };
  assert.equal(api.alertState(mv, 209.9), "wait");
  assert.equal(api.alertState(mv, 210), "hit");
  assert.equal(api.alertState(mv, 190), "hit", "a fall counts too");
  assert.equal(api.alertState(mv, 195), "wait");
  assert.equal(api.alertState({ kind: "move", value: 5 }, 300), "wait", "no starting price, no alert");
  assert.equal(api.alertState({ kind: "above", value: 1 }, null), "wait");
  assert.equal(api.alertState({ kind: "weird", value: 1 }, 5), "wait");
  assert.equal(api.alertState(null, 5), "wait");
});

test("trendingIdsFrom keeps clean, unique CoinGecko ids in order", () => {
  const vm2 = require("node:vm");
  const ctx = vm2.createContext({ self: {}, console, fetch: async () => ({ ok: false }), AbortController, setTimeout, clearTimeout });
  vm2.runInContext(read("prices.js"), ctx, { filename: "prices.js" });
  const P = ctx.self.TM_PRICES;
  assert.equal(typeof P.getTrendingCoins, "function");
  assert.equal(typeof P.getCoinPrices, "function");
  const ids = P.trendingIdsFrom({ coins: [{ item: { id: "pepe" } }, { item: { id: "bad id!" } }, { item: { id: "pepe" } }, { item: {} }, null, { item: { id: "sui" } }] });
  assert.deepEqual(JSON.parse(JSON.stringify(ids)), ["pepe", "sui"]);
  assert.deepEqual(JSON.parse(JSON.stringify(P.trendingIdsFrom(null))), []);
  const many = { coins: Array.from({ length: 30 }, (_, i) => ({ item: { id: "coin-" + i } })) };
  assert.equal(P.trendingIdsFrom(many).length, 15, "capped at 15");
});

test("the Trending tab exists on both pages and is wired in both scripts", () => {
  for (const f of ["index.html", "popup.html"]) assert.ok(read(f).includes('id="pred-tab-trending"'), f);
  for (const f of ["app.js", "popup.js"]) {
    const t = read(f);
    assert.ok(t.includes('"pred-tab-trending"') && t.includes("getTrendingCoins"), f);
  }
});

test("getCoinPrices never throws and ignores junk ids", async () => {
  const vm2 = require("node:vm");
  const calls = [];
  const ctx = vm2.createContext({ self: {}, console, AbortController, setTimeout, clearTimeout,
    fetch: async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ bitcoin: { usd: 65000 }, ethereum: { usd: "x" } }) }; } });
  vm2.runInContext(read("prices.js"), ctx, { filename: "prices.js" });
  const P = ctx.self.TM_PRICES;
  const m = await P.getCoinPrices(["bitcoin", "ethereum", "Bad Id", "bitcoin"], "usd");
  assert.equal(m.get("bitcoin"), 65000);
  assert.ok(!m.has("ethereum"));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("ids=bitcoin%2Cethereum") && !calls[0].includes("Bad"));
  const down = vm2.createContext({ self: {}, console, AbortController, setTimeout, clearTimeout, fetch: async () => { throw new Error("offline"); } });
  vm2.runInContext(read("prices.js"), down, { filename: "prices.js" });
  assert.equal((await down.self.TM_PRICES.getCoinPrices(["bitcoin"], "usd")).size, 0);
  assert.equal((await down.self.TM_PRICES.getCoinPrices([], "usd")).size, 0);
});

test("favouriteIds merges starred ids and watchlist symbols, cleaned, unique and capped", () => {
  const { api } = load();
  const map = { BTC: "bitcoin", ETH: "ethereum" };
  const out = JSON.parse(JSON.stringify(api.favouriteIds(["pepe", "bad id!", "bitcoin"], ["btc", "eth", "ZZZ"], map)));
  assert.deepEqual(out, ["pepe", "bitcoin", "ethereum"]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.favouriteIds(null, null, null))), []);
  const many = Array.from({ length: 80 }, (_, i) => "coin-" + i);
  assert.equal(api.favouriteIds(many, [], {}).length, 50, "capped at 50");
});

test("rangePosition places the price between the day's low and high", () => {
  const { api } = load();
  assert.equal(api.rangePosition(100, 200, 150), 50);
  assert.equal(api.rangePosition(100, 200, 100), 0);
  assert.equal(api.rangePosition(100, 200, 250), 100, "clamped");
  assert.equal(api.rangePosition(100, 200, 50), 0, "clamped");
  assert.equal(api.rangePosition(200, 200, 200), null, "flat day cannot be drawn");
  assert.equal(api.rangePosition(null, 200, 150), null);
  assert.equal(api.rangePosition(100, 200, undefined), null);
});

test("baskets only list coins the app already knows, and topSource follows the chosen collection", async () => {
  const vm2 = require("node:vm");
  const calls = [];
  const ctx = vm2.createContext({ self: {}, console, AbortController, setTimeout, clearTimeout,
    fetch: async (url) => { calls.push(String(url)); return { ok: true, json: async () => [{ id: "uniswap", symbol: "uni", name: "Uniswap", current_price: 7, market_cap: 5, market_cap_rank: 30, price_change_percentage_24h: 1 }, { id: "aave", symbol: "aave", name: "Aave", current_price: 90 }] }; } });
  vm2.runInContext(read("prices.js"), ctx, { filename: "prices.js" });
  const P = ctx.self.TM_PRICES;
  const keys = Object.keys(P.BASKETS);
  assert.ok(keys.length >= 6);
  const known = new Set([...Object.values(P.COINGECKO_IDS), ...P.TOP_COINS.map((c) => (Array.isArray(c) ? c[0] : c.id))]);
  for (const k of keys) {
    assert.ok(P.BASKETS[k].length >= 4, k + " has enough coins");
    for (const id of P.BASKETS[k]) assert.ok(known.has(id), k + ": unknown coin " + id);
  }
  const rows = await P.getBasketCoins("defi", "usd");
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => r.id))), ["uniswap", "aave"]);
  assert.equal(rows[0].cgId, "uniswap");
  assert.ok(calls.some((u) => u.includes("/coins/markets") && u.includes("ids=")), "one request for the whole basket");
  await assert.rejects(() => P.getBasketCoins("nope", "usd"));

  const seen = [];
  const fake = { getTopCoins: async () => { seen.push("top"); return []; }, getBasketCoins: async (k) => { seen.push("basket:" + k); return []; }, getCoinsByIds: async (ids) => { seen.push("ids:" + ids.join(",")); return []; }, BASKETS: P.BASKETS, COINGECKO_IDS: { BTC: "bitcoin" } };
  const { api } = load({ TM_PRICES: fake, isWatchlisted: (s) => s === "BTC" });
  await api.topSource("usd");
  api.setCollection("meme"); await api.topSource("usd");
  api.setCollection("fav"); await api.topSource("usd");
  api.setCollection("bogus"); await api.topSource("usd");
  assert.deepEqual(seen, ["top", "basket:meme", "ids:bitcoin", "ids:bitcoin"]);
});

test("the coin hooks are wired in both scripts and the collection UI is in both stylesheets", () => {
  for (const f of ["app.js", "popup.js"]) {
    const t = read(f);
    assert.ok(t.includes("TM_EXPLORE.onCoinOpen") && t.includes("TM_EXPLORE.onCoinInfo") && t.includes("TM_EXPLORE.topSource"), f);
  }
  for (const f of ["app.css", "popup.css"]) assert.ok(read(f).includes(".tm-range-bar") && read(f).includes(".tm-collection"), f);
});
