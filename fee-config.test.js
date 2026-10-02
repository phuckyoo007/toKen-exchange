const test = require("node:test");
const assert = require("node:assert/strict");
const { ROOT, loadBrowserLibs } = require("./helpers/load-libs");

loadBrowserLibs(["ethers.umd.min.js", "fee-config.js"]);
const { computeFee, feePercentLabel, FEE_NUMERATOR, AGGREGATOR_FEE_NUMERATOR, FEE_DENOMINATOR, FEE_RECIPIENT } = self.TM_FEE;
const BN = ethers.BigNumber;

test("rate is exactly 0.5%", () => {
  assert.equal(FEE_NUMERATOR, 500);
  assert.equal(FEE_DENOMINATOR, 100000);
  assert.equal(feePercentLabel(), "0.5%");
});

test("1000 units: 5 fee, 995 swapped (the example in the file header)", () => {
  const { feeWei, netWei } = computeFee(1000);
  assert.equal(feeWei.toString(), "5");
  assert.equal(netWei.toString(), "995");
});

test("1 ETH in wei", () => {
  const { feeWei, netWei } = computeFee(BN.from("1000000000000000000"));
  assert.equal(feeWei.toString(), "5000000000000000");
  assert.equal(netWei.toString(), "995000000000000000");
});

test("zero in, zero out", () => {
  const { feeWei, netWei } = computeFee(0);
  assert.equal(feeWei.toString(), "0");
  assert.equal(netWei.toString(), "0");
});

test("dust amounts round the fee DOWN, so the user is never overcharged", () => {
  assert.equal(computeFee(199).feeWei.toString(), "0"); // 0.995 -> 0
  assert.equal(computeFee(200).feeWei.toString(), "1");
  assert.equal(computeFee(199).netWei.toString(), "199");
});

test("fee + net always equals the input, and fee never exceeds 0.5%", () => {
  const samples = ["1", "7", "199", "200", "12345", "999999", "1000000000000000001", "115792089237316195423570985008687907853269984665640564039457584007913129639935"];
  for (const s of samples) {
    const amt = BN.from(s);
    const { feeWei, netWei } = computeFee(amt);
    assert.ok(feeWei.add(netWei).eq(amt), "fee+net != amount for " + s);
    assert.ok(feeWei.mul(FEE_DENOMINATOR).lte(amt.mul(FEE_NUMERATOR)), "fee too high for " + s);
  }
});

test("accepts numbers, decimal strings, hex strings and BigNumbers alike", () => {
  const want = "5";
  for (const input of [1000, "1000", "0x03e8", BN.from(1000)]) {
    assert.equal(computeFee(input).feeWei.toString(), want);
  }
});

test("fee recipient is a valid, correctly-checksummed address", () => {
  // getAddress() throws on a mixed-case address whose checksum is wrong, which
  // would mean a typo in the payout address.
  assert.equal(ethers.utils.getAddress(FEE_RECIPIENT), FEE_RECIPIENT);
});

test("aggregator-routed swaps use the higher rate: 0.65%", () => {
  assert.equal(AGGREGATOR_FEE_NUMERATOR, 650);
  assert.equal(feePercentLabel({ viaAggregator: true }), "0.65%");
  const { feeWei, netWei } = computeFee(1000, { viaAggregator: true });
  assert.equal(feeWei.toString(), "6"); // 6.5 rounds down
  assert.equal(netWei.toString(), "994");
  assert.equal(computeFee(BN.from("1000000000000000000"), { viaAggregator: true }).feeWei.toString(), "6500000000000000");
});

test("viaAggregator false / missing options keep the base rate", () => {
  for (const opts of [undefined, {}, { viaAggregator: false }]) {
    assert.equal(computeFee(1000, opts).feeWei.toString(), "5");
    assert.equal(feePercentLabel(opts), "0.5%");
  }
  assert.ok(AGGREGATOR_FEE_NUMERATOR > FEE_NUMERATOR);
});

test("aggregator fee + net equals the input and never exceeds 0.65%", () => {
  for (const s of ["1", "153", "154", "999999", "1000000000000000001"]) {
    const amt = BN.from(s);
    const { feeWei, netWei } = computeFee(amt, { viaAggregator: true });
    assert.ok(feeWei.add(netWei).eq(amt));
    assert.ok(feeWei.mul(FEE_DENOMINATOR).lte(amt.mul(AGGREGATOR_FEE_NUMERATOR)));
  }
});
