# Token Exchange — Google Play Store Listing Draft

Everything below is written from what's actually in the built APK (`TokenExchange.apk`, v2.0) and the app's own Privacy Policy / Terms of Service, so it should hold up to Google's review. Paste directly into the matching Play Console fields; adjust anything that doesn't match how you want to present it.

## App title (max 30 characters)

**Token Exchange: Crypto Wallet** (29 characters)

## Short description (max 80 characters)

**Self-custody wallet for ETH, Base & more. Swap, buy, and sell crypto safely.** (76 characters)

## Full description (max 4000 characters)

> Token Exchange is a self-custody crypto wallet. Your private keys and recovery phrase are generated and encrypted entirely on your own device — we never see them, store them, or have any way to recover them for you.
>
> SUPPORTED NETWORKS
> Manage assets across six chains: Ethereum, Base, Arbitrum, Optimism, BNB Smart Chain, and Polygon — all from one wallet.
>
> SWAP TOKENS
> Swap tokens directly using on-chain liquidity, with quotes powered by 0x's Swap API. You always review and sign every transaction yourself.
>
> BUY & SELL CRYPTO
> Buy crypto with cash or sell back to your bank through Coinbase or Onramper. These are independent, licensed providers — they handle identity verification and payment processing directly, under their own privacy policies. Token Exchange never receives your payment details.
>
> CONNECT TO DAPPS
> Use WalletConnect to link Token Exchange to third-party decentralized apps, and approve or reject each connection and transaction yourself.
>
> NO ACCOUNT REQUIRED
> Create a wallet, view balances, and send, receive, or swap tokens — no name, email, or ID required. An optional username/password lets you back up an encrypted copy of your wallet for cross-device recovery; even then, your password and unencrypted vault never reach our servers in a form we can read.
>
> PRIVACY BY DESIGN
> No Google Analytics, no ad trackers, no data sold to third parties. Live prices come from CoinGecko's public API with no personal data attached.
>
> AVAILABLE IN 9 LANGUAGES
> English, Arabic, Spanish, French, Hindi, Japanese, Portuguese, Russian, and Chinese.
>
> Token Exchange is a software tool, not a bank, broker-dealer, custodian, or financial advisor. Cryptocurrency is volatile and carries risk — only use funds you can afford to lose. Full details are in our Privacy Policy and Terms of Service, linked in the app.

(1,562 characters — well under the 4,000 limit, so there's room to expand if you want more detail on any section.)

## Screenshots — recommended shot list

Google Play requires at least 2 phone screenshots (up to 8 recommended), 16:9 or 9:16, min 320px. Suggested captures, in order:

1. **Wallet home / balance view** — shows the multi-chain balance list and the gold/dark theme.
2. **Swap screen** — mid-quote, showing two tokens and an exchange rate (demonstrates the core feature).
3. **Buy/Sell screen** — the Coinbase/Onramper provider picker.
4. **WalletConnect connection prompt** — shows a dapp connection request being approved.
5. **Language picker** — a nice, easy way to visually prove the 9-language support.
6. **Send/Receive screen** — QR code and address display.

I can generate these for real by running the APK in an Android emulator here and driving it to each screen — that's a real but doable next step if you want actual screenshots rather than just this shot list. Say the word and I'll set that up.

## Content rating questionnaire — how to answer it

Google's questionnaire (IARC) asks category-by-category. Based on what the app actually does:

- **App category**: Utility / Productivity / Finance (pick "Finance" if offered as a top-level option; otherwise Utility).
- **Violence, sexual content, profanity, controlled substances**: No to all — none of this exists in the app.
- **Simulated gambling**: No — token swapping and buy/sell are financial transactions, not gambling mechanics (no odds, no chance-based rewards).
- **User-generated content / communication between users**: No — the feedback form sends text to you, not to other users, and there's no chat/messaging between users.
- **Shares user's location**: No — the app doesn't request or use device location.
- **Digital purchases**: This needs care. Token Exchange doesn't sell anything through Google Play Billing — buy/sell of crypto happens through Coinbase's and Onramper's own regulated, external payment flows. When the questionnaire distinguishes "purchases through Google Play" from other real-money transactions, answer according to that distinction (typically "No" for Play Billing purchases, since none exist here).

## Data safety section — how to answer it

This should mirror your actual Privacy Policy, since Google spot-checks consistency between the two.

**Data collected:**

| Category | Collected? | Notes |
|---|---|---|
| Financial info (wallet address, transaction data) | Yes | Sent to 0x, blockchain RPC providers, Coinbase, and Onramper only to perform the swap/buy/sell the user requested. Not sold, not used for ads. |
| User IDs (optional username) | Yes | Only if the user opts into cross-device backup. Deletable on request. |
| Passwords | No* | *Only a one-way derived value is ever sent — the actual password never leaves the device. Worth phrasing carefully in the form; Google's categories don't have a clean box for "we receive a hash, never the password," so lean toward disclosing this under "User IDs"/"Other" rather than checking "Passwords collected." |
| App activity / feedback text | Yes | Only when the user submits the in-app feedback form. |
| Device or other IDs (IP address) | Yes | Logged server-side only for rate-limiting/abuse prevention, not for tracking or ads. |
| Location, contacts, photos, health data, browsing history | No | None of these are requested or accessed. |

**Data shared with third parties:** Yes — wallet address and transaction details are shared with 0x, blockchain nodes, Coinbase, Onramper, and WalletConnect, strictly to perform the feature the user invoked. Purpose: "App functionality," not advertising or marketing.

**Security practices to declare:** Data encrypted in transit (confirm your server uses HTTPS everywhere — it should); users can request account/data deletion (per your Privacy Policy §7).

## One thing to fix before you submit

Your Privacy Policy and Terms of Service both currently say Token Exchange is "operated by **Sanders LLC**." Since we ended up going the free personal-name route with D&B (Matthew Sanders as sole proprietor, no LLC formed), that line is now inaccurate — it names an entity that doesn't legally exist. Google can flag a mismatch between your Play Console developer identity (Matthew Sanders) and your own legal documents. Worth updating both pages to say "operated by Matthew Sanders" (or whatever wording you'd like) before you submit the listing. I can make that edit for you if you'd like — just say so.
