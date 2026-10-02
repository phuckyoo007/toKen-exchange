// The extension build must produce a folder where every path the manifest,
// popup page, background worker and stylesheet point at really exists.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("../scripts/build-extension");

const out = fs.mkdtempSync(path.join(os.tmpdir(), "tm-ext-"));
build(out);
const exists = (rel) => fs.existsSync(path.join(out, rel));
const read = (rel) => fs.readFileSync(path.join(out, rel), "utf8");

test("manifest paths all exist in the built extension", () => {
  const m = JSON.parse(read("manifest.json"));
  const paths = [
    m.action.default_popup,
    m.background.service_worker,
    ...Object.values(m.icons),
    ...Object.values(m.action.default_icon),
    ...m.content_scripts.flatMap((c) => c.js),
  ];
  for (const p of paths) assert.ok(exists(p), "manifest points at missing " + p);
});

test("popup.html scripts, styles and images all exist", () => {
  const html = read("popup/popup.html");
  const refs = [...html.matchAll(/\b(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|data:|about:)/.test(r));
  assert.ok(refs.length > 10);
  for (const r of refs) assert.ok(exists(path.posix.join("popup", r)), "popup.html references missing " + r);
});

test("background importScripts list exists", () => {
  const src = read("background/background.js");
  const refs = [...src.matchAll(/["'](\.\.\/(?:lib|vendor)\/[^"']+\.js)["']/g)].map((m) => m[1]);
  assert.ok(refs.length >= 8);
  for (const r of refs) assert.ok(exists(path.posix.join("background", r)), "importScripts missing " + r);
});

test("popup.css url() references exist", () => {
  const css = read("popup/popup.css");
  const refs = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]).filter((r) => !r.startsWith("data:"));
  for (const r of refs) assert.ok(exists(path.posix.join("popup", r)), "popup.css references missing " + r);
});
