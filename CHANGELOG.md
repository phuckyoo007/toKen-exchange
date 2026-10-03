# Changelog
## Unreleased

- **Security:** sites can no longer switch the wallet's network silently. The extension
  opens an approval window ("X wants to switch from A to B"); rejecting returns EIP-1193
  error 4001, and switching to the chain you are already on does not prompt. Strings added
  in all nine languages; new `tests/switch-network.test.js`.

- **Fee:** `computeFee` / `feePercentLabel` now honor `{ viaAggregator }`. Swaps routed
  through 0x are charged 0.65% (our 0.5% + 0x's ~0.15%); router swaps stay at 0.5%.
  Three new tests. (`wallet-engine.js` already passed the option; `fee-config.js`
  ignored it.)
- **Security:** `app.js` now uses the shared `escapeHtml` from `ui-common.js`, which
  escapes quotes. The website's old copy did not, so it was unsafe inside HTML attributes.
- **Dedupe:** 21 helpers removed from `app.js` (about 200 lines); `index.html` loads
  `lib/ui-common.js` before `app.js`, as `popup.html` already did.
- **Repo:** restored `tests/`, `tests/helpers/`, `docs/` and `.gitignore`; removed the
  nested deploy zip, ten README-*.md files, the reference txt and the duplicate
  listing; store screenshots and art moved out of the repo; removed `accounts-api.js`.
- **Build:** `npm run build:extension` replaces the manual copy table; a test checks
  every path in the built extension resolves.
- **Verified stablecoin addresses:** new shared `known-tokens.js` with USDC, EURC and USDT
  contracts copied from the issuers' own pages (Circle, Tether) and checked by test
  (checksum, known chain, pinned values). A chain is listed only where the issuer lists
  the token, so USDT is on Ethereum, Avalanche and Celo only. Used for "Quick add" chips on
  the Add Token screen and "Suggested" rows on the swap "To" picker, on the website and in
  the extension. Nothing is added or swapped automatically; the normal lookup and confirm
  steps still run. `sw.js` cache bumped to v7.
- **Docs/CI:** documented `ALCHEMY_API_KEY`; added a GitHub Actions workflow.


Newest first. This file replaces the per-change README files that used to sit
in the repo root; nothing from them is lost, it is condensed here.

## Hardening and cleanup pass (2026-09-28)

**1. Escaping of third-party text** (`app.js`, `popup.js`)
`escapeHtml()` did not escape quote characters, so a `"` in a value could break
out of an attribute like `src="..."`. It now escapes `& < > " '`. Added it to
every place third-party text reached `innerHTML` unescaped: CoinGecko coin
name/symbol (row text, `aria-label`, `title`), Polymarket question / outcome /
volume, the on-chain token symbol and decoded function name on the
approve-transaction screen (attacker-controlled: anyone can deploy a token with
any symbol), and `e.message` on the extension's approval-error screen.
`tokenIconHtml()` only accepts `https://` image URLs.

**2. Rate limiters can no longer be bypassed** (`client-ip.js` new, six API files)
The swap-quote, Transak, Coinbase and feature-request APIs took the FIRST
`X-Forwarded-For` entry as the client IP, which a client can forge to dodge a
per-IP limit and burn 0x/Transak/Coinbase quota. One shared `clientIp(req)` now
counts from the right, skipping `TRUST_PROXY_HOPS` proxies (default 1 = Railway).
Still open: limiters are in memory and reset on redeploy.

**3. CORS restricted** (`cors.js` new, swap-quote / Transak / Coinbase APIs)
Was `Access-Control-Allow-Origin: *`, so any website could make a visitor's
browser spend your quota. Now only `https://www.tokenswaphub.org`,
`https://tokenswaphub.org`, `https://web-wallet-production.up.railway.app` and
the published extension (`chrome-extension://adiihfpfinmhikjiopobbeigcfaoepko`)
get the header; extras via `ALLOWED_ORIGINS`. CORS only constrains browsers;
curl and scripts are covered by the per-IP limits.

**4. Security headers and CSP** (`security-headers.js`, `sw-register.js` new; `server.js`, `index.html`, `app.js`)
Content-Security-Policy (own scripts only, no inline scripts, no eval; frames
only for Transak/Coinbase/Onramper), `frame-ancestors 'none'` and
`X-Frame-Options: DENY` (anti-clickjacking), `X-Content-Type-Options`,
Referrer-Policy, Permissions-Policy, and HSTS over https. The inline
service-worker registration moved to `sw-register.js`; the inline `onerror` on
token logos became one delegated listener. Set `CSP_REPORT_ONLY=1` if a deploy
looks broken. Known limits: `connect-src` allows any `https:`/`wss:` host
(RPCs are user-configurable) and `style-src` keeps `'unsafe-inline'`.
Not yet checked live: Transak/Coinbase/Onramper widgets and WalletConnect
pairing (try Buy and a pairing once after deploying).

**5. Extension permissions and an address leak** (`manifest.json` 0.11.1 -> 0.11.2, `content-script.js`)
Removed the unneeded `tabs` permission. Fixed a real bug: the background worker
tags `accountsChanged`/`chainChanged` broadcasts with the one origin they are
meant for, but the content script never checked the tag, so connecting to site A
sent your address to every open page. Pages now only receive events addressed
to their own origin. `host_permissions` deliberately left as is: the background
worker fetches custom RPCs, NFT metadata and APIs that rely on it to skip CORS.
Fixed since: `wallet_switchEthereumChain` now asks first (see Unreleased).

**6. `playwright` removed** (`package.json`, `package-lock.json`)
Listed as a production dependency but used nowhere; it only slowed installs.

**7. `.gitignore` and tests** (`.gitignore`, `tests/`, `package.json`, `.github/workflows/test.yml`)
67 dependency-free tests (`npm test`) covering vault crypto, fee math, swap
helpers, wallet derivation, the server helpers from items 2 to 4, and repo
layout consistency.

**8. Repo cleanup** (this change)
Consolidated the six scattered READMEs into `README.md` and this file. Removed
the nested `token-exchange-deploy-repo.zip`, the screenshots and store art, and
`new-files-contents-reference.txt` from the repo. Stopped `server.js` copying
the extension's `manifest.json` into the public website (`/manifest.json` was
being served; the site uses `site.webmanifest`). Added checks that fail on
stray archives, unreferenced images and undocumented environment variables.

**9. Offline shell fixed** (`sw.js`, `tests/service-worker.test.js` new)
`PRECACHE_URLS` listed 11 files and none of the `/lib/*`, `/vendor/*` or
`/fonts/*` files the page loads, and it pointed at `/img/` files while missing
others, so offline the app opened with no wallet code. It now lists all 61
files the site loads (scripts, vendored libraries, translations, fonts, images,
flags). Install also no longer uses `cache.addAll()`, which is all-or-nothing:
one 404 used to leave the cache empty, now it only skips that file.
`CACHE_NAME` bumped to `token-exchange-shell-v3` so old caches are cleaned up.
Network-first for wallet code is unchanged. A new test fails if `index.html` or
`app.css` load a file that is not precached, or `sw.js` lists a file the server
does not serve, so the list cannot silently go stale again.

**10. Shared front-end code** (`ui-common.js` new; `app.js`, `popup.js`, `index.html`, `popup.html`, `server.js`, `sw.js`)
`app.js` and `popup.js` had 22 identical blocks (16 functions plus their
constants: `escapeHtml`, `sendMsg`, `showScreen`, the cube-nav helpers, currency
formatting, network/token colours and so on), each pasted twice, which is how
the two drift apart (fix #1 had to be made in both). They now live once in
`ui-common.js` (193 lines removed from each file), loaded before `app.js` /
`popup.js` on the site and in the popup. Pure move: nothing was rewritten.
`tests/shared-ui.test.js` fails if a shared name is redeclared in `app.js` or
`popup.js`, or a page stops loading `ui-common.js`. Extension build: add
`ui-common.js` to the extension's `lib/` folder. Not merged: functions that
differ (`refreshMain`, `refreshBalance`, `showError`, `tokenIconHtml`), and the
rest of the two files, which are ~90% the same text but with many small
differences; merging those safely needs a browser test setup first.

## Earlier changes (undated)

### Network switcher redesign
The dashboard's "Network" row is now a neon-sign picker: tapping it opens a
bottom sheet with every network as a glowing sign (Ethereum, Base, Polygon, BNB,
Arbitrum, Optimism), two per row, each in its brand colour; the current network
has a gold ring and tapping another switches and closes the sheet. Base's icon
was redrawn so the divider line and dot read at small size. Custom networks
appear too, as a plain circle with their first letter (long names shrink and
truncate). The small network badge in the header is unchanged.
Files: `app.js`, `index.html`, `app.css`.

### Back button restored
Every "Back" (and one "Cancel") button is a floating gold pill pinned to the
top-left (`.top-back-btn`), so it stays visible while scrolling long lists, with
a slow glow pulse that turns off under "reduce motion". It had been lost in an
old upload mix-up and was ported back from an older copy, adapted to the
gold-frame desktop layout. 23 buttons converted in `index.html`; styles in
`app.css`; no `app.js` change (`data-back` and `showScreen()` were already generic).

### Known-stablecoin registry
`KNOWN_STABLECOIN_ADDRESSES` in `app.js` holds hand-verified issuer addresses
(never guessed): EURC on Ethereum and Base; USDC on Ethereum, Base, Polygon,
Arbitrum One, OP Mainnet; USDT on Ethereum. JPYC and BRZ were deliberately left
out because several contracts share each name with no single official source.
It powers three things: the coin-detail fallback ("switch to Ethereum/Base and
we'll add it") instead of a dead end when a coin is not on the current network;
"Quick add" chips on the Add Token screen (they only fill the address and run
the normal on-chain lookup, so the confirm step stays); and a green "On
Ethereum Mainnet, Base" availability line on stablecoin-backed rows in the
Currencies tab. Files: `app.js`, `en.js`, `app.css`, `index.html` (`#add-token-quick`).

### RPC failover for Approve
"Couldn't get a response from the network" during Approve happened because
`TM_SWAP_APPROVE` / `TM_SWAP_ALLOWANCE` committed to one RPC node chosen by a
cheap read check, and public nodes fail on writes more often than reads.
`wallet-engine.js` now has `withRpcFailover(network, action)`, which tries each
of the network's RPC URLs in turn (healthy one first) but only for node and
transport errors; real failures (a revert, bad nonce, rejected signature) are
rethrown immediately so the true error still shows. Deliberately NOT applied
to `TM_SWAP_EXECUTE` (the broadcast): retrying a write after a node may already
have accepted it could submit a second transaction, so that path needs its own
careful design. `TM_SWAP_QUOTE`'s router fallback has the same single-node
exposure but was not the cause.

### Swap quotes were failing for every pair
`wallet-engine.js` called `TM_SWAP.tryAggregatorQuote(...)` and
`TM_SWAP.executeAggregatorSwap(...)`, but neither existed in `lib/swap.js`, so
every swap with a selected account crashed before reaching the on-chain router
fallback (and aggregator-quoted swaps silently took the fallback path while
still being charged the higher aggregator fee). Both were added to `swap.js`:
`tryAggregatorQuote` calls the backend's `/api/swap-quote` by absolute URL (the
file is shared with the extension) and returns `null`, never throwing, whenever
no aggregator route exists; `executeAggregatorSwap` broadcasts the transaction
0x prepared. A token with no 0x liquidity (like NOVA) now falls through to the
plain router quote or gives an honest liquidity error.

### Transak opens in-app (website and full-page app)
Buy/Sell embed the Transak widget in an `<iframe>` (`allow="camera;microphone;payment"`)
instead of `window.open`. Each screen toggles between an intro view
(`#buy-intro` / `#sell-intro`) and a widget view (`#buy-widget` / `#sell-widget`);
closing or backing out sets the iframe to `about:blank` (releasing camera/mic
mid-KYC) and reopening always starts at the intro, never a stale 5-minute
single-use URL. The backend (`transak-widget-api.js`) was unchanged. The
extension's small toolbar popup deliberately still opens Transak in a new tab:
Transak warns the KYC camera step is unreliable in a popup that can lose focus
and auto-close. Files: `index.html`, `app.js`, `app.css`, `en.js`.
