// lib/token-scan-ui.js
// UI for "Scan wallet": the button next to "+ Add token", the results screen and
// the Add / Add all actions. Shared by the extension popup and the website; it uses
// each page's own globals ($, sendMsg, showScreen, showError, hideError,
// currentNetwork, currentStatus, refreshTokens) and loads AFTER popup.js / app.js.
// The wording is plain English for now -- it is kept in one object (S) so it can be
// moved into the language files later without touching the logic.
(function () {
  // Wording lives in the language files (keys scan.*). The English fallback below only
  // applies if the i18n script is not loaded.
  const S_EN = {
    scanning: "Scanning this account for tokens\u2026",
    unsupported: "Scanning isn't available on this network yet. Use \"+ Add token\" and paste a contract address instead.",
    noAccount: "No account is selected.",
    noCatalog: "Couldn't reach CoinGecko, so only the verified stablecoins were checked.",
    none: "No new tokens found on this account.",
    add: "Add",
    adding: "Adding\u2026",
    added: "Added \u2713",
    addAll: "Add all",
  };
  const S = new Proxy({}, { get: (_, k) => (typeof TM_I18N !== "undefined" && TM_I18N.t ? TM_I18N.t("scan." + String(k)) : S_EN[k]) });
  const el = (id) => document.getElementById(id);
  const btn = el("btn-scan-tokens");
  if (!btn || !el("screen-scan-tokens")) return;

  let gen = 0;

  function fmtBalance(wei, decimals) {
    const n = Number(ethers.utils.formatUnits(wei, decimals));
    if (!isFinite(n)) return "?";
    if (n === 0) return "0";
    return n.toLocaleString(undefined, { maximumSignificantDigits: 6, maximumFractionDigits: 8 });
  }

  function setStatus(text) { el("scan-tokens-status").textContent = text || ""; }

  async function addOne(t, button) {
    hideError("scan-tokens-error");
    button.disabled = true;
    button.textContent = S.adding;
    try {
      await sendMsg("TM_ADD_TRACKED_TOKEN", { tokenAddress: t.address, symbol: t.symbol, decimals: t.decimals, name: t.name });
      button.textContent = S.added;
      button.dataset.done = "1";
      refreshTokens();
    } catch (e) {
      button.disabled = false;
      button.textContent = S.add;
      showError("scan-tokens-error", e.message);
    }
    updateAddAll();
  }

  function updateAddAll() {
    const left = el("scan-tokens-list").querySelectorAll(".scan-add-btn:not([data-done])").length;
    el("btn-scan-add-all").classList.toggle("hidden", left < 2);
  }

  function renderRows(found) {
    const root = el("scan-tokens-list");
    root.innerHTML = "";
    found.forEach((t) => {
      const row = document.createElement("div");
      row.className = "token-row";

      const icon = document.createElement("span");
      icon.className = "token-icon";
      icon.style.background = "#6b6f7a";
      icon.textContent = t.symbol.slice(0, 3).toUpperCase();

      const main = document.createElement("span");
      main.className = "token-main";
      const sym = document.createElement("span");
      sym.className = "token-symbol";
      sym.textContent = t.symbol;
      const name = document.createElement("span");
      name.className = "token-name muted small";
      name.textContent = t.name;
      main.appendChild(sym);
      main.appendChild(name);

      const balCol = document.createElement("span");
      balCol.className = "token-balance-col";
      const bal = document.createElement("span");
      bal.className = "token-balance";
      bal.textContent = fmtBalance(t.balanceWei, t.decimals);
      balCol.appendChild(bal);

      const add = document.createElement("button");
      add.type = "button";
      add.className = "scan-add-btn";
      add.textContent = S.add;
      add.addEventListener("click", () => addOne(t, add));

      row.appendChild(icon);
      row.appendChild(main);
      row.appendChild(balCol);
      row.appendChild(add);
      root.appendChild(row);
    });
    updateAddAll();
  }

  async function runScan() {
    const my = ++gen;
    hideError("scan-tokens-error");
    el("scan-tokens-list").innerHTML = "";
    el("btn-scan-add-all").classList.add("hidden");
    el("btn-scan-again").disabled = true;
    setStatus(S.scanning);
    try {
      if (!currentStatus || !currentStatus.selectedAddress) { setStatus(S.noAccount); return; }
      const net = currentNetwork;
      const { addresses, catalogOk } = await TM_TOKEN_SCAN.candidates(net);
      if (my !== gen) return;
      if (!addresses.length) { setStatus(S.unsupported); return; }
      const res = await sendMsg("TM_SCAN_TOKENS", { addresses });
      if (my !== gen || net !== currentNetwork) return; // switched account/network or re-scanned meanwhile
      renderRows(res.found);
      const parts = [res.found.length ? `Found ${res.found.length} token${res.found.length === 1 ? "" : "s"} you haven't added yet (checked ${res.checked} on ${net.name}).` : S.none + ` (Checked ${res.checked} on ${net.name}.)`];
      if (res.alreadyTracked) parts.push(`${res.alreadyTracked} already in your list.`);
      if (!catalogOk) parts.push(S.noCatalog);
      setStatus(parts.join(" "));
    } catch (e) {
      if (my !== gen) return;
      setStatus("");
      showError("scan-tokens-error", e.message);
    } finally {
      if (my === gen) el("btn-scan-again").disabled = false;
    }
  }

  btn.addEventListener("click", () => { showScreen("screen-scan-tokens"); runScan(); });
  el("btn-scan-again").addEventListener("click", runScan);
  el("btn-scan-add-all").addEventListener("click", async () => {
    const buttons = [...el("scan-tokens-list").querySelectorAll(".scan-add-btn:not([data-done])")];
    for (const b of buttons) { b.click(); await new Promise((r) => setTimeout(r, 0)); while (b.disabled && !b.dataset.done) await new Promise((r) => setTimeout(r, 30)); }
  });
})();
