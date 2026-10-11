// Token Exchange - basic offline-support service worker.
//
// Goal: let the app shell (HTML/CSS/JS/fonts/icons) still open when the
// device has no connection, without ever risking stale data for anything
// that talks to the network for real information -- price quotes, swap
// quotes, account auth, onramp/offramp calls. Those all live under /api/
// and are never cached; they always go straight to the network.
//
// Strategy for everything else: network-first, falling back to the cache
// only when the network request fails outright (offline, DNS error, etc).
// A successful network response always refreshes the cache. This keeps the
// wallet's own code and UI as fresh as possible whenever there's a
// connection, while still giving a working shell offline -- appropriate
// for an app that holds financial/private-key logic, where "always prefer
// the latest code when we can reach it" matters more than raw speed.
//
// CACHE_NAME is versioned by hand. Bump it whenever PRECACHE_URLS changes so
// old caches get cleaned up on activate. tests/service-worker.test.js fails if
// this list drifts from what index.html and app.css actually load.
const CACHE_NAME = "token-exchange-shell-v26";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/app.css",
  "/app.js",
  "/shim.js",
  "/wallet-engine.js",
  "/cube-nav.js",
  "/globe-nav.js",
  "/extras.js",
  "/sw-register.js",
  "/site.webmanifest",
  // vendored libraries (copied from node_modules by server.js at start-up)
  "/vendor/ethers.umd.min.js",
  "/vendor/walletconnect-sign-client.umd.js",
  "/vendor/qrcode-generator.js",
  // app libraries
  "/lib/identicon.js",
  "/lib/prices.js",
  "/lib/polymarket.js",
  "/lib/token-catalog.js",
  "/lib/transak-config.js",
  "/lib/i18n.js",
  "/lib/support-config.js",
  "/lib/crypto-utils.js",
  "/lib/wallet.js",
  "/lib/networks.js",
  "/lib/nft.js",
  "/lib/swap.js",
  "/lib/fee-config.js",
  "/lib/sanctions-list.js",
  "/lib/walletconnect-config.js",
  "/lib/account.js",
  "/lib/feature-requests.js",
  "/lib/ui-common.js",
  "/lib/known-tokens.js",
  "/lib/token-scan.js",
  "/lib/token-scan-ui.js",
  // translations
  "/lib/i18n/en.js",
  "/lib/i18n/ar.js",
  "/lib/i18n/zh.js",
  "/lib/i18n/es.js",
  "/lib/i18n/fr.js",
  "/lib/i18n/hi.js",
  "/lib/i18n/pt.js",
  "/lib/i18n/ja.js",
  "/lib/i18n/ru.js",
  // fonts
  "/fonts/fredoka-400.woff2",
  "/fonts/fredoka-500.woff2",
  "/fonts/fredoka-600.woff2",
  "/fonts/fredoka-700.woff2",
  // images
  "/img/splash.jpg",
  "/img/splash-light.jpg",
  "/img/spinner-coin.png",
  "/img/favicon-32.png",
  "/img/apple-touch-icon.png",
  "/img/icon-192.png",
  "/img/icon-512.png",
  "/img/bg-scene.jpg",
  "/img/card-banner.jpg",
  "/img/card-watermark.jpg",
  "/img/card-watermark-light.jpg",
  "/img/flag-en.svg",
  "/img/flag-ar.svg",
  "/img/flag-zh.svg",
  "/img/flag-es.svg",
  "/img/flag-fr.svg",
  "/img/flag-hi.svg",
  "/img/flag-pt.svg",
  "/img/flag-ja.svg",
  "/img/flag-ru.svg",
];

self.addEventListener("install", (event) => {
  // Add files one by one instead of cache.addAll(): addAll is all-or-nothing,
  // so a single 404 used to leave the cache empty. Now a missing file only
  // costs that one file. Install still never fails because of the cache.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            fetch(url, { cache: "reload" }).then((res) => {
              if (!res.ok) throw new Error(url + " " + res.status);
              return cache.put(url, res);
            })
          )
        )
      )
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only ever handle same-origin GET requests. POST/PUT (form submissions,
  // API writes) and cross-origin requests (RPC providers, price feeds,
  // WalletConnect relays, etc.) pass straight through untouched.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Anything dynamic never gets cached -- always hit the network.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Last resort for a full-page navigation while offline with
          // nothing cached yet: fall back to the cached shell if we have
          // it, otherwise let the request fail normally.
          if (req.mode === "navigate") {
            return caches.match("/index.html");
          }
          return Promise.reject(new Error("offline and not cached"));
        })
      )
  );
});
