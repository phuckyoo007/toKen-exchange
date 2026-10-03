# Token Exchange

A self-custody Ethereum-and-more wallet that ships as **a website**
(tokenswaphub.org) and **a Chrome extension**, built from the same source files.
Keys are generated and encrypted on the user's device; the server never sees them.

- Change history: [docs/CHANGELOG.md](docs/CHANGELOG.md)
- Play Store listing draft: [docs/play-store-listing.md](docs/play-store-listing.md)

## How the repo is laid out

**Every source file lives in the repo root (flat).** There are no folders of
source code. Two things turn that flat pile into something runnable:

- **The website.** `server.js` copies the root files into a generated `public/`
  folder on every start (`index.html` and friends to `/`, `lib` files to
  `/lib/`, translations to `/lib/i18n/`, images to `/img/`, fonts to `/fonts/`),
  copies the three vendored libraries from `node_modules` to `/vendor/`, then
  serves it. **The lists at the top of `server.js` are the source of truth for
  what the website ships.** `public/` is never committed.
- **The Chrome extension.** `manifest.json` is the extension's manifest and
  expects folders. Build the extension folder with:

      npm run build:extension      # -> dist/extension/ (load this unpacked in Chrome)

  `scripts/build-extension.js` holds the layout (`background/`, `content/`,
  `popup/`, `icons/`, `vendor/`, `lib/`, `lib/i18n/`). Which shared scripts go
  in `lib/` is read from what `popup.html` and `background.js` load from
  `../lib/`, so you never edit a copy table by hand.


`app.js` (website) and `popup.js` (extension) are two front-ends that grew from
the same code and still share a lot of it. Shared code that both pages load
lives in the `lib`-type files; the UI helpers both use (`$`, `escapeHtml`,
`sendMsg`, `showScreen`, currency and colour helpers) are in `ui-common.js`.
Fix a helper there once, not in both `app.js` and `popup.js`.

### Adding a new shared script: checklist
Forgetting one of these is how "works on my machine, broken on the site" happens.
1. Put the file in the repo root.
2. Add its name to `LIB_FILES` in `server.js`.
3. Add a `<script src="lib/...">` line to `index.html` (and `popup.html` as
   `../lib/...` if the extension uses it, plus `background.js` if the background
   worker does).
4. Add it to `PRECACHE_URLS` in `sw.js` and bump `CACHE_NAME`.
5. Run `npm test`. It fails if a page references something the server does not
   lay out.

## Run it locally

    npm install
    npm start          # http://localhost:3000
    npm test           # ~6 s, no install needed

Needs Node 22.13 or newer.

`GET /healthz` returns `{"ok":true}` once the server is up (point Railway's health
check at it). The server also shuts down cleanly on SIGTERM, and logs rather
than crashes on an error in a single request.

## Configuration (environment variables)

Set these as Railway variables. Nothing is required to boot; features whose
keys are missing switch themselves off (the Buy/Sell buttons hide, swaps fall
back to the on-chain router) instead of breaking.

| Variable | Used for |
|---|---|
| `PORT` | Port to listen on (Railway sets it). Default 3000. |
| `DATA_DIR` | Folder for `accounts.json` and `feature-requests.json`. **Must be a mounted persistent volume in production**: the account/backup API refuses to run in production without it, because the disk is wiped on every redeploy. |
| `TRUST_PROXY_HOPS` | How many proxies sit in front of the server, for rate limiting. Default `1` (Railway). Use `0` only if exposed directly. |
| `ALLOWED_ORIGINS` | Extra CORS origins, comma-separated (e.g. `chrome-extension://<dev id>,http://localhost:3000` to test an unpacked extension). |
| `CSP_REPORT_ONLY` | Set to `1` to make the Content-Security-Policy log violations instead of blocking. Debugging aid; remove afterwards. |
| `ZEROEX_API_KEY` | 0x Swap API key for aggregator swap quotes. |
| `ALCHEMY_API_KEY` | Alchemy API key for the NFT gallery (`nft-api.js`). Without it the NFT feature stays off. |
| `ADMIN_TOKEN` | Bearer token for the admin console (`/admin.html`, `admin-api.js`). Without it every `/api/admin/*` route answers 503. |
| `TRANSAK_API_KEY`, `TRANSAK_API_SECRET` | Transak Buy/Sell. Secret: never commit. |
| `TRANSAK_ENVIRONMENT` | `production` or `staging` (default `staging`, so a forgotten variable cannot move real money). Use the key pair that matches. |
| `TRANSAK_REFERRER_DOMAIN` | Optional. Default `tokenswaphub.org`; must match your Transak dashboard. |
| `COINBASE_CDP_API_KEY_ID`, `COINBASE_CDP_API_SECRET` | Coinbase onramp/offramp sessions. Secret: never commit. |

Known limit: rate-limit counters live in memory, so they reset on every
redeploy and are not shared between instances. Run a single instance.

## HTTP API (served by `server.js`)

`/api/swap-quote`, `/api/transak-session`, `/api/coinbase-onramp-session`,
`/api/coinbase-offramp-status`, `/api/feature-requests`, `/api/nft-list`,
`/api/nft-metadata`, and the account/backup routes under `/api/auth/*` and
`/api/vault`. The swap, Transak, Coinbase and NFT endpoints only answer
browsers on the allowed origins (see `cors.js`).

## Admin console

`/admin.html` (logic in `admin.js`) talks to `/api/admin/*` (`admin-api.js`),
both wired into `server.js`. It operates on the same user store as
`/api/auth/*` (`auth-api.js`'s `accounts.json`) -- NOT the separate,
not-wired-in `accounts-api.js` below.

- Set `ADMIN_TOKEN` (a long random string) as a Railway variable to turn it
  on. Until it's set, every `/api/admin/*` route answers 503 -- there is no
  default admin password, and the page itself serves either way (it just
  can't do anything without a token).
- Visit `/admin.html`, paste the token (kept in `sessionStorage` only --
  cleared on tab close, never written to disk). From there: see per-user
  vault version/session count/last-updated (never the encrypted vault
  itself or anything that unlocks one), sign a user out everywhere, disable
  or delete an account, and clear a stuck login/IP rate limit.
- The page is served to anyone who requests it (it's a login gate, like the
  site itself), but `noindex, nofollow` keeps it out of search engines and
  every `/api/admin/*` call requires the bearer token, rate-limited at 20
  bad attempts per 15 minutes per IP.
- Treat the token like a password: a long random value, not committed
  anywhere, rotated if you suspect it leaked.

## Not wired in

`accounts-api.js` (optional username/password **website** accounts for
syncing display settings across devices -- a different, lower-stakes system
than the admin console or the wallet itself; see the file's own header) is
in the repo but `server.js` does not load it, so it is inactive on the live
site. Finish wiring it up or remove it; do not assume it is running. If you
do wire it in, it reads `ACCOUNTS_ENABLED` (`1` to switch it on) and
`ACCOUNTS_DB_PATH` (where its SQLite file lives; put it on the persistent
volume).

## Repo hygiene

- Keep screenshots, store art and zip snapshots out of the repo. They are not
  served, they bloat every clone, and an old snapshot is easy to upload by
  mistake. `npm test` fails if an archive or an unreferenced image appears in
  the root.
- Every environment variable the server code reads must be listed in the table
  above; `npm test` enforces that too.
