#!/usr/bin/env node
// Builds the Chrome extension folder from the flat repo root.
//   npm run build:extension            -> dist/extension/
//   node scripts/build-extension.js out/dir
//
// The layout is the table in README.md. Which shared scripts go in lib/ is NOT
// hard-coded: it is whatever popup.html, background.js and manifest.json
// reference, so adding a script there is enough. Throws if anything referenced
// is missing from the repo root.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Where each root file lands inside the extension.
const VENDOR = ["ethers.umd.min.js", "walletconnect-sign-client.umd.js", "qrcode-generator.js"];
const I18N = ["ar", "en", "es", "fr", "hi", "ja", "pt", "ru", "zh"].map((c) => c + ".js");
const POPUP_IMAGES = ["spinner-coin.png", "splash.jpg", "bg-scene.jpg", "card-watermark.jpg", "card-watermark-light.jpg"];
const FONTS = ["fredoka-400.woff2", "fredoka-500.woff2", "fredoka-600.woff2", "fredoka-700.woff2"];

function build(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const files = new Map(); // destination (relative to outDir) -> root file

  const add = (dest, src) => files.set(dest, src);
  add("manifest.json", "manifest.json");
  add("background/background.js", "background.js");
  add("content/content-script.js", "content-script.js");
  add("content/inject.js", "inject.js");
  add("popup/popup.html", "popup.html");
  add("popup/popup.js", "popup.js");
  add("popup/popup.css", "popup.css");
  for (const f of POPUP_IMAGES) add("popup/img/" + f, f);
  for (const f of FONTS) add("popup/fonts/" + f, f);
  for (const s of [16, 32, 48, 128]) add(`icons/icon${s}.png`, `icon${s}.png`);
  for (const f of VENDOR) add("vendor/" + f, f);
  for (const f of I18N) add("lib/i18n/" + f, f);
  // Translated extension name/description (Chrome shows these in the browser's language).
  const LOCALES = {
    "_locales/en/messages.json": "locale-en.json",
    "_locales/es/messages.json": "locale-es.json",
    "_locales/fr/messages.json": "locale-fr.json",
    "_locales/pt_BR/messages.json": "locale-pt.json",
    "_locales/ru/messages.json": "locale-ru.json",
    "_locales/zh_CN/messages.json": "locale-zh.json",
    "_locales/ja/messages.json": "locale-ja.json",
    "_locales/ar/messages.json": "locale-ar.json",
    "_locales/hi/messages.json": "locale-hi.json",
  };
  for (const [dest, src] of Object.entries(LOCALES)) add(dest, src);

  // Shared scripts: everything the popup page and the background worker pull from ../lib/.
  const libRefs = new Set();
  for (const src of [read("popup.html"), read("background.js")]) {
    for (const m of src.matchAll(/["']\.\.\/lib\/([A-Za-z0-9_-]+\.js)["']/g)) libRefs.add(m[1]);
  }
  for (const f of libRefs) add("lib/" + f, f);

  const missing = [...new Set(files.values())].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) throw new Error("missing from repo root: " + missing.join(", "));

  for (const [dest, src] of files) {
    const to = path.join(outDir, dest);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, src), to);
  }
  return [...files.keys()].sort();
}

module.exports = { build };

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, "dist", "extension"));
  const list = build(out);
  console.log(`Built ${list.length} files into ${path.relative(process.cwd(), out) || "."}`);
}
