# Token Exchange

A self-custody EVM wallet browser extension with a built-in token swap, in the same
spirit as MetaMask's wallet + Swap feature. This is a working MVP you can load into
Chrome today.

## What's included

- Create or import a wallet (12-word recovery phrase), encrypted at rest with
  AES-256-GCM (key derived from your password via PBKDF2, 310,000 iterations).
- Multiple accounts: additional HD accounts, or import a raw private key.
- Multi-chain: Ethereum, Base, Polygon, BNB Chain, Arbitrum, and Optimism built in,
  plus "Add network" for any other EVM chain.
- Send native coin or ERC-20 tokens.
- Track ERC-20 token balances: the main screen used to show only the native
  coin. Now you can add any token by contract address and see its balance
  (and USD value, where available) right on the main screen -- see "Token
  balance list" below.
- Swap tokens on-chain through a Uniswap-V2-style router -- no aggregator API key
  needed. Enabled by default on all six built-in networks: Ethereum (Uniswap V2),
  Base (Uniswap V2 Router02), Polygon (QuickSwap V2), BNB Chain (PancakeSwap V2),
  Arbitrum (Uniswap V2), and OP Mainnet (Uniswap V2); see "About swap routers"
  below for the verification behind each one, including a caveat on Arbitrum's.
- A built-in 0.5% app fee on every swap (see "How the fee works" below) --
  this is what turns the app into a revenue product rather than just a personal
  wallet.
- Sanctioned-address screening: sends and swaps are checked against a bundled
  OFAC sanctions list before they go out (see "Sanctioned-address screening"
  below).
- Live prices: a "Live prices" screen has a **Crypto** tab (18 core coins plus ~50
  more, searchable, with 24h change and a star-to-pin watchlist) and a
  **Currencies** tab (what 1 unit of each of 42 national currencies is worth
  in your display currency). The main screen shows roughly what your connected
  account's balance is worth. Settings -> Display currency offers 42 fiat
  currencies (USD, EUR, GBP, JPY, CHF, CNY, MXN, NGN, ...) and 5 crypto
  denominations (BTC, ETH, BNB, SOL, XRP). All powered by CoinGecko's free
  public API (see "Live prices" below). Extra coins whose CoinGecko id isn't
  returned are quietly left out rather than shown as "n/a".
  Tapping a coin opens an in-app coin screen (price chart with 24H/7D/1M/1Y
  ranges, market stats, a short description) with a **Swap for <coin>**
  button. Swap is only offered when the coin is the selected network's native
  coin or a token the user has added (matched by symbol) -- the wallet never
  guesses token contract addresses -- and the Swap screen's From list shows
  only what the user actually holds.
- Buy crypto: a "Buy" button opens MoonPay's hosted on-ramp widget in a new
  tab so you can purchase crypto with a card or bank transfer and send it to
  your wallet address (see "Buy crypto (MoonPay)" below).
- Dapp connectivity: injects an EIP-1193 provider (`window.tokenExchange` (alias: `window.tokenMachine`)) plus
  EIP-6963 announcement so sites can discover and connect to it like any other
  wallet, with an approval popup for connect / send transaction / sign message /
  add network requests.
- Help & support chat: a "Need help?" / "Help & support" entry point on the
  onboarding, unlock, and settings screens opens a built-in FAQ chat -- see
  "Help & support chat" below.
- Multi-language UI: a language picker on the welcome screen and in Settings
  covers English, Arabic, Chinese (Simplified), Spanish, French, Hindi,
  Portuguese, Japanese, and Russian, including the Help & support chat in
  whichever language is selected -- see "Languages" below.
- A brief branded startup splash plays on every popup open before the
  wallet UI, the same role MetaMask's fox animation plays -- see "v0.7.2
  startup splash" in "Verification performed" below.

## Load it into Chrome

1. Open `chrome://extensions`.
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and select this folder.
4. Click the puzzle-piece icon in Chrome's toolbar and pin "Token Exchange".
5. Click it, choose "Create a new wallet", set a password, and **back up the
   recovery phrase it shows you** -- that's the only copy, and there is no
   password-reset or account-recovery path other than that phrase.

To try the swap feature, switch to Ethereum, Base, Polygon, or BNB Chain (top
of the main screen), then go to Swap.

## How the fee works (this is the revenue model)

Every swap skims a small percentage off the input amount before anything gets
traded, and sends it to a wallet address you control -- the same pattern
MetaMask (0.875%), the Uniswap Labs web app, and most swap aggregators use.
Configured in one place, `lib/fee-config.js`:

- **Rate: 0.5%** flat, of the input amount (a little over half of MetaMask's 0.875%).
- **Recipient:** `0xd537ff9E2773CeCB7A3C68f174F8Cb3a5d60e4dB`
- **Mechanics:** on a swap, the wallet sends the fee as its own small transfer
  to that address, waits for it to confirm, then swaps the remaining amount
  through the router. That means **two transactions per swap** instead of one
  (a bit more gas for the user) -- the tradeoff for staying fully
  non-custodial with no smart-contract deployment required. The popup shows
  the fee amount and net amount being swapped before the user confirms, so
  it's never a surprise.
- To change the rate or payout address later, edit the two constants at the
  top of `lib/fee-config.js` -- nothing else needs to change.

**Compliance note (not legal advice):** taking a cut on swaps you facilitate
is a common, legal pattern as long as the wallet never custodies user funds
(this one doesn't -- money moves straight from the user's own signed
transactions). That said, once you're charging real users real fees, things
like fee disclosure requirements, tax obligations on the revenue, and
consumer-protection rules can vary by where your users are. Worth a real
lawyer's five minutes before you promote this publicly, especially at scale.

## Sanctioned-address screening

Before any send or swap goes out (both from the popup UI and from a
connected dapp's `eth_sendTransaction`), the wallet checks the sending
account and any explicit destination address against a bundled list of
addresses OFAC has publicly named on its Specially Designated Nationals
(SDN) list -- see `lib/sanctions-list.js`. If either address matches, the
transaction is blocked with a clear error instead of being signed.

This check is entirely local: the list ships inside the extension package
and the check runs on-device, so no address is ever sent anywhere to
perform it -- it doesn't change the "no data leaves your device" privacy
posture described above. It's the same approach Uniswap's own web app and
most reputable wallet/DEX front-ends use.

Be clear-eyed about what this does and doesn't do. It blocks addresses
regulators have already publicly identified (mostly tied to known hacks,
theft, and money-laundering cases). It cannot verify who owns a wallet,
cannot detect funds stolen recently enough that they haven't been added to
a public list yet, and is not a substitute for real KYC/AML compliance --
that requires becoming a licensed, regulated money-service business, which
is a fundamentally different undertaking than a self-custody wallet. Treat
this as a floor, not a guarantee.

The bundled list will go stale. Re-pull it periodically from
`lib/sanctions-list.js`'s source comment (a community mirror of the OFAC
SDN list) or from OFAC directly if you maintain this project long-term.

## Live prices

The "Live prices" screen (a compact card on the main screen shows the same
first few coins, with a "See all" link to the full screen), and the small
USD estimate under your balance, all come from CoinGecko's free, keyless
public API -- see `lib/prices.js`. No API key or account is needed, and the
only thing sent to CoinGecko is "what's the current price of coin X", the
same request any price-ticker website makes -- no address, balance, or
account info is ever included. This is a display-only, best-effort feature:
if CoinGecko is unreachable or rate-limits the request, the price simply
doesn't show rather than blocking anything else in the wallet.

Prices are cached in memory for 45 seconds to stay comfortably under
CoinGecko's free-tier rate limit (roughly 10-30 requests/minute per IP).

## Trending Markets (Polymarket, read-only)

The main screen's "Trending Markets" card, and its own "See all" screen,
show a handful of currently-popular Polymarket prediction markets -- crypto
up/down questions, sports moneylines, and similar -- pulled from
Polymarket's public, keyless Gamma API (see `lib/polymarket.js`), the same
data anyone sees on polymarket.com. This is purely informational, the same
way MetaMask's Portfolio shows a "Markets" widget: **Token Exchange does not
place bets, hold a position, or make any contract call related to
Polymarket** -- it only reads and displays the public odds (the primary
outcome's name and its current implied probability as a percent) and 24h
volume. Best-effort like the prices feature: an unreachable Polymarket API
just leaves the card/screen showing a quiet "unavailable" note.

## Buy crypto (MoonPay)

The "Buy" button opens MoonPay's hosted widget (`https://buy.moonpay.com/`)
in a new browser tab -- see `lib/buy-config.js`. MoonPay is a separate,
regulated third-party on-ramp; Token Exchange never touches your payment
details or identity documents, and once that tab opens you're interacting
directly with MoonPay under MoonPay's own privacy policy and terms, not
this extension's.

Two things worth knowing:

- **This needs your own MoonPay publishable API key before it'll work.**
  Sign up at https://dashboard.moonpay.com, grab your publishable key
  (`pk_test_...` for sandbox, `pk_live_...` once approved for production),
  and put it in the constant at the top of `lib/buy-config.js`. Until
  that's filled in, the Buy button tells the user Buy isn't configured yet
  rather than opening a broken widget.
- **Your wallet address is not pre-filled into the widget.** MoonPay
  requires that parameter to be part of a cryptographically signed URL
  (signed with your MoonPay *secret* key), and the secret key must never
  ship inside a browser extension -- anyone who installs the extension
  could extract it from the package and use it as if they were you. So
  instead, the Buy screen shows your address with a Copy button, and you
  paste it into MoonPay's widget yourself once it opens. A future
  improvement could add a small backend that signs the URL server-side
  (keeping the secret key off the client) to remove that one extra step.
- Only the `eth` currency code (Ethereum mainnet native ETH) is pre-selected
  automatically, because that's the one code this project could directly
  verify against MoonPay's own documentation. Base, Polygon, BNB Chain,
  Arbitrum, and OP Mainnet were actively re-researched (MoonPay's docs, the
  public currencies API -- blocked by their robots.txt for automated
  fetching -- and third-party integration guides) and still came up empty,
  so those networks open the widget with MoonPay's full currency picker
  instead of guessing a code that might be wrong. See the comment in
  `lib/buy-config.js` for the full trail, and add a code there yourself once
  you can confirm one from your own MoonPay dashboard.

## Swap, buy, and sell from any currency or coin

Every row on the Live prices screen opens a detail screen with actions:

- **Currencies tab** -- every currency is listed, including your own display
  currency (USD used to drop out of the list when it was the display currency).
  Tapping a currency offers **Swap for <stablecoin>** when a verified, liquid
  token for it exists on your network (USD -> USDC on all six built-in
  networks; EUR -> EURC, JPY -> JPYC, AUD -> AUDD, BRL -> BRZ where verified).
  If a currency has no such token, or none on any supported network, the swap
  falls back to USDC (a US-dollar stablecoin) with a note saying so -- it never
  invents a token for a currency.
- **Buy with <currency>** opens MoonPay's Buy widget in that currency.
- **Sell to my bank (<currency>)** opens MoonPay's Sell widget paying out in that
  currency. Cashing out is two steps because MoonPay hands you a deposit
  address: paste it (and the quoted amount) into "Step 2" on the Sell screen and
  the wallet opens Send with both filled in for you to review and confirm.
  Nothing is sent automatically.
- Currencies outside MoonPay's eight known codes (USD, EUR, GBP, JPY, CAD, AUD,
  INR, BRL) open MoonPay with its own currency picker.
- Not yet applied to the browser-extension popup (`extension-updated-icons/`),
  which doesn't have the Currencies tab.

## Help & support chat

A "Need help?" link on the onboarding and unlock screens, and a "Help &
support" button in Settings, opens a chat-style screen for common questions
(creating/importing a wallet, a forgotten password, a stuck swap, the 0.5%
fee, adding a network or token, dapp connections, MoonPay issues, and so
on). Tap one of the suggested topic chips or type a question in your own
words.

This is a deterministic, fully client-side FAQ matcher (`lib/support-faq.js`)
-- not a real AI model. It scores your question against a fixed set of
written answers by keyword overlap and shows the closest match, or an honest
"I don't have a written answer for that yet" if nothing scores well enough.
Nothing you type is sent anywhere: there's no network call, no API key, and
no backend, which keeps it consistent with the rest of the extension's
no-backend, non-custodial design and avoids a real LLM's risk of
hallucinating wrong information about your wallet or funds. If you want a
human fallback contact shown for unanswered questions, set
`SUPPORT_CONTACT_EMAIL` in `lib/support-config.js` (blank by default).

## Languages

A language picker on the welcome screen (before you even create or import a
wallet) and another in Settings switch the entire UI -- every screen, button,
error message, and the Help & support chat -- between English, Arabic
(العربية), Chinese Simplified (中文（简体）), Spanish (Español), French
(Français), Hindi (हिन्दी), Portuguese (Português), Japanese (日本語), and
Russian (Русский). Arabic also switches the layout to right-to-left. Both
pickers show a representative country flag next to each language name (the
usual language-picker convention -- a flag stands in for the country most
associated with a language, not a claim it belongs only to that place).

The wallet defaults to whichever of these languages matches your browser's
own language setting (falling back to English if your browser is set to a
language not in this list), but you're never stuck with that: change it any
time from Settings, and the choice is remembered on this device via
`chrome.storage.local`. This is a from-scratch, self-contained implementation
(`lib/i18n.js` + one `lib/i18n/<code>.js` file per language) rather than
Chrome's built-in `chrome.i18n`/`_locales` system, specifically so the
language can be chosen from inside the wallet instead of only following the
browser's UI language.

The Help & support chat's FAQ (see "Help & support chat" below) is written
natively in each language rather than translated on the fly -- both the
answers and the keyword matching against what you type work in whichever
language is currently selected. Network/service names (Ethereum, Base,
MoonPay, CoinGecko, etc.) and a handful of internal protocol-level strings
sent back to connecting dapps (e.g. "user rejected transaction") are left in
English on purpose -- the former because that's how you'll encounter those
names everywhere else, the latter because dapp-side code, not a human, reads
them.

**On translation quality:** these are AI-generated translations, not yet
reviewed by native speakers of each language. Each language file was checked
programmatically against the English source for structural correctness (no
missing UI strings, no missing FAQ entries, no corrupted `{placeholder}`
tokens) and spot-checked for fluency, but a native-speaker review pass --
especially of the security-critical wording around the recovery phrase and
password reset -- is worth doing before leaning on it heavily for real funds
at scale. If you (or a native speaker you trust) spot a translation that
should be improved, it's a self-contained edit to that one
`lib/i18n/<code>.js` file.

## Token balance list

The main screen now has a "Tokens" section below the native balance. Tap
"+ Add token", paste in an ERC-20 contract address on the current network,
and "Look up" reads the contract's own `name()` / `symbol()` / `decimals()`
directly on-chain -- shown as a preview -- before you confirm adding it.
Nothing is ever stored based on what you typed for symbol or decimals; it's
always what the contract itself reports. Once added, the token shows its
live balance (and, where CoinGecko recognizes the contract address, a USD
value) on the main screen, and can be removed with the × button on its row.

This is a "watch list" in the same sense as MetaMask's "Import tokens" --
it's a display feature only. Tracked tokens are per-network (an address on
Ethereum and the same address on Polygon are tracked independently, since
they're unrelated contracts even if a token happens to exist at both), and
per-installation (stored in `chrome.storage.local`, alongside everything
else -- see "What's stored, and where" territory in the privacy policy).
Adding a token doesn't grant it any special access to your wallet; it's the
same read-only `balanceOf` call the Swap and Send screens already make for
whatever token address you type in there.

USD values come from CoinGecko's `/simple/token_price/{platform}` endpoint,
which prices a token **by contract address** rather than by a per-coin id
-- see `lib/prices.js`. This matters because it sidesteps the exact
guessing problem every other CoinGecko integration in this project has had
to work around (mapping a symbol to the right id): there's no id to guess
for an arbitrary user-added token, just the address you already have. The
per-network "platform id" CoinGecko needs for this (`ethereum`, `base`,
`polygon-pos`, `binance-smart-chain`, `arbitrum-one`,
`optimistic-ethereum`) was verified the same way as the swap routers above
-- by confirming each one's actual CoinGecko chain page loads at that
exact slug (a wrong slug 404s, which is exactly how `optimism` was caught
as wrong -- the real one is `optimistic-ethereum`).

If CoinGecko doesn't recognize a token's contract address (a very new
token, or one it simply hasn't indexed), the row still shows the on-chain
balance with no USD value, rather than an error -- pricing is best-effort
layered on top of a balance display that always works as long as the RPC
call succeeds.

Verified end-to-end in headless Chromium against a mock ERC-20 contract
(`test-token-list.js`): looking up a token shows the correct preview before
adding, adding shows the correct balance formatted to the token's own
decimals, adding the same token twice is rejected, an invalid address is
rejected with a clear error, and removing a token clears it from the list
-- all with zero console/page errors.

## RPC fallback

Every built-in network lists at least one RPC endpoint (Ethereum lists two:
`cloudflare-eth.com` and `eth.llamarpc.com`). Before v0.3.1, the wallet only
ever used the first one -- if it had a bad moment, every balance check,
quote, send, or swap on that network failed outright, even though a working
backup was sitting right there in the config and never got used.

Now, before making a real RPC call, the wallet does a quick health check
(a cheap `eth_getBalance` call against the zero address, ~3s timeout) down
the list of that network's RPCs and uses the first one that actually
answers correctly -- see `pickHealthyRpcUrl()` / `getProviderFor()` in
`background/background.js`. The choice is cached for 20 seconds per network
so normal use (loading the balance, then getting a swap quote a moment
later) doesn't re-check on every single call. If every listed RPC fails the
check, it falls back to the first one anyway so you see the real
underlying error instead of a health-check artifact. The generic RPC
passthrough used for dapp requests (`rpcPassthrough()`) does the equivalent
thing per-call: try each URL in order, fall through to the next on failure.

This was verified against the exact failure this was built to fix: a
mocked RPC returning `{"error":{"code":-32603,"message":"Internal
error"}}` for `eth_getBalance` (word-for-word what a real user hit against
`cloudflare-eth.com` in practice) now correctly falls through to a working
backup instead of failing the balance check -- see
`test-rpc-fallback.js`.

## About swap routers (read before using real funds)

Swapping works by calling a Uniswap-V2-style router contract directly -- there's
no off-chain price API. Getting a router address wrong doesn't just fail
quietly, it can send a transaction to the wrong contract, so every router
address in `lib/networks.js` was checked against a block explorer or
official docs before being hardcoded, not guessed. Confidence varies
slightly by chain, noted here for transparency:

- **Ethereum -- Uniswap V2.** The original, well-known deployment.
- **Base -- Uniswap V2 Router02.** Confirmed as a verified contract on
  BaseScan.
- **Polygon -- QuickSwap V2.**
- **BNB Chain -- PancakeSwap V2.**
- **OP Mainnet -- Uniswap V2 Router02.** Confirmed directly: fetched
  optimistic.etherscan.io, contract verified with an exact source match,
  named `UniswapV2Router02`, same compiler version as the original mainnet
  deployment. Same address as Ethereum mainnet's.
- **Arbitrum One -- Uniswap V2 Router02, same address as Base's.** This one
  carries a caveat: arbiscan.io was blocking automated verification
  attempts when this was checked (2026-09-07), so instead of a direct
  fetch, this rests on two independent sources agreeing -- Arbiscan's own
  page title as indexed by search ("Uniswap V2: Router" at that exact
  address on Arbitrum One) and a third-party router-address aggregator
  listing the same address for the same chain. That's meaningfully more
  than a guess, but it's one notch below the direct confirmation the other
  five chains got. **If you're moving significant funds, spend ten seconds
  confirming `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` yourself on
  arbiscan.io before trusting it.**

If you ever add a network yourself, look up its router address from the
actual project's own documentation or the chain's block explorer "verified
contract" page, then add it via Settings -> Add network (or edit
`lib/networks.js` directly). Don't take a router address from a search
result or a stranger's message without checking it against a primary
source yourself -- and be aware that the same address can be a completely
different, unrelated contract on a different chain (this came up directly
while researching Arbitrum/Optimism: one candidate address that looked
promising turned out to be Uniswap's router on one chain and an entirely
unrelated contract called "MasterDeployer" on another).

## Known limitations (read this too)

- **This has not been professionally security-audited.** It's a solid MVP
  built with standard practices (encrypted local vault, keys never touch
  disk unencrypted, private keys never leave the background worker), but
  "not audited" means exactly that. Don't put a meaningful amount of money
  behind it without an independent review first.
- **Manifest V3 service workers are ephemeral.** Chrome can unload the
  background worker after ~30 seconds of inactivity, which clears the
  unlocked wallet from memory -- you may need to re-enter your password more
  often than in some other wallets. This is a deliberate trade-off for this
  MVP rather than a bug; a follow-up could add an offscreen document or a
  keep-alive alarm to reduce it.
- **No mobile app yet.** This build is the browser extension only, per the
  "extension first" scope -- a React Native version reusing `lib/wallet.js`,
  `lib/networks.js`, and `lib/swap.js` (all plain JS, no browser-only APIs
  except the encrypted-vault crypto calls) would be the natural next step.
- **RPC endpoints are the free public ones** for each chain (e.g.
  `mainnet.base.org`). They can rate-limit or transiently error under load
  (see "RPC fallback" below for how the wallet now handles that); swap in
  your own Infura/Alchemy/QuickNode URL in `lib/networks.js` if you hit that
  regularly.
- Gas price/limit estimation is left to the wallet's `sendTransaction`
  defaults (ethers.js auto-estimates); there's no gas-fee customization UI
  yet.

## Project layout

```
manifest.json              MV3 manifest
background/background.js   Service worker: wallet state, signing, dapp RPC handling
content/content-script.js  Isolated-world bridge (page <-> background)
content/inject.js          Main-world EIP-1193 / EIP-6963 provider injected into pages
lib/wallet.js              Mnemonic/key derivation + encrypted vault
lib/crypto-utils.js        PBKDF2 + AES-GCM helpers (Web Crypto)
lib/networks.js            Built-in chain configs + custom network storage
lib/swap.js                Uniswap-V2-style router quote/swap logic
lib/fee-config.js          Swap fee rate + payout address (the revenue model)
lib/sanctions-list.js      Bundled OFAC sanctioned-address list + local screening check
lib/prices.js              CoinGecko live USD price lookups (loaded directly into the popup)
lib/polymarket.js          Polymarket trending-markets read-only lookups (loaded directly into the popup)
lib/buy-config.js          MoonPay widget URL builder for the Buy button (loaded directly into the popup)
lib/i18n.js                Language-picker engine: t()/apply()/setLanguage(), RTL handling, and the
                            Help & support chat's language-aware FAQ matching (see "Languages" below)
lib/i18n/<code>.js         One file per supported language (en/ar/zh/es/fr/hi/pt/ja/ru): every UI
                            string plus that language's own Help & support FAQ, keywords, greeting,
                            and fallback message
lib/support-config.js      Contact email shown by the Help & support chat's fallback message
popup/                     All UI screens (onboarding, unlock, wallet, settings, dapp approvals);
                            popup/popup.html also holds the golden slot-machine header logo (inline SVG)
popup/img/splash.jpg       Startup splash artwork shown briefly on every popup open (see "What's
                            included" above)
popup/fonts/               Self-hosted Fredoka woff2 files (@font-face, no CDN reachable at runtime)
vendor/ethers.umd.min.js   Bundled locally (MV3 CSP blocks remote scripts)
icons/                     Placeholder icon set
test-load.js               Optional: Playwright script that loads the unpacked
                            extension into real Chromium and exercises the core
                            flows end to end (wallet creation, accounts, network
                            switching, seed export, swap-availability gating).
                            Requires `npm install playwright` to run; not needed
                            to use the extension itself.
test-i18n.js               Optional: Playwright script covering the language
                            picker (manual switching, RTL for Arabic, FAQ chat
                            answering in the selected language) and browser-
                            locale auto-detection for both a supported and an
                            unsupported locale.
verify-i18n-parity.js      Optional: Node script (no browser) that checks every
                            lib/i18n/<code>.js file defines the exact same UI
                            string keys and FAQ ids as lib/i18n/en.js, and that
                            no {placeholder} token was dropped in translation.
```

## Verification performed

`test-load.js` was run against the actual built extension in headless Chromium
and confirmed, with zero console/page errors: wallet creation produces a valid
12-word phrase and address, the account/network selectors populate correctly,
adding a second account works, viewing the recovery phrase after re-entering
the password returns the exact original phrase, and the Swap screen correctly
enables itself on both Ethereum and Base now that Base has a verified router.
Live swap execution (and therefore the actual fee transfer) and balance
fetching against real RPC endpoints could not be exercised from this
sandboxed build environment (outbound network calls to public RPCs are
blocked here) -- test a real swap on a small amount first from your own
machine with normal internet access before relying on it.

The sanctioned-address check was unit-tested directly against
`lib/sanctions-list.js`: a known-sanctioned address correctly throws and
blocks the transaction, a normal address correctly passes through, and
the full Playwright regression suite above still passes with zero
console/page errors after the check was wired into every send/swap path.

`lib/prices.js` and `lib/buy-config.js` were unit-tested directly (mocked
`fetch`, mocked API key) to confirm correct CoinGecko id mapping, in-memory
caching, and MoonPay URL construction. `test-prices-buy.js` (same pattern
as `test-load.js`) drives the actual Prices and Buy screens end to end in
headless Chromium: Prices shows a clear error instead of crashing when
CoinGecko is unreachable (expected in this sandboxed build environment,
which has no outbound internet access), Buy shows a clear "not configured"
error when no MoonPay key is set, and -- verified separately with a
temporary test key -- correctly opens a new tab pointed at MoonPay's widget
with the right query parameters once a key is configured. Zero console/page
errors in either case. Test a live price load and a real MoonPay handoff
from your own machine with normal internet access before relying on them.

`test-rpc-fallback.js` verifies the RPC-fallback fix (see "RPC fallback"
above) against two local mock RPC servers inside real headless Chromium:
one reproduces the exact `-32603 Internal error` a real user hit against
`cloudflare-eth.com` on `eth_getBalance`, the other answers normally. The
new `getProviderFor()` correctly falls through to the working one, a plain
single-URL provider against only the broken one still fails the same way
it always did (confirming the test reproduces the real bug), and
`rpcPassthrough()` recovers the same way for dapp-forwarded calls.

`test-token-list.js` verifies the token balance list (see "Token balance
list" above) against a mock ERC-20 contract served behind a local RPC (its
`decimals()` / `symbol()` / `name()` / `balanceOf()` responses are real
ABI-encoded return data via ethers' own encoder, not hand-rolled hex), run
end to end in headless Chromium against the real, unmodified extension
code: looking up the mock token shows the correct name/symbol/decimals
preview, adding it shows the correct balance formatted to its own
decimals, adding the same address twice is rejected, an invalid address is
rejected with a clear error before any RPC call is made, and removing the
token empties the list again -- zero console/page errors throughout.

**v0.5.1 visual polish pass** (`popup/popup.css`, plus small tweaks in
`popup.html`/`popup.js`) was cosmetic only -- no message handlers, storage
keys, or screen IDs changed. Verified by re-running all four Playwright
suites above against the updated markup/styles (all still pass with zero
console/page errors) and by rendering every screen in headless Chromium and
comparing before/after screenshots. The concrete changes: a persistent
footer closes off what used to be a noticeable empty gap at the bottom of
shorter screens (Send, Swap, Settings, Prices, Buy, Add token); the popup
now has `max-height: 600px` with `overflow-y: auto` so it scrolls
internally instead of growing unboundedly or clipping once a user tracks
enough tokens or the price list is long (there was previously no safety
net for that at all); the tokens list, live-prices list, and network
picker are now visually grouped as cards; `.error`/`.warn`/`.hint` messages
are boxed and color-coded the same way instead of `.error` being bare
colored text while `.warn` was boxed; buttons, links and inputs got
`:focus-visible` rings and smoother hover transitions; screens fade in on
navigation; and the header logo was slightly reduced (296px vs 336px max
width, tighter padding) so it doesn't dominate screens that are mostly
forms. The balance display also now gets a subtle pulse animation while
loading instead of sitting static, and shows `--` instead of getting stuck
on `...` if the balance fetch fails.

**v0.6.0 Help & support chat** (`lib/support-faq.js`, `lib/support-config.js`,
plus the new `#screen-support` markup/styles/wiring in
`popup.html`/`popup.css`/`popup.js`) adds the FAQ chat described above. It
introduces no new permissions, storage keys, or network calls. Verified with
a new `test-support-chat.js` Playwright suite covering all three entry
points (onboarding, unlock, settings), the greeting not repeating on a
second open, a topic-chip answer, free-text matching by click and by Enter
key, the honest fallback for an unmatched question, and the back button
returning to the right screen -- zero console/page errors. Also re-ran all
four pre-existing suites against the changed markup/JS to confirm no
regressions (all still pass with zero unexpected console/page errors).

**v0.7.0 multi-language UI** (`lib/i18n.js`, nine new `lib/i18n/<code>.js`
files, plus `data-i18n*` attributes and a language picker added throughout
`popup.html`/`popup.js`/`popup.css`) adds the language support described in
"Languages" above. `verify-i18n-parity.js` confirms all nine language files
share the exact same UI string keys, the same 18 FAQ entry ids in the same
order, and no dropped `{placeholder}` tokens. A new `test-i18n.js` Playwright
suite confirms: the language picker actually changes visible text and (for
Arabic) sets right-to-left layout; the Help & support chat answers a topic
chip and free-text questions in the selected language (tested in both
Arabic and Chinese); a full wallet-creation flow works end to end in a
non-English language; and the wallet correctly auto-selects a supported
language from the browser's own locale, or falls back to English for an
unsupported one -- zero console/page errors throughout. Also re-ran all five
pre-existing suites (including the v0.6.0 support-chat one) against the
changed markup/JS to confirm no regressions.

**v0.7.1 "jackpot" visual pass** (`popup/popup.html`'s inline header SVG,
`popup/popup.css`, cosmetic only) leans further into the slot-machine
identity: the header's coin reels got a soft colored glow behind each coin,
the side lever is now a bright pink handle instead of gold-on-gold, headings
pick up a warm gold glow, and every button (plus the settings gear and the
language/network dropdowns) became a fully rounded "pill" shape with a
stronger raised-coin bevel instead of the previous flat/8px-radius look. No
markup structure, element IDs, or behavior changed -- verified by re-running
all five Playwright suites (zero regressions) and by rendering all 12 major
screens in headless Chromium to check the new look end to end.

**v0.7.2 startup splash** (`popup/popup.html`, `popup/popup.css`,
`popup/popup.js`, `popup/img/splash.jpg`) adds a brief branded splash screen
shown the moment the popup opens, before the onboarding/unlock/main screen
underneath -- the same role MetaMask's fox animation plays. It's the
user-supplied "ETH coin + holographic trading dashboard" artwork, cropped to
the popup's shape, with a small "TOKEN EXCHANGE" wordmark pinned over the top.
It shows for a fixed minimum (900ms) then fades out over 0.4s into whichever
real screen is ready; a 4-second safety timeout force-hides it if startup
ever throws, so a bug can never leave the splash covering the wallet
indefinitely. It's skipped entirely for the small "approve" popup windows a
dapp triggers, where instant responsiveness matters more than a brand
moment. Since Manifest V3 popups are a fresh page load every time they're
opened (there's no persistent app to keep running in the background between
opens), this splash necessarily plays on every open rather than once ever --
that's a platform constraint, not a choice; it's why the hold is short.
Verified with a new `test-splash.js` (image loads, splash shows immediately,
fades and is removed on its own, the right screen is visible underneath
afterward, and it's skipped in approve mode) plus a clean re-run of all four
pre-existing Playwright suites (two of them needed their post-`goto` wait
bumped from 500ms to 950ms so they click through only after the splash's
minimum hold ends -- expected, not a regression) and a fresh 13-screen
render (the splash plus the original 12) to check it end to end.

**v0.7.3 spinning-coin loading indicator** (`popup/img/spinner-coin.png`,
`popup/popup.html`, `popup/popup.css`) adds an actual rotating-coin animation
-- cropped from a second user-supplied image (a 3D Ethereum coin on a plain
background) into a circular, transparent-background PNG -- shown wherever
the wallet is genuinely loading: a small version sits low on the startup
splash for its whole time on screen, and a larger one replaces the plain
"Loading..." text's empty space on `screen-loading` (the brief screen shown
while the wallet checks whether a vault already exists, and the one an
"approve" dapp-request popup would show if that check ever took a moment).
Pure CSS `transform: rotate()` keyframe animation, no JS timers added. The
startup splash itself still uses the original dashboard-scene image --
verified by re-running `test-splash.js` and all four pre-existing Playwright
suites (zero regressions) and a fresh render of the splash and the loading
screen to check the spinner's size and position on both.

**v0.8.0 full-bleed "jackpot" background** (`popup/img/bg-scene.jpg`,
`popup/popup.html`, `popup/popup.css`) is a bigger step than earlier cosmetic
passes: the arcade-cabinet reference art (the same AI-generated mockup the
v0.7.1 pass took its color cues from) now sits behind the *entire* popup on
every screen, not just cropped into the header. The header's old hand-coded
inline SVG logo is retired (`#brand-logo { display: none; }`, element left
in the DOM but unused) in favor of the reference image's own slot-machine
artwork showing through directly at the top of every screen -- a closer
match to the source art than any vector re-drawing could be. A dark scrim
gradient is baked into the same fixed background layer: nearly transparent
over the header art itself, then ramping to ~95%+ opaque by the bottom of
the header so none of the reference image's own (fake, non-interactive)
onboarding text/buttons show through behind the real ones -- getting that
ramp steep enough to fully kill ghosting (an early, gentler version visibly
double-exposed "LANGUAGE" and the welcome buttons) took an iteration. Every
screen's real content (headings, inputs, buttons, cards) is unchanged HTML
sitting in front of this backdrop; cards/inputs keep their own solid dark
fills, so only the padding/gaps between them show the scene, giving a subtle
vignette and side-cabinet glimpse rather than a busy background. The
`.primary` button gradient was also brightened slightly (a paler top
highlight, a defined gold-brown border ring) to sit closer to the
reference's glossier pill buttons. No screen's markup, IDs, or JS changed --
verified by re-running all five Playwright suites (zero regressions;
`screenshot-tour.js`'s final Arabic-RTL shot needed a wait added after its
mid-script `page.reload()` for the same reason the splash tests did -- the
new startup splash was covering that reload's screen too) and a fresh
13-screen render of every major screen to check the background, scrim, and
button styling end to end.

**v0.9.0 interactive Home screen, Activity log, rounder type, live-data
cards, and language flags** bundles five changes:

- **Home tabs + Activity** (`popup/popup.html`, `popup/popup.css`,
  `popup/popup.js`): reopening the popup with a wallet already unlocked --
  the normal case, not first-run or mid-session creation/import/unlock --
  now stops the startup splash from auto-fading and turns it into the real
  landing screen instead, with the reference artwork's own painted-on
  Home/Assets/Activity/Send bar wired up as real navigation
  (`activateSplashHome()`, a cancelable `splashAutoTimers` array replacing
  the old fixed auto-fade timers). The splash artwork itself already had a
  faint fake nav bar baked into it a little above the true bottom edge, with
  no scrim behind it at all -- an early version of the new real tab bar sat
  lower down and left that fake one visibly ghosting just above it; fixed by
  giving `#splash-tabbar` a tall, steeply-opaque backing that fully covers
  the fake bar's zone before fading out higher up. "Activity" is a new,
  honestly-scoped local-only log of sends made from this wallet on this
  device (`chrome.storage.local`, capped at 50 entries) -- explicitly not a
  real fetched on-chain transaction history, which would need a separate
  explorer/indexer integration. New `test-home-tabs.js` covers: wallet
  creation does NOT trip the new home behavior (only reopening an
  already-unlocked wallet does), the home screen does not auto-fade even
  well past the old timers, each tab navigates correctly, and a seeded
  activity entry renders correctly. The four tab labels and the Activity
  screen's text are English-only for now in the other 8 supported
  languages -- `lib/i18n.js`'s existing fallback (current language ->
  English -> raw key) means they show clean English rather than breaking,
  but a native-speaker translation pass hasn't covered these new strings
  yet.
- **Rounder display/body font** (`popup/fonts/fredoka-{400,500,600,700}.woff2`,
  `popup/popup.css`): swapped the previous system-font/serif pairing for
  Fredoka everywhere except monospace addresses/hashes, self-hosted as
  local `@font-face` files (an extension's popup can't reach Google Fonts'
  CDN at runtime) with the four weights already used across headings,
  buttons, and body text.
- **Live-prices card on the main screen** (`popup/popup.html`,
  `popup/popup.css`, `popup/popup.js`): the first four coins from the
  existing Prices-screen board now also show on the main dashboard itself
  in a compact card, with a "See all" link still going to the full screen.
  Shares the exact same `TM_PRICES.getPriceBoard()` call and row markup as
  the full screen (factored into a shared `renderPriceRow()`), so the two
  stay visually and behaviorally consistent; a rate-limited/unreachable
  CoinGecko leaves a quiet one-line note in the card instead of an error
  banner, since this is a convenience widget, not the primary screen.
- **Trending Markets card + screen** (`lib/polymarket.js`, `popup/popup.html`,
  `popup/popup.css`, `popup/popup.js`): a new, read-only display of
  trending Polymarket prediction markets -- crypto up/down questions,
  sports moneylines, and similar -- the same public, keyless Gamma API
  data anyone sees on polymarket.com, shown the way MetaMask's Portfolio
  surfaces a "Markets" widget. This wallet does not place bets, hold
  positions, or make any contract call related to Polymarket; it only
  reads and displays the odds (primary outcome name, its implied
  probability as a percent, and 24h volume). `lib/polymarket.js` is
  wrapped in its own IIFE (unlike the older `lib/prices.js`) so its
  top-level consts can't collide with another script's same-named consts
  sharing the popup's global scope -- an actual `SyntaxError:
  Identifier 'CACHE_TTL_MS' has already been declared` crash caught during
  testing before this shipped. Verified with mocked API responses
  (realistic Yes/No and two-way sports markets, including Polymarket's
  outcomes/outcomePrices fields arriving as JSON-encoded strings rather
  than real arrays) confirming percentage math, volume formatting
  (`$1.3M`/`$820.0K`/`$430`), and color coding all render correctly.
- **Flags in both language pickers** (`popup/popup.js`): each of the 9
  supported languages now shows a representative country flag emoji next
  to its name in the onboarding and settings language selects, the same
  convention most apps' language pickers use (a flag stands in for the
  language's most-associated country, not a claim the language belongs to
  only that place).

All five changes were verified together: `node --check` on every touched
`.js` file, an HTML tag-balance check, the new `test-home-tabs.js`, and a
full re-run of the entire pre-existing Playwright suite (`test-load.js`,
`test-support-chat.js`, `test-i18n.js`, `test-prices-buy.js`,
`test-splash.js`, `test-rpc-fallback.js`, `test-token-list.js`) -- all eight
suites pass with zero real script/page errors. `test-load.js` needed one
adjustment: it now filters out `Failed to load resource: net::` browser
console noise from the two new cards' background CoinGecko/Polymarket
fetches (both unreachable in this sandboxed build environment, same as
every other network call here) while still failing on any real JS
exception, matching how the other suites in this file already treat that
same sandbox-only noise. `screenshot-tour.js` gained two new steps
(`04a-home-tabs`, `04b-activity`) capturing the new screens. Test a live
CoinGecko/Polymarket load from your own machine with normal internet
access before relying on the two new cards showing real data.

**v0.10.0 visual polish pass -- closing gaps against MetaMask's look**
(`popup/popup.html`, `popup/popup.css`, `popup/popup.js`,
`lib/identicon.js`, `lib/i18n/en.js`): a focused round of "this feels
generic" feedback compared directly against MetaMask's UI, closing five
specific gaps:

- **Account identicons** (`lib/identicon.js`, new): a small, fully local,
  dependency-free per-address avatar -- a symmetric 5x5 colored grid derived
  deterministically from the address (seeded `mulberry32` PRNG off an FNV-ish
  string hash, HSL background/foreground hues picked far enough apart on the
  wheel to guarantee contrast) -- the same "this account always looks like
  this, and no two accounts look alike" role MetaMask's blockie avatar
  plays. Shows next to the account picker and, once a valid `0x...` address
  is typed, next to the Send screen's recipient field too. Pure inline SVG:
  no image request, no canvas, nothing fetched, so it can't leak which
  addresses exist to any third party.
- **Colored network + token icons** (`popup/popup.js`): the network picker
  and the "Ethereum Mainnet"-style badge now show a small dot in that
  network's real brand color (Ethereum's periwinkle, Base's blue, Polygon's
  purple, etc., with a deterministic hashed-HSL fallback for any network not
  on the curated list); every token row (main balance list and both Prices
  cards) now shows a colored circular badge with the token's first two
  letters, using real brand colors for ~20 common symbols (BTC orange,
  ETH periwinkle, USDT teal, USDC blue, ...) and the same hashed-HSL
  fallback otherwise. Colors are computed locally from the symbol string --
  no logo images fetched from a third-party CDN, which would otherwise leak
  exactly which tokens a given user holds to that CDN.
- **USD-first balance hierarchy** (`popup/popup.html`, `popup/popup.css`,
  `popup/popup.js`): the main balance display had this backwards -- the
  native coin amount was the huge gold number and the USD value was tiny and
  muted. Flipped to match how MetaMask, Coinbase Wallet, and Rainbow all
  lead with fiat: the USD estimate is now the large lead figure, with the
  native amount/symbol as smaller secondary text underneath. When no USD
  estimate is available (CoinGecko unreachable, or the network's native
  coin isn't one it prices), a `.balance-lead-fallback` state re-promotes the
  native amount back to the large/gold treatment instead of leaving the
  balance box looking half-empty.
- **Network badge readability fix**: user feedback on a live build flagged
  the "Ethereum Mainnet" badge sitting above the account/network dropdowns
  as looking out of place next to the rest of the app -- it was set in the
  monospace font (`var(--font-mono)`) at a cramped 10.5px, more like a raw
  debug label than app copy. Switched it to the same Fredoka body font the
  dropdowns themselves use, at a slightly larger, medium-weight 12.5px, so
  it now reads as a normal part of the interface instead of clashing with
  it.
- **Activity list icons + status pills** (`popup/popup.js`,
  `popup/popup.css`, new `activity.statusSent` string): each entry in the
  local Activity log now shows a small circular badge with an up-right
  arrow (every entry here is currently an outgoing send -- there's no
  receive-tracking yet) and a green "Sent" status pill, the same at-a-glance
  direction-plus-status convention MetaMask's own activity feed uses,
  instead of three lines of plain text.

Verified with a fresh `verify-badge.js`/`verify-activity.js` Playwright
screenshot check of the new badge and activity styling, plus a full clean
re-run of all eight existing Playwright suites (`/tmp/tm-test-profile*`
profiles wiped first, since several of these test files reuse a fixed
profile path across runs) -- zero regressions -- and a fresh 15-screen
`screenshot-tour.js` render. The new `activity.statusSent` string is
English-only in the other 8 languages for now, same fallback behavior as
the rest of the newer Home-tabs/Activity strings.

**v0.11.0 WalletConnect support, plus more MetaMask/Binance-parity
features** (`background/background.js`, `popup/popup.html`,
`popup/popup.css`, `popup/popup.js`, `lib/prices.js`, new
`lib/walletconnect-config.js`, new `vendor/walletconnect-sign-client.umd.js`,
new `vendor/qrcode-generator.js`): a second round of closing gaps against
both MetaMask and Binance's Web3 Wallet, plus the most-requested missing
piece -- connecting to dapps that only offer a "WalletConnect" option.

- **WalletConnect v2** (Settings -> WalletConnect): paste the `wc:...` URI
  from any dapp's "Connect Wallet" QR code to pair with it, the same as a
  real WalletConnect-compatible wallet, without needing this extension's
  own injected-provider support (which only works on pages you're actually
  browsing in this Chrome profile). Built on WalletConnect's own
  `@walletconnect/sign-client` (vendored as a single prebuilt bundle --
  Chrome extensions can't fetch remote code at runtime, MV3 or otherwise),
  running directly inside the MV3 service worker: `SignClient.init()` was
  confirmed working there in a real loaded-extension test before anything
  was wired up, since MV3 service workers lack `window`/`localStorage` and
  it wasn't obvious in advance that the library's browser build (which
  falls back to IndexedDB via `idb-keyval`, available in a service worker)
  would just work. Session proposals and signing requests
  (`eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`) are
  routed through the *exact same* approval-popup pipeline the injected
  dapp provider already used (`openApprovalPopup` + a newly-shared
  `handleSigningMethod()`), so there's no second approval UI to build,
  test, or keep in sync -- a WalletConnect request looks and behaves
  exactly like a regular dapp request, just labeled with the dapp's name
  instead of a browser tab's origin. Settings shows connected dapps with a
  Disconnect button. **Requires your own free Project ID** from
  cloud.reown.com (formerly WalletConnect Cloud) -- see
  `lib/walletconnect-config.js`; until one is set, the WalletConnect screen
  shows a plain "not configured yet" notice instead of a confusing relay
  error. Genuine pairing against the real relay (`relay.walletconnect.org`)
  couldn't be exercised end-to-end in this sandboxed build environment (no
  outbound access to it here), though a placeholder Project ID confirmed
  the client genuinely attempts to reach the real relay rather than failing
  silently -- test a real connection from your own machine before relying
  on it.
- **QR code for your receive address** (`vendor/qrcode-generator.js`, a
  small vendored dependency-free encoder -- MIT-licensed, by Kazuhiko
  Arase): a "Show QR" link under the address on the main screen renders it
  as a scannable code, entirely locally (no image request of any kind, so
  showing it can't leak the address anywhere). Purely additive -- Copy
  still works exactly as before.
- **Token watchlist** (Prices screen and the main-screen Live Prices card):
  tap a coin's star to pin it to the top of the list, the same
  quick-reference convention Binance and most exchange apps call an
  "address book" for people, but for tickers. Stored locally
  (`chrome.storage.local`); starring a symbol never sends it anywhere.
- **Address book** (Settings -> Address book): save a name + address once,
  then pick it from a "Contacts" link on the Send screen instead of
  retyping or re-pasting it every time. Reuses the same per-address
  identicon as the account picker for a consistent, at-a-glance visual.
- **Multi-fiat display currency** (Settings -> Display currency): balances
  and prices can now show in EUR, GBP, JPY, CAD, AUD, INR, or BRL instead
  of only USD -- CoinGecko prices every coin directly in each of these, so
  switching is just a different `vs_currencies` request, no separate
  currency-conversion step to get wrong. `lib/prices.js`'s returned fields
  were renamed from `usd`/`usd24hChange` to the currency-neutral
  `price`/`change24h` as part of this, since they no longer always hold a
  USD figure.

Verified with the full nine-suite Playwright regression (the eight
pre-existing suites plus a new `test-walletconnect.js` covering the
"not configured" state and URI validation), two new one-off Playwright
scripts exercising the watchlist reorder, currency switch, and
add/pick-from-Send address-book flow against a mocked price board (real
CoinGecko/relay access isn't available in this sandboxed build
environment), and a fresh 15-screen `screenshot-tour.js` render. All new
Settings/Address-book/WalletConnect strings are English-only in the other
8 languages for now, same fallback behavior as every other recently-added
screen.
