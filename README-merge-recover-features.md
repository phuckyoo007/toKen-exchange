# Recovering 3 features after the security/cleanup pass

## What happened
The security and cleanup pass (the 10-item PDF, "all-fixes-1-10") was built
from an older saved snapshot of the repo -- before three things shipped
earlier today:

1. The wallet-engine.js fix for "Couldn't reach the network" (a plain
   `ethers.providers.JsonRpcProvider` was silently making an extra,
   failure-prone network-detection call before every real one; switched to
   `StaticJsonRpcProvider` with an explicit chain ID everywhere a provider
   is built).
2. The "Hottest Exchanges" home card + full screen (CoinGecko's exchange
   trust-score ranking).
3. The swap "To" picker's new stablecoin suggestions (offers EURC/USDC/USDT
   you don't already hold, per network).

Once that pass got uploaded to GitHub, all three were gone from `main` --
not because anything conflicted, just because the pass started from a copy
of the repo taken before they existed.

## What this delivers
The 6 files below, with all three features re-applied ON TOP OF the
security pass (not instead of it) -- every escaping/CORS/CSP/rate-limit/
extension fix from the 10-item pass is untouched:

- `wallet-engine.js` -- network-error fix restored
- `prices.js`, `app.css`, `en.js`, `index.html`, `app.js` -- Hottest
  Exchanges + swap suggestions restored

Only these 6 files need to be re-uploaded; nothing else from the security
pass needs to change.

## Verified before delivery
- Applied each of the three re-additions as an isolated diff against the
  exact pre-security-pass version of each file, confirming no other lines
  were touched.
- `node --check` on every changed file.
- Full `npm test` on the merged repo: still 82/82 passing (the security
  pass's own suite, including the "no redeclared shared name" and
  service-worker precache-consistency tests).
- Booted the merged `server.js` locally and confirmed via direct fetch that
  `wallet-engine.js`, `app.js`, `prices.js`, `app.css` and `en.js` all serve
  the merged content together, with the CSP/CORS/security headers still
  present and unchanged.
- Headless Chromium smoke test: page loads with zero console/JS errors,
  `showScreen('screen-exchanges')` + `refreshExchanges()` run cleanly, and
  `suggestedStablecoinAssets([], {chainId:1})` returns the expected
  EURC/USDC/USDT suggestions (the only error seen was the sandbox's own
  network restriction blocking the live CoinGecko call -- expected here,
  not a bug).
- Re-ran the 8 isolated logic tests for the swap-suggestions function --
  all still pass.

## To deploy
Replace these 6 files in the repo root with the ones in this zip (over top
of what's already there from the security pass), commit, and Railway will
redeploy. No other files need to change.
