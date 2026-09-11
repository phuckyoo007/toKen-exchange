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
const FEE_RECIPIENT = "0xd537ff9E2773CeCB7A3C68f174F8Cb3a5d60e4dB";

// Returns { feeWei, netWei } for a given input amount (ethers.BigNumber or
// anything ethers.BigNumber.from() accepts).
function computeFee(amountInWei) {
  const amount = ethers.BigNumber.from(amountInWei);
  const feeWei = amount.mul(FEE_NUMERATOR).div(FEE_DENOMINATOR);
  const netWei = amount.sub(feeWei);
  return { feeWei, netWei };
}

function feePercentLabel() {
  return ((FEE_NUMERATOR / FEE_DENOMINATOR) * 100).toString() + "%";
}

if (typeof self !== "undefined") {
  self.TM_FEE = { FEE_NUMERATOR, FEE_DENOMINATOR, FEE_RECIPIENT, computeFee, feePercentLabel };
}
