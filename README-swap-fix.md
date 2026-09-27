# Fix: swap quotes were failing for everyone, not just NOVA

## Root cause

Your NOVA -> ETH swap error ("Something went wrong talking to the network")
wasn't specific to NOVA. `wallet-engine.js`'s swap-quote handler calls
`TM_SWAP.tryAggregatorQuote(...)` and, later, `TM_SWAP.executeAggregatorSwap(...)`
-- but neither function actually existed in `lib/swap.js`. Every swap attempt
where you had a selected account (i.e. basically every real attempt) hit
`TM_SWAP.tryAggregatorQuote is not a function` before it ever got to the
plain on-chain router quote that was supposed to be the fallback.

This confirms the intended design, which was already half-built:
- `swap-quote-api.js` (backend) already correctly proxies to 0x's Swap API
  and returns clean `{configured:false}` / `{ok:false, liquidityAvailable:false}`
  / a full quote -- this part was never broken.
- `lib/swap.js` (client) was supposed to have a `tryAggregatorQuote()` that
  calls that backend endpoint, and an `executeAggregatorSwap()` that
  broadcasts the transaction 0x prepares -- neither was ever written.

So this wasn't "NOVA has no liquidity" (though that's *also* true, and now
handled correctly) -- it was every swap, on every token pair, crashing
before it could even fall back to the plain router quote.

## What I added to `lib/swap.js`

- **`tryAggregatorQuote({ network, tokenIn, tokenOut, amountInWei, taker, slippageBps })`**
  -- fetches `https://web-wallet-production.up.railway.app/api/swap-quote`
  (an absolute URL, same pattern as `transak-config.js` / 
  `coinbase-onramp-config.js`, since this file is shared between the website
  and the extension and a relative path only works on the website's own
  origin). Returns `null` -- never throws -- whenever an aggregator route
  isn't available for *any* reason: feature not configured, no liquidity
  (exactly NOVA's case, and any other custom/illiquid token), a bad response,
  or a network failure. A `null` return is what makes the existing code fall
  through to the plain Uniswap-V2-style router quote, which is the right
  behavior for a token 0x doesn't index at all.
- **`executeAggregatorSwap({ signer, transaction })`** -- broadcasts the exact
  transaction (`to`/`data`/`value`/`gas`/`gasPrice`) the backend already
  prepared via 0x. This one mattered too: `TM_SWAP_EXECUTE` already had a
  try/catch around this call that falls back to a plain router-executed swap
  on failure -- but since the function didn't exist, *every* aggregator-quoted
  swap was silently taking that fallback path while still being charged the
  higher aggregator fee rate (the fee is sent before this call runs). That
  fallback is now back to being the rare edge case it was designed for
  (a stale quote or gas mismatch) instead of the thing that happened on
  every single 0x-routed swap.

Nothing about the backend (`swap-quote-api.js`), the plain router path
(`getQuote`/`executeSwap`), or the fee math changed -- this only fills in
the two missing functions those already-correct pieces were calling.

## What this means for your NOVA swap specifically

NOVA is your own token with essentially no market liquidity that 0x would
know about, so `tryAggregatorQuote` will correctly return `null` for it and
the swap will fall through to the plain on-chain router quote against
whatever pool NOVA actually has configured on Base. If that pool has enough
liquidity for the amount you're swapping, it should now quote and execute
normally instead of crashing outright. If NOVA has no router pool with
depth for that amount, you'd now get an honest "not enough liquidity" /
on-chain revert instead of the generic network-error message -- which is a
real, separate limitation of the pool itself, not something this fix can
paper over.

## Files changed

- `lib/swap.js` -- added `tryAggregatorQuote` and `executeAggregatorSwap`,
  exported both on `TM_SWAP`. Nothing else in the file changed.

## Testing note

The browser bridge wasn't connected, so I verified this with an isolated
script (stubbing `fetch`/`ethers`) covering: a network exception, the
`{configured:false}` case, the `{ok:false, liquidityAvailable:false}` case
(NOVA's actual scenario), a non-200 response, malformed JSON, a fully
successful quote (checking `amountOutWei`/`minAmountOutWei`/`allowanceTarget`/
`transaction` all come through correctly), `executeAggregatorSwap` sending
the exact prepared transaction, and it throwing a clear error if the
transaction is missing. All eight passed. Also confirmed `node --check
swap.js` parses cleanly. Worth a real click-through once it's live: try the
NOVA -> ETH swap again (should now either quote via the router or give an
honest liquidity error instead of crashing), and if you have a token pair
with real 0x liquidity (e.g. ETH -> USDC on a supported network), that's
worth testing too since it exercises the aggregator path this fix actually
completes end-to-end.
