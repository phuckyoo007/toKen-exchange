# Changelog

## Unreleased -- swap history + wallet scan

- **Activity -> Swaps tab (extension):** Activity now has Sends | Swaps tabs. Each successful swap
  is recorded locally (`tm_swap_history`, last 100) and links to the block explorer.
- **Scan wallet (extension + website):** new "Scan wallet" button next to "+ Add token". It checks
  the account for the verified stablecoins (`known-tokens.js`) plus the top ~250 CoinGecko-listed
  tokens on the current network, using Multicall3 (one-by-one fallback), and lists what it holds
  with Add / Add all. Nothing is added automatically, and unlisted/airdropped tokens are never
  shown. New message `TM_SCAN_TOKENS` in `background.js` and `wallet-engine.js`; shared code in
  `token-scan.js` (logic) and `token-scan-ui.js` (screen).
- **Scan wording is English-only for now** (kept in the `S` object in `token-scan-ui.js`); the
  Swaps-tab strings are translated in all nine languages.
- Service worker cache bumped to v10 (two new precached files).

## Unreleased -- audit follow-up

- **Security (extension):** `wallet_switchEthereumChain` changed the active network with no
  prompt, so any connected site could move the wallet to another chain. It now opens a
  `switchNetwork` approval screen (origin, from, to), answers EIP-1193 4001 on reject, and
  does not prompt when the wallet is already on that chain. New strings in all nine languages.
- **Swap -- slippage:** `msg.slippageBps || 100` turned an explicit 0 into 1% and accepted any
  value. `TM_SWAP.normalizeSlippageBps` now defaults only when the value is missing and
  rejects anything but a whole number from 1 to 5000, in both the extension worker and the
  website engine. The 0x route saved at quote time remembers its slippage and is only reused
  for that same tolerance; if the user changed it after quoting, the swap asks for a fresh
  quote instead of quietly switching route and fee.
- **Swap -- the quote the user saw:** both UIs now send `quotedAmountOutWei` with
  `TM_SWAP_EXECUTE`, and the router path derives its minimum output from it instead of from a
  fresh quote taken just before sending. If the price has already fallen past the tolerance the
  swap is refused **before the app fee is taken**. The website re-quotes when the slippage
  selector changes; the popup hides the stale quote. The quote request now carries the chosen
  slippage (it used to quote 0x at the default regardless of the selector).
- **Request ids:** `newRequestId()` uses `crypto.randomUUID()` instead of `Math.random()`.
- **Server:** `server.js` no longer dies on one bad request or rejected promise (logs, answers
  500). A missing vendored library or a busy port now prints what to do. Adds `GET /healthz` and
  a clean shutdown on SIGTERM.
- **Server:** one shared body reader, `read-body.js`, replaces five copies. Sizes are counted in
  bytes and an oversized body gets a real 413 instead of a dropped connection. Per-endpoint caps
  are unchanged (10 KB Transak/Coinbase, 16 KB feature requests, 8 KB admin, 96 KB auth).
- **Translations:** every non-English file now defines the same 422 strings as `en.js` (each was
  missing 187 and carried 37 unused ones). The new strings are machine translations -- have a
  native speaker review them, especially the send-delay and auto-lock hints and the new
  "Trending Coins" wording. Removed the unused `account.*`, `onboarding.siteNotice*` and
  `buy.description2Html` strings.
- **Bug fix (English):** `en.js` lacked `swap.getQuoteBtn`, `swap.netAmountLine` and
  `swap.estimatedOutLine` (used by the extension), the `findNfts.*` / `main.findNftsBtn` strings
  and `swap.flipBtnTitle` (used by the website), so English users saw raw key names. Added in
  all nine languages.
- **Bug fix (swap fee row):** the website and the extension shared `swap.appFeeLine` with
  different placeholders. The website row now uses `swap.appFeeValue`; `swap.appFeeLine` is the
  extension's "App fee ({percent}): {amount}".
- **Tests:** `tests/slippage.test.js` (validation, shown-quote minimum, refuse-before-fee, against
  a fake chain), `tests/read-body.test.js`, `tests/i18n.test.js` (keys, FAQ ids, `{placeholders}`
  and "every key the pages ask for exists in English"). 143 tests pass.
- **Repo:** removed the nested deploy zip, eleven README-*/notes files, the duplicate store
  listing and `DELETE-AND-MOVE.txt`; store screenshots live outside the repo; added `.gitignore`
  and a GitHub Actions workflow. `sw.js` cache bumped to v9. `accounts-api.js` is untouched
  (the README still documents it as optional and not wired in).

## 2026-09-28 — second-pass audit

- **Admin console wired in:** `admin-api.js` and `admin.html` existed but
  `server.js` never loaded them. Now `/admin.html` and `/admin.js` are served
  and `/api/admin/*` is routed through `handleAdminApi`. `admin.html`'s
  previously-inline `<script>` moved to `admin.js` -- the site's CSP
  (`script-src 'self'`, no inline scripts) would otherwise have silently
  broken the page. The brute-force throttle on bad tokens now keys on
  `clientIp()` (same helper every other endpoint uses) instead of the raw
  socket address, which behind Railway's proxy would have put every caller
  in one shared bucket. Requires `ADMIN_TOKEN` (documented in README); without
  it every admin route still answers 503, as before. 8 new tests
  (`tests/admin-api.test.js`): auth required, wrong token refused, correct
  token returns metadata only (no vault/bundle data), throttle behavior and
  its IP-spoofing resistance, and that no inline script remains. Also
  verified over real HTTP (a temporary local server): 401 unauthenticated,
  200 with the right token, and the page loads under the live CSP header
  with `admin.js` as an external file. `accounts-api.js` (a separate,
  lower-stakes, optional website-accounts feature) is unrelated and still
  not wired in; see README.

- **Security (extension):** any website could request transactions, message
  signatures or `eth_signTypedData_v4`, for any account in the wallet, without
  ever being connected; `wallet_switchEthereumChain` changed the active network
  with no prompt either. `background.js` now requires a connected origin for
  all four (`requireConnectedOrigin`, EIP-1193 error 4100), limited to the
  account that origin was connected with. The same checks were added for
  WalletConnect sessions (`assertWcRequestAllowed`): a paired dapp may only act
  on the chain and account approved at pairing. Typed-data signing is also
  refused when `domain.chainId` doesn't match the selected network (blocks
  cross-chain replay/phishing). 15 new tests in `tests/dapp-gate.test.js`. Not
  run in a loaded extension or against a live WalletConnect pairing: please
  connect to a dapp, sign, switch network, and try one WalletConnect pairing.
- **Auto-lock default raised to 21 minutes:** the site's existing inactivity
  auto-lock defaulted to 5 minutes; people who already chose a value keep it.
  Added a "21 minutes (default)" option; removed the now-stale "(recommended)"
  tag from the 5-minute option.
- **Repo cleanup (again):** the root had re-accumulated an old deploy zip, 11
  stray README/notes files, 9 unused screenshots/art files, and `CHANGELOG.md`
  / `play-store-listing.md` living at the root instead of `docs/`. All moved or
  removed; `tests/repo-clean.test.js` catches this drift again going forward.
  `build-extension.js` also belongs in `scripts/`, not the repo root (it was
  loose there); moved.

## Unreleased

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
Noticed, not changed: `wallet_switchEthereumChain` switches the active network
for any site without a confirmation prompt (MetaMask asks first).

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
