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
//   Found in Crypto.com: 11 converter, 12 recurring-buy reminders, 13 portfolio history,
//   14 pay from a payment link or QR, 15 this-month activity summary (see the section further down)
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
    safe(() => recordPortfolio(total));
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

  // ---------------------------------------------------------------- 11-15. FOUND IN CRYPTO.COM
  //   11 Converter            13 Portfolio history       15 Activity summary (this month)
  //   12 Recurring-buy        14 Pay from a payment link or QR
  //      reminders
  // All local. Reminders are reminders only: nothing here ever buys or sends by itself.

  // ---- screen-open hook: Send/Activity/Home are cube faces, so watch showScreen and nav clicks
  const openHooks = [];
  function onScreenOpen(fn) { openHooks.push(fn); }
  function initScreenHooks() {
    if (typeof showScreen === "function") {
      const original = showScreen;
      window.showScreen = function (id) {
        const r = original.apply(this, arguments);
        openHooks.forEach((h) => { try { h(id); } catch (e) { /* best-effort */ } });
        return r;
      };
    }
    document.addEventListener("click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-cube-goto], #btn-goto-send, .cube-tab, .splash-tab, .globe-tab") : null;
      if (t) setTimeout(() => openHooks.forEach((h) => { try { h(null); } catch (err) { /* best-effort */ } }), 80);
    });
  }

  // ---- tools card on Home
  function initTools() {
    const anchor = document.querySelector(".tm-apps-card") || ($id("btn-goto-predictions") && $id("btn-goto-predictions").closest(".prices-card"));
    if (!anchor) return;
    const card = el("div", "prices-card tm-tools-card");
    const head = el("div", "prices-card-header");
    const title = el("span", "prices-card-title");
    head.appendChild(title);
    const chips = el("div", "quick-add tm-tools-chips");
    const mk = (id, goto) => { const b = el("button", "quick-add-chip"); b.type = "button"; b.id = id; b.addEventListener("click", goto); chips.appendChild(b); return b; };
    const bConv = mk("tm-tool-conv", () => openConverter());
    const bRem = mk("tm-tool-rem", () => openReminders());
    const bPay = mk("tm-tool-pay", () => { showScreen("screen-send"); setTimeout(() => safe(() => togglePayRow(true)), 120); });
    const setText = () => {
      title.textContent = tr("explore.toolsTitle", "Tools");
      bConv.textContent = tr("explore.toolConverter", "Converter");
      bRem.textContent = tr("explore.toolReminders", "Recurring buy");
      bPay.textContent = tr("explore.toolPayLink", "Pay a link");
    };
    setText();
    card.appendChild(head);
    card.appendChild(chips);
    anchor.insertAdjacentElement("afterend", card);
    onScreenOpen((id) => { if (id === "screen-main" || id == null) setText(); });
  }

  // ---- 11. CONVERTER
  // Numbers, codes and dates stay left-to-right even inside Arabic sentences.
  function ltr(t) { return t ? "\u2066" + t + "\u2069" : t; }
  function currencyCode() { return String(safe(() => currentCurrency) || "USD").toUpperCase(); }
  function convertAmount(amount, fromRow, toRow) {
    if (!fromRow || !toRow || !(fromRow.price > 0) || !(toRow.price > 0) || !isFinite(amount)) return null;
    const v = (amount * fromRow.price) / toRow.price;
    return isFinite(v) ? v : null;
  }
  function formatConverted(n) {
    if (typeof n !== "number" || !isFinite(n)) return "";
    const abs = Math.abs(n);
    if (abs === 0) return "0";
    if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (abs >= 1) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    const digits = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(abs))));
    return n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
  }
  let convRows = [];
  function convRow(sym) { return convRows.find((r) => r.symbol === sym) || null; }
  function renderConverter() {
    const out = $id("tm-conv-result");
    if (!out) return;
    if (convRows.length < 2) { out.textContent = tr("explore.convNoPrices", "Prices aren't available right now. Try again in a moment."); return; }
    const amountStr = $id("tm-conv-amount").value.trim().replace(",", ".");
    const amount = Number(amountStr);
    if (!amountStr || !(amount >= 0) || !isFinite(amount)) { out.textContent = ""; return; }
    const from = convRow($id("tm-conv-from").value);
    const to = convRow($id("tm-conv-to").value);
    const v = convertAmount(amount, from, to);
    out.textContent = v == null ? "" : tr("explore.convResult", "{amount} {from} ≈ {value} {to}", { amount: ltr(amountStr), from: ltr(from.symbol), value: ltr(formatConverted(v)), to: ltr(to.symbol) });
  }
  async function openConverter() {
    const fromSel = $id("tm-conv-from");
    const toSel = $id("tm-conv-to");
    showScreen("screen-converter");
    $id("tm-conv-result").textContent = tr("explore.convLoading", "Loading prices…");
    const code = currencyCode();
    let board = [];
    try { board = await TM_PRICES.getPriceBoard(code); } catch (e) { board = []; }
    convRows = [{ symbol: code, price: 1 }];
    board.forEach((c) => { if (c && typeof c.price === "number" && c.price > 0) convRows.push({ symbol: c.symbol, price: c.price }); });
    const keepFrom = fromSel.value;
    const keepTo = toSel.value;
    [fromSel, toSel].forEach((sel) => {
      sel.innerHTML = "";
      convRows.forEach((r) => { const o = el("option", null, r.symbol); o.value = r.symbol; sel.appendChild(o); });
    });
    fromSel.value = convRow(keepFrom) ? keepFrom : (convRow("ETH") ? "ETH" : convRows[Math.min(1, convRows.length - 1)].symbol);
    toSel.value = convRow(keepTo) ? keepTo : code;
    renderConverter();
  }
  function initConverter() {
    const section = addScreen("screen-converter");
    section.innerHTML =
      '<h2 id="tm-conv-title"></h2><p class="muted" id="tm-conv-intro"></p>' +
      '<label class="tm-label" for="tm-conv-amount" id="tm-conv-amount-label"></label>' +
      '<input type="text" id="tm-conv-amount" inputmode="decimal" autocomplete="off" value="1" />' +
      '<label class="tm-label" for="tm-conv-from" id="tm-conv-from-label"></label><select id="tm-conv-from"></select>' +
      '<button type="button" id="tm-conv-swap" class="link tm-conv-swap"></button>' +
      '<label class="tm-label" for="tm-conv-to" id="tm-conv-to-label"></label><select id="tm-conv-to"></select>' +
      '<p id="tm-conv-result" class="tm-conv-result"></p>';
    section.appendChild(makeBackBtn("screen-main"));
    const setText = () => {
      $id("tm-conv-title").textContent = tr("explore.convTitle", "Coin converter");
      $id("tm-conv-intro").textContent = tr("explore.convIntro", "See what an amount is worth in another coin or currency, using the live prices from your Prices list.");
      $id("tm-conv-amount-label").textContent = tr("explore.convAmount", "Amount");
      $id("tm-conv-from-label").textContent = tr("explore.convFrom", "From");
      $id("tm-conv-to-label").textContent = tr("explore.convTo", "To");
      $id("tm-conv-swap").textContent = "⇅ " + tr("explore.convSwap", "Swap sides");
    };
    setText();
    onScreenOpen((id) => { if (id === "screen-converter") setText(); });
    $id("tm-conv-amount").addEventListener("input", renderConverter);
    $id("tm-conv-from").addEventListener("change", renderConverter);
    $id("tm-conv-to").addEventListener("change", renderConverter);
    $id("tm-conv-swap").addEventListener("click", () => {
      const a = $id("tm-conv-from").value;
      $id("tm-conv-from").value = $id("tm-conv-to").value;
      $id("tm-conv-to").value = a;
      renderConverter();
    });
  }

  // ---- 12. RECURRING-BUY REMINDERS
  const REM_KEY = "tm_buy_reminders";
  const FREQS = [["weekly", "explore.remWeekly", "Every week"], ["biweekly", "explore.remBiweekly", "Every 2 weeks"], ["monthly", "explore.remMonthly", "Every month"]];
  function addInterval(ts, freq) {
    const d = new Date(ts);
    if (freq === "monthly") d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + (freq === "biweekly" ? 14 : 7));
    return d.getTime();
  }
  // Moves a reminder's next date forward, past `now`, one interval at a time.
  function advanceReminder(r, now) {
    let next = Number(r.next) || now;
    for (let i = 0; i < 500 && next <= now; i++) next = addInterval(next, r.freq);
    return Object.assign({}, r, { next });
  }
  function dueReminders(list, now) {
    return (Array.isArray(list) ? list : []).filter((r) => r && FREQS.some((f) => f[0] === r.freq) && Number(r.next) <= now).sort((a, b) => a.next - b.next);
  }
  function cleanReminders(list) {
    return (Array.isArray(list) ? list : []).filter((r) => r && typeof r.id === "string" && FREQS.some((f) => f[0] === r.freq) && isFinite(Number(r.next)));
  }
  async function loadReminders() { return cleanReminders((await storeGet([REM_KEY]))[REM_KEY]); }
  function saveReminders(list) { storeSet({ [REM_KEY]: list }); }
  function reminderWhat(r) {
    const bits = [];
    if (r.amount) bits.push(r.amount + " " + currencyCode());
    if (r.asset) bits.push(r.asset);
    return ltr(bits.join(" · "));
  }
  function freqLabel(f) { const x = FREQS.find((q) => q[0] === f); return x ? tr(x[1], x[2]) : f; }

  let dueBox = null;
  async function renderDue() {
    if (!dueBox) return;
    const list = await loadReminders();
    const due = dueReminders(list, Date.now());
    dueBox.innerHTML = "";
    dueBox.classList.toggle("hidden", !due.length);
    if (!due.length) return;
    const r = due[0];
    const titleKey = { weekly: ["explore.remDueWeekly", "Time for your weekly buy"], biweekly: ["explore.remDueBiweekly", "Time for your buy (every 2 weeks)"], monthly: ["explore.remDueMonthly", "Time for your monthly buy"] }[r.freq];
    dueBox.appendChild(el("strong", "tm-due-title", tr(titleKey[0], titleKey[1])));
    const what = reminderWhat(r);
    if (what) dueBox.appendChild(el("span", "tm-due-what muted", tr("explore.remPlanned", "Planned: {what}", { what })));
    const row = el("div", "tm-due-actions");
    const buy = el("button", "secondary", tr("explore.remBuyNow", "Buy"));
    const done = el("button", "link", tr("explore.remDone", "Done"));
    const later = el("button", "link", tr("explore.remTomorrow", "Tomorrow"));
    [buy, done, later].forEach((b) => { b.type = "button"; row.appendChild(b); });
    dueBox.appendChild(row);
    buy.addEventListener("click", () => { const g = $id("btn-goto-buy"); if (g) g.click(); else showScreen("screen-buy"); });
    done.addEventListener("click", async () => {
      const cur = await loadReminders();
      saveReminders(cur.map((x) => (x.id === r.id ? advanceReminder(x, Date.now()) : x)));
      renderDue();
    });
    later.addEventListener("click", async () => {
      const cur = await loadReminders();
      saveReminders(cur.map((x) => (x.id === r.id ? Object.assign({}, x, { next: Date.now() + 864e5 }) : x)));
      renderDue();
    });
  }

  async function renderReminderList() {
    const root = $id("tm-rem-list");
    if (!root) return;
    const list = await loadReminders();
    root.innerHTML = "";
    if (!list.length) { root.appendChild(el("p", "muted", tr("explore.remEmpty", "No reminders yet."))); return; }
    list.sort((a, b) => a.next - b.next).forEach((r) => {
      const row = el("div", "tm-rem-row");
      const left = el("span", "tm-rem-left");
      const what = reminderWhat(r);
      left.appendChild(el("strong", null, freqLabel(r.freq) + (what ? " · " + what : "")));
      left.appendChild(el("span", "muted small", tr("explore.remNext", "Next: {date}", { date: ltr(new Date(r.next).toLocaleDateString()) })));
      const del = el("button", "link", tr("explore.remRemove", "Remove"));
      del.type = "button";
      del.addEventListener("click", async () => {
        saveReminders((await loadReminders()).filter((x) => x.id !== r.id));
        renderReminderList();
        renderDue();
      });
      row.appendChild(left);
      row.appendChild(del);
      root.appendChild(row);
    });
  }
  function openReminders() {
    const sel = $id("tm-rem-freq");
    sel.innerHTML = "";
    FREQS.forEach((f) => { const o = el("option", null, tr(f[1], f[2])); o.value = f[0]; sel.appendChild(o); });
    $id("tm-rem-error").classList.add("hidden");
    $id("tm-rem-amount-label").textContent = tr("explore.remAmount", "Amount in {currency} (optional)", { currency: currencyCode() });
    renderReminderList();
    showScreen("screen-reminders");
  }
  function initReminders() {
    const section = addScreen("screen-reminders");
    section.innerHTML =
      '<h2 id="tm-rem-title"></h2><p class="muted" id="tm-rem-intro"></p>' +
      '<label class="tm-label" for="tm-rem-freq" id="tm-rem-freq-label"></label><select id="tm-rem-freq"></select>' +
      '<label class="tm-label" for="tm-rem-amount" id="tm-rem-amount-label"></label>' +
      '<input type="text" id="tm-rem-amount" inputmode="decimal" autocomplete="off" placeholder="25" />' +
      '<label class="tm-label" for="tm-rem-asset" id="tm-rem-asset-label"></label>' +
      '<input type="text" id="tm-rem-asset" autocomplete="off" maxlength="12" placeholder="ETH" />' +
      '<p id="tm-rem-error" class="error hidden"></p>' +
      '<button type="button" id="tm-rem-add" class="secondary"></button>' +
      '<div id="tm-rem-list" class="tm-rem-list"></div>' +
      '<p class="warn small" id="tm-rem-note"></p>';
    section.appendChild(makeBackBtn("screen-main"));
    const setText = () => {
      $id("tm-rem-title").textContent = tr("explore.remTitle", "Recurring buy reminders");
      $id("tm-rem-intro").textContent = tr("explore.remIntro", "Get a nudge on a schedule to buy a coin.");
      $id("tm-rem-freq-label").textContent = tr("explore.remFreq", "How often");
      $id("tm-rem-asset-label").textContent = tr("explore.remAsset", "Coin (optional)");
      $id("tm-rem-add").textContent = tr("explore.remAdd", "Add reminder");
      $id("tm-rem-note").textContent = tr("explore.remNote", "This is a reminder only. Token Exchange never buys anything for you automatically -- you finish each purchase yourself.");
    };
    setText();
    onScreenOpen((id) => { if (id === "screen-reminders") setText(); if (id === "screen-main" || id == null) renderDue(); });
    $id("tm-rem-add").addEventListener("click", async () => {
      const err = $id("tm-rem-error");
      const amountStr = $id("tm-rem-amount").value.trim().replace(",", ".");
      const asset = $id("tm-rem-asset").value.trim().toUpperCase();
      if ((amountStr && !(/^\d+(\.\d+)?$/.test(amountStr) && Number(amountStr) > 0)) || (asset && !/^[A-Z0-9]{1,12}$/.test(asset))) {
        err.textContent = tr("explore.remBad", "Enter a valid amount and coin, or leave them blank.");
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      const freq = $id("tm-rem-freq").value;
      const list = await loadReminders();
      if (list.length >= 20) { err.textContent = tr("explore.remTooMany", "That's the limit of 20 reminders."); err.classList.remove("hidden"); return; }
      list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), freq, amount: amountStr, asset, next: addInterval(Date.now(), freq) });
      saveReminders(list);
      $id("tm-rem-amount").value = "";
      $id("tm-rem-asset").value = "";
      renderReminderList();
    });
    const balance = document.querySelector(".balance-box");
    if (balance && balance.parentNode) {
      dueBox = el("div", "tm-due-banner hidden");
      dueBox.id = "tm-due-banner";
      balance.insertAdjacentElement("beforebegin", dueBox);
    }
    renderDue();
    setInterval(renderDue, 60000);
  }

  // ---- 13. PORTFOLIO HISTORY (snapshots of the total, saved on this device only)
  const HIST_KEY = "tm_portfolio_hist";
  const HIST_GAP_MS = 6 * 3600 * 1000;
  const HIST_MAX = 180;
  function addHistoryPoint(points, ts, usd, maxPts) {
    const out = (Array.isArray(points) ? points : []).filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]));
    if (!isFinite(usd) || usd <= 0) return out;
    const last = out[out.length - 1];
    if (last && ts - last[0] < HIST_GAP_MS) out[out.length - 1] = [last[0], usd];
    else out.push([ts, usd]);
    return out.slice(-(maxPts || HIST_MAX));
  }
  function historyChange(points, now, windowMs) {
    const recent = (points || []).filter((p) => now - p[0] <= windowMs);
    if (recent.length < 2) return null;
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (!(first[1] > 0)) return null;
    return { pct: ((last[1] - first[1]) / first[1]) * 100, since: first[0], values: recent.map((p) => p[1]) };
  }
  function sparkSvg(values) {
    const w = 100, h = 28;
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    const span = max - min || 1;
    const pts = values.map((v, i) => (i * (w / Math.max(values.length - 1, 1))).toFixed(1) + "," + (h - 2 - ((v - min) / span) * (h - 4)).toFixed(1));
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(" ") + '"/></svg>';
  }
  let histBox = null;
  function initHistory() {
    if (!mixBox || !mixBox.parentNode) return;
    histBox = el("div", "tm-hist hidden");
    histBox.id = "tm-hist";
    mixBox.insertAdjacentElement("afterend", histBox);
  }
  async function recordPortfolio(total) {
    if (!histBox) return;
    const addr = safe(() => String(currentStatus.selectedAddress || "").toLowerCase());
    if (!addr || !(total > 0)) { histBox.classList.add("hidden"); return; }
    const all = (await storeGet([HIST_KEY]))[HIST_KEY] || {};
    const before = all[addr] || [];
    const after = addHistoryPoint(before, Date.now(), total, HIST_MAX);
    const lastBefore = before[before.length - 1];
    const lastAfter = after[after.length - 1];
    if (!lastBefore || lastBefore[0] !== lastAfter[0] || Math.abs(lastBefore[1] - lastAfter[1]) >= 0.005) {
      all[addr] = after;
      const keys = Object.keys(all);
      if (keys.length > 20) delete all[keys[0]];
      storeSet({ [HIST_KEY]: all });
    }
    const ch = historyChange(after, Date.now(), 30 * 864e5);
    histBox.innerHTML = "";
    if (!ch) { histBox.classList.add("hidden"); return; }
    const up = ch.pct >= 0;
    histBox.className = "tm-hist " + (up ? "tm-hist-up" : "tm-hist-down");
    histBox.appendChild(el("div", "tm-mix-title", tr("explore.histTitle", "Portfolio history")));
    const row = el("div", "tm-hist-row");
    const spark = el("span", "tm-hist-spark");
    spark.innerHTML = sparkSvg(ch.values);
    const pct = (up ? "+" : "") + ch.pct.toFixed(Math.abs(ch.pct) < 10 ? 2 : 1) + "%";
    row.appendChild(spark);
    row.appendChild(el("span", "tm-hist-text", tr("explore.histChange", "{pct} since {date}", { pct: ltr(pct), date: ltr(new Date(ch.since).toLocaleDateString()) })));
    histBox.appendChild(row);
    histBox.appendChild(el("div", "muted small", tr("explore.histNote", "Saved on this device only.")));
  }

  // ---- 14. PAY FROM A PAYMENT LINK OR QR
  // Turns "1.5e18"-style EIP-681 numbers into a plain integer string (null if not a whole number).
  function sciToInt(str) {
    const m = /^(\d+)(?:\.(\d+))?(?:[eE]\+?(\d+))?$/.exec(String(str).trim());
    if (!m) return null;
    const frac = m[2] || "";
    const exp = Number(m[3] || 0);
    let digits = m[1] + frac;
    const shift = exp - frac.length;
    if (shift >= 0) digits += "0".repeat(shift);
    else {
      const cut = digits.slice(shift);
      if (/[1-9]/.test(cut)) return null;
      digits = digits.slice(0, shift);
    }
    digits = digits.replace(/^0+(?=\d)/, "");
    if (!digits) digits = "0";
    return digits.length > 78 ? null : digits;
  }
  function parsePaymentLink(raw) {
    const s = String(raw || "").trim();
    if (ADDRESS_RE.test(s)) return { to: s, chainId: null };
    const m = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(\/[A-Za-z]+)?(?:\?(.*))?$/i.exec(s);
    if (!m) return null;
    const out = { chainId: m[2] ? Number(m[2]) : null };
    const params = {};
    try {
      (m[4] || "").split("&").forEach((kv) => {
        const i = kv.indexOf("=");
        if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
    } catch (e) { return null; }
    const fn = (m[3] || "").toLowerCase();
    if (fn === "/transfer") {
      if (!ADDRESS_RE.test(params.address || "")) return null;
      out.token = m[1];
      out.to = params.address;
      if (params.uint256 != null) { const u = sciToInt(params.uint256); if (u == null) return null; out.units = u; }
    } else if (fn === "") {
      out.to = m[1];
      if (params.value != null) { const v = sciToInt(params.value); if (v == null) return null; out.valueWei = v; }
    } else return null;
    return out;
  }
  function setPayNote(text, isError) {
    const n = $id("tm-pay-note");
    if (!n) return;
    n.textContent = text || "";
    n.classList.toggle("hidden", !text);
    n.classList.toggle("error", !!isError);
    if (text) safe(() => n.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }
  function fireInput(node) { node.dispatchEvent(new Event("input", { bubbles: true })); }
  // Fills the Send form from a payment link. Returns { ok, message } so a QR scanner can report it too.
  function applyPaymentLink(raw) {
    const fail = (key, fb, vars) => { const m = tr(key, fb, vars); setPayNote(m, true); return { ok: false, message: m }; };
    const p = parsePaymentLink(raw);
    if (!p) return fail("explore.payInvalid", "That doesn't look like a payment link or a wallet address.");
    try {
      p.to = ethers.utils.getAddress(p.to);
      if (p.token) p.token = ethers.utils.getAddress(p.token);
    } catch (e) { return fail("explore.payBadChecksum", "That address has a typo (the checksum doesn't match), so it wasn't filled in."); }
    const net = typeof currentNetwork !== "undefined" ? currentNetwork : null;
    if (p.chainId && net && p.chainId !== net.chainId) {
      return fail("explore.payWrongNetwork", "That link is for a different network (chain {chainId}). Switch networks first, then try again.", { chainId: p.chainId });
    }
    const to = $id("send-to");
    const sel = $id("send-asset-select");
    const amountInput = $id("send-amount");
    if (!to || !sel || !amountInput) return fail("explore.payInvalid", "That doesn't look like a payment link or a wallet address.");
    to.value = p.to;
    fireInput(to);
    let note = tr("explore.payFilled", "Filled in from the payment link. Double-check everything before you send.");
    if (p.token) {
      sel.value = "token";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      const tokenInput = $id("send-token-address");
      tokenInput.value = p.token;
      fireInput(tokenInput);
      let decimals = null;
      document.querySelectorAll("#tokens-list .token-row[data-tok-id]").forEach((row) => {
        if (row.dataset.tokId.toLowerCase() === p.token.toLowerCase() && isFinite(Number(row.dataset.decimals))) decimals = Number(row.dataset.decimals);
      });
      if (p.units != null && decimals != null) {
        amountInput.value = trimNumber(ethers.utils.formatUnits(p.units, decimals));
      } else {
        amountInput.value = "";
        if (p.units != null) note = tr("explore.payTokenAmount", "Token filled in. Enter the amount yourself -- this token isn't in your list yet.");
      }
      fireInput(amountInput);
    } else {
      sel.value = "native";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      if (p.valueWei != null) {
        const dec = (net && net.nativeCurrency && net.nativeCurrency.decimals) || 18;
        amountInput.value = trimNumber(ethers.utils.formatUnits(p.valueWei, dec));
      } else amountInput.value = "";
      fireInput(amountInput);
    }
    setPayNote(note, false);
    return { ok: true, message: note };
  }
  function togglePayRow(show) {
    const row = $id("tm-pay-row");
    if (!row) return;
    const open = typeof show === "boolean" ? show : row.classList.contains("hidden");
    row.classList.toggle("hidden", !open);
    if (open) { const i = $id("tm-pay-input"); if (i) i.focus(); }
    else setPayNote("", false);
  }
  function initPayLink() {
    const anchor = $id("btn-scan-qr") || $id("send-to-resolved") || $id("send-to");
    if (!anchor) return;
    const btn = el("button", "link tm-pay-toggle");
    btn.type = "button";
    btn.id = "tm-pay-toggle";
    const row = el("div", "tm-pay-row hidden");
    row.id = "tm-pay-row";
    const input = el("input");
    input.type = "text";
    input.id = "tm-pay-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    const go = el("button", "secondary");
    go.type = "button";
    row.appendChild(input);
    row.appendChild(go);
    const note = el("p", "muted small hidden");
    note.id = "tm-pay-note";
    anchor.insertAdjacentElement("afterend", btn);
    btn.insertAdjacentElement("afterend", row);
    row.insertAdjacentElement("afterend", note);
    const setText = () => {
      btn.textContent = tr("explore.payToggle", "Paste payment link");
      input.placeholder = tr("explore.payPlaceholder", "ethereum:0x… or a wallet address");
      go.textContent = tr("explore.payApply", "Fill in");
    };
    setText();
    onScreenOpen((id) => { if (id === "screen-send" || id == null) setText(); });
    btn.addEventListener("click", () => togglePayRow());
    go.addEventListener("click", () => { if (applyPaymentLink(input.value).ok) input.value = ""; });
    input.addEventListener("paste", () => setTimeout(() => { if (input.value.trim() && applyPaymentLink(input.value).ok) input.value = ""; }, 0));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  }

  // ---- 15. ACTIVITY SUMMARY (this calendar month)
  function summarizeActivity(list, now) {
    const d = new Date(now);
    const y = d.getFullYear(), mo = d.getMonth();
    const res = { sent: { count: 0, by: {} }, recv: { count: 0, by: {} } };
    (Array.isArray(list) ? list : []).forEach((it) => {
      if (!it || !it.ts) return;
      const t = new Date(it.ts);
      if (t.getFullYear() !== y || t.getMonth() !== mo) return;
      const bucket = it.direction === "in" ? res.recv : res.sent;
      bucket.count += 1;
      const amt = Number(it.amount);
      const sym = String(it.asset || "").slice(0, 12);
      if (sym && isFinite(amt) && amt > 0) bucket.by[sym] = Math.round(((bucket.by[sym] || 0) + amt) * 1e8) / 1e8;
    });
    return res;
  }
  function assetsText(by) {
    return Object.keys(by).sort((a, b) => by[b] - by[a]).slice(0, 3).map((s) => trimNumber(String(by[s])) + " " + s).join(", ");
  }
  let sumBox = null;
  async function renderActivitySummary() {
    if (!sumBox) return;
    const data = await storeGet(["tm_activity"]);
    const s = summarizeActivity(data.tm_activity, Date.now());
    sumBox.innerHTML = "";
    sumBox.appendChild(el("div", "tm-mix-title", tr("explore.sumTitle", "This month")));
    if (!s.sent.count && !s.recv.count) { sumBox.appendChild(el("div", "muted small", tr("explore.sumNone", "Nothing yet this month."))); return; }
    const line = (key, fb, b) => {
      if (!b.count) return;
      const assets = assetsText(b.by);
      sumBox.appendChild(el("div", "tm-sum-line", tr(key, fb, { count: b.count }) + (assets ? " · " + ltr(assets) : "")));
    };
    line("explore.sumSent", "Sent: {count}", s.sent);
    line("explore.sumReceived", "Received: {count}", s.recv);
  }
  function initActivitySummary() {
    const list = $id("activity-list");
    if (!list || !list.parentNode) return;
    sumBox = el("div", "tm-act-sum");
    sumBox.id = "tm-act-sum";
    list.insertAdjacentElement("beforebegin", sumBox);
    renderActivitySummary();
    onScreenOpen((id) => { if (id === "screen-activity" || id == null) renderActivitySummary(); });
    try { new MutationObserver(() => renderActivitySummary()).observe(list, { childList: true }); } catch (e) { /* no observer */ }
  }


  // ---- 16. SCREEN-READER LABELS: tie each bare <label> to the field right after it, and name the account switcher
  function initA11y() {
    const run = () => {
      document.querySelectorAll("label:not([for])").forEach((lab) => {
        const nxt = lab.nextElementSibling;
        if (nxt && /^(SELECT|INPUT|TEXTAREA)$/.test(nxt.tagName) && nxt.id && !nxt.labels.length) lab.htmlFor = nxt.id;
      });
      const acct = $id("account-select");
      if (acct) acct.setAttribute("aria-label", tr("explore.accountSwitch", "Switch account"));
    };
    run();
    onScreenOpen(() => run());
  }

  // ---------------------------------------------------------------- start
  function init() {
    [initHideBalances, initRecent, initRequest, initSort, initMix, initZero, initSecurity, initApps, initPercent, initScreenHooks, initTools, initConverter, initReminders, initHistory, initPayLink, initActivitySummary, initA11y].forEach((f) => {
      try { const r = f(); if (r && typeof r.catch === "function") r.catch(() => {}); } catch (e) { /* one feature failing must not affect the others */ }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  function setSortMode(mode) { if (SORTS.some((x) => x[0] === mode)) { sortMode = mode; markSortActive(); } }

  window.TM_EXPLORE = { sortMarkets, setSortMode, afterTokens, refreshAllocation, receiptText, addReceiptRow, buildPaymentLink,
    convertAmount, formatConverted, advanceReminder, dueReminders, addHistoryPoint, historyChange, sciToInt, parsePaymentLink, applyPaymentLink, summarizeActivity };
})();
