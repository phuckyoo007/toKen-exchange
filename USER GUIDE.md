# Token Exchange: Getting started

Token Exchange is a self-custody wallet. Your keys are created and stored on your own device, and nobody at Token Exchange can see your funds, move them, or recover them for you. That freedom comes with one responsibility: keep your recovery phrase safe.

You can use it on the web at **www.tokenswaphub.org** or as a Chrome extension. The steps are the same in both.

---

## 1. Create your wallet

1. Tap **Create a new wallet**.
2. Choose a password (at least 8 characters). It unlocks the wallet on this device only.
3. Write down your **recovery phrase** (12 words) on paper and keep it somewhere safe and private.
4. Tick **I've saved my recovery phrase**, then tap **Finish**.

> **Your recovery phrase is the only way to get your funds back** if you forget your password or lose your device. Token Exchange cannot reset it. Never type it into a website, send it in a message, or share it with anyone, including anyone claiming to be support. Anyone who has it can take everything in your wallet.

Already have a wallet? Tap **Import an existing wallet** and enter your 12 or 24 word phrase.

## 2. Choose your display currency

Open **Settings → Display currency** and pick how you want values shown.

- **National currencies:** 42 to choose from, including USD, CAD, EUR, GBP, JPY, CHF, MXN, AUD and more.
- **Crypto:** BTC, ETH, BNB, SOL or XRP.

This only changes how prices and balances are displayed. It doesn't convert or move anything you own.

## 3. Pick a network

Use the **Network** selector on the main screen. Built in: Ethereum, Base, Polygon, BNB Chain, Arbitrum and Optimism. Your address is the same on all of them, but balances are separate, so make sure you're on the network you mean to use before sending or receiving.

## 4. Get crypto into your wallet

**Receive from another wallet or exchange:** copy your address from the main screen (or tap **Show QR**) and send to it. Send on the network you have selected.

**Buy with a card or bank transfer:** tap **Buy**, then **Continue to MoonPay**. MoonPay is a separate company that handles payment, identity verification and fees. Token Exchange never sees your card or bank details. Which countries, currencies (such as USD or CAD) and payment methods are available depends on MoonPay.

<!-- OWNER NOTE: publish the Buy paragraph above (and section 8) only after a live MoonPay key (pk_live_) is set in buy-config.js. With the test key, purchases run in MoonPay's sandbox only. -->

Already hold some crypto? You can skip MoonPay and use **Swap** instead (section 6).

## 5. Add tokens like USDC

Tokens such as USDC don't appear automatically. To track one:

1. Tap **+ Add token** on the main screen.
2. Paste the token's **contract address** for the network you're on.
3. Tap **Look up**, check the name and symbol, then tap **Add to my wallet**.

Get the address from the token issuer's own website. For USDC, that's Circle's official list of USDC contract addresses. Copycat tokens with the same name exist, and a wallet can't tell a fake from the real one, so never copy an address from a chat message, a social post or a search ad.

## 6. Swap one crypto for another

1. Tap **Swap** and choose the coin you have (**From**) and the coin you want (**To**).
2. Enter an amount and tap **Get quote**.
3. Review the estimate. It shows the app fee, the net amount swapped and the estimated amount you'll receive.
4. If you're swapping a token (not the network's main coin), tap **Approve token first** once. This lets the swap use that token.
5. Confirm the swap.

Good to know:

- **Fees:** Token Exchange charges a 0.5% fee on the amount you swap. It's shown before you confirm and is sent as its own transaction, so a swap is two transactions. You also pay the normal network fee for each.
- **Slippage tolerance:** if the price moves more than this while your swap is processing, the swap is cancelled instead of completing at a worse price.
- **Liquidity varies:** some coin pairs and networks have thin markets. If the quote looks poor, try a smaller amount, another network, or another pair.
- **Swap doesn't take dollars or other national currency.** To pay with those, use **Buy**.

## 7. Send crypto

1. Tap **Send**, choose the asset, and enter the recipient's address (or an ENS name like `name.eth`).
2. Enter the amount and choose a speed: **Slow**, **Standard** or **Fast**. Faster costs more in network fees.
3. Confirm. Your wallet holds the send for a short cancel window (30 seconds by default), so you can still tap **Cancel send** if you spot a mistake.

Crypto sent to a wrong address can't be recovered. Check the address carefully, especially if the wallet warns you that you haven't sent to it before or that it looks like one you've used before. Lookalike addresses are a common scam.

## 8. Sell for cash

Tap **Sell**, then **Continue to MoonPay**. MoonPay quotes a cash payout and gives you a deposit address. Come back and use **Send** to send your crypto to that address. Your wallet never sends anything on its own. Once MoonPay receives it, it pays out to your linked bank account or card.

## 9. Check live prices

Tap **See all** under Live Prices on the main screen.

- **Crypto tab:** prices and 24-hour change for dozens of coins. Tap the star to pin a coin to the top.
- **Currencies tab:** what 1 unit of each currency is worth in your display currency.
- Use the search box to find a coin or currency.

Prices are informational and come from CoinGecko. Nothing about your wallet is sent to look them up.

## 10. Keep your wallet safe

- Store your recovery phrase offline. A photo or a note in your phone isn't safe.
- In **Settings**, set **Auto-lock after inactivity** (5 minutes is recommended) and tap **Lock wallet** when you're done.
- Keep a **Send delay** on. It gives you time to cancel a mistaken send.
- Use **Manage approvals** to review which apps and tokens you've allowed to use your funds.
- Nobody from Token Exchange will ever ask for your recovery phrase or password.

## Need help?

Open **Settings → Help & support** for answers in the app, or **Request a feature** to tell us what to build next. You can also tap **Need help?** on the welcome or unlock screens.
