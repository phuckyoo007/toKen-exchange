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
// CACHE_NAME is versioned by hand. Bump it whenever this list of
// precached files changes so old caches get cleaned up on activate.
const CACHE_NAME = "token-exchange-shell-v1";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/app.css",
  "/app.js",
  "/shim.js",
  "/wallet-engine.js",
  "/cube-nav.js",
  "/site.webmanifest",
  "/img/icon-192.png",
  "/img/icon-512.png",
  "/img/bg-scene.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        // Don't fail install just because one optional asset 404s in a
        // given deployment -- offline support degrading gracefully beats
        // the service worker never installing at all.
      })
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
