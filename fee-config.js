// lib/fee-config.js
// Single place to configure the app's swap fee. The fee is skimmed off the
// INPUT amount before the remainder is swapped -- e.g. on a 1000-unit swap
// at the default rate, 5 units go to FEE_RECIPIENT and 995 units actually
// get swapped. This is the same shape of fee MetaMask, the Uniswap
// Labs web app, and most swap aggregators charge; it works because the
// wallet stays non-custodial (nothing is ever held -- funds move straight
// from the user to the fee address and to the router in the same flow the
// user themselves signs).
//
// Expressed as an exact integer fraction (not "basis points") so the rate
// has no floating-point rounding: FEE_NUMERATOR / FEE_DENOMINATOR.
//   500 / 100000 = 0.005 = 0.5% (flat)
//
// To change the rate later, edit these two numbers -- nothing else in the
// codebase needs to change. To change the payout address, edit FEE_RECIPIENT.

const FEE_NUMERATOR = 500;
const FEE_DENOMINATOR = 100000;
const FEE_RECIPIENT = "0x0064118676E6C4daaE92Fa7a89e14a5BD60A20C4";

// A second, higher rate that applies ONLY to a swap that actually routes
// through the 0x aggregator (see lib/swap.js's tryAggregatorQuote() and
// wallet-engine.js/background.js's TM_SWAP_QUOTE/TM_SWAP_EXECUTE
// handlers, which decide per-swap which rate applies). 0x bakes its own
// ~0.15% protocol fee into the quote it hands back -- already netted out
// of the buyAmount it returns, not something this wallet's server ever
// collects -- so this raises OUR OWN skim by that same 0.15% on those
// swaps only, to keep this wallet's own take the same either way. A swap
// that falls back to the plain on-chain router (no 0x involved, no 0x fee
// taken from it) is still charged the base rate above, unchanged.
//   650 / 100000 = 0.0065 = 0.65% (flat, aggregator-routed swaps only)
const AGGREGATOR_FEE_NUMERATOR = 650;
const AGGREGATOR_FEE_DENOMINATOR = 100000;

// Returns { feeWei, netWei } for a given input amount (ethers.BigNumber or
// anything ethers.BigNumber.from() accepts). Pass { viaAggregator: true }
// for a swap that's routing through the 0x aggregator, to use the higher
// combined rate above; omit it (or pass false) for the base rate.
function computeFee(amountInWei, opts) {
  const useAggregatorRate = !!(opts && opts.viaAggregator);
  const numerator = useAggregatorRate ? AGGREGATOR_FEE_NUMERATOR : FEE_NUMERATOR;
  const denominator = useAggregatorRate ? AGGREGATOR_FEE_DENOMINATOR : FEE_DENOMINATOR;
  const amount = ethers.BigNumber.from(amountInWei);
  const feeWei = amount.mul(numerator).div(denominator);
  const netWei = amount.sub(feeWei);
  return { feeWei, netWei };
}

function feePercentLabel(opts) {
  const useAggregatorRate = !!(opts && opts.viaAggregator);
  const numerator = useAggregatorRate ? AGGREGATOR_FEE_NUMERATOR : FEE_NUMERATOR;
  const denominator = useAggregatorRate ? AGGREGATOR_FEE_DENOMINATOR : FEE_DENOMINATOR;
  return ((numerator / denominator) * 100).toString() + "%";
}

if (typeof self !== "undefined") {
  self.TM_FEE = {
    FEE_NUMERATOR,
    FEE_DENOMINATOR,
    FEE_RECIPIENT,
    AGGREGATOR_FEE_NUMERATOR,
    AGGREGATOR_FEE_DENOMINATOR,
    computeFee,
    feePercentLabel,
  };
}
