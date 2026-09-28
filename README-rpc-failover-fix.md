# Fix: "Couldn't get a response from the network" during Approve (and swap execute risk)

## What was happening

Both times you hit this, it was during the Approve step, right after a
working quote. That's a specific tell: `TM_SWAP_APPROVE` (and
`TM_SWAP_ALLOWANCE`) picked exactly ONE RPC node via `pickHealthyRpcUrl()`
and committed to it for the whole call. But `pickHealthyRpcUrl()` only
proves that node can answer a cheap read (`eth_getBalance`) -- it says
nothing about whether that same node will reliably accept a raw signed
transaction a few seconds later. Public RPC nodes fail on writes more often
than reads (rate limits, brief hiccups, a malformed response body), and
when that happens ethers throws `SERVER_ERROR`/`NETWORK_ERROR`/`TIMEOUT`,
which your own `friendlyErrorMessage()` table turns into exactly the
message you saw: "Couldn't get a response from the network." There was no
fallback -- one flaky node and the whole approve failed, even though
`network.rpcUrls` for Base lists three separate nodes.

## What I changed

In `wallet-engine.js`, added `withRpcFailover(network, action)`: it tries
each of the network's RPC URLs in turn (the cached "healthy" one first,
then the rest), running a fresh `JsonRpcProvider` for each. It only moves
to the next URL for errors that look like a node/transport problem
(matching the same categories your `friendlyErrorMessage()` already uses,
plus ethers' `SERVER_ERROR`/`NETWORK_ERROR`/`TIMEOUT` codes) -- a real
failure (a revert, insufficient allowance, a rejected signature, a bad
nonce) fails identically on every node, so it's rethrown immediately
instead of retried, so you still see the real error rather than a
misleading "network" message.

`TM_SWAP_APPROVE` and `TM_SWAP_ALLOWANCE` now go through this helper
instead of a single `getProviderFor()` call. Both are safe to retry against
another node without risk -- allowance is a read, and re-approving the same
spender for the same amount is a no-op if the first attempt actually went
through.

## What I deliberately did NOT touch this round

`TM_SWAP_EXECUTE` (the actual swap broadcast) has the same single-node
exposure, but I didn't want to change that path blind -- a write that
moves real value deserves its own careful look at what happens if the
first node's response fails AFTER it already broadcast the transaction
(retrying elsewhere could occasionally submit a second transaction at a
different gas price rather than just retrying a no-op). I'd rather look at
that one specifically with you next, now that I have the exact current
code, than fold it into this fix by assumption.

`TM_SWAP_QUOTE`'s router fallback has the same exposure too but wasn't
what broke here (your quote worked fine both times) -- lower priority.

## Testing note

The Chrome bridge wasn't connected, so I verified `withRpcFailover()` with
an isolated script stubbing `JsonRpcProvider` and `pickHealthyRpcUrl`,
covering: first URL fails with a retryable error / second succeeds, two
URLs fail via ethers' `SERVER_ERROR` code / third succeeds, a non-retryable
error (`CALL_EXCEPTION`, e.g. a revert) is thrown immediately without
trying other URLs, all URLs failing propagates the last error, and the
single-RPC-URL case still works unchanged. All five passed. Also confirmed
`node --check wallet-engine.js` parses cleanly, and diffed the full file
against the current GitHub copy to confirm this is the only change --
nothing else in the file was touched.

## Files changed

- `wallet-engine.js` -- added `withRpcFailover()`/`isRpcFailoverRetryable()`,
  and switched `TM_SWAP_APPROVE`/`TM_SWAP_ALLOWANCE` to use it. Nothing
  else changed.

## One correction from earlier

I'd flagged a possible Buy/Sell inconsistency in the error-masking fix
(`showError`'s `raw` flag) based on a page-summary tool that turned out to
mis-quote the file. I pulled the raw file directly this time to check, and
both Buy and Sell already have it correctly -- no action needed there.
