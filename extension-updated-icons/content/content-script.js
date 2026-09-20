// content/content-script.js
// Runs in the ISOLATED world (has chrome.runtime access, but a separate JS
// heap from the page). Bridges postMessage traffic from inject.js (which
// runs in the page's MAIN world, see manifest content_scripts "world":"MAIN")
// to the background service worker, and relays wallet events back down.

const CHANNEL = "tokenmachine";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.channel !== CHANNEL || msg.direction !== "to-extension") return;

  if (msg.kind === "request") {
    chrome.runtime.sendMessage(
      { type: "TM_DAPP_REQUEST", method: msg.method, params: msg.params, origin: window.location.origin },
      (response) => {
        const err = chrome.runtime.lastError;
        window.postMessage(
          {
            channel: CHANNEL,
            direction: "from-extension",
            kind: "response",
            id: msg.id,
            ok: err ? false : response.ok,
            result: response && response.result,
            error: err ? err.message : response && response.error,
            code: response && response.code,
          },
          "*"
        );
      }
    );
  }
});

// Relay wallet-originated events (accountsChanged, chainChanged) from the
// background worker down into the page.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "TM_EVENT") return;
  window.postMessage(
    { channel: CHANNEL, direction: "from-extension", kind: "event", event: msg.event, data: msg.data },
    "*"
  );
});
