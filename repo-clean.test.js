// Keeps the repo from filling back up with clutter, and keeps the docs honest.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/load-libs");

const rootFiles = fs.readdirSync(ROOT).filter((f) => fs.statSync(path.join(ROOT, f)).isFile());
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Vendored third-party bundles: never scanned for our own settings or references.
const VENDORED = new Set(["ethers.umd.min.js", "walletconnect-sign-client.umd.js", "qrcode-generator.js"]);

test("no zip snapshots or backup files in the repo root", () => {
  const stray = rootFiles.filter((f) => /\.(zip|bak|orig|rej)$/i.test(f) || /~$/.test(f));
  assert.deepEqual(stray, [], "an old snapshot is easy to upload by mistake; delete: " + stray.join(", "));
});

test("every image in the repo root is actually used by the site or the extension", () => {
  // "Used" = its file name appears in code: server.js lists, manifest, html, css, js.
  const codeFiles = rootFiles.filter((f) => /\.(js|html|css|json|webmanifest)$/.test(f) && !VENDORED.has(f) && f !== "package-lock.json");
  const haystack = codeFiles.map(read).join("\n");
  const images = rootFiles.filter((f) => /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(f));
  const unused = images.filter((img) => !haystack.includes(img));
  assert.deepEqual(unused, [], "not referenced anywhere (screenshots and store art belong outside the repo): " + unused.join(", "));
});

test("the extension manifest is not published on the website", () => {
  const m = read("server.js").match(/const TOP_LEVEL_FILES = (\[[\s\S]*?\]);/);
  assert.ok(m, "TOP_LEVEL_FILES not found in server.js");
  const list = new Function("return " + m[1])();
  assert.ok(!list.includes("manifest.json"), "manifest.json (the extension manifest) must not be served; the site uses site.webmanifest");
  assert.ok(list.includes("site.webmanifest"));
});

test("README.md exists and points at the docs folder", () => {
  assert.ok(rootFiles.includes("README.md"));
  const readme = read("README.md");
  for (const doc of ["docs/CHANGELOG.md", "docs/play-store-listing.md"]) {
    assert.ok(readme.includes(doc), "README should link " + doc);
    assert.ok(fs.existsSync(path.join(ROOT, doc)), doc + " is missing");
  }
});

test("every environment variable the server code reads is documented in README.md", () => {
  // Platform-provided or vendor-internal variables that are not ours to configure.
  const IGNORE = new Set(["NODE_ENV", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID"]);
  const serverFiles = rootFiles.filter((f) => f.endsWith(".js") && !VENDORED.has(f));
  const used = new Set();
  for (const f of serverFiles) {
    for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) used.add(m[1]);
  }
  const readme = read("README.md");
  const undocumented = [...used].filter((v) => !IGNORE.has(v) && !readme.includes("`" + v + "`"));
  assert.deepEqual(undocumented, [], "add these to the configuration table in README.md: " + undocumented.join(", "));
});
