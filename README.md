# Token Exchange — Web Wallet (standalone site edition)

This is the **same wallet** as the Token Exchange browser extension — same
account creation/import, same encrypted vault, same send/swap/tokens/
prices/activity/settings screens, same 0.5% swap fee, same OFAC address
screening, same multi-language support — rebuilt to run as a single, plain
website instead of a browser extension. No build step: unzip it, open
`index.html`, or host the folder anywhere that serves static files.

## Read this before you put real funds in it

**A website holding private keys is a fundamentally easier target than an
installed browser extension holding the same keys.** This isn't a defect
in this specific build — it's why MetaMask, Rabby, and every other major
wallet ship a browser extension (and/or a mobile app) as their real product
and, at most, a *read-only* portfolio viewer as a website. Specifically:

- **Phishing is much easier against a website.** A lookalike domain
  (`token-exchange-wallet.com` vs. the real one), a typo-squatted URL, a
  malicious ad, or a compromised DNS record can put a byte-for-byte visual
  clone of this page in front of someone, and there is no reliable way for
  a person to tell it apart from the real thing just by looking. An
  installed extension has no such lookalike problem: it only runs from the
  copy actually installed in the browser, under a fixed extension ID.
- **The hosting itself is a target.** Wherever you (or anyone) deploys
  this — Netlify, Vercel, GitHub Pages, your own server — an attacker who
  compromises that host, that DNS record, or that git repo can silently
  edit the page everyone loads. An installed extension isn't affected by
  someone else's server being compromised after the fact.
- **Browser extensions get their own isolated storage** that other sites
  can't read or write. A website's storage (this build uses IndexedDB,
  scoped to whatever origin serves it) is still same-origin-protected from
  *other* sites, but the page itself is only as trustworthy as whoever
  controls that origin at the moment you load it — which is exactly the
  property phishing/DNS/host-compromise attacks go after.

None of this means "unsafe to ever use" — it means **know what you're
trading away** versus the extension. Reasonable ways to use this
responsibly:

- Treat it like a hot wallet for small amounts, not your main holdings.
- Only ever open it from a URL you typed yourself or a bookmark you saved
  the first time, never a link someone sent you.
- If you deploy it publicly, lock down who can push to that hosting
  (branch protection, 2FA on the hosting account, etc.) — the deploy
  pipeline is now part of your wallet's security perimeter.
- Prefer the browser extension version of Token Exchange for anything you
  actually care about. This site is here for the case where an extension
  truly isn't available to you.

This warning also appears directly on the app's own onboarding screen — it
isn't just buried in this file.

## What actually changed from the extension

The extension splits into two processes: a background service worker that
holds the unlocked wallet secret and does the real work, and the popup UI,
talking to it over `chrome.runtime.sendMessage`. A website has no second
process to split across, so:

- **`chrome.storage.local` → IndexedDB.** `shim.js` implements the same
  `get`/`set`/`remove` calls (both the callback and promise calling styles
  the original code already used) against an IndexedDB database in your
  browser. Nothing was rewritten in `lib/wallet.js`, `lib/networks.js`, or
  any other library file to make this work — they call the exact same
  `chrome.storage.local` API either way.
- **`chrome.runtime.sendMessage` → a direct in-page call.** `shim.js`
  routes it straight into `wallet-engine.js`'s `handleMessage()` — the same
  message names and payloads the extension's background.js switch/case
  handled, just called in this same tab instead of crossing a real
  extension message boundary. `app.js` (the UI logic, a near-verbatim copy
  of the extension's `popup.js`) didn't need to change to make this work
  either.
- **`wallet-engine.js`** is background.js's logic, ported. The parts that
  only existed to service an **injected provider on some other website**
  (a real browser extension's content-script-based dapp connection) are
  gone, because a plain webpage cannot inject a provider into other sites
  the way an extension's content script can — there's no dapp-origin
  concept here to defend. Everything else — create/import/unlock, send,
  swap, tokens, tracked-token balances, address book, WalletConnect — is
  unchanged.
- **WalletConnect still works,** and is now the *only* way this page can
  connect to an outside dapp (no injected-provider path exists on a plain
  website). Approving a WalletConnect connection or signing request shows
  the exact same approve screens the extension has always had — just
  in-place in this tab instead of a second popup window, since there's
  nowhere else for a second window to see this tab's in-memory unlocked
  wallet. Needs your own free Project ID in `lib/walletconnect-config.js`,
  same as the extension (see that file's comments) — ships with a blank
  one, showing a plain "not configured yet" notice until you add it.
- Everything visual is the same "Vault" theme, laid out as a centered card
  instead of stretched to a fixed 360×600 popup window, since this now
  runs in a normal resizable browser tab.

## Running it

No build step, no `npm install`, no server-side code.

1. Unzip this folder.
2. Open `index.html` directly, or serve the folder with anything static
   (`python3 -m http.server 8080` from inside the folder, `npx serve`,
   Netlify/Vercel/GitHub Pages, etc.).
3. Create or import a wallet, same as the extension.

Your vault is encrypted the same way as the extension's (see
`lib/crypto-utils.js`) and stored only in this browser's IndexedDB —
nothing is sent anywhere except the same public RPC/CoinGecko/Polymarket/
MoonPay/WalletConnect-relay calls the extension itself makes, listed in the
main project's `README.md`.

**Important:** your vault lives in *this browser, on this device, at this
exact origin* (protocol+domain+port). Opening the same files from a
different domain, a different port, or `file://` vs. a local server counts
as a different origin to IndexedDB — you won't see the same wallet. Stick
to one way of opening it, and if you deploy it, keep it at one stable URL.

## Known limitations

- **Ephemeral by tab, not by 30 seconds.** The extension's background
  worker can be killed by Chrome after ~30s idle, re-locking the wallet
  fairly often. This page instead stays unlocked for as long as the tab
  itself stays open — closing the tab or reloading the page clears the
  in-memory secret and returns you to the unlock screen, same as the
  extension's own re-lock behavior, just on a different trigger.
- **No injected provider.** This page cannot appear as a "Connect Wallet"
  option that a website's own JavaScript detects (that mechanism is an
  extension-only capability). WalletConnect (pasting a `wc:...` URI) is the
  only way to connect this wallet to an external dapp.
- Live network calls (RPC balances, CoinGecko prices, Polymarket markets,
  a real WalletConnect pairing) could not be exercised end-to-end from the
  sandboxed environment this was built in — the same honest caveat called
  out elsewhere in this project. Automated testing here did confirm:
  wallet creation, the backup/seed-phrase flow, password unlock, vault
  persistence across a page reload, navigation through Settings/
  WalletConnect/Address book, and clean console output (no JS errors)
  throughout. Please click through it yourself with a real internet
  connection before trusting it with anything beyond a small test amount.

## Files

```
index.html            the page (ported from the extension's popup.html)
app.css                styling (ported from popup.css, plus a small
                        "centered card in a real browser tab" layout addition
                        at the bottom, clearly marked, instead of a fixed
                        360x600 popup box)
app.js                 UI logic (ported from popup.js, unchanged except one
                        small edit: after a WalletConnect approval, return to
                        the previous screen instead of window.close()-ing a
                        popup window that doesn't exist here)
wallet-engine.js       the wallet's "background" logic (ported from
                        background/background.js, minus the injected-
                        provider/content-script-only code path)
shim.js                chrome.storage.local (-> IndexedDB) and
                        chrome.runtime.sendMessage (-> direct call) so the
                        library files and app.js run unmodified
lib/                   same library files as the extension (crypto-utils,
                        wallet, networks, swap, fee-config, sanctions-list,
                        walletconnect-config, prices, polymarket, identicon,
                        i18n + all 9 language files, buy-config, support-config)
vendor/                ethers.js, the WalletConnect sign-client, and the QR
                        code generator -- same vendored copies the extension uses
fonts/, img/            same bundled Fredoka font + artwork as the extension
```
