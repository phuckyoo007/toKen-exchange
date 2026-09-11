const http = require("http");
const path = require("path");
const fs = require("fs");
const handler = require("serve-handler");
const { handleFeatureRequestsApi } = require("./feature-requests-api");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const VENDOR_DIR = path.join(PUBLIC_DIR, "vendor");
const LIB_DIR = path.join(PUBLIC_DIR, "lib");
const I18N_DIR = path.join(LIB_DIR, "i18n");
const FONTS_DIR = path.join(PUBLIC_DIR, "fonts");
const IMG_DIR = path.join(PUBLIC_DIR, "img");
const PORT = process.env.PORT || 3000;

const TOP_LEVEL_FILES = ["index.html", "app.css", "app.js", "shim.js", "wallet-engine.js", "manifest.json"];
const LIB_FILES = [
"buy-config.js", "crypto-utils.js", "fee-config.js", "feature-requests.js", "i18n.js",
"identicon.js", "networks.js", "polymarket.js", "prices.js", "sell-config.js",
"sanctions-list.js", "support-config.js", "swap.js", "wallet.js",
"walletconnect-config.js",
];
const I18N_FILES = ["ar.js", "en.js", "es.js", "fr.js", "hi.js", "ja.js", "pt.js", "ru.js", "zh.js"];
const FONT_FILES = ["fredoka-400.woff2", "fredoka-500.woff2", "fredoka-600.woff2", "fredoka-700.woff2"];
const IMG_FILES = [
"bg-scene.jpg", "spinner-coin.png", "splash.jpg",
"apple-touch-icon.png", "icon-192.png", "icon-512.png", "favicon-32.png",
];

function copyIfExists(srcName, destDir) {
const src = path.join(ROOT, srcName);
if (!fs.existsSync(src)) {
console.warn("Expected file not found at repo root:", srcName);
return;
}
fs.copyFileSync(src, path.join(destDir, srcName));
}

function layoutPublicDir() {
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(LIB_DIR, { recursive: true });
fs.mkdirSync(I18N_DIR, { recursive: true });
fs.mkdirSync(FONTS_DIR, { recursive: true });
fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(VENDOR_DIR, { recursive: true });

TOP_LEVEL_FILES.forEach((f) => copyIfExists(f, PUBLIC_DIR));
LIB_FILES.forEach((f) => copyIfExists(f, LIB_DIR));
I18N_FILES.forEach((f) => copyIfExists(f, I18N_DIR));
FONT_FILES.forEach((f) => copyIfExists(f, FONTS_DIR));
IMG_FILES.forEach((f) => copyIfExists(f, IMG_DIR));

console.log("Laid out public/ from flat repo root files.");
}

function copyVendorFiles() {
const ethersUmd = require.resolve("ethers/dist/ethers.umd.min.js");
fs.copyFileSync(ethersUmd, path.join(VENDOR_DIR, "ethers.umd.min.js"));

const wcMain = require.resolve("@walletconnect/sign-client");
const wcUmd = path.join(path.dirname(wcMain), "index.umd.js");
fs.copyFileSync(wcUmd, path.join(VENDOR_DIR, "walletconnect-sign-client.umd.js"));

const qr = require.resolve("qrcode-generator");
fs.copyFileSync(qr, path.join(VENDOR_DIR, "qrcode-generator.js"));

console.log("Vendor files copied into", VENDOR_DIR);
}

function main() {
layoutPublicDir();
copyVendorFiles();
const server = http.createServer((req, res) => {
if (handleFeatureRequestsApi(req, res)) return;
handler(req, res, { public: PUBLIC_DIR });
});
server.listen(PORT, () => console.log("Serving on port " + PORT));
}

main();
