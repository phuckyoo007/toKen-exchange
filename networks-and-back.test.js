const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// networks.js is a plain browser script; evaluate it in isolation.
function loadNetworks() {
  const src = read("networks.js") + "\n;BUILTIN_NETWORKS;";
  return (0, eval)(src);
}
const ethers = (() => { try { return require("ethers"); } catch (e) { return null; } })();

test("every network with a swap router also has a wrapped-native token, and they are valid addresses", () => {
  const nets = loadNetworks();
  const on = nets.filter((n) => n.swapRouter);
  assert.ok(on.length >= 9, "expected at least 9 swap-enabled networks, got " + on.length);
  for (const n of on) {
    assert.match(n.swapRouter, /^0x[0-9a-fA-F]{40}$/, n.key + " router");
    assert.match(n.wrappedNative || "", /^0x[0-9a-fA-F]{40}$/, n.key + " wrappedNative");
    if (ethers) {
      assert.doesNotThrow(() => ethers.utils.getAddress(n.swapRouter), n.key + " router checksum");
      assert.doesNotThrow(() => ethers.utils.getAddress(n.wrappedNative), n.key + " wrapped checksum");
    }
  }
});

test("networks with no verified router stay switched off", () => {
  const nets = loadNetworks();
  for (const key of ["robinhood", "monad", "scroll", "zksync", "mantle", "celo", "sepolia"]) {
    const n = nets.find((x) => x.key === key);
    assert.ok(n, key + " exists");
    assert.strictEqual(n.swapRouter, null, key + " must not have a router until one is verified");
  }
});

test("Avalanche, Linea and Gnosis routers match the verified addresses", () => {
  const nets = loadNetworks();
  const get = (k) => nets.find((x) => x.key === k);
  assert.strictEqual(get("avalanche").swapRouter.toLowerCase(), "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24");
  assert.strictEqual(get("linea").swapRouter.toLowerCase(), "0x2abf469074dc0b54d793850807e6eb5faf2625b1");
  assert.strictEqual(get("gnosis").swapRouter.toLowerCase(), "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506");
});

for (const page of ["index.html", "popup.html"]) {
  test(page + ": every Back/Cancel button is the big pinned pill and points at a real screen", () => {
    const html = read(page);
    const buttons = [...html.matchAll(/<button[^>]*class="(?:[^"]*\s)?back-btn(?:\s[^"]*)?"[^>]*>/g)].map((m) => m[0]);
    assert.ok(buttons.length >= 15, "found " + buttons.length);
    for (const b of buttons) {
      assert.match(b, /top-back-btn/, "not converted: " + b);
      const target = /data-back="([^"]+)"/.exec(b);
      assert.ok(target, "missing data-back: " + b);
      assert.ok(html.includes('id="' + target[1] + '"'), page + " has no #" + target[1]);
    }
    assert.ok(/id="btn-support-back"/.test(html));
  });
}

test("the pinned Back button styles exist for website and extension", () => {
  for (const css of ["app.css", "popup.css"]) {
    const s = read(css);
    assert.match(s, /\.top-back-btn\s*\{/);
    assert.match(s, /\.top-back-btn-coin\s*\{/);
    assert.match(s, /prefers-reduced-motion[^}]*\{[^}]*\.top-back-btn\s*\{\s*animation:\s*none/);
  }
});

test("website exposes TMNativeBack for the Android app", () => {
  assert.match(read("app.js"), /window\.TMNativeBack\s*=\s*function/);
});
