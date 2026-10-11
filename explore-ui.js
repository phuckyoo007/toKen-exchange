// lib/explore-ui.js
// Wallet conveniences found in Coinbase Wallet and OKX Wallet, shared by the website and the
// extension popup. It builds its own bits of UI next to elements both pages already have
// ($ ids below), so index.html and popup.html need nothing but one <script> tag, and it uses
// the page globals (sendMsg, showScreen, currentNetwork, currentStatus, ethers, TM_I18N,
// qrcode) -- loading AFTER app.js / popup.js.
//
//   1  Hide balances (eye toggle)          6  Security checklist (Settings)
//   2  Recent recipients on Send           7  Hide zero balances on the token list
//   3  Request payment (amount + QR)       8  Explore apps (curated official dapps)
//   4  Gainers / losers / volume sorting   9  Copy a receipt for any activity entry
//   5  Portfolio mix bar                  10  25 / 50 / 75 / Max on Send, 25 / 50 / 75 on Swap
//
// Everything is best-effort and local: nothing here sends data anywhere, and if any one piece
// can't find its anchor element or throws, the rest of the wallet is unaffected.
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  const $id = (id) => document.getElementById(id);
  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

  // Translate with an English fallback so a missing key never shows raw.
  function tr(key, fallback, vars) {
    try {
      const s = TM_I18N.t(key, vars);
      if (s && s !== key) return s;
    } catch (e) { /* i18n not ready */ }
    let out = fallback;
    if (vars) Object.keys(vars).forEach((k) => { out = out.split("{" + k + "}").join(String(vars[k])); });
    return out;
  }

  function storeGet(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(keys, (r) => resolve(r || {})); } catch (e) { resolve({}); }
    });
  }
  function storeSet(obj) {
    try { chrome.storage.local.set(obj); } catch (e) { /* best-effort */ }
  }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function shortAddr(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  function flashLabel(btn, doneText) {
    const old = btn.textContent;
    btn.textContent = doneText;
    setTimeout(() => { btn.textContent = old; }, 1500);
  }

  // Screens this module adds. The page's own back buttons are wired once at load, so these
  // wire theirs here.
  function makeBackBtn(target) {
    const b = el("button", "back-btn top-back-btn");
    b.type = "button";
    b.innerHTML = '<span class="top-back-btn-coin" aria-hidden="true">&#8592;</span><span class="top-back-btn-label"></span>';
    b.querySelector(".top-back-btn-label").textContent = tr("common.back", "Back");
    b.addEventListener("click", () => showScreen(target));
    return b;
  }
  function addScreen(id) {
    const section = el("section", "screen hidden");
    section.id = id;
    const anchor = $id("screen-settings");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(section, anchor);
    else document.body.appendChild(section);
    return section;
  }

  // ---------------------------------------------------------------- 1. HIDE BALANCES
  const HIDE_KEY = "tm_hide_balances";
  const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  let hideBtn = null;

  function applyHideBalances(on) {
    document.body.classList.toggle("tm-hide-bal", !!on);
    if (!hideBtn) return;
    hideBtn.innerHTML = on ? EYE_OFF : EYE;
    const label = tr(on ? "explore.showBalances" : "explore.hideBalances", on ? "Show balances" : "Hide balances");
    hideBtn.title = label;
    hideBtn.setAttribute("aria-label", label);
    hideBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  async function initHideBalances() {
    const box = document.querySelector(".balance-box");
    if (!box) return;
    hideBtn = el("button", "tm-eye-btn");
    hideBtn.type = "button";
    box.appendChild(hideBtn);
    const saved = (await storeGet([HIDE_KEY]))[HIDE_KEY] === true;
    applyHideBalances(saved);
    hideBtn.addEventListener("click", () => {
      const next = !document.body.classList.contains("tm-hide-bal");
      applyHideBalances(next);
      storeSet({ [HIDE_KEY]: next });
    });
  }

  // ---------------------------------------------------------------- 2. RECENT RECIPIENTS
  let recentBox = null;
  async function renderRecent() {
    if (!recentBox) return;
    const data = await storeGet(["tm_activity", "tm_contacts"]);
    const activity = Array.isArray(data.tm_activity) ? data.tm_activity : [];
    const contacts = Array.isArray(data.tm_contacts) ? data.tm_contacts : [];
    const seen = new Set();
    const picks = [];
    for (const item of activity) {
      if (!item || item.direction === "in" || typeof item.to !== "string" || !ADDRESS_RE.test(item.to)) continue;
      const k = item.to.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      picks.push(item.to);
      if (picks.length >= 4) break;
    }
    recentBox.innerHTML = "";
    recentBox.classList.toggle("hidden", !picks.length);
    if (!picks.length) return;
    recentBox.appendChild(el("span", "quick-add-label muted", tr("explore.recentLabel", "Recent:")));
    picks.forEach((addr) => {
      const c = contacts.find((x) => x && typeof x.address === "string" && x.address.toLowerCase() === addr.toLowerCase());
      const b = el("button", "quick-add-chip", c && c.name ? String(c.name).slice(0, 14) : shortAddr(addr));
      b.type = "button";
      b.title = addr;
      b.addEventListener("click", () => {
        const input = $id("send-to");
        if (!input) return;
        input.value = addr;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      recentBox.appendChild(b);
    });
  }
  function initRecent() {
    const screen = $id("screen-send");
    const anchor = $id("send-to-resolved") || $id("send-to");
    if (!screen || !anchor) return;
    recentBox = el("div", "quick-add tm-recent hidden");
    recentBox.id = "tm-recent-recips";
    anchor.insertAdjacentElement("afterend", recentBox);
    // Send is one of the cube/globe faces, whose visibility isn't a class change, so refresh
    // when the page navigates to it (showScreen) or a nav tab / Send button is clicked.
    if (typeof showScreen === "function") {
      const original = showScreen;
      window.showScreen = function (id) {
        const r = original.apply(this, arguments);
        if (id === "screen-send") renderRecent();
        return r;
      };
    }
    document.addEventListener("click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-cube-goto], #btn-goto-send, .cube-tab, .splash-tab, .globe-tab") : null;
      if (t) setTimeout(renderRecent, 60);
    });
    renderRecent();
  }

  // ---------------------------------------------------------------- 3. REQUEST PAYMENT
  function requestAssets() {
    const nc = (typeof currentNetwork !== "undefined" && currentNetwork && currentNetwork.nativeCurrency) || {};
    const list = [{ key: "native", symbol: nc.symbol || "ETH", decimals: nc.decimals || 18, address: null }];
    document.querySelectorAll("#tokens-list .token-row[data-tok-id]").forEach((row) => {
      const address = row.dataset.tokId;
      const decimals = Number(row.dataset.decimals);
      if (!ADDRESS_RE.test(address) || !row.dataset.symbol || !isFinite(decimals)) return;
      let checksummed = address;
      try { checksummed = ethers.utils.getAddress(address); } catch (e) { /* keep as-is */ }
      list.push({ key: address, symbol: row.dataset.symbol, decimals, address: checksummed });
    });
    return list;
  }

  // EIP-681 payment link: ethereum:<to>@<chain>?value=<wei> for the coin, or
  // ethereum:<token>@<chain>/transfer?address=<to>&uint256=<units> for a token.
  function buildPaymentLink(asset, to, chainId, unitsStr) {
    if (!asset.address) return "ethereum:" + to + "@" + chainId + (unitsStr ? "?value=" + unitsStr : "");
    return "ethereum:" + asset.address + "@" + chainId + "/transfer?address=" + to + (unitsStr ? "&uint256=" + unitsStr : "");
  }

  function renderRequest() {
    const assetSel = $id("tm-req-asset");
    const amountInput = $id("tm-req-amount");
    const err = $id("tm-req-error");
    err.classList.add("hidden");
    const to = safe(() => currentStatus.selectedAddress);
    const net = typeof currentNetwork !== "undefined" ? currentNetwork : null;
    const assets = requestAssets();
    const asset = assets.find((a) => a.key === assetSel.value) || assets[0];
    if (!to || !net || !asset) return;
    let units = null;
    const amountStr = amountInput.value.trim();
    if (amountStr) {
      try {
        const bn = ethers.utils.parseUnits(amountStr, asset.decimals);
        if (bn.lte(0)) throw new Error("zero");
        units = bn.toString();
      } catch (e) {
        err.textContent = tr("explore.requestBadAmount", "Enter a valid amount.");
        err.classList.remove("hidden");
      }
    }
    const link = buildPaymentLink(asset, to, net.chainId, units);
    const msg = amountStr && units
      ? tr("explore.requestMessage", "Please send {amount} {symbol} on {network} to {address}", { amount: amountStr, symbol: asset.symbol, network: net.name, address: to })
      : tr("explore.requestMessageNoAmount", "Please send {symbol} on {network} to {address}", { symbol: asset.symbol, network: net.name, address: to });
    $id("tm-req-msg").textContent = msg;
    $id("tm-req-link").value = link;
    const box = $id("tm-req-qr");
    try {
      const qr = qrcode(0, "M");
      qr.addData(link);
      qr.make();
      box.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
    } catch (e) { box.innerHTML = ""; }
  }

  function openRequest() {
    const assets = requestAssets();
    const sel = $id("tm-req-asset");
    sel.innerHTML = "";
    assets.forEach((a) => {
      const o = el("option", null, a.symbol);
      o.value = a.key;
      sel.appendChild(o);
    });
    $id("tm-req-amount").value = "";
    renderRequest();
    showScreen("screen-request");
  }

  function initRequest() {
    const qrBtn = $id("btn-toggle-qr");
    if (!qrBtn || !qrBtn.parentNode) return;
    const section = addScreen("screen-request");
    section.innerHTML =
      '<h2 id="tm-req-title"></h2>' +
      '<p class="muted" id="tm-req-intro"></p>' +
      '<label class="tm-label" for="tm-req-asset" id="tm-req-asset-label"></label>' +
      '<select id="tm-req-asset"></select>' +
      '<label class="tm-label" for="tm-req-amount" id="tm-req-amount-label"></label>' +
      '<input type="text" id="tm-req-amount" inputmode="decimal" autocomplete="off" placeholder="0.0" />' +
      '<p id="tm-req-error" class="error hidden"></p>' +
      '<div id="tm-req-qr" class="qr-box"></div>' +
      '<p id="tm-req-msg" class="tm-req-msg"></p>' +
      '<input type="text" id="tm-req-link" class="hidden" readonly />' +
      '<button type="button" id="tm-req-copy-msg" class="secondary"></button>' +
      '<button type="button" id="tm-req-copy-link" class="secondary"></button>' +
      '<p class="muted small" id="tm-req-hint"></p>';
    section.appendChild(makeBackBtn("screen-main"));
    const setText = () => {
      $id("tm-req-title").textContent = tr("explore.requestTitle", "Request payment");
      $id("tm-req-intro").textContent = tr("explore.requestIntro", "Share a QR code or message so someone can pay you a set amount.");
      $id("tm-req-asset-label").textContent = tr("explore.requestAsset", "Asset");
      $id("tm-req-amount-label").textContent = tr("explore.requestAmount", "Amount (optional)");
      $id("tm-req-copy-msg").textContent = tr("explore.copyMessage", "Copy message");
      $id("tm-req-copy-link").textContent = tr("explore.copyLink", "Copy payment link");
      $id("tm-req-hint").textContent = tr("explore.requestLinkHint", "Wallets that support payment links fill in the amount for you; anyone else can follow the message above.");
    };
    setText();
    $id("tm-req-asset").addEventListener("change", renderRequest);
    $id("tm-req-amount").addEventListener("input", renderRequest);
    $id("tm-req-copy-msg").addEventListener("click", async (e) => {
      if (await copyText($id("tm-req-msg").textContent)) flashLabel(e.currentTarget, tr("explore.copied", "Copied"));
    });
    $id("tm-req-copy-link").addEventListener("click", async (e) => {
      if (await copyText($id("tm-req-link").value)) flashLabel(e.currentTarget, tr("explore.copied", "Copied"));
    });
    const open = el("button", "link");
    open.type = "button";
    open.id = "btn-request-payment";
    open.textContent = tr("explore.requestBtn", "Request");
    open.addEventListener("click", () => { setText(); open.textContent = tr("explore.requestBtn", "Request"); openRequest(); });
    qrBtn.insertAdjacentElement("afterend", open);
  }

  // ---------------------------------------------------------------- 4. RANKING SORT
  let sortMode = "rank";
  let sortBox = null;
  const SORTS = [["rank", "explore.sortRank", "Top"], ["gainers", "explore.sortGainers", "Gainers"], ["losers", "explore.sortLosers", "Losers"], ["volume", "explore.sortVolume", "Volume"]];

  function markSortActive() {
    if (!sortBox) return;
    sortBox.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.sort === sortMode));
  }
  function initSort() {
    const list = $id("predictions-list");
    if (!list || !list.parentNode) return;
    sortBox = el("div", "quick-add tm-sort hidden");
    sortBox.id = "tm-sort-chips";
    SORTS.forEach(([mode, key, fb]) => {
      const b = el("button", "quick-add-chip", tr(key, fb));
      b.type = "button";
      b.dataset.sort = mode;
      b.addEventListener("click", () => {
        sortMode = mode;
        markSortActive();
        if (typeof refreshPredictions === "function") refreshPredictions();
      });
      sortBox.appendChild(b);
    });
    list.parentNode.insertBefore(sortBox, list);
    markSortActive();
  }
  // Called by refreshPredictions() with the freshly fetched rows; returns them in display order.
  function sortMarkets(markets) {
    const onTop = typeof predictionsTab !== "undefined" && predictionsTab === "top";
    if (sortBox) sortBox.classList.toggle("hidden", !onTop);
    if (!onTop || sortMode === "rank" || !Array.isArray(markets)) return markets;
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
    const key = (m) => (sortMode === "volume" ? num(m.volume) : num(m.change24h));
    const dir = sortMode === "losers" ? 1 : -1;
    return markets.slice().sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * dir;
    });
  }

  // ---------------------------------------------------------------- 5. PORTFOLIO MIX
  const MIX_COLORS = ["#d9a441", "#4f8fdc", "#4fb98a", "#b072d6", "#d9715f"];
  let mixBox = null;
  function initMix() {
    const tokens = document.querySelector(".tokens-section");
    if (!tokens || !tokens.parentNode) return;
    mixBox = el("div", "tm-mix hidden");
    mixBox.id = "tm-mix";
    tokens.parentNode.insertBefore(mixBox, tokens);
  }
  function refreshAllocation() {
    if (!mixBox) return;
    const parts = [];
    const nativeUsd = Number(window.TM_NATIVE_USD);
    const sym = ($id("balance-symbol") && $id("balance-symbol").textContent.trim()) || "";
    if (isFinite(nativeUsd) && nativeUsd > 0) parts.push({ label: sym || "•", usd: nativeUsd });
    document.querySelectorAll("#tokens-list .token-row[data-usd]").forEach((row) => {
      const usd = Number(row.dataset.usd);
      if (isFinite(usd) && usd > 0) parts.push({ label: row.dataset.symbol || "?", usd });
    });
    const total = parts.reduce((s, p) => s + p.usd, 0);
    if (parts.length < 2 || !(total > 0)) { mixBox.classList.add("hidden"); mixBox.innerHTML = ""; return; }
    parts.sort((a, b) => b.usd - a.usd);
    const top = parts.slice(0, 4);
    const rest = parts.slice(4).reduce((s, p) => s + p.usd, 0);
    if (rest > 0) top.push({ label: tr("explore.allocOther", "Other"), usd: rest });
    mixBox.innerHTML = "";
    const head = el("div", "tm-mix-title", tr("explore.allocTitle", "Portfolio mix"));
    const bar = el("div", "tm-mix-bar");
    bar.setAttribute("role", "img");
    const legend = el("div", "tm-mix-legend");
    const summary = [];
    top.forEach((p, i) => {
      const pct = (p.usd / total) * 100;
      const seg = el("span", "tm-mix-seg");
      seg.style.flexGrow = String(Math.max(pct, 0.5));
      seg.style.background = MIX_COLORS[i % MIX_COLORS.length];
      seg.title = p.label + " " + pct.toFixed(1) + "%";
      bar.appendChild(seg);
      const item = el("span", "tm-mix-item");
      const dot = el("i", "tm-mix-dot");
      dot.style.background = MIX_COLORS[i % MIX_COLORS.length];
      item.appendChild(dot);
      item.appendChild(document.createTextNode(p.label + " " + (pct < 1 ? "<1" : String(Math.round(pct))) + "%"));
      legend.appendChild(item);
      summary.push(p.label + " " + Math.round(pct) + "%");
    });
    bar.setAttribute("aria-label", summary.join(", "));
    mixBox.appendChild(head);
    mixBox.appendChild(bar);
    mixBox.appendChild(legend);
    mixBox.classList.remove("hidden");
  }

  // ---------------------------------------------------------------- 7. HIDE ZERO BALANCES
  const ZERO_KEY = "tm_hide_zero";
  let zeroBtn = null;
  let hideZero = false;
  function updateZeroToggle() {
    const list = $id("tokens-list");
    if (!list || !zeroBtn) return;
    list.classList.toggle("tm-hide-zero", hideZero);
    const zeros = list.querySelectorAll('.token-row[data-zero="1"]').length;
    zeroBtn.classList.toggle("hidden", zeros === 0);
    zeroBtn.textContent = hideZero ? tr("explore.zeroShow", "Show zero balances") : tr("explore.zeroHide", "Hide zero balances");
  }
  async function initZero() {
    const anchor = $id("tokens-hidden-toggle");
    if (!anchor) return;
    zeroBtn = el("button", "link hidden");
    zeroBtn.type = "button";
    zeroBtn.id = "tm-zero-toggle";
    anchor.insertAdjacentElement("beforebegin", zeroBtn);
    hideZero = (await storeGet([ZERO_KEY]))[ZERO_KEY] === true;
    zeroBtn.addEventListener("click", () => {
      hideZero = !hideZero;
      storeSet({ [ZERO_KEY]: hideZero });
      updateZeroToggle();
    });
    updateZeroToggle();
  }

  // Called by refreshTokens() once the rows are on screen.
  function afterTokens() {
    safe(updateZeroToggle);
    safe(refreshAllocation);
  }

  // ---------------------------------------------------------------- 6. SECURITY CHECKLIST
  async function openSecurity() {
    const data = await storeGet(["tm_auto_lock_minutes", "tm_send_delay_seconds"]);
    const lock = typeof data.tm_auto_lock_minutes === "number" ? data.tm_auto_lock_minutes : 21;
    const delay = typeof data.tm_send_delay_seconds === "number" ? data.tm_send_delay_seconds : 30;
    const inExtension = location.protocol === "chrome-extension:" || location.protocol === "moz-extension:";
    const checks = [
      [lock > 0, tr("explore.secAutoLock", "Auto-lock is on"), tr("explore.secAutoLockOff", "Auto-lock is off -- turn it on in Settings so an unattended screen locks itself.")],
      [delay > 0, tr("explore.secSendDelay", "Send delay is on"), tr("explore.secSendDelayOff", "Send delay is off -- turn it on in Settings to get a cancel window on every send.")],
      [inExtension, tr("explore.secExtension", "Using the browser extension"), tr("explore.secWebsite", "Using the website -- an installed extension is safer for everyday use.")],
    ];
    const ok = checks.filter((c) => c[0]).length;
    const root = $id("tm-sec-list");
    root.innerHTML = "";
    checks.forEach(([pass, good, bad]) => {
      const row = el("div", "tm-sec-row " + (pass ? "ok" : "warn"));
      row.appendChild(el("span", "tm-sec-mark", pass ? "✓" : "!"));
      row.appendChild(el("span", "tm-sec-text", pass ? good : bad));
      root.appendChild(row);
    });
    $id("tm-sec-score").textContent = tr("explore.secScore", "{ok} of {total} checks passed", { ok, total: checks.length });
    showScreen("screen-security");
  }
  function initSecurity() {
    const anchor = $id("btn-view-seed") || $id("btn-goto-contacts");
    if (!anchor) return;
    const section = addScreen("screen-security");
    section.innerHTML =
      '<h2 id="tm-sec-title"></h2><p class="muted" id="tm-sec-intro"></p><p class="tm-sec-score" id="tm-sec-score"></p><div id="tm-sec-list"></div>' +
      '<p class="muted small" id="tm-sec-manual"></p>' +
      '<button type="button" class="secondary" id="tm-sec-phrase"></button>' +
      '<button type="button" class="secondary hidden" id="tm-sec-approvals"></button>';
    section.appendChild(makeBackBtn("screen-settings"));
    const setText = () => {
      $id("tm-sec-title").textContent = tr("explore.securityTitle", "Security checklist");
      $id("tm-sec-intro").textContent = tr("explore.securityIntro", "These checks only look at settings on this device. They can't see your funds or your recovery phrase.");
      $id("tm-sec-manual").textContent = tr("explore.secManual", "Things only you can check:");
      $id("tm-sec-phrase").textContent = tr("explore.secPhraseBtn", "Confirm your recovery phrase is written down");
      $id("tm-sec-approvals").textContent = tr("explore.secApprovalsBtn", "Review token approvals");
    };
    setText();
    $id("tm-sec-phrase").addEventListener("click", () => { const b = $id("btn-view-seed"); if (b) b.click(); });
    const approvals = $id("btn-goto-approvals");
    if (approvals) {
      $id("tm-sec-approvals").classList.remove("hidden");
      $id("tm-sec-approvals").addEventListener("click", () => approvals.click());
    }
    const btn = el("button", "secondary");
    btn.type = "button";
    btn.id = "btn-goto-security";
    btn.textContent = tr("explore.securityBtn", "Security checklist");
    btn.addEventListener("click", () => { setText(); openSecurity(); });
    anchor.insertAdjacentElement("afterend", btn);
  }

  // ---------------------------------------------------------------- 8. EXPLORE APPS
  // A short, fixed list of well-known apps (official addresses). Token Exchange doesn't run or
  // endorse them; they open in a normal browser tab and you connect with the extension or
  // WalletConnect. Always check the address bar before connecting.
  const APPS = [
    ["Uniswap", "https://app.uniswap.org", "swap"], ["Curve", "https://curve.fi", "swap"], ["Aerodrome", "https://aerodrome.finance", "swap"],
    ["Aave", "https://app.aave.com", "lending"], ["Compound", "https://app.compound.finance", "lending"],
    ["Lido", "https://stake.lido.fi", "staking"], ["OpenSea", "https://opensea.io", "nft"],
    ["ENS", "https://app.ens.domains", "names"], ["Jumper", "https://jumper.exchange", "bridge"], ["Etherscan", "https://etherscan.io", "explorer"],
  ];
  const CAT_FALLBACK = { swap: "Swap", lending: "Lending", staking: "Staking", nft: "NFTs", names: "Names", bridge: "Bridge", explorer: "Explorer" };
  function appLink(app, cls) {
    const a = el("a", cls, app[0]);
    a.href = app[1];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function initApps() {
    const predBtn = $id("btn-goto-predictions");
    const anchorCard = predBtn && predBtn.closest(".prices-card");
    if (!anchorCard) return;
    const section = addScreen("screen-explore-apps");
    section.innerHTML = '<h2 id="tm-apps-title"></h2><p class="muted" id="tm-apps-intro"></p><div id="tm-apps-list" class="tm-apps-list"></div><p class="warn small" id="tm-apps-note"></p>';
    section.appendChild(makeBackBtn("screen-main"));
    const card = el("div", "prices-card tm-apps-card");
    const head = el("div", "prices-card-header");
    const title = el("span", "prices-card-title");
    const all = el("button", "link");
    all.type = "button";
    head.appendChild(title);
    head.appendChild(all);
    const chips = el("div", "quick-add tm-apps-chips");
    APPS.slice(0, 5).forEach((a) => { chips.appendChild(appLink(a, "quick-add-chip")); });
    card.appendChild(head);
    card.appendChild(chips);
    anchorCard.insertAdjacentElement("afterend", card);
    const setText = () => {
      title.textContent = tr("explore.appsTitle", "Explore apps");
      all.textContent = tr("explore.appsSeeAll", "See all");
      $id("tm-apps-title").textContent = tr("explore.appsTitle", "Explore apps");
      $id("tm-apps-intro").textContent = tr("explore.appsIntro", "Popular apps that work with your wallet. They open in a new tab.");
      $id("tm-apps-note").textContent = tr("explore.appsNote", "Token Exchange doesn't run or endorse these apps. Check the address bar before you connect, and never share your recovery phrase.");
      const list = $id("tm-apps-list");
      list.innerHTML = "";
      APPS.forEach((a) => {
        const row = el("div", "tm-app-row");
        const left = el("span", "tm-app-left");
        left.appendChild(appLink(a, "tm-app-name"));
        left.appendChild(el("span", "muted small", tr("explore.cat." + a[2], CAT_FALLBACK[a[2]])));
        row.appendChild(left);
        row.appendChild(el("span", "tm-app-host muted small", a[1].replace("https://", "")));
        list.appendChild(row);
      });
    };
    setText();
    all.addEventListener("click", () => { setText(); showScreen("screen-explore-apps"); });
  }

  // ---------------------------------------------------------------- 9. COPY RECEIPT
  function receiptText(item, explorerUrl) {
    const incoming = item.direction === "in";
    const lines = [tr("explore.receiptTitle", "Token Exchange receipt")];
    lines.push(tr(incoming ? "activity.receivedLabel" : "activity.sentLabel", incoming ? "Received {amount} {asset}" : "Sent {amount} {asset}", { amount: item.amount, asset: item.asset }));
    if (!incoming && item.to) lines.push(tr("activity.toLabel", "To: {address}", { address: item.to }));
    if (item.networkName) lines.push(tr("explore.receiptNetwork", "Network: {network}", { network: item.networkName }));
    if (item.ts) lines.push(tr("explore.receiptDate", "Date: {date}", { date: new Date(item.ts).toLocaleString() }));
    if (item.txHash) lines.push(tr("explore.receiptTx", "Transaction: {hash}", { hash: item.txHash }));
    if (explorerUrl) lines.push(tr("explore.receiptLink", "Link: {url}", { url: explorerUrl }));
    return lines.join("\n");
  }
  // Called by renderActivity() for each entry; appends a small "Copy receipt" row after the card.
  function addReceiptRow(root, item, explorerUrl) {
    if (!root || !item) return;
    const row = el("div", "tm-receipt-row");
    const b = el("button", "link", tr("explore.receiptBtn", "Copy receipt"));
    b.type = "button";
    b.addEventListener("click", async () => {
      if (await copyText(receiptText(item, explorerUrl))) flashLabel(b, tr("explore.receiptCopied", "Receipt copied"));
    });
    row.appendChild(b);
    root.appendChild(row);
  }

  // ---------------------------------------------------------------- 10. PERCENT BUTTONS
  function trimNumber(s) { return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s; }

  function makePctRow(id, pcts, onPick, withMax) {
    const row = el("div", "quick-add tm-pct");
    row.id = id;
    pcts.forEach((p) => {
      const b = el("button", "quick-add-chip", p + "%");
      b.type = "button";
      b.addEventListener("click", () => onPick(p));
      row.appendChild(b);
    });
    if (withMax) {
      const b = el("button", "quick-add-chip", tr("swap.maxBtn", "Max"));
      b.type = "button";
      b.addEventListener("click", () => onPick(100));
      row.appendChild(b);
    }
    const note = el("p", "muted small tm-pct-note hidden");
    note.id = id + "-note";
    row.appendChild(note);
    return row;
  }
  function setNote(id, text) {
    const n = $id(id + "-note");
    if (!n) return;
    n.textContent = text || "";
    n.classList.toggle("hidden", !text);
  }

  async function pickSendPercent(pct) {
    const id = "tm-send-pct";
    setNote(id, "");
    try {
      const addr = currentStatus.selectedAddress;
      const isNative = $id("send-asset-select").value === "native";
      let wei, decimals;
      if (isNative) {
        const r = await sendMsg("TM_GET_BALANCE", { address: addr });
        wei = ethers.BigNumber.from(r.balanceWei);
        decimals = r.decimals;
      } else {
        const tokenAddress = $id("send-token-address").value.trim();
        if (!ethers.utils.isAddress(tokenAddress)) return;
        const r = await sendMsg("TM_GET_TOKEN_BALANCE", { address: addr, tokenAddress });
        wei = ethers.BigNumber.from(r.balanceWei);
        decimals = r.decimals;
      }
      let amountWei = wei.mul(pct).div(100);
      if (isNative && pct === 100) {
        // Max on the native coin has to leave room for the network fee.
        let feeWei;
        try {
          const est = await sendMsg("TM_ESTIMATE_SEND_FEE", { to: addr, amountWei: "1", tokenAddress: null });
          const speed = typeof currentSendSpeed !== "undefined" ? currentSendSpeed : "standard";
          feeWei = ethers.BigNumber.from((est.tiers && est.tiers[speed]) || est.feeWei);
        } catch (e) {
          setNote(id, tr("explore.maxNoFee", "Couldn't estimate the network fee, so Max isn't available -- type the amount instead."));
          return;
        }
        const reserve = feeWei.mul(110).div(100);
        if (wei.lte(reserve)) {
          setNote(id, tr("explore.maxTooLow", "Not enough to cover the network fee."));
          return;
        }
        amountWei = wei.sub(reserve);
      }
      if (amountWei.lte(0)) return;
      const input = $id("send-amount");
      input.value = trimNumber(ethers.utils.formatUnits(amountWei, decimals));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (e) { /* best-effort: the amount box is still there to type in */ }
  }

  function swapFromBalance() {
    try {
      if (typeof swapState !== "undefined" && typeof findHeldAsset === "function") {
        const a = findHeldAsset(swapState.fromKey);
        if (a) return a;
      }
      if (typeof swapHeldAssets !== "undefined" && $id("swap-from-select")) {
        return swapHeldAssets.find((x) => x.key === $id("swap-from-select").value) || null;
      }
    } catch (e) { /* fall through */ }
    return null;
  }
  function pickSwapPercent(pct) {
    const asset = swapFromBalance();
    const input = $id("swap-amount-in");
    if (!asset || !input) return;
    const n = Number(asset.balance) * pct / 100;
    if (!(n > 0)) return;
    input.value = trimNumber(n.toFixed(Math.min(Number(asset.decimals) || 8, 8)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function initPercent() {
    const sendInput = $id("send-amount");
    if (sendInput && sendInput.parentNode) {
      sendInput.insertAdjacentElement("afterend", makePctRow("tm-send-pct", [25, 50, 75], pickSendPercent, true));
    }
    const swapInput = $id("swap-amount-in");
    if (swapInput) {
      const panel = swapInput.closest(".swap-panel") || swapInput;
      panel.insertAdjacentElement("afterend", makePctRow("tm-swap-pct", [25, 50, 75], pickSwapPercent, false));
    }
  }

  // ---------------------------------------------------------------- start
  function init() {
    [initHideBalances, initRecent, initRequest, initSort, initMix, initZero, initSecurity, initApps, initPercent].forEach((f) => {
      try { const r = f(); if (r && typeof r.catch === "function") r.catch(() => {}); } catch (e) { /* one feature failing must not affect the others */ }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  function setSortMode(mode) { if (SORTS.some((x) => x[0] === mode)) { sortMode = mode; markSortActive(); } }

  window.TM_EXPLORE = { sortMarkets, setSortMode, afterTokens, refreshAllocation, receiptText, addReceiptRow, buildPaymentLink };
})();
