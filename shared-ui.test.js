// Guards the code shared by the website (app.js) and the extension (popup.js).
// The shared helpers live once in ui-common.js. If someone pastes one back into
// app.js or popup.js, the two copies would drift apart again -- this fails first.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT } = require("./helpers/load-libs");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const common = read("ui-common.js");

// Every top-level name ui-common.js defines (function / const / let).
const names = [...common.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|^(?:const|let)\s+([A-Za-z0-9_$]+)\b/gm)].map(
  (m) => m[1] || m[2]
);

test("ui-common.js defines the expected shared names", () => {
  for (const n of ["$", "escapeHtml", "sendMsg", "showScreen", "formatCurrency", "tokenIconColor", "networkDotHtml", "CUBE_FACE_ORDER"]) {
    assert.ok(names.includes(n), n + " missing from ui-common.js");
  }
});

for (const file of ["app.js", "popup.js"]) {
  test(file + " does not redeclare anything from ui-common.js", () => {
    const src = read(file);
    const dupes = names.filter((n) => {
      const esc = n.replace(/\$/g, "\\$");
      return new RegExp("^\\s*(?:async\\s+)?function\\s+" + esc + "\\s*\\(|^\\s*(?:const|let|var)\\s+" + esc + "\\b", "m").test(src);
    });
    assert.deepEqual(dupes, [], file + " redeclares shared names: " + dupes.join(", "));
  });
}

test("both pages load ui-common.js before their own script", () => {
  const site = read("index.html");
  const popup = read("popup.html");
  const si = site.indexOf('src="lib/ui-common.js"');
  assert.ok(si > 0 && si < site.indexOf('src="app.js"'), "index.html must load lib/ui-common.js before app.js");
  const pi = popup.indexOf('src="../lib/ui-common.js"');
  assert.ok(pi > 0 && pi < popup.indexOf('src="popup.js"'), "popup.html must load ../lib/ui-common.js before popup.js");
});

test("escapeHtml from ui-common.js escapes markup and both quote types", () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(common, ctx);
  const out = ctx.escapeHtml(`<img src=x onerror="a('b')">&`);
  assert.equal(out, "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(ctx.escapeHtml(null), "");
});

test("networkDotColor and tokenIconColor are stable and fall back to a hash color", () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(common + "\nthis.nd = networkDotColor; this.tc = tokenIconColor;", ctx);
  assert.equal(ctx.nd("ethereum"), "#627EEA");
  assert.match(ctx.nd("my-custom-chain"), /^hsl\(\d+, 55%, 58%\)$/);
  assert.equal(ctx.nd("my-custom-chain"), ctx.nd("my-custom-chain"));
  assert.equal(ctx.tc("usdc"), "#2775CA");
  assert.match(ctx.tc("ZZZ"), /^hsl\(\d+, 55%, 46%\)$/);
});
