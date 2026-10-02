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

// Swaps routed through the 0x aggregator: 0x nets its own ~0.15% protocol fee
// out of the quote it returns, so we skim 0.15% more up front to keep this
// wallet's own take at the base 0.5%.
//   650 / 100000 = 0.0065 = 0.65%
const AGGREGATOR_FEE_NUMERATOR = 650;

function rateFor(opts) {
  return opts && opts.viaAggregator ? AGGREGATOR_FEE_NUMERATOR : FEE_NUMERATOR;
}

// Returns { feeWei, netWei } for a given input amount (ethers.BigNumber or
// anything ethers.BigNumber.from() accepts). Pass { viaAggregator: true } for
// swaps routed through the 0x aggregator (higher rate, see above).
function computeFee(amountInWei, opts) {
  const amount = ethers.BigNumber.from(amountInWei);
  const feeWei = amount.mul(rateFor(opts)).div(FEE_DENOMINATOR);
  const netWei = amount.sub(feeWei);
  return { feeWei, netWei };
}

function feePercentLabel(opts) {
  return ((rateFor(opts) / FEE_DENOMINATOR) * 100).toString() + "%";
}

if (typeof self !== "undefined") {
  self.TM_FEE = { FEE_NUMERATOR, AGGREGATOR_FEE_NUMERATOR, FEE_DENOMINATOR, FEE_RECIPIENT, computeFee, feePercentLabel };
}
