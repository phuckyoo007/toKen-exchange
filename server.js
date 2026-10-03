const http = require("http");
const path = require("path");
const fs = require("fs");
const handler = require("serve-handler");
const { handleFeatureRequestsApi } = require("./feature-requests-api");
const { handleSwapQuoteApi } = require("./swap-quote-api");
const { handleAuthApi } = require("./auth-api");
const { handleCoinbaseOnrampApi } = require("./coinbase-onramp-api");
const { handleTransakApi } = require("./transak-widget-api");
const { handleNftApi } = require("./nft-api");
const { handleAdminApi } = require("./admin-api");
const { applySecurityHeaders } = require("./security-headers");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const VENDOR_DIR = path.join(PUBLIC_DIR, "vendor");
const LIB_DIR = path.join(PUBLIC_DIR, "lib");
const I18N_DIR = path.join(LIB_DIR, "i18n");
const FONTS_DIR = path.join(PUBLIC_DIR, "fonts");
const IMG_DIR = path.join(PUBLIC_DIR, "img");
const PORT = process.env.PORT || 3000;

const TOP_LEVEL_FILES = ["index.html", "app.css", "app.js", "shim.js", "wallet-engine.js", "cube-nav.js", "globe-nav.js", "extras.js", "sw-register.js", "site.webmanifest", "sw.js", "privacy.html", "terms.html", "support.html", "admin.html", "admin.js"];
const LIB_FILES = [
"account.js", "coinbase-onramp-config.js", "crypto-utils.js", "fee-config.js", "feature-requests.js", "i18n.js",
"identicon.js", "known-tokens.js", "networks.js", "nft.js", "onramper-config.js", "polymarket.js", "token-catalog.js", "prices.js",
"sanctions-list.js", "support-config.js", "swap.js", "ui-common.js", "transak-config.js", "wallet.js",
"walletconnect-config.js",
];
const I18N_FILES = ["ar.js", "en.js", "es.js", "fr.js", "hi.js", "ja.js", "pt.js", "ru.js", "zh.js"];
const FONT_FILES = ["fredoka-400.woff2", "fredoka-500.woff2", "fredoka-600.woff2", "fredoka-700.woff2"];
const IMG_FILES = [
"bg-scene.jpg", "spinner-coin.png", "splash.jpg", "splash-light.jpg",
"apple-touch-icon.png", "icon-192.png", "icon-512.png", "favicon-32.png",
"card-banner.jpg", "card-watermark.jpg", "card-watermark-light.jpg",
"flag-en.svg", "flag-ar.svg", "flag-zh.svg", "flag-es.svg", "flag-fr.svg",
"flag-hi.svg", "flag-pt.svg", "flag-ja.svg", "flag-ru.svg",
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
  // Each vendored library is copied out of node_modules. If one is missing the
  // site cannot work, so fail with a message that says what to do instead of a
  // raw stack trace.
  const vendored = [
    ["ethers", () => require.resolve("ethers/dist/ethers.umd.min.js"), "ethers.umd.min.js"],
    ["@walletconnect/sign-client", () => path.join(path.dirname(require.resolve("@walletconnect/sign-client")), "index.umd.js"), "walletconnect-sign-client.umd.js"],
    ["qrcode-generator", () => require.resolve("qrcode-generator"), "qrcode-generator.js"],
  ];
  for (const [pkg, resolveSrc, destName] of vendored) {
    try {
      fs.copyFileSync(resolveSrc(), path.join(VENDOR_DIR, destName));
    } catch (e) {
      throw new Error("Could not copy the vendored library from '" + pkg + "' (" + e.message + "). Run `npm install` and try again.");
    }
  }
  console.log("Vendor files copied into", VENDOR_DIR);
}

// Sends a request to the API modules, then to the static file handler. Its own
// function so one failing handler is caught in a single place (see main()).
function routeRequest(req, res) {
  applySecurityHeaders(req, res);
  const pathname = String(req.url || "").split("?")[0];
  if (pathname === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true }));
    return;
  }
  if (handleFeatureRequestsApi(req, res)) return;
  if (handleSwapQuoteApi(req, res)) return;
  if (handleAuthApi(req, res)) return;
  if (handleCoinbaseOnrampApi(req, res)) return;
  if (handleTransakApi(req, res)) return;
  if (handleNftApi(req, res)) return;
  if (handleAdminApi(req, res)) return;
  return handler(req, res, { public: PUBLIC_DIR });
}

function failRequest(res, err) {
  console.error("Unhandled request error:", err && err.stack ? err.stack : err);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Internal server error." }));
}

function main() {
  layoutPublicDir();
  copyVendorFiles();
  const server = http.createServer((req, res) => {
    try {
      // serve-handler returns a promise; catch its rejections too.
      const maybePromise = routeRequest(req, res);
      if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch((e) => failRequest(res, e));
    } catch (e) {
      failRequest(res, e);
    }
  });
  server.on("clientError", (err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") console.error("Port " + PORT + " is already in use. Set a different PORT or stop the other process.");
    else console.error("Server error:", err);
    process.exit(1);
  });
  server.listen(PORT, () => console.log("Serving on port " + PORT));

  // Finish in-flight requests on a deploy restart instead of cutting them off.
  const shutdown = (signal) => {
    console.log(signal + " received, shutting down.");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// A bug in one request must not take the whole wallet site down.
process.on("unhandledRejection", (reason) => console.error("Unhandled promise rejection:", reason));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err && err.stack ? err.stack : err));

try {
  main();
} catch (e) {
  console.error("Startup failed:", e && e.message ? e.message : e);
  process.exit(1);
}
