# Fix: swap "Approving..." then "Couldn't get a response from the network"

## Root cause
Not the network, not Railway (deploy is healthy) and not NOVA. ethers v5's fee
estimate assumes Ethereum: it adds a fixed 1.5 gwei tip. Base's real base fee is
~0.005 gwei, so the wallet asked the node to budget ~150x more gas money than the
approve will actually cost (maxFeePerGas 1.51 gwei vs ~0.011 gwei). The node checks
"can this account afford gasLimit x maxFeePerGas?", answered "gas required exceeds
allowance", and the app's error mapper showed that as "Couldn't get a response".
Any account holding only a little ETH on Base hits this.

## Changes
- wallet-engine.js + background.js: on Base / OP / Arbitrum every provider now returns
  realistic fee data (node's suggested tip, capped at 0.1 gwei). Fixes approve, the
  0.5% fee transfer, the swap, and sends.
- wallet-engine.js: deterministic failures (bad gas estimate, insufficient funds,
  revert) are no longer retried across all RPCs as if they were network flakes.
- app.js: clear messages for "not enough ETH for network fee" and for gas-estimate
  failures instead of the generic network message.

## Tested
Local mock Base node that enforces the same gas-allowance check: stock ethers fails
with 0.00003 ETH, patched code sends the approve. With 0 ETH it now says "Not enough
ETH to pay the network fee". The repo's own *.test.js files can't run from this zip
(missing helpers/load-libs), before or after these changes.

## Added: "Network fee" row on the Swap screen
Shows the estimated network fee for the whole swap (approve if needed + 0.5% fee
transfer + swap) in ETH and your display currency, with a per-step breakdown and the
current gas price. If the account holds less native coin (ETH on Base) than the fees
need, a warning appears before you tap Swap.
- New message TM_SWAP_GAS_ESTIMATE in wallet-engine.js and background.js.
- Row added to index.html (website) and popup.html/popup.js (extension); app.js renders it.
- New English strings in en.js (other languages fall back to English).
- Gas units are typical ERC-20 / Uniswap V2 numbers (approve 55k, fee transfer 65k or
  21k for native, swap 250k or 200k for native); real usage is usually a bit lower.
Tested the handler against a mock Base node: ~0.0000022 ETH total at 0.006 gwei.
UI rendering itself was not run in a browser here.
