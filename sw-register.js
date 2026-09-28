// Registers the offline-support service worker. This used to be an inline
// <script> in index.html; it's an external file now so the Content-Security-
// Policy can forbid all inline scripts.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {
      // Offline support is an enhancement, not a requirement -- if
      // registration fails (unsupported browser, blocked storage, etc.)
      // the site just runs exactly as it did before this existed.
    });
  });
}
