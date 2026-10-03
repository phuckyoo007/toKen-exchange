// A website must not be able to change the wallet's active network silently.
// background.js has to ask (openApprovalPopup "switchNetwork") BEFORE it calls
// setSelectedNetwork, and the popup must have a screen and strings for it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/load-libs");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const KEYS = ["approve.switchNetTitle", "approve.switchNetText", "approve.switchNetWarning", "approve.switchNetBtn"];

test("wallet_switchEthereumChain asks the user before switching", () => {
  const src = read("background.js");
  const start = src.indexOf('case "wallet_switchEthereumChain"');
  const end = src.indexOf('case "wallet_addEthereumChain"');
  assert.ok(start > 0 && end > start, "could not find the switch case");
  const body = src.slice(start, end);
  const ask = body.indexOf('openApprovalPopup(\n          "switchNetwork"');
  const set = body.indexOf("setSelectedNetwork(");
  assert.ok(ask > 0, "no switchNetwork approval request");
  assert.ok(set > ask, "network is changed before the user is asked");
  assert.match(body, /err\.code = 4001/, "a rejection must surface as EIP-1193 4001");
  assert.match(body, /found\.chainId === network\.chainId\) return null/, "switching to the current chain should not prompt");
});

test("the popup renders the switchNetwork request", () => {
  assert.match(read("popup.js"), /type === "switchNetwork"/);
  const html = read("popup.html");
  for (const id of ["screen-approve-switchnetwork", "approve-switchnet-text", "btn-approve-switchnet-accept", "btn-approve-switchnet-reject"]) {
    assert.ok(html.includes('id="' + id + '"'), id + " missing from popup.html");
  }
});

test("all nine languages have the switch-network strings", () => {
  for (const c of ["ar", "en", "es", "fr", "hi", "ja", "pt", "ru", "zh"]) {
    const src = read(c + ".js");
    for (const k of KEYS) assert.ok(src.includes('"' + k + '"'), c + ".js is missing " + k);
  }
  for (const c of ["ar", "en", "es", "fr", "hi", "ja", "pt", "ru", "zh"]) {
    assert.match(read(c + ".js"), /"approve\.switchNetText": "[^"]*\{origin\}[^"]*\{from\}[^"]*\{to\}|"approve\.switchNetText": "[^"]*\{from\}[^"]*\{to\}/, c + " text lost its placeholders");
  }
});

test("request ids use crypto, not Math.random", () => {
  for (const f of ["background.js", "wallet-engine.js"]) {
    const src = read(f);
    const m = src.match(/function newRequestId\(\) \{[\s\S]*?\n\}/);
    assert.ok(m, f + ": newRequestId not found");
    assert.ok(!/Math\.random/.test(m[0]), f + ": newRequestId still uses Math.random");
    assert.match(m[0], /crypto\.randomUUID/);
  }
});
