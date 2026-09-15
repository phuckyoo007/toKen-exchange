# Chrome Web Store submission guide — Token Exchange

Everything below is ready to copy-paste into the Chrome Web Store Developer Dashboard. The parts only you can do are marked **[YOU DO THIS]**.

## 0. Fixing the rejection (Item ID `adiihfpfinmhikjiopobbeigcfaoepko`, routing FZSL)

Google's review flagged two things. Both are fixed below — here's exactly what changed and what you still need to do:

**Violation 1 — Keyword Spam ("Yellow Argon"):** the flagged text was the chain list in the detailed description: `" Ethereum, Base, Polygon, BNB Chain, Arbitrum, and OP Mainnet "`. That reads as a keyword-stuffed list to their automated reviewer even though it was accurate. **Fixed** — the "WHAT IT DOES" bullet in section 2 below now reads "Ethereum, Base, and other EVM-compatible networks" instead of naming all six chains. No functionality changed, just how it's described.

**Violation 2 — User Data Privacy ("Purple Nickel"):** the privacy policy link doesn't resolve to a valid policy for their reviewer. I checked the artifact directly — the policy content itself is fine (10 sections, real contact email already in place), but it's still set to **private**, meaning only your account can open it. Google's crawler hits it logged-out and gets nothing, which is almost certainly the whole cause. **[YOU DO THIS]**: open https://claude.ai/code/artifact/fb5be8f4-5c01-4c55-bc89-f64f548c112a, share it (or publish it) so it's reachable by anyone with the link, then open it in a private/incognito window to confirm it loads without you being signed in. If it still won't share for some reason, tell me and I'll rebuild the same content as a plain static page instead.

**To resubmit:** in the Developer Dashboard, edit the existing listing's detailed description with the corrected text from section 2, confirm the privacy policy URL in the "Privacy practices" tab is still correct, save, and then use whatever action the dashboard is showing you for this revision — either "Submit for review" on a new draft or "Appeal" on the rejected one. That click is yours to make; I can't do it from here.

## 1. One-time setup **[YOU DO THIS]**

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and sign in with the Google account you want to publish under.
2. Pay the one-time **$5 USD** registration fee (verified current as of this writing — covers up to 20 extensions, for life, not a subscription).
3. Click "New Item" and upload the extension zip.

## 2. Store listing copy (copy-paste these)

**Extension name:**
```
Token Exchange
```

**Short description** (132 character limit — this one is 118):
```
Self-custody Ethereum & Base wallet with a built-in token swap. Your keys stay encrypted on your device, always.
```

**Detailed description:**
```
Token Exchange is a self-custody wallet for Ethereum, Base, and other EVM-compatible networks, with a built-in token swap.

WHAT IT DOES
• Create or import a wallet secured by a 12-word recovery phrase
• Hold and send ETH and ERC-20 tokens across Ethereum, Base, and other EVM-compatible networks — or add any network yourself
• Swap tokens directly on-chain through established decentralized exchange routers — no account, no order book, no middleman holding your funds
• Connect to any dapp or website that supports wallet extensions, the same way you'd connect MetaMask or Coinbase Wallet

YOUR KEYS NEVER LEAVE YOUR DEVICE
Token Exchange is non-custodial. Your recovery phrase and private keys are encrypted (AES-256-GCM) and stored only in your browser, locally. We never see them, never store a copy, and can't recover them for you if lost — the same trade-off every self-custody wallet makes in exchange for nobody but you controlling your funds.

TRANSPARENT FEES
Swaps carry a flat 0.5% fee on the amount you're swapping, shown clearly before you confirm — never a hidden cost buried in the exchange rate.

KNOW BEFORE YOU USE IT
This is an actively developed wallet that has not yet completed an independent third-party security audit. Read the full privacy policy for details on data handling, permissions, and the networks this extension talks to.
```

**Category:** Productivity (Chrome Web Store's closest fit for wallet/utility extensions — there's no dedicated "Finance" or "Crypto" category, and cryptocurrency extensions are excluded from the "Featured" shelf by policy, though they're fully allowed to be listed and installed normally).

**Language:** English

## 3. Privacy policy URL **[YOU DO THIS — one edit needed first]**

Published here: https://claude.ai/code/artifact/fb5be8f4-5c01-4c55-bc89-f64f548c112a

Before you submit, open it and share it (or republish it) so it's reachable by Google's reviewers — an unshared artifact is private to your account. **Also replace the placeholder contact email in section 10 with a real address you monitor** — the Web Store requires a working contact method, and right now it just says `[insert contact email before publishing]`. Paste the final URL into the "Privacy policy" field in the dashboard's "Privacy practices" tab.

## 4. Permission justifications (paste into the "Privacy practices" tab)

Chrome now requires a written justification for each sensitive permission. Use these:

**`storage`:**
```
Used to store the user's encrypted wallet vault, account list, and network preferences locally in the browser. Nothing is transmitted to any server — there is no backend for this extension.
```

**`tabs`:**
```
Used only to notify already-open tabs when the user switches accounts or networks in the wallet, so connected dapps stay in sync (standard EIP-1193 accountsChanged/chainChanged events). Never used to read browsing history or tab content.
```

**Host permissions (`http://*/*`, `https://*/*`):**
```
Required to inject the wallet's connection interface (window.ethereum-equivalent provider) into web pages, so any website can offer a "Connect Wallet" button that talks to this extension — the same permission every comparable wallet extension (MetaMask, Coinbase Wallet, Rabby) requests, for the same reason. The content script does not read or transmit page content; it only relays messages a page explicitly sends to the wallet.
```

**Remote code:** No — answer "No" to the remote code question. Everything (including the bundled `ethers.js` library) ships inside the extension package; nothing is fetched from a CDN at runtime.

**Single purpose description** (a required field describing the extension's one core function):
```
Token Exchange lets users hold, send, and swap cryptocurrency on Ethereum-compatible networks from a self-custody wallet built into the browser.
```

## 5. Screenshots

Three are ready in this folder, framed at the required 1280×800:
- `store-shot-1-onboarding.png`
- `store-shot-2-main.png`
- `store-shot-3-swap.png`

**Worth doing before you submit:** these were captured in a sandboxed build environment with no live network access, so the balance shows "..." (still loading) instead of a real number. Retaking these three from your own machine — where the balance will actually resolve to "0.0000 ETH" or similar — will look more finished. The Chrome Web Store requires at least one screenshot; up to five are allowed, and a small promo tile (440×280) is optional.

## 6. What to expect after you submit

- Review typically takes anywhere from a few hours to a couple of weeks. Extensions requesting broad host permissions and handling anything wallet/crypto-adjacent tend to land on the slower, more scrutinized end of that range — budget for it, and don't be surprised by a request for clarification rather than an outright rejection.
- If Chrome's automated review flags the broad host permissions or the private-key handling, point them at the privacy policy and the permission justifications above — that's exactly what they're there for.
- A first-time developer account publishing a wallet extension may get extra scrutiny simply for being new. That's normal and not a sign anything is wrong with the extension.

## What I can't do for you

I can't create your Google developer account, pay the $5 fee, or click submit — that requires your own login. Everything else above (the copy, the policy, the screenshots, the manifest) is ready to hand to that form.
