// Keeps the nine language files in step with English, and English in step with the code.
// en.js is the canonical list: every other language must define exactly the same
// string keys and FAQ ids, with the same {placeholders}.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT } = require("./helpers/load-libs");

const LANGS = ["en", "ar", "zh", "es", "fr", "hi", "pt", "ja", "ru"];
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

globalThis.self = globalThis;
for (const l of LANGS) vm.runInThisContext(read(l + ".js"), { filename: l + ".js" });
const DATA = globalThis.TM_I18N_DATA;
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
const EN = DATA.en.strings;

test("every language file registers itself", () => {
  for (const l of LANGS) assert.ok(DATA[l] && DATA[l].strings, l + " did not register TM_I18N_DATA." + l);
});

test("every language defines exactly the same string keys as English", () => {
  for (const l of LANGS.filter((x) => x !== "en")) {
    const keys = Object.keys(DATA[l].strings);
    const missing = Object.keys(EN).filter((k) => !(k in DATA[l].strings));
    const extra = keys.filter((k) => !(k in EN));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, l + " is out of step with en.js");
  }
});

test("every language has the same FAQ ids as English, in the same order", () => {
  const ids = DATA.en.faq.map((f) => f.id);
  for (const l of LANGS.filter((x) => x !== "en")) {
    assert.deepEqual(DATA[l].faq.map((f) => f.id), ids, l + " FAQ ids differ from en.js");
  }
});

test("translations keep the same {placeholders} as English and are never empty", () => {
  for (const l of LANGS.filter((x) => x !== "en")) {
    for (const [k, v] of Object.entries(DATA[l].strings)) {
      assert.ok(String(v).trim() !== "", l + ":" + k + " is empty");
      assert.equal(placeholders(v), placeholders(EN[k]), l + ":" + k + " placeholders differ from English");
    }
  }
});

test("every key the pages and scripts ask for exists in English", () => {
  // Static references only: data-i18n*="key" in HTML and t("key") / TM_I18N.t("key") in scripts.
  const files = ["index.html", "popup.html", "app.js", "popup.js", "extras.js", "ui-common.js", "account.js", "swap.js", "wallet-engine.js", "feature-requests.js", "nft.js", "prices.js", "polymarket.js"].filter((f) => fs.existsSync(path.join(ROOT, f)));
  const wanted = new Map();
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([\w.]+)"/g)) wanted.set(m[1], f);
    for (const m of src.matchAll(/\bt\(\s*["']([a-z][\w]*\.[\w.]+)["']/g)) wanted.set(m[1], f);
  }
  // Keys built at run time (e.g. "swap.gasStep_" + step) end in "_" and are checked below.
  const missing = [...wanted].filter(([k]) => !k.endsWith("_") && !(k in EN)).map(([k, f]) => k + " (" + f + ")");
  assert.deepEqual(missing, [], "used in code but not defined in en.js");
});

test("run-time built keys have an entry for every variant (swap.gasStep_*)", () => {
  for (const step of ["approve", "fee", "swap"]) assert.ok(("swap.gasStep_" + step) in EN, "swap.gasStep_" + step);
});
