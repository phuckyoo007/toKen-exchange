// content/inject.js
// Runs in the page's MAIN world (see manifest.json content_scripts
// "world": "MAIN"). Implements an EIP-1193 provider ("window.tokenMachine",
// plus EIP-6963 announcement so multi-wallet dapps can discover it, and
// window.ethereum as a fallback for older dapps that only check that).
//
// Honesty note: this does NOT set `isMetaMask: true`. Some wallets do that
// purely as a compatibility shim, but we'd rather a dapp correctly detect
// "Token Machine" (via EIP-6963, the modern standard) than pretend to be a
// different wallet.

(function () {
  const CHANNEL = "tokenmachine";
  let idCounter = 0;
  const pending = new Map();

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++idCounter;
      pending.set(id, { resolve, reject });
      window.postMessage({ channel: CHANNEL, direction: "to-extension", kind: "request", id, method, params }, "*");
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || msg.direction !== "from-extension") return;

    if (msg.kind === "response") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else {
        const err = new Error(msg.error || "Request failed.");
        if (msg.code) err.code = msg.code;
        p.reject(err);
      }
    } else if (msg.kind === "event") {
      provider._emit(msg.event, msg.data);
    }
  });

  class TokenMachineProvider {
    constructor() {
      this.isTokenMachine = true;
      this._listeners = {};
      this.chainId = null;
      this.selectedAddress = null;
      this._init();
    }

    async _init() {
      try {
        this.chainId = await send("eth_chainId", []);
      } catch (e) {
        /* dapp hasn't triggered a request yet; fine */
      }
    }

    async request({ method, params }) {
      const result = await send(method, params || []);
      if (method === "eth_chainId") this.chainId = result;
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        this.selectedAddress = (result && result[0]) || null;
      }
      return result;
    }

    // legacy aliases some older dapps still call
    sendAsync(payload, callback) {
      this.request({ method: payload.method, params: payload.params })
        .then((result) => callback(null, { id: payload.id, jsonrpc: "2.0", result }))
        .catch((err) => callback(err));
    }

    send(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === "string") {
        return this.request({ method: methodOrPayload, params: paramsOrCallback });
      }
      return this.sendAsync(methodOrPayload, paramsOrCallback);
    }

    on(event, handler) {
      (this._listeners[event] = this._listeners[event] || []).push(handler);
    }

    removeListener(event, handler) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter((h) => h !== handler);
    }

    _emit(event, data) {
      if (event === "chainChanged") this.chainId = data;
      if (event === "accountsChanged") this.selectedAddress = (data && data[0]) || null;
      (this._listeners[event] || []).forEach((h) => {
        try {
          h(data);
        } catch (e) {
          console.error("[TokenMachine] listener error", e);
        }
      });
    }
  }

  const provider = new TokenMachineProvider();

  // EIP-6963: Multi Injected Provider Discovery -- the modern, non-conflicting
  // way for dapps to find every installed wallet instead of racing to own
  // window.ethereum.
  const info = {
    uuid: crypto.randomUUID(),
    name: "Token Exchange",
    icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="%230B5FFF"/></svg>'),
    rdns: "app.tokenexchange",
  };
  function announce() {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  }
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  // Legacy fallback so older dapps that only check window.ethereum still work,
  // as long as no other wallet has already claimed the slot.
  if (!window.ethereum) {
    window.ethereum = provider;
  }
  window.tokenExchange = provider;
  window.tokenMachine = provider; // back-compat alias
})();
