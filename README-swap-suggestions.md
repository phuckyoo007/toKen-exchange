# Swap "To" suggestions -- what changed

## The problem
The "To" picker in Swap only ever listed assets you already hold (or have
added as a tracked token). If you wanted to swap into a stablecoin you'd
never held before, there was no way to even find it in that list -- you'd
have had to know its contract address and use the manual "custom address"
entry.

## The fix
`app.js` now adds a `suggestedStablecoinAssets(held, network)` function,
called from `populateSwapSelects()`. It offers a zero-balance entry for each
stablecoin in the existing, hand-verified `KNOWN_STABLECOIN_ADDRESSES` map
(EURC, USDC, USDT) that has a known contract address **on the network you're
currently connected to** -- never a guessed address, and never one for a
different chain.

- If you already hold or have tracked that stablecoin (even at zero
  balance), the real entry wins and the suggestion for it is skipped --
  de-duplicated by contract address.
- Only affects the "To" side. "From" is untouched -- it still only lists
  what you actually hold with a positive balance, same as before.
- The suggested entry's `decimals` field is cosmetic (just for display in
  the picker). The actual swap quote/approve/execute path always re-fetches
  the token's real decimals live from the contract itself, so this can't
  affect swap math.

## Verified
- `node --check` -- no syntax errors.
- Diffed against a freshly-pulled copy of the live `app.js`: the change is
  exactly the new function plus the one line in `populateSwapSelects()` that
  merges it in -- nothing else touched.
- 8 isolated logic tests (mocking `held`/`network` inputs) covering: correct
  per-network filtering (mainnet vs. Base vs. Polygon), case-insensitive
  address de-duplication against already-held assets, empty results for an
  unsupported chain or missing network (no throw), native-coin entries never
  causing a false dedup match, and the suggested entry's shape lining up
  with what the rest of the swap code (`findHeldAsset`, `keyToAddress`)
  already expects. All 8 passed.

## To deploy
Replace `app.js` in the repo root with the one in this zip, upload/commit as
usual, and Railway will redeploy.
