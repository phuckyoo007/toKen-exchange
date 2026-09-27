# Known-stablecoin fix, now in three places

## Recap

Your screenshot showed EURC on OP Mainnet: "Swap for EURC" greyed out, with
"EURC can't be swapped on OP Mainnet yet." That was correct — EURC isn't
deployed on Optimism — but the wallet had no way to tell you *where it is*.
The fix added a small, hand-verified `KNOWN_STABLECOIN_ADDRESSES` list in
`app.js` (addresses checked against each issuer's own official docs, never
guessed) so a coin-detail page could say "switch to Ethereum/Base and we'll
add it for you" instead of a dead end.

Registry currently covers:

- **EURC**: Ethereum, Base
- **USDC**: Ethereum, Base, Polygon, Arbitrum One, OP Mainnet
- **USDT**: Ethereum only

(JPYC and BRZ were researched and deliberately left out — multiple
different contracts share each name across explorers with no single
official page saying which is current, so I didn't want to guess with
real money on the line. Happy to add either once there's an unambiguous
issuer-published address.)

You asked where else that list could be useful — here's the other two
places it now shows up, on top of the original coin-detail fix.

## 1. Add Token screen: "Quick add" chips

Opening Add Token now shows a small "Quick add:" row of chips for whichever
of EURC/USDC/USDT are verified on whatever network you're currently on —
e.g. on OP Mainnet you'd see a single "+ USDC" chip; on Ethereum you'd see
all three. Tapping one fills in the contract address and runs the exact
same on-chain lookup as typing it in yourself, so you still see the name/
symbol/decimals preview and click "Add to my wallet" to confirm — no
shortcuts around that verification step, just no more needing to go find
the address yourself.

If none of the three are verified on your current network (BSC, for
instance — none of them are confirmed there), the row simply doesn't show.

## 2. Currencies list: availability tags

On the Prices screen's Currencies tab, a stablecoin-backed currency row
(EUR, USD, etc.) now shows a small green line under its ticker — e.g. "✓ On
Ethereum Mainnet, Base" under EUR — so you can tell at a glance which of
your networks actually has it, before tapping in only to find out. Purely
informational, this doesn't add anything by itself.

## Files changed (cumulative for this feature)

- `app.js` — `KNOWN_STABLECOIN_ADDRESSES` registry (EURC/USDC/USDT) and the
  three places it's used: the coin-detail dead-end fallback, the Add Token
  quick-add chips, and the Currencies list availability tag
- `en.js` — new strings: `coin.swapUnavailableKnownElsewhere`,
  `coin.addOnNetworkBtn`, `addToken.quickAddLabel`, `addToken.quickAddChip`,
  `prices.availableOn`
- `app.css` — `.quick-add-chips` / `.quick-add-chip` (Add Token, reuses the
  existing support-chip look) and `.price-net-tag` (Currencies list)
- `index.html` — one new empty container, `#add-token-quick`, on the Add
  Token screen (populated entirely by `app.js`)

## Testing note

The browser bridge to your computer wasn't connected while I built this, so
I verified both features' filtering logic with an isolated test script
(confirmed each network shows exactly the right quick-add chips, and each
currency row shows exactly the right availability tag or none at all) and
confirmed `app.js`/`en.js` still parse cleanly and `index.html`'s tags stay
balanced. Worth a real click-through once it's live — the Add Token screen
on a couple of different networks, and the Currencies tab's EUR/USD rows,
are the parts to eyeball.
