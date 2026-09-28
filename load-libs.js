// Loads the real, shipped browser scripts (lib/*.js and the vendored ethers)
// into THIS Node process, the same way a page would: as classic scripts that
// attach themselves to `self` (self.TM_CRYPTO, self.TM_WALLET, ...).
// Each test file runs in its own process, so loading here never leaks between
// test files. No npm packages are needed.
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

function loadBrowserLibs(files) {
  globalThis.self = globalThis;
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), "utf8");
    vm.runInThisContext(code, { filename: f });
  }
  return globalThis;
}

// In-memory stand-in for chrome.storage.local (promise style, as wallet.js uses it).
function installFakeChromeStorage() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
          return out;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) store[k] = JSON.parse(JSON.stringify(v));
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        },
      },
    },
  };
  return store;
}

module.exports = { ROOT, loadBrowserLibs, installFakeChromeStorage };
