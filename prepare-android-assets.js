#!/usr/bin/env node
// Lays the website's files out as android/app/src/main/assets/www, the same
// folder layout the website serves (index.html + app.js at /, lib/, lib/i18n/,
// img/, fonts/, vendor/). The lists at the top of server.js are the source of
// truth for what ships, so this reads them rather than keeping a second copy.
//   npm ci && node scripts/prepare-android-assets.js
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "android", "app", "src", "main", "assets", "www");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

function list(name) {
  const m = new RegExp("const " + name + " = (\\[[\\s\\S]*?\\]);").exec(server);
  if (!m) throw new Error("Could not find " + name + " in server.js");
  return vm.runInNewContext(m[1]);
}

fs.rmSync(OUT, { recursive: true, force: true });
function copy(files, sub) {
  const dir = path.join(OUT, sub);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) throw new Error("Missing file for the Android app: " + f);
    fs.copyFileSync(src, path.join(dir, f));
  }
}
// admin.html / admin.js are the website's admin console; they have no place in the phone app.
copy(list("TOP_LEVEL_FILES").filter((f) => !/^admin\./.test(f)), "");
copy(list("LIB_FILES"), "lib");
copy(list("I18N_FILES"), "lib/i18n");
copy(list("FONT_FILES"), "fonts");
copy(list("IMG_FILES"), "img");

// Vendored libraries: copied out of node_modules (npm ci), the same as server.js.
function resolveVendor(pkgResolve, rootCopy) {
  try { return pkgResolve(); } catch (e) {
    const fallback = path.join(ROOT, rootCopy);
    if (fs.existsSync(fallback)) return fallback;
    throw new Error("Could not find " + rootCopy + " (run `npm ci` first): " + e.message);
  }
}
const vendored = [
  [resolveVendor(() => require.resolve("ethers/dist/ethers.umd.min.js"), "ethers.umd.min.js"), "ethers.umd.min.js"],
  [resolveVendor(() => path.join(path.dirname(require.resolve("@walletconnect/sign-client")), "index.umd.js"), "walletconnect-sign-client.umd.js"), "walletconnect-sign-client.umd.js"],
  [resolveVendor(() => require.resolve("qrcode-generator"), "qrcode-generator.js"), "qrcode-generator.js"],
];
fs.mkdirSync(path.join(OUT, "vendor"), { recursive: true });
for (const [src, name] of vendored) fs.copyFileSync(src, path.join(OUT, "vendor", name));
console.log("Android web assets written to", path.relative(ROOT, OUT));
