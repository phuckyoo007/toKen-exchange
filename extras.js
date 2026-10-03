// extras.js -- website add-ons loaded after app.js:
//   QR address scanning, activity CSV export, tx-confirmed notifications,
//   price alerts, light/dark theme switch, bridge link.
// Everything here is best-effort: if a piece fails it must never break the
// wallet, so each feature is wrapped and degrades to a short message.
(function () {
  "use strict";

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  const $id = (id) => document.getElementById(id);

  // Translate with an English fallback, so a missing key never shows raw.
  function tr(key, fallback, vars) {
    try {
      const s = TM_I18N.t(key, vars);
      if (s && s !== key) return s;
    } catch (e) { /* i18n not ready */ }
    let out = fallback;
    if (vars) Object.keys(vars).forEach((k) => { out = out.split("{" + k + "}").join(String(vars[k])); });
    return out;
  }

  // ---------- theme (applied immediately to avoid a flash) ----------
  function applyTheme(v) {
    const root = document.documentElement;
    if (v === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
  }
  applyTheme(LS.get("tm_theme", "dark"));

  // ---------- toast + notifications ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $id("tm-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 6000);
  }
  function notify(title, body) {
    const on = LS.get("tm_notify", "off") === "on";
    if (on && "Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
      try { new Notification(title, { body }); return; } catch (e) { /* fall through to toast */ }
    }
    toast(body ? title + " -- " + body : title);
  }

  // ---------- QR scanning ----------
  let scanStream = null;
  let scanTimer = null;

  function stopScan() {
    clearInterval(scanTimer);
    scanTimer = null;
    if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
    const v = $id("qr-scan-video");
    if (v) v.srcObject = null;
    const o = $id("qr-scan-overlay");
    if (o) o.classList.add("hidden");
  }

  // Pull a wallet address out of a scanned QR. For an EIP-681 token transfer
  // ("ethereum:<TOKEN>@1/transfer?address=<RECIPIENT>") the FIRST address is
  // the token contract, so we must use the address= parameter instead --
  // otherwise a scan would put the token contract in the recipient box.
  function addressFromQr(raw) {
    const s = String(raw || "").trim();
    let target = s;
    if (/^ethereum:/i.test(s) && /\/transfer/i.test(s)) {
      const m = s.match(/[?&]address=(0x[0-9a-fA-F]{40})/);
      target = m ? m[1] : "";
    }
    const m2 = target.match(/0x[0-9a-fA-F]{40}/);
    if (!m2) return null;
    try { return ethers.utils.getAddress(m2[0]); } catch (e) { return null; } // bad checksum -> null
  }

  async function startScan() {
    const overlay = $id("qr-scan-overlay");
    const video = $id("qr-scan-video");
    const hint = $id("qr-scan-hint");
    const unsupported = tr("send.scanUnsupported", "QR scanning isn't supported in this browser. Paste the address instead.");
    if (!overlay || !video || !("BarcodeDetector" in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast(unsupported);
      return;
    }
    let detector;
    try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { toast(unsupported); return; }
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) {
      toast(tr("send.scanDenied", "Camera access was blocked. Allow the camera for this site, or paste the address."));
      return;
    }
    video.srcObject = scanStream;
    try { await video.play(); } catch (e) { /* autoplay quirks */ }
    hint.textContent = tr("send.scanHint", "Point the camera at a wallet address QR code.");
    overlay.classList.remove("hidden");
    scanTimer = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (!codes.length) return;
        const addr = addressFromQr(codes[0].rawValue);
        if (!addr) { hint.textContent = tr("send.scanNoAddress", "That QR code doesn't contain a valid wallet address."); return; }
        stopScan();
        const to = $id("send-to");
        to.value = addr;
        to.dispatchEvent(new Event("input", { bubbles: true }));
        toast(tr("send.scanFilled", "Address filled in. Double-check it before sending."));
      } catch (e) { /* frame not ready */ }
    }, 350);
  }

  // ---------- CSV export of the local activity log ----------
  // Cells starting with = + - @ are prefixed with ' so a spreadsheet never
  // treats third-party text (e.g. a token symbol) as a formula.
  function csvCell(v) {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    chrome.storage.local.get(["tm_activity"], (res) => {
      const list = Array.isArray(res.tm_activity) ? res.tm_activity : [];
      if (!list.length) { toast(tr("activity.exportEmpty", "Nothing to export yet.")); return; }
      const rows = [["Date (UTC)", "Direction", "Amount", "Asset", "To", "Network", "Tx hash", "Explorer link"]];
      list.forEach((it) => {
        let link = "";
        try { link = (it.direction === "in") ? "" : (buildExplorerTxUrl(it.blockExplorer, it.txHash) || ""); } catch (e) { /* no link */ }
        rows.push([
          it.ts ? new Date(it.ts).toISOString() : "",
          it.direction === "in" ? "in" : "out",
          it.amount, it.asset, it.to, it.networkName, it.txHash, link,
        ]);
      });
      const csv = "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "token-exchange-activity-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  }

  // ---------- "transaction confirmed" notifications ----------
  // Wraps recordActivity (a global function declaration in app.js). For a
  // send we poll the chain for the receipt; for a detected incoming transfer
  // we just announce it.
  function rpcUrlsFor(net) {
    return (net && Array.isArray(net.rpcUrls)) ? net.rpcUrls.slice() : [];
  }
  async function receiptFrom(urls, chainId, hash) {
    for (const url of urls) {
      try {
        const p = new ethers.providers.JsonRpcProvider(url, chainId);
        return { ok: true, receipt: await p.getTransactionReceipt(hash) };
      } catch (e) { /* try the next endpoint */ }
    }
    return { ok: false, receipt: null };
  }
  function watchTx(entry, net) {
    const urls = rpcUrlsFor(net);
    if (!entry.txHash || !urls.length) return;
    const chainId = net.chainId;
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      if (tries > 150) { clearInterval(iv); return; } // ~15 minutes
      const r = await receiptFrom(urls, chainId, entry.txHash);
      if (!r.ok || !r.receipt) return;
      clearInterval(iv);
      const what = (entry.amount || "") + " " + (entry.asset || "");
      if (r.receipt.status === 0) notify(tr("notify.txFailed", "Transaction failed"), what.trim());
      else notify(tr("notify.txConfirmed", "Transaction confirmed"), what.trim());
    }, 6000);
  }
  function hookActivity() {
    if (typeof window.recordActivity !== "function" || window.recordActivity.__tmWrapped) return;
    const orig = window.recordActivity;
    const wrapped = function (entry) {
      const out = orig.apply(this, arguments);
      try {
        if (entry && entry.direction === "in") {
          notify(tr("notify.received", "Funds received"), ((entry.amount || "") + " " + (entry.asset || "")).trim());
        } else if (entry && entry.txHash) {
          watchTx(entry, window.currentNetwork || (typeof currentNetwork !== "undefined" ? currentNetwork : null));
        }
      } catch (e) { /* never break recording */ }
      return out;
    };
    wrapped.__tmWrapped = true;
    window.recordActivity = wrapped;
  }

  // ---------- price alerts (checked while the site is open) ----------
  const ALERT_KEY = "tm_price_alerts";
  function loadAlerts() {
    try { const a = JSON.parse(LS.get(ALERT_KEY, "[]")); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveAlerts(a) { LS.set(ALERT_KEY, JSON.stringify(a.slice(0, 20))); }
  function renderAlerts() {
    const root = $id("alert-list");
    if (!root) return;
    root.innerHTML = "";
    loadAlerts().forEach((al) => {
      const row = document.createElement("div");
      row.className = "price-alert-item";
      const span = document.createElement("span");
      span.textContent = al.sym + " " + (al.dir === "above"
        ? tr("settings.alertAbove", "goes above") : tr("settings.alertBelow", "drops below")) + " " + al.price + " " + al.cur;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "link";
      del.textContent = "\u2715";
      del.setAttribute("aria-label", tr("settings.alertRemove", "Remove alert"));
      del.addEventListener("click", () => { saveAlerts(loadAlerts().filter((x) => x.id !== al.id)); renderAlerts(); });
      row.appendChild(span);
      row.appendChild(del);
      root.appendChild(row);
    });
  }
  async function addAlert() {
    const price = Number(($id("alert-price").value || "").replace(",", "."));
    if (!(price > 0)) { toast(tr("settings.alertBadPrice", "Enter a price above zero.")); return; }
    const net = (typeof currentNetwork !== "undefined") ? currentNetwork : null;
    const cur = (typeof currentCurrency !== "undefined") ? currentCurrency : "USD";
    if (!net) return;
    let live = null;
    try { live = await TM_PRICES.getNativePriceForNetwork(net.key, cur); } catch (e) { /* offline */ }
    if (live == null) { toast(tr("settings.alertNoFeed", "No price feed is available for this network right now.")); return; }
    const list = loadAlerts();
    list.push({ id: crypto.randomUUID(), net: net.key, sym: net.nativeCurrency.symbol, cur, dir: $id("alert-dir").value === "below" ? "below" : "above", price });
    saveAlerts(list);
    $id("alert-price").value = "";
    renderAlerts();
  }
  async function checkAlerts() {
    const list = loadAlerts();
    if (!list.length) return;
    const fired = [];
    const cache = {};
    for (const al of list) {
      const k = al.net + "|" + al.cur;
      if (!(k in cache)) {
        try { cache[k] = await TM_PRICES.getNativePriceForNetwork(al.net, al.cur); } catch (e) { cache[k] = null; }
      }
      const p = cache[k];
      if (p == null) continue;
      if ((al.dir === "above" && p >= al.price) || (al.dir === "below" && p <= al.price)) {
        fired.push(al.id);
        notify(tr("notify.priceAlert", "Price alert"), al.sym + " " + (al.dir === "above" ? "\u2265" : "\u2264") + " " + al.price + " " + al.cur + " (" + p + ")");
      }
    }
    if (fired.length) { saveAlerts(loadAlerts().filter((x) => fired.indexOf(x.id) === -1)); renderAlerts(); }
  }

  // ---------- wiring ----------
  function init() {
    hookActivity();

    const scanBtn = $id("btn-scan-qr");
    if (scanBtn) scanBtn.addEventListener("click", startScan);
    const scanClose = $id("btn-scan-close");
    if (scanClose) scanClose.addEventListener("click", stopScan);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") stopScan(); });

    const csvBtn = $id("btn-export-csv");
    if (csvBtn) csvBtn.addEventListener("click", exportCsv);

    const themeSel = $id("theme-select");
    if (themeSel) {
      themeSel.value = LS.get("tm_theme", "dark") === "light" ? "light" : "dark";
      themeSel.addEventListener("change", () => { LS.set("tm_theme", themeSel.value); applyTheme(themeSel.value); });
    }

    const notifySel = $id("notify-select");
    const notifyHint = $id("notify-hint");
    if (notifySel) {
      const supported = "Notification" in window;
      notifySel.value = (supported && LS.get("tm_notify", "off") === "on" && Notification.permission === "granted") ? "on" : "off";
      if (!supported && notifyHint) notifyHint.textContent = tr("settings.notifyUnsupported", "This browser doesn't support system notifications. You'll still see messages inside the page.");
      notifySel.addEventListener("change", async () => {
        if (notifySel.value !== "on") { LS.set("tm_notify", "off"); return; }
        if (!supported) { notifySel.value = "off"; return; }
        let perm = Notification.permission;
        if (perm === "default") { try { perm = await Notification.requestPermission(); } catch (e) { perm = "denied"; } }
        if (perm === "granted") LS.set("tm_notify", "on");
        else {
          LS.set("tm_notify", "off");
          notifySel.value = "off";
          toast(tr("settings.notifyDenied", "Notifications are blocked for this site in your browser settings."));
        }
      });
    }

    const addBtn = $id("btn-add-alert");
    if (addBtn) addBtn.addEventListener("click", addAlert);
    renderAlerts();
    setTimeout(checkAlerts, 8000);
    setInterval(checkAlerts, 120000);

    // Bridge: open a well-known bridge aggregator in a new tab, pre-selecting
    // the chain the wallet is on. We never handle bridged funds ourselves.
    const bridge = $id("btn-bridge");
    if (bridge) {
      const setHref = () => {
        let href = "https://jumper.exchange/";
        try {
          if (typeof currentNetwork !== "undefined" && currentNetwork && currentNetwork.chainId) href += "?fromChain=" + encodeURIComponent(currentNetwork.chainId);
        } catch (e) { /* default link */ }
        bridge.href = href;
      };
      bridge.addEventListener("pointerdown", setHref);
      bridge.addEventListener("click", setHref);
      setHref();
    }
  }

  // Small test hook (pure helpers only).
  window.__tmExtras = { addressFromQr, csvCell };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
