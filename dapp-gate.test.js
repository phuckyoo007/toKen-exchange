// background.js runs only inside Chrome, so this pulls out just the connection
// gate (requireConnectedOrigin) and the WalletConnect gate (assertWcRequestAllowed)
// and checks them in isolation.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT } = require("./helpers/load-libs");

const src = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
const m = src.match(/async function requireConnectedOrigin[\s\S]*?\n}\n/);
assert.ok(m, "requireConnectedOrigin not found in background.js");

function gate(approved) {
  const ctx = { getApprovedOrigins: async () => approved };
  vm.createContext(ctx);
  vm.runInContext(m[0] + "\nthis.f = requireConnectedOrigin;", ctx);
  return ctx.f;
}

test("an origin that never connected is refused with EIP-1193 code 4100", async () => {
  await assert.rejects(gate({})("https://evil.example", "0xabc"), (e) => e.code === 4100);
});

test("a connected origin passes, address compared case-insensitively", async () => {
  const f = gate({ "https://ok.example": ["0xAbC123"] });
  await f("https://ok.example");
  await f("https://ok.example", "0xabc123");
});

test("a connected origin cannot use a different account", async () => {
  const f = gate({ "https://ok.example": ["0xAbC123"] });
  await assert.rejects(f("https://ok.example", "0xdef456"), (e) => e.code === 4100);
});

test("every dapp signing path and chain switch calls the gate", () => {
  for (const method of ["wallet_switchEthereumChain", "eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]) {
    const block = src.split('case "' + method + '"')[1] || "";
    assert.match(block.slice(0, 400), /requireConnectedOrigin/, method + " must call requireConnectedOrigin");
  }
});

// ---- WalletConnect: requests must stay inside what the user approved ----
const wcSrc = src.match(/function assertWcRequestAllowed[\s\S]*?\n}\n/);
assert.ok(wcSrc, "assertWcRequestAllowed not found in background.js");
const wcCtx = {};
vm.createContext(wcCtx);
vm.runInContext(wcSrc[0] + "\nthis.f = assertWcRequestAllowed;", wcCtx);
const session = { namespaces: { eip155: { accounts: ["eip155:1:0xAbC123", "eip155:8453:0xAbC123"] } } };

test("WalletConnect: approved chain and account pass", () => {
  wcCtx.f(session, 1, "eth_sendTransaction", [{ from: "0xabc123", to: "0x1" }]);
  wcCtx.f(session, 8453, "personal_sign", ["0xdead", "0xABC123"]);
  wcCtx.f(session, 1, "eth_signTypedData_v4", ["0xabc123", "{}"]);
});

test("WalletConnect: a chain the dapp was not approved for is refused", () => {
  assert.throws(() => wcCtx.f(session, 137, "eth_sendTransaction", [{ from: "0xabc123" }]), (e) => e.code === 4100);
});

test("WalletConnect: another account in the wallet is refused for every signing method", () => {
  assert.throws(() => wcCtx.f(session, 1, "eth_sendTransaction", [{ from: "0xdef456" }]), (e) => e.code === 4100);
  assert.throws(() => wcCtx.f(session, 1, "personal_sign", ["0xdead", "0xdef456"]), (e) => e.code === 4100);
  assert.throws(() => wcCtx.f(session, 1, "eth_signTypedData_v4", ["0xdef456", "{}"]), (e) => e.code === 4100);
});

test("WalletConnect: a signing request with no account at all is refused", () => {
  assert.throws(() => wcCtx.f(session, 1, "eth_sendTransaction", [{}]), (e) => e.code === 4100);
});

test("WalletConnect: session_request calls the check before handling anything", () => {
  const block = src.split('client.on("session_request"')[1] || "";
  assert.match(block.slice(0, 900), /assertWcRequestAllowed\(/);
});
