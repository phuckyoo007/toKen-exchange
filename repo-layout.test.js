// Guards against the mistakes a flat, hand-uploaded repo invites: a file that
// server.js lists but is missing, a page that references a script the server
// never lays out, or a file with a syntax error that would take the site down.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT } = require("./helpers/load-libs");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));

// Pull the file lists straight out of server.js so this test can never drift from it.
function listFromServer(name) {
  const m = read("server.js").match(new RegExp("const " + name + " = (\\[[\\s\\S]*?\\]);"));
  assert.ok(m, "could not find " + name + " in server.js");
  return new Function("return " + m[1])();
}
const TOP = listFromServer("TOP_LEVEL_FILES");
const LIB = listFromServer("LIB_FILES");
const I18N = listFromServer("I18N_FILES");
const FONTS = listFromServer("FONT_FILES");
const IMG = listFromServer("IMG_FILES");
const VENDOR = ["ethers.umd.min.js", "walletconnect-sign-client.umd.js", "qrcode-generator.js"];

// Every URL path the site will serve, mapped to the repo-root file behind it.
const served = new Map();
TOP.forEach((f) => served.set("/" + f, f));
LIB.forEach((f) => served.set("/lib/" + f, f));
I18N.forEach((f) => served.set("/lib/i18n/" + f, f));
FONTS.forEach((f) => served.set("/fonts/" + f, f));
IMG.forEach((f) => served.set("/img/" + f, f));
VENDOR.forEach((f) => served.set("/vendor/" + f, f)); // copied from node_modules at start-up

function localRefs(html, attr) {
  const re = new RegExp("\\b" + attr + "\\s*=\\s*\"([^\"]+)\"", "gi");
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const v = m[1];
    if (/^(https?:|data:|mailto:|tel:|#|blob:|\/\/)/i.test(v)) continue;
    out.push(v.split("#")[0].split("?")[0]);
  }
  return out.filter(Boolean);
}
const toPath = (ref) => "/" + ref.replace(/^\.?\//, "");

test("every file server.js lists exists in the repo root", () => {
  const missing = [...new Set([...served.values()])].filter((f) => !VENDOR.includes(f) && !exists(f));
  assert.deepEqual(missing, []);
});

test("server.js copies its three vendored libraries from node_modules", () => {
  const src = read("server.js");
  for (const f of VENDOR) assert.ok(src.includes(f), f + " is not copied by server.js");
  // The extension ships root copies of the same three files.
  for (const f of VENDOR) assert.ok(exists(f), "missing root copy " + f);
});

for (const page of ["index.html", "privacy.html", "terms.html", "support.html"]) {
  test(page + ": every local script, stylesheet and image it references is actually served", () => {
    assert.ok(TOP.includes(page), page + " is not in TOP_LEVEL_FILES");
    const html = read(page);
    const refs = [
      ...localRefs(html, "src"),
      ...localRefs(html, "href").filter((r) => !/\.html$/.test(r) || TOP.includes(r)),
    ];
    const unserved = refs.map(toPath).filter((p) => !served.has(p));
    assert.deepEqual([...new Set(unserved)], []);
  });
}

test("app.css: every local url(...) it references is served", () => {
  const css = read("app.css");
  const refs = [];
  css.replace(/url\(\s*["\x27]?([^"\x27)]+)["\x27]?\s*\)/g, (_, u) => { if (!/^(data:|https?:|#)/i.test(u)) refs.push(u.split("?")[0]); });
  const unserved = refs.map((r) => (r.startsWith("/") ? r : "/" + r.replace(/^\.\//, ""))).filter((p) => !served.has(p));
  assert.deepEqual([...new Set(unserved)], []);
});

test("popup.html: every script it loads has a matching file in the repo root", () => {
  const scripts = localRefs(read("popup.html"), "src").filter((r) => r.endsWith(".js"));
  assert.ok(scripts.length > 5);
  const missing = scripts.filter((r) => !exists(path.basename(r)) && r !== "popup.js");
  assert.deepEqual(missing, []);
});

test("lib scripts index.html loads are all in LIB_FILES (nothing is loaded but never laid out)", () => {
  const libScripts = localRefs(read("index.html"), "src").filter((r) => r.startsWith("lib/") && !r.startsWith("lib/i18n/"));
  const notListed = libScripts.map((r) => r.replace("lib/", "")).filter((f) => !LIB.includes(f));
  assert.deepEqual(notListed, []);
});

test("no JavaScript file has a syntax error", () => {
  const skip = new Set(VENDOR);
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".js") && !skip.has(f));
  assert.ok(files.length > 30);
  for (const f of files) {
    assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f);
  }
});
