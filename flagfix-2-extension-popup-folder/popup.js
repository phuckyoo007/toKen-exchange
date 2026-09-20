// popup/popup.js
// Drives both the normal toolbar popup (onboarding/unlock/wallet/settings)
// and the "approval" mode popup window opened by the background worker when
// a dapp requests something (connect, sign, send, add network).

function $(id) { return document.getElementById(id); }

// The one spinning-coin image (popup/img/spinner-coin.png) doubles as the
// wallet's single "you're waiting on something" cue everywhere -- the
// startup splash, screen-loading, the balance, and every other in-place
// loading state below all share it rather than each inventing their own.
function coinSpinnerHtml(label) {
  const img = `<img class="inline-coin-spinner" src="img/spinner-coin.png" alt="" />`;
  return label ? `${img}<span>${escapeHtml(label)}</span>` : img;
}

// ---------------------------------------------------------------- DISPLAY CURRENCY
// Which fiat currency price/balance displays are shown in (see Settings) --
// CoinGecko prices every coin directly in each of these, so switching just
// means re-requesting with a different vs_currencies code, no separate FX
// conversion needed. Defaults to USD until TM_PRICES loads (see init()).
const TM_CURRENCY_KEY = "tm_currency";
let currentCurrency = "usd";

function loadCurrency() {
  return new Promise((resolve) => {
    chrome.storage.local.get([TM_CURRENCY_KEY], (res) => {
      const stored = res[TM_CURRENCY_KEY];
      currentCurrency = stored && TM_PRICES.SUPPORTED_CURRENCIES[stored] ? stored : TM_PRICES.DEFAULT_CURRENCY;
      resolve();
    });
  });
}

function currencySymbol() {
  const info = TM_PRICES.SUPPORTED_CURRENCIES[currentCurrency];
  return info ? info.symbol : "$";
}

function formatCurrency(amount) {
  return `${currencySymbol()}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------- NETWORK COLORS
// Each chain's own brand color, the same small colored dot MetaMask (and
// basically every other multi-chain wallet) shows next to a network's
// name so the current chain reads at a glance instead of only by text --
// handy since two networks with similar names (or a long custom one) are
// otherwise easy to misread in a hurry.
const NETWORK_DOT_COLORS = {
  ethereum: "#627EEA",
  base: "#0052FF",
  polygon: "#8247E5",
  bsc: "#F3BA2F",
  arbitrum: "#28A0F0",
  optimism: "#FF0420",
};
function networkDotColor(key) {
  if (NETWORK_DOT_COLORS[key]) return NETWORK_DOT_COLORS[key];
  // A user-added custom network has no known brand color -- fall back to a
  // color hashed from its key, so it's still a consistent, distinct dot
  // rather than a plain gray "unknown" marker every time.
  let h = 0;
  const str = String(key || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 58%)`;
}
function networkDotHtml(key) {
  return `<span class="network-dot" style="background:${networkDotColor(key)}"></span>`;
}

// ---------------------------------------------------------------- TOKEN ICONS
// A colored initials badge per coin/token -- the same role a real logo
// plays in MetaMask's token list, without fetching one from a third party
// (a user-added token's contract address would otherwise have to be sent
// to some logo API just to look it up). Well-known coins get their actual
// brand color; anything else gets a color hashed from its own symbol, so
// it's still a consistent, distinct badge rather than a plain gray "?".
const TOKEN_BRAND_COLORS = {
  BTC: "#F7931A", ETH: "#627EEA", WETH: "#627EEA", BNB: "#F3BA2F", POL: "#8247E5",
  MATIC: "#8247E5", SOL: "#14F195", XRP: "#25A6E1", DOGE: "#C2A633", ADA: "#0033AD",
  USDT: "#26A17B", USDC: "#2775CA", DAI: "#F5AC37", AVAX: "#E84142", LINK: "#2A5ADA",
  DOT: "#E6007A", TRX: "#EF0027", UNI: "#FF007A", LTC: "#345D9D", SHIB: "#F00500",
  TON: "#0098EA", WBTC: "#F09242",
};
function tokenIconColor(symbol) {
  const key = String(symbol || "").toUpperCase();
  if (TOKEN_BRAND_COLORS[key]) return TOKEN_BRAND_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 46%)`;
}
function tokenIconHtml(symbol) {
  const s = String(symbol || "?").trim();
  const initials = escapeHtml((s.slice(0, 2) || "?").toUpperCase());
  return `<span class="token-icon" style="background:${tokenIconColor(s)}">${initials}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

function sendMsg(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response || !response.ok) return reject(new Error((response && response.error) || "Unknown error"));
      resolve(response);
    });
  });
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden");
}
function hideError(id) { $(id).classList.add("hidden"); }

document.querySelectorAll(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    showScreen(btn.dataset.back);
    if (btn.dataset.back === "screen-main") refreshMain();
  });
});

let currentStatus = null;
let currentNetworks = [];
let currentNetwork = null;

// ---------------------------------------------------------------- ONBOARDING
$("btn-goto-create").addEventListener("click", () => showScreen("screen-create"));
$("btn-goto-import").addEventListener("click", () => showScreen("screen-import"));
$("btn-goto-support-onboarding").addEventListener("click", () => openSupport("screen-onboarding"));

$("btn-create-submit").addEventListener("click", async () => {
  const pw = $("create-password").value;
  const pw2 = $("create-password-confirm").value;
  if (pw.length < 8) return alert(TM_I18N.t("errors.passwordTooShort"));
  if (pw !== pw2) return alert(TM_I18N.t("errors.passwordMismatch"));
  try {
    const res = await sendMsg("TM_CREATE_WALLET", { password: pw });
    $("mnemonic-display").textContent = res.mnemonic;
    $("create-step-password").classList.add("hidden");
    $("create-step-backup").classList.remove("hidden");
  } catch (e) {
    alert(e.message);
  }
});

$("backup-confirm-check").addEventListener("change", (e) => {
  $("btn-backup-done").disabled = !e.target.checked;
});
$("btn-backup-done").addEventListener("click", async () => {
  await refreshMain();
  showScreen("screen-main");
});

$("btn-import-submit").addEventListener("click", async () => {
  hideError("import-error");
  const mnemonic = $("import-mnemonic").value;
  const pw = $("import-password").value;
  const pw2 = $("import-password-confirm").value;
  if (pw.length < 8) return showError("import-error", TM_I18N.t("errors.passwordTooShort"));
  if (pw !== pw2) return showError("import-error", TM_I18N.t("errors.passwordMismatch"));
  try {
    await sendMsg("TM_IMPORT_MNEMONIC", { mnemonic, password: pw });
    await refreshMain();
    showScreen("screen-main");
  } catch (e) {
    showError("import-error", e.message);
  }
});

// ---------------------------------------------------------------- UNLOCK
$("btn-unlock-submit").addEventListener("click", async () => {
  hideError("unlock-error");
  try {
    await sendMsg("TM_UNLOCK", { password: $("unlock-password").value });
    await refreshMain();
    showScreen("screen-main");
  } catch (e) {
    showError("unlock-error", e.message);
  }
});
$("btn-goto-reset").addEventListener("click", () => showScreen("screen-reset"));
$("btn-goto-support-unlock").addEventListener("click", () => openSupport("screen-unlock"));

// ---------------------------------------------------------------- MAIN
async function refreshMain() {
  currentStatus = await sendMsg("TM_GET_STATUS");
  const netRes = await sendMsg("TM_GET_NETWORKS");
  currentNetworks = netRes.networks;
  currentNetwork = netRes.selected;

  const accSel = $("account-select");
  accSel.innerHTML = "";
  currentStatus.accounts.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.address;
    opt.textContent = `${a.name} (${a.address.slice(0, 6)}...${a.address.slice(-4)})`;
    if (a.address === currentStatus.selectedAddress) opt.selected = true;
    accSel.appendChild(opt);
  });

  const netSel = $("network-select");
  netSel.innerHTML = "";
  currentNetworks.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n.chainId;
    opt.textContent = n.name + (n.swapRouter ? "" : TM_I18N.t("addToken.swapUnavailableSuffix"));
    if (n.chainId === currentNetwork.chainId) opt.selected = true;
    netSel.appendChild(opt);
  });

  $("network-badge").innerHTML = networkDotHtml(currentNetwork.key) + `<span>${escapeHtml(currentNetwork.name)}</span>`;
  $("network-badge").classList.remove("hidden");
  if ($("network-select-dot")) $("network-select-dot").style.background = networkDotColor(currentNetwork.key);
  $("address-display").textContent = currentStatus.selectedAddress || "";
  updateAccountIdenticon(currentStatus.selectedAddress);
  refreshAddressQr();

  // Intentionally NOT awaited: balance comes from an RPC call that can be
  // slow (or fail) on a bad connection / rate-limited public endpoint. We
  // don't want a slow network to block the screen transition -- show the
  // wallet UI immediately and let the balance fill in when it's ready.
  // The USD value is the lead number (see #balance-usd's CSS), so that's
  // where the loading cue and any "couldn't load" fallback text goes;
  // the native amount underneath fills in once the RPC call resolves.
  $("balance-usd").innerHTML = `<img class="balance-coin-spinner" src="img/spinner-coin.png" alt="" />`;
  $("balance-usd").classList.remove("hidden");
  $("balance-amount").textContent = "";
  $("balance-symbol").textContent = "";
  document.querySelector(".balance-native-row").classList.remove("balance-lead-fallback");
  refreshBalance();
  refreshTokens(); // not awaited -- same reasoning as the balance above
  refreshMainPricesCard(); // not awaited -- same reasoning as the balance above
  refreshMainPredictionsCard(); // not awaited -- same reasoning as the balance above
}

async function refreshBalance() {
  hideError("main-error");
  if (!currentStatus.selectedAddress) return;
  try {
    const bal = await sendMsg("TM_GET_BALANCE", { address: currentStatus.selectedAddress });
    const formatted = ethers.utils.formatUnits(bal.balanceWei, bal.decimals);
    $("balance-amount").textContent = Number(formatted).toFixed(5);
    $("balance-symbol").textContent = bal.symbol;
    refreshBalanceUsd(); // not awaited -- a slow/rate-limited price API shouldn't block the balance display
  } catch (e) {
    $("balance-amount").textContent = "--";
    // No native amount to base a USD estimate on either -- fall back to
    // showing that "--" as the lead number instead of leaving the
    // balance box looking empty.
    $("balance-usd").innerHTML = "";
    $("balance-usd").classList.add("hidden");
    document.querySelector(".balance-native-row").classList.add("balance-lead-fallback");
    showError("main-error", TM_I18N.t("main.balanceFetchErrorPrefix") + e.message);
  }
}

$("account-select").addEventListener("change", async (e) => {
  await sendMsg("TM_SELECT_ACCOUNT", { address: e.target.value });
  currentStatus.selectedAddress = e.target.value;
  $("address-display").textContent = e.target.value;
  updateAccountIdenticon(e.target.value);
  refreshAddressQr();
  await refreshBalance();
  await refreshTokens();
});

// ---------------------------------------------------------------- IDENTICONS
function updateAccountIdenticon(address) {
  const el = $("account-identicon");
  if (el) el.innerHTML = address ? TM_IDENTICON.svgFor(address, 28) : "";
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
$("send-to").addEventListener("input", (e) => {
  const el = $("send-to-identicon");
  const val = e.target.value.trim();
  if (ADDRESS_RE.test(val)) {
    el.innerHTML = TM_IDENTICON.svgFor(val, 24);
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
    el.innerHTML = "";
  }
});

$("network-select").addEventListener("change", async (e) => {
  await sendMsg("TM_SELECT_NETWORK", { chainId: Number(e.target.value) });
  await refreshMain();
});

$("btn-copy-address").addEventListener("click", () => {
  navigator.clipboard.writeText(currentStatus.selectedAddress || "");
});

// Local, in-page QR rendering (see vendor/qrcode-generator.js) -- no
// network request of any kind, so showing your own receive address this
// way can't leak it anywhere.
function refreshAddressQr() {
  const box = $("address-qr-box");
  if (box.classList.contains("hidden")) return;
  const address = $("address-display").textContent;
  if (!address) {
    box.innerHTML = "";
    return;
  }
  const qr = qrcode(0, "M");
  qr.addData(address);
  qr.make();
  box.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
}

$("btn-toggle-qr").addEventListener("click", () => {
  const box = $("address-qr-box");
  const isHidden = box.classList.toggle("hidden"); // true if "hidden" was just added
  $("btn-toggle-qr").textContent = isHidden ? TM_I18N.t("main.showQrBtn") : TM_I18N.t("main.hideQrBtn");
  if (!isHidden) refreshAddressQr();
});

$("btn-settings").addEventListener("click", () => showScreen("screen-settings"));
$("btn-goto-send").addEventListener("click", () => showScreen("screen-send"));
$("btn-goto-swap").addEventListener("click", () => { setupSwapScreen(); showScreen("screen-swap"); });
$("btn-goto-prices").addEventListener("click", () => { showScreen("screen-prices"); refreshPrices(); });
$("btn-goto-predictions").addEventListener("click", () => { showScreen("screen-predictions"); refreshPredictions(); });
$("btn-goto-buy").addEventListener("click", () => { setupBuyScreen(); showScreen("screen-buy"); });
$("btn-goto-add-token").addEventListener("click", () => { resetAddTokenScreen(); showScreen("screen-add-token"); });

// ---------------------------------------------------------------- TOKENS
async function refreshTokens() {
  let res;
  try {
    res = await sendMsg("TM_GET_TRACKED_TOKEN_BALANCES");
  } catch (e) {
    return; // best-effort -- don't let this disrupt the rest of the main screen
  }

  const list = $("tokens-list");
  list.innerHTML = "";
  if (!res.tokens.length) {
    $("tokens-empty").classList.remove("hidden");
    return;
  }
  $("tokens-empty").classList.add("hidden");

  // USD values are best-effort on top of best-effort: a rate-limited or
  // unreachable CoinGecko just means the row shows a balance with no $
  // value, never an error the user has to deal with.
  let prices = {};
  try {
    if (currentNetwork) {
      prices = await TM_PRICES.getTokenPricesByContract(currentNetwork.key, res.tokens.map((t) => t.address), currentCurrency);
    }
  } catch (e) {
    prices = {};
  }

  res.tokens.forEach((t) => {
    const row = document.createElement("div");
    row.className = "token-row";
    const formatted = ethers.utils.formatUnits(t.balanceWei, t.decimals);
    const priceEntry = prices[t.address.toLowerCase()];
    const usdText =
      priceEntry && typeof priceEntry.price === "number" ? formatCurrency(Number(formatted) * priceEntry.price) : "";
    const nameEl = document.createElement("span");
    nameEl.className = "token-name muted small";
    nameEl.textContent = t.name || (t.error ? TM_I18N.t("tokens.loadError") : "");
    const mainEl = document.createElement("span");
    mainEl.className = "token-main";
    mainEl.innerHTML = `<span class="token-symbol"></span>`;
    mainEl.querySelector(".token-symbol").textContent = t.symbol;
    mainEl.appendChild(nameEl);

    const balEl = document.createElement("span");
    balEl.className = "token-balance-col";
    const balSpan = document.createElement("span");
    balSpan.className = "token-balance";
    balSpan.textContent = Number(formatted).toFixed(4);
    balEl.appendChild(balSpan);
    if (usdText) {
      const usdSpan = document.createElement("span");
      usdSpan.className = "token-usd muted small";
      usdSpan.textContent = usdText;
      balEl.appendChild(usdSpan);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "token-remove-btn";
    removeBtn.title = TM_I18N.t("tokens.removeTitle");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      await sendMsg("TM_REMOVE_TRACKED_TOKEN", { tokenAddress: t.address });
      await refreshTokens();
    });

    row.insertAdjacentHTML("beforeend", tokenIconHtml(t.symbol));
    row.appendChild(mainEl);
    row.appendChild(balEl);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}

function resetAddTokenScreen() {
  hideError("add-token-error");
  $("add-token-address").value = "";
  $("add-token-preview").classList.add("hidden");
  delete $("add-token-preview").dataset.address;
}

$("btn-token-lookup").addEventListener("click", async () => {
  hideError("add-token-error");
  $("add-token-preview").classList.add("hidden");
  try {
    const address = $("add-token-address").value.trim();
    if (!ethers.utils.isAddress(address)) throw new Error(TM_I18N.t("addToken.invalidAddress"));
    const info = await sendMsg("TM_LOOKUP_TOKEN", { tokenAddress: address });
    $("add-token-name").textContent = info.name || TM_I18N.t("addToken.noName");
    $("add-token-symbol").textContent = info.symbol;
    $("add-token-decimals").textContent = info.decimals;
    const preview = $("add-token-preview");
    preview.dataset.address = address;
    preview.dataset.symbol = info.symbol;
    preview.dataset.decimals = String(info.decimals);
    preview.dataset.name = info.name || "";
    preview.classList.remove("hidden");
  } catch (e) {
    showError("add-token-error", e.message);
  }
});

$("btn-token-confirm-add").addEventListener("click", async () => {
  hideError("add-token-error");
  try {
    const d = $("add-token-preview").dataset;
    await sendMsg("TM_ADD_TRACKED_TOKEN", {
      tokenAddress: d.address,
      symbol: d.symbol,
      decimals: Number(d.decimals),
      name: d.name,
    });
    await refreshTokens();
    showScreen("screen-main");
  } catch (e) {
    showError("add-token-error", e.message);
  }
});

// ---------------------------------------------------------------- PRICES
function showUsdUnavailable() {
  // No USD estimate to lead with -- promote the native amount/symbol
  // underneath into the lead spot instead (see .balance-lead-fallback in
  // popup.css) so the balance box never reads as empty, just native-only.
  $("balance-usd").innerHTML = "";
  $("balance-usd").classList.add("hidden");
  document.querySelector(".balance-native-row").classList.add("balance-lead-fallback");
}

async function refreshBalanceUsd() {
  if (!currentNetwork) return showUsdUnavailable();
  try {
    const price = await TM_PRICES.getNativePriceForNetwork(currentNetwork.key, currentCurrency);
    if (price == null) return showUsdUnavailable();
    const amount = Number($("balance-amount").textContent) || 0;
    document.querySelector(".balance-native-row").classList.remove("balance-lead-fallback");
    $("balance-usd").textContent = formatCurrency(amount * price);
    $("balance-usd").classList.remove("hidden");
  } catch (e) {
    // Price lookups are best-effort -- a rate-limited or unreachable
    // CoinGecko shouldn't disrupt the rest of the wallet UI.
    showUsdUnavailable();
  }
}

// ---------------------------------------------------------------- WATCHLIST
// A starred-token list, purely local (chrome.storage.local) -- the same
// quick-reference convention Binance and most exchange apps use. Starring
// a token never sends its symbol anywhere; it only changes render order.
const TM_WATCHLIST_KEY = "tm_watchlist";
let watchlistSymbols = new Set();

function loadWatchlist() {
  return new Promise((resolve) => {
    chrome.storage.local.get([TM_WATCHLIST_KEY], (res) => {
      watchlistSymbols = new Set(Array.isArray(res[TM_WATCHLIST_KEY]) ? res[TM_WATCHLIST_KEY] : []);
      resolve();
    });
  });
}

function isWatchlisted(symbol) {
  return watchlistSymbols.has(String(symbol).toUpperCase());
}

function toggleWatchlist(symbol) {
  const key = String(symbol).toUpperCase();
  if (watchlistSymbols.has(key)) watchlistSymbols.delete(key);
  else watchlistSymbols.add(key);
  chrome.storage.local.set({ [TM_WATCHLIST_KEY]: Array.from(watchlistSymbols) });
}

// Stable sort (guaranteed by the spec for Array#sort) -- starred coins move
// to the top, everything else keeps its original relative order.
function sortByWatchlist(board) {
  return [...board].sort((a, b) => (isWatchlisted(a.symbol) ? 0 : 1) - (isWatchlisted(b.symbol) ? 0 : 1));
}

function renderPriceRow(c) {
  const row = document.createElement("div");
  row.className = "price-row";
  const priceText =
    c.price == null
      ? TM_I18N.t("prices.naText")
      : `${currencySymbol()}${c.price.toLocaleString(undefined, { minimumFractionDigits: c.price < 1 ? 4 : 2, maximumFractionDigits: c.price < 1 ? 4 : 2 })}`;
  let changeHtml = "";
  if (typeof c.change24h === "number") {
    const cls = c.change24h >= 0 ? "up" : "down";
    const sign = c.change24h >= 0 ? "+" : "";
    changeHtml = `<span class="price-change ${cls}">${sign}${c.change24h.toFixed(2)}%</span>`;
  }
  const starred = isWatchlisted(c.symbol);
  row.innerHTML = `
    <span class="price-left">${tokenIconHtml(c.symbol)}<span><span class="price-name">${c.name}</span><span class="price-symbol">${c.symbol}</span></span></span>
    <span class="price-right"><button type="button" class="star-btn ${starred ? "starred" : ""}" aria-label="${TM_I18N.t("prices.watchlistToggle")}">${starred ? "★" : "☆"}</button><span class="price-usd">${priceText}</span>${changeHtml}</span>
  `;
  row.querySelector(".star-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleWatchlist(c.symbol);
    row.replaceWith(renderPriceRow(c));
  });
  return row;
}

async function refreshPrices() {
  hideError("prices-error");
  $("prices-status").innerHTML = coinSpinnerHtml(TM_I18N.t("prices.loading"));
  $("prices-status").classList.remove("hidden");
  try {
    const board = sortByWatchlist(await TM_PRICES.getPriceBoard(currentCurrency));
    const list = $("prices-list");
    list.innerHTML = "";
    board.forEach((c) => list.appendChild(renderPriceRow(c)));
    $("prices-status").classList.add("hidden");
  } catch (e) {
    $("prices-status").classList.add("hidden");
    showError("prices-error", e.message);
  }
}

// Compact live-prices card on the main screen -- just the first handful of
// PRICE_BOARD's coins, at a glance, without navigating away. Best-effort
// like the balance/token refreshes above: a rate-limited or unreachable
// CoinGecko leaves a quiet one-line note here rather than disrupting
// screen-main (the full Prices screen still shows a real error banner).
const MAIN_PRICES_CARD_COUNT = 4;
async function refreshMainPricesCard() {
  const list = $("prices-card-list");
  if (!list) return;
  list.innerHTML = `<div class="price-row skeleton">${coinSpinnerHtml(TM_I18N.t("prices.loading"))}</div>`;
  try {
    const board = sortByWatchlist(await TM_PRICES.getPriceBoard(currentCurrency));
    list.innerHTML = "";
    board.slice(0, MAIN_PRICES_CARD_COUNT).forEach((c) => list.appendChild(renderPriceRow(c)));
  } catch (e) {
    list.innerHTML = `<div class="price-row skeleton">${TM_I18N.t("prices.cardUnavailable")}</div>`;
  }
}

// ---------------------------------------------------------------- PREDICTIONS
// Read-only display of trending Polymarket markets (see lib/polymarket.js).
// This wallet never places a bet or holds a position -- it only shows the
// public odds, the same way MetaMask's Portfolio surfaces them.
function formatMarketVolume(v) {
  if (!v) return null;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

function renderMarketRow(m) {
  const row = document.createElement("div");
  row.className = "market-row";
  let metaHtml = "";
  if (m.leadPct != null && m.leadName) {
    const cls = m.leadPct >= 50 ? "up" : "down";
    metaHtml += `<span class="market-pct ${cls}">${m.leadName} ${m.leadPct}%</span>`;
  }
  const volText = formatMarketVolume(m.volume24hr);
  if (volText) metaHtml += `<span class="market-volume">${volText} ${TM_I18N.t("predictions.volSuffix")}</span>`;
  row.innerHTML = `
    <span class="market-question">${m.question}</span>
    <span class="market-meta">${metaHtml}</span>
  `;
  return row;
}

async function refreshPredictions() {
  hideError("predictions-error");
  $("predictions-status").innerHTML = coinSpinnerHtml(TM_I18N.t("predictions.loading"));
  $("predictions-status").classList.remove("hidden");
  try {
    const markets = await TM_POLYMARKET.getTrendingMarkets(12);
    const list = $("predictions-list");
    list.innerHTML = "";
    if (!markets.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = TM_I18N.t("predictions.empty");
      list.appendChild(p);
    } else {
      markets.forEach((m) => list.appendChild(renderMarketRow(m)));
    }
    $("predictions-status").classList.add("hidden");
  } catch (e) {
    $("predictions-status").classList.add("hidden");
    showError("predictions-error", e.message);
  }
}

const MAIN_PREDICTIONS_CARD_COUNT = 3;
async function refreshMainPredictionsCard() {
  const list = $("predictions-card-list");
  if (!list) return;
  list.innerHTML = `<div class="market-row skeleton">${coinSpinnerHtml(TM_I18N.t("predictions.loading"))}</div>`;
  try {
    const markets = await TM_POLYMARKET.getTrendingMarkets(MAIN_PREDICTIONS_CARD_COUNT);
    list.innerHTML = "";
    if (!markets.length) {
      list.innerHTML = `<div class="market-row skeleton">${TM_I18N.t("predictions.empty")}</div>`;
    } else {
      markets.forEach((m) => list.appendChild(renderMarketRow(m)));
    }
  } catch (e) {
    list.innerHTML = `<div class="market-row skeleton">${TM_I18N.t("predictions.cardUnavailable")}</div>`;
  }
}

// ---------------------------------------------------------------- BUY
function setupBuyScreen() {
  hideError("buy-error");
  $("buy-address-display").textContent = (currentStatus && currentStatus.selectedAddress) || "";
}

$("btn-buy-copy-address").addEventListener("click", () => {
  navigator.clipboard.writeText((currentStatus && currentStatus.selectedAddress) || "");
});

$("btn-buy-open").addEventListener("click", () => {
  hideError("buy-error");
  try {
    const url = TM_BUY_CONFIG.buildBuyUrl(currentNetwork.key);
    chrome.tabs.create({ url });
  } catch (e) {
    showError("buy-error", e.message);
  }
});

// ---------------------------------------------------------------- SETTINGS
$("btn-add-account").addEventListener("click", async () => {
  try {
    await sendMsg("TM_ADD_ACCOUNT", {});
    await refreshMain();
  } catch (e) { alert(e.message); }
});
$("btn-goto-import-key").addEventListener("click", () => showScreen("screen-import-key"));
$("btn-goto-add-network").addEventListener("click", () => showScreen("screen-add-network"));
$("btn-goto-walletconnect").addEventListener("click", () => {
  showScreen("screen-walletconnect");
  renderWcSessions();
});
$("btn-view-seed").addEventListener("click", () => showScreen("screen-view-seed"));
$("btn-goto-support-settings").addEventListener("click", () => openSupport("screen-settings"));
$("btn-lock").addEventListener("click", async () => {
  await sendMsg("TM_LOCK", {});
  showScreen("screen-unlock");
});
$("btn-goto-reset-2").addEventListener("click", () => showScreen("screen-reset"));
$("btn-reset-confirm").addEventListener("click", async () => {
  await sendMsg("TM_RESET_WALLET", {});
  location.reload();
});

$("btn-import-key-submit").addEventListener("click", async () => {
  hideError("import-key-error");
  try {
    await sendMsg("TM_IMPORT_PRIVATE_KEY", { privateKey: $("import-key-input").value });
    await refreshMain();
    showScreen("screen-main");
  } catch (e) {
    showError("import-key-error", e.message);
  }
});

$("btn-add-network-submit").addEventListener("click", async () => {
  hideError("add-network-error");
  try {
    const network = {
      name: $("net-name").value,
      chainId: Number($("net-chainid").value),
      rpcUrls: [$("net-rpc").value],
      nativeCurrency: { name: $("net-symbol").value, symbol: $("net-symbol").value, decimals: 18 },
      blockExplorer: $("net-explorer").value,
      swapRouter: $("net-router").value || null,
      swapLabel: $("net-router").value ? "Custom (user-verified)" : null,
    };
    await sendMsg("TM_ADD_NETWORK", { network });
    await refreshMain();
    showScreen("screen-main");
  } catch (e) {
    showError("add-network-error", e.message);
  }
});

$("btn-view-seed-submit").addEventListener("click", async () => {
  hideError("view-seed-error");
  try {
    const res = await sendMsg("TM_EXPORT_MNEMONIC", { password: $("view-seed-password").value });
    $("view-seed-display").textContent = res.mnemonic;
    $("view-seed-display").classList.remove("hidden");
  } catch (e) {
    showError("view-seed-error", e.message);
  }
});

// ---------------------------------------------------------------- SEND
$("send-asset-select").addEventListener("change", (e) => {
  $("send-token-address").classList.toggle("hidden", e.target.value !== "token");
});

$("btn-send-submit").addEventListener("click", async () => {
  hideError("send-error");
  $("send-status").classList.add("hidden");
  try {
    const to = $("send-to").value.trim();
    const amountStr = $("send-amount").value.trim();
    if (!ethers.utils.isAddress(to)) throw new Error(TM_I18N.t("send.invalidRecipient"));
    let res;
    if ($("send-asset-select").value === "native") {
      const amountWei = ethers.utils.parseEther(amountStr || "0");
      res = await sendMsg("TM_SEND_NATIVE", { to, amountWei: amountWei.toString() });
    } else {
      const tokenAddress = $("send-token-address").value.trim();
      if (!ethers.utils.isAddress(tokenAddress)) throw new Error(TM_I18N.t("send.invalidTokenAddress"));
      const info = await sendMsg("TM_GET_TOKEN_BALANCE", { address: currentStatus.selectedAddress, tokenAddress });
      const amountWei = ethers.utils.parseUnits(amountStr || "0", info.decimals);
      res = await sendMsg("TM_SEND_TOKEN", { to, tokenAddress, amountWei: amountWei.toString() });
    }
    $("send-status").textContent = TM_I18N.t("send.sentStatus", { txHash: res.txHash });
    $("send-status").classList.remove("hidden");
    const sentAsset = $("send-asset-select").value === "native" ? (currentNetwork && currentNetwork.nativeCurrency.symbol) || "" : "token";
    recordActivity({ amount: amountStr, asset: sentAsset, to, txHash: res.txHash });
    await refreshBalance();
  } catch (e) {
    showError("send-error", e.message);
  }
});

// ---------------------------------------------------------------- SWAP
function setupSwapScreen() {
  hideError("swap-error");
  $("swap-status").classList.add("hidden");
  $("swap-quote-display").classList.add("hidden");
  const unsupported = !currentNetwork.swapRouter;
  $("swap-unsupported").classList.toggle("hidden", !unsupported);
  $("swap-form").classList.toggle("hidden", unsupported);
}

$("btn-swap-quote").addEventListener("click", async () => {
  hideError("swap-error");
  try {
    const tokenIn = $("swap-from-custom").value.trim() || TM_NATIVE();
    const tokenOut = $("swap-to-custom").value.trim() || TM_NATIVE();
    const amountStr = $("swap-amount-in").value.trim();
    let decimalsIn = 18;
    if (tokenIn !== TM_NATIVE()) {
      const info = await sendMsg("TM_GET_TOKEN_BALANCE", { address: currentStatus.selectedAddress, tokenAddress: tokenIn });
      decimalsIn = info.decimals;
    }
    // This is the TOTAL amount the user is putting in -- the app fee comes
    // off the top of this before anything is swapped (see TM_SWAP_QUOTE in
    // background.js / lib/fee-config.js).
    const totalAmountInWei = ethers.utils.parseUnits(amountStr || "0", decimalsIn);
    const quote = await sendMsg("TM_SWAP_QUOTE", { tokenIn, tokenOut, amountInWei: totalAmountInWei.toString() });

    let decimalsOut = 18;
    if (tokenOut !== TM_NATIVE()) {
      const info = await sendMsg("TM_GET_TOKEN_BALANCE", { address: currentStatus.selectedAddress, tokenAddress: tokenOut });
      decimalsOut = info.decimals;
    }
    $("swap-fee-line").textContent = TM_I18N.t("swap.appFeeLine", {
      percent: quote.feePercentLabel,
      amount: ethers.utils.formatUnits(quote.feeWei, decimalsIn),
    });
    $("swap-net-line").textContent = TM_I18N.t("swap.netAmountLine", {
      amount: ethers.utils.formatUnits(quote.netAmountInWei, decimalsIn),
    });
    $("swap-quote-line").textContent = TM_I18N.t("swap.estimatedOutLine", {
      amount: ethers.utils.formatUnits(quote.amountOutWei, decimalsOut),
    });
    $("swap-quote-display").dataset.tokenIn = tokenIn;
    $("swap-quote-display").dataset.tokenOut = tokenOut;
    $("swap-quote-display").dataset.totalAmountInWei = totalAmountInWei.toString();
    $("swap-quote-display").dataset.netAmountInWei = quote.netAmountInWei;

    // Router allowance only ever needs to cover the NET amount -- the fee
    // portion moves as a separate plain transfer, never through the router.
    $("btn-swap-approve").classList.add("hidden");
    if (tokenIn !== TM_NATIVE()) {
      const allowanceRes = await sendMsg("TM_SWAP_ALLOWANCE", { tokenAddress: tokenIn });
      if (ethers.BigNumber.from(allowanceRes.allowanceWei).lt(quote.netAmountInWei)) {
        $("btn-swap-approve").classList.remove("hidden");
      }
    }
    $("swap-quote-display").classList.remove("hidden");
  } catch (e) {
    showError("swap-error", e.message);
  }
});

$("btn-swap-approve").addEventListener("click", async () => {
  hideError("swap-error");
  try {
    const tokenIn = $("swap-quote-display").dataset.tokenIn;
    const netAmountInWei = $("swap-quote-display").dataset.netAmountInWei;
    $("swap-status").textContent = TM_I18N.t("swap.approvingStatus");
    $("swap-status").classList.remove("hidden");
    await sendMsg("TM_SWAP_APPROVE", { tokenAddress: tokenIn, amountWei: netAmountInWei });
    $("swap-status").textContent = TM_I18N.t("swap.approvedStatus");
    $("btn-swap-approve").classList.add("hidden");
  } catch (e) {
    showError("swap-error", e.message);
  }
});

$("btn-swap-execute").addEventListener("click", async () => {
  hideError("swap-error");
  try {
    const tokenIn = $("swap-quote-display").dataset.tokenIn;
    const tokenOut = $("swap-quote-display").dataset.tokenOut;
    const totalAmountInWei = $("swap-quote-display").dataset.totalAmountInWei;
    const slippageBps = Number($("swap-slippage").value);
    $("swap-status").textContent = TM_I18N.t("swap.sendingStatus");
    $("swap-status").classList.remove("hidden");
    const res = await sendMsg("TM_SWAP_EXECUTE", { tokenIn, tokenOut, amountInWei: totalAmountInWei, slippageBps });
    $("swap-status").textContent = TM_I18N.t("swap.swappedStatus", { feeTx: res.feeTxHash || TM_I18N.t("swap.feeTxNa"), tx: res.txHash });
    await refreshBalance();
  } catch (e) {
    showError("swap-error", e.message);
  }
});

function TM_NATIVE() { return "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; }

// ---------------------------------------------------------------- APPROVAL MODE
async function initApprovalFlow(requestId) {
  let pending;
  try {
    pending = await sendMsg("TM_GET_PENDING_REQUEST", { requestId });
  } catch (e) {
    document.body.innerHTML = `<div class="screen"><p class="error">${e.message}</p></div>`;
    return;
  }

  const status = await sendMsg("TM_GET_STATUS");
  if (!status.unlocked) {
    $("approve-origin-locked").textContent = TM_I18N.t("approve.unlockOriginText", { origin: pending.origin });
    showScreen("screen-approve-locked");
    $("btn-approve-unlock").addEventListener("click", async () => {
      hideError("approve-unlock-error");
      try {
        await sendMsg("TM_UNLOCK", { password: $("approve-unlock-password").value });
        renderApproval(requestId, pending);
      } catch (e) {
        showError("approve-unlock-error", e.message);
      }
    });
    return;
  }
  renderApproval(requestId, pending);
}

async function respondApproval(requestId, approved, result, error) {
  await sendMsg("TM_APPROVAL_RESPONSE", { requestId, approved, result, error });
  window.close();
}

async function renderApproval(requestId, pending) {
  const { type, payload } = pending;

  if (type === "connect") {
    const status = await sendMsg("TM_GET_STATUS");
    $("approve-connect-wants").innerHTML = TM_I18N.t("approve.connectWantsText", {
      origin: `<span class="mono">${escapeHtml(payload.origin)}</span>`,
    });
    $("approve-connect-address").textContent = status.selectedAddress || (status.accounts[0] && status.accounts[0].address) || "";
    showScreen("screen-approve-connect");
    $("btn-approve-connect-accept").onclick = () =>
      respondApproval(requestId, true, { address: $("approve-connect-address").textContent });
    $("btn-approve-connect-reject").onclick = () => respondApproval(requestId, false, null, "User rejected connection.");
  } else if (type === "transaction") {
    $("approve-tx-origin").textContent = payload.origin;
    $("approve-tx-to").textContent = payload.tx.to || TM_I18N.t("approve.contractCreation");
    let valueDisplay = "0";
    try { valueDisplay = ethers.utils.formatEther(payload.tx.value || "0x0") + TM_I18N.t("approve.nativeSuffix"); } catch (e) {}
    $("approve-tx-value").textContent = valueDisplay;
    $("approve-tx-data").textContent = payload.tx.data || "0x";
    showScreen("screen-approve-tx");
    $("btn-approve-tx-accept").onclick = () => respondApproval(requestId, true, true);
    $("btn-approve-tx-reject").onclick = () => respondApproval(requestId, false, null, "User rejected transaction.");
  } else if (type === "sign") {
    $("approve-sign-origin").textContent = payload.origin;
    let display = payload.message;
    try {
      if (ethers.utils.isHexString(payload.message)) display = ethers.utils.toUtf8String(payload.message);
    } catch (e) { /* leave as raw hex if not valid utf8 */ }
    $("approve-sign-message").textContent = display;
    showScreen("screen-approve-sign");
    $("btn-approve-sign-accept").onclick = () => respondApproval(requestId, true, true);
    $("btn-approve-sign-reject").onclick = () => respondApproval(requestId, false, null, "User rejected signature.");
  } else if (type === "signTypedData") {
    $("approve-sign-origin").textContent = payload.origin;
    $("approve-sign-message").textContent = JSON.stringify(payload.typedData, null, 2);
    showScreen("screen-approve-sign");
    $("btn-approve-sign-accept").onclick = () => respondApproval(requestId, true, true);
    $("btn-approve-sign-reject").onclick = () => respondApproval(requestId, false, null, "User rejected signature.");
  } else if (type === "addNetwork") {
    $("approve-addnet-origin").textContent = payload.origin;
    $("approve-addnet-details").innerHTML = `
      <div><span class="muted">${TM_I18N.t("approve.addNetNameLabel")}</span> ${escapeHtml(payload.name)}</div>
      <div><span class="muted">${TM_I18N.t("approve.addNetChainIdLabel")}</span> ${escapeHtml(payload.chainId)}</div>
      <div><span class="muted">${TM_I18N.t("approve.addNetRpcLabel")}</span> <span class="mono small">${escapeHtml((payload.rpcUrls || []).join(", "))}</span></div>
    `;
    showScreen("screen-approve-addnetwork");
    $("btn-approve-addnet-accept").onclick = async () => {
      try {
        await sendMsg("TM_ADD_NETWORK", { network: payload });
        await respondApproval(requestId, true, true);
      } catch (e) {
        alert(e.message);
      }
    };
    $("btn-approve-addnet-reject").onclick = () => respondApproval(requestId, false, null, "User rejected adding network.");
  }
}

// ---------------------------------------------------------------- SUPPORT
let supportReturnScreen = "screen-main";
let supportOpenedOnce = false;

function addSupportMessage(text, sender) {
  const log = $("support-log");
  const bubble = document.createElement("div");
  bubble.className = `support-msg ${sender}`;
  bubble.textContent = text;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
}

function renderSupportChips() {
  const chipsEl = $("support-chips");
  chipsEl.innerHTML = "";
  TM_I18N.getChips().forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "support-chip";
    btn.type = "button";
    btn.textContent = c.chip;
    btn.addEventListener("click", () => askSupport(c.chip, c.id));
    chipsEl.appendChild(btn);
  });
}

function askSupport(displayText, knownEntryId) {
  addSupportMessage(displayText, "user");
  const entry = knownEntryId ? TM_I18N.findFaqById(knownEntryId) : TM_I18N.findBestAnswer(displayText);
  const answer = TM_I18N.answerTextFor(entry);
  addSupportMessage(answer, "bot");
}

function openSupport(returnScreen) {
  supportReturnScreen = returnScreen;
  if (!supportOpenedOnce) {
    supportOpenedOnce = true;
    renderSupportChips();
    addSupportMessage(TM_I18N.getGreeting(), "bot");
  }
  showScreen("screen-support");
  $("support-input").focus();
}

$("btn-support-back").addEventListener("click", () => {
  showScreen(supportReturnScreen);
  if (supportReturnScreen === "screen-main") refreshMain();
});

$("btn-support-send").addEventListener("click", () => {
  const input = $("support-input");
  const text = input.value.trim();
  if (!text) return;
  askSupport(text, null);
  input.value = "";
});

$("support-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("btn-support-send").click();
  }
});

// ---------------------------------------------------------------- LANGUAGE
// A flag is a stand-in for the country most associated with each language,
// not a claim that the language belongs to only that place (there's no
// single flag for Arabic or English) -- this is the same convention almost
// every app's language picker uses, just to make the list scannable.
//
// This used to be a plain <select> with a Unicode flag-emoji character
// (Regional Indicator Symbol pairs) prepended to each option's text. That
// works fine in the app's own rendered text, but a native <select>'s
// dropdown popup is drawn by the OS/browser, not by us -- and a lot of
// Android devices ship without the color-emoji flag glyphs installed, so
// the popup falls back to showing the two raw letters ("US", "ES", ...)
// instead of a flag picture, which is exactly the confusing thing a flag
// was supposed to avoid. Real <img> flags fix that everywhere, but a
// native <option> can't contain an <img> in any browser -- so each
// ".language-select" element is progressively enhanced here into a small
// custom dropdown (a button showing the current flag+name, and a listbox
// of flag+name rows) while the original <select> stays in the DOM, hidden,
// purely as the value-holder every other bit of code already reads/writes.
function populateLanguageSelects() {
  document.querySelectorAll(".language-select").forEach((sel) => {
    let wrap = sel.parentNode.classList && sel.parentNode.classList.contains("lang-picker") ? sel.parentNode : null;
    let trigger, list;

    if (!wrap) {
      wrap = document.createElement("span");
      wrap.className = "lang-picker";
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);

      // Move the select's id (e.g. "language-select-header") onto the
      // trigger so any CSS or labeling keyed off that id keeps applying to
      // the thing that's actually visible now.
      trigger = document.createElement("button");
      trigger.type = "button";
      if (sel.id) { trigger.id = sel.id; sel.removeAttribute("id"); }
      if (sel.title) trigger.title = sel.title;
      if (sel.getAttribute("aria-label")) trigger.setAttribute("aria-label", sel.getAttribute("aria-label"));
      trigger.className = "lang-picker-trigger";
      trigger.innerHTML = '<img class="lang-flag" alt="" /><span class="lang-name"></span><span class="lang-caret" aria-hidden="true">▾</span>';
      wrap.appendChild(trigger);

      sel.classList.add("lang-picker-native-hidden");
      sel.setAttribute("tabindex", "-1");
      sel.setAttribute("aria-hidden", "true");

      list = document.createElement("ul");
      list.className = "lang-picker-list hidden";
      list.setAttribute("role", "listbox");
      wrap.appendChild(list);

      trigger.addEventListener("click", () => {
        const willOpen = list.classList.contains("hidden");
        document.querySelectorAll(".lang-picker-list").forEach((l) => l.classList.add("hidden"));
        if (willOpen) list.classList.remove("hidden");
      });
      if (!document.body.dataset.langPickerOutsideClick) {
        document.body.dataset.langPickerOutsideClick = "1";
        document.addEventListener("click", (e) => {
          if (!e.target.closest(".lang-picker")) {
            document.querySelectorAll(".lang-picker-list").forEach((l) => l.classList.add("hidden"));
          }
        });
      }
    } else {
      trigger = wrap.querySelector(".lang-picker-trigger");
      list = wrap.querySelector(".lang-picker-list");
    }

    const updateTrigger = (code) => {
      const lang = TM_I18N.LANGS.find((l) => l.code === code) || TM_I18N.LANGS[0];
      trigger.querySelector(".lang-flag").src = `img/flag-${lang.code}.svg`;
      trigger.querySelector(".lang-name").textContent = lang.name;
      list.querySelectorAll(".lang-picker-item").forEach((it) => it.classList.toggle("active", it.dataset.code === lang.code));
    };

    sel.innerHTML = "";
    list.innerHTML = "";
    TM_I18N.LANGS.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = lang.name;
      sel.appendChild(opt);

      const item = document.createElement("li");
      item.className = "lang-picker-item";
      item.setAttribute("role", "option");
      item.dataset.code = lang.code;
      item.innerHTML = `<img class="lang-flag" src="img/flag-${lang.code}.svg" alt="" /><span>${lang.name}</span>`;
      item.addEventListener("click", () => {
        sel.value = lang.code;
        TM_I18N.setLanguage(lang.code);
        updateTrigger(lang.code);
        list.classList.add("hidden");
      });
      list.appendChild(item);
    });

    sel.value = TM_I18N.getLanguage();
    updateTrigger(sel.value);
  });
}

function populateCurrencySelect() {
  const sel = $("currency-select-settings");
  sel.innerHTML = "";
  Object.keys(TM_PRICES.SUPPORTED_CURRENCIES).forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${TM_PRICES.SUPPORTED_CURRENCIES[code].symbol} ${TM_PRICES.SUPPORTED_CURRENCIES[code].label}`;
    sel.appendChild(opt);
  });
  sel.value = currentCurrency;
  sel.addEventListener("change", async (e) => {
    currentCurrency = e.target.value;
    chrome.storage.local.set({ [TM_CURRENCY_KEY]: currentCurrency });
    // Re-render whatever's currently showing a price so the switch feels
    // immediate rather than waiting for the next natural refresh.
    if (currentStatus && currentStatus.unlocked) {
      refreshBalanceUsd();
      refreshTokens();
      if (!$("screen-prices").classList.contains("hidden")) refreshPrices();
      refreshMainPricesCard();
    }
  });
}

document.addEventListener("tm-language-changed", () => {
  // Re-render already-rendered dynamic text that data-i18n's static markup
  // scan can't reach: the network dropdown's per-option "(swap unavailable)"
  // suffix, and the support chat's topic chips if that screen has been
  // opened already. Past chat messages intentionally stay in whatever
  // language they were sent/answered in, like a real chat history would.
  if (currentNetworks && currentNetworks.length && currentNetwork) {
    const netSel = $("network-select");
    Array.from(netSel.options).forEach((opt) => {
      const n = currentNetworks.find((net) => String(net.chainId) === opt.value);
      if (n) opt.textContent = n.name + (n.swapRouter ? "" : TM_I18N.t("addToken.swapUnavailableSuffix"));
    });
  }
  if ($("support-chips") && $("support-chips").children.length) renderSupportChips();
});

// ---------------------------------------------------------------- SPLASH
// Every popup open is a fresh page load in MV3 (there's no persistent
// in-memory app to keep running between opens), so this brief branded
// splash -- the ETH/trading-dashboard artwork the user chose, playing
// the role MetaMask's fox animation plays -- shows once per open, then
// fades into whichever real screen (onboarding/unlock/main) is next.
// It's skipped for the small "approve" popup windows dapps trigger,
// where an instant utility feel matters more than a brand moment.
const SPLASH_MIN_MS = 900;
const splashStartedAt = Date.now();
let splashAutoTimers = [];
function clearSplashAutoTimers() {
  splashAutoTimers.forEach((id) => clearTimeout(id));
  splashAutoTimers = [];
}
function hideSplash() {
  const el = $("splash-screen");
  if (!el || el.dataset.hidden) return;
  el.dataset.hidden = "1";
  clearSplashAutoTimers();
  el.classList.add("splash-hide");
  setTimeout(() => el.remove(), 450);
}
// Safety net: never let a startup error leave the splash covering the
// whole popup indefinitely. Cleared by activateSplashHome() -- once the
// splash is deliberately left up as the real landing screen, there's no
// "stuck" state to guard against, and this would otherwise yank it away
// out from under someone still looking at it.
splashAutoTimers.push(setTimeout(hideSplash, 4000));

// When a wallet already exists and is unlocked, the splash (the user's own
// dashboard artwork) stops being a timed brand flash and becomes the real
// landing screen: screen-main is already prepared underneath, and these
// four tabs -- matching the reference image's own bottom nav -- are how
// the user moves forward from here, instead of an auto-fade.
let splashHomeActivated = false;
function activateSplashHome() {
  if (splashHomeActivated) return;
  splashHomeActivated = true;
  clearSplashAutoTimers();
  const el = $("splash-screen");
  if (el) el.classList.add("splash-home");
  $("splash-tab-home").addEventListener("click", () => hideSplash());
  $("splash-tab-assets").addEventListener("click", () => {
    hideSplash();
    showScreen("screen-main");
    const tokensHeader = document.querySelector("#screen-main .tokens-header");
    if (tokensHeader) tokensHeader.scrollIntoView({ block: "start" });
  });
  $("splash-tab-activity").addEventListener("click", () => {
    hideSplash();
    renderActivity();
    showScreen("screen-activity");
  });
  $("splash-tab-send").addEventListener("click", () => {
    hideSplash();
    showScreen("screen-send");
  });
}

// ---------------------------------------------------------------- ACTIVITY
// A small, honest local log -- not a real blockchain history (that would
// need an explorer/indexer API and its own set of tradeoffs), just a
// ---------------------------------------------------------------- WALLETCONNECT
async function renderWcSessions() {
  hideError("wc-error");
  $("wc-status").classList.add("hidden");
  let res;
  try {
    res = await sendMsg("TM_WC_GET_SESSIONS");
  } catch (e) {
    showError("wc-error", e.message);
    return;
  }
  $("wc-not-configured").classList.toggle("hidden", !!res.configured);
  const root = $("wc-sessions-list");
  root.innerHTML = "";
  const sessions = res.sessions || [];
  $("wc-sessions-empty").classList.toggle("hidden", sessions.length > 0);
  sessions.forEach((s) => {
    const row = document.createElement("div");
    row.className = "activity-entry";
    const icon = document.createElement("span");
    icon.className = "account-identicon";
    icon.style.width = "32px";
    icon.style.height = "32px";
    icon.innerHTML = TM_IDENTICON.svgFor(s.topic, 32);
    const body = document.createElement("div");
    body.className = "activity-body";
    const main = document.createElement("div");
    main.className = "activity-main";
    main.textContent = s.name;
    const sub = document.createElement("div");
    sub.className = "activity-sub";
    sub.textContent = s.url;
    body.appendChild(main);
    body.appendChild(sub);
    const disconnectBtn = document.createElement("button");
    disconnectBtn.className = "secondary small";
    disconnectBtn.textContent = TM_I18N.t("wc.disconnectBtn");
    disconnectBtn.onclick = async () => {
      disconnectBtn.disabled = true;
      try {
        await sendMsg("TM_WC_DISCONNECT", { topic: s.topic });
        renderWcSessions();
      } catch (e) {
        showError("wc-error", e.message);
        disconnectBtn.disabled = false;
      }
    };
    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(disconnectBtn);
    root.appendChild(row);
  });
}

$("btn-wc-connect").addEventListener("click", async () => {
  hideError("wc-error");
  const uri = $("wc-uri-input").value.trim();
  if (!uri.startsWith("wc:")) {
    showError("wc-error", TM_I18N.t("wc.invalidUri"));
    return;
  }
  $("btn-wc-connect").disabled = true;
  $("wc-status").textContent = TM_I18N.t("wc.pairingStatus");
  $("wc-status").classList.remove("hidden");
  try {
    await sendMsg("TM_WC_PAIR", { uri });
    $("wc-uri-input").value = "";
    $("wc-status").textContent = TM_I18N.t("wc.pairedStatus");
  } catch (e) {
    $("wc-status").classList.add("hidden");
    showError("wc-error", e.message);
  } finally {
    $("btn-wc-connect").disabled = false;
  }
});

// ---------------------------------------------------------------- ADDRESS BOOK
// Saved name+address pairs, kept locally (chrome.storage.local) -- lets a
// Send default to picking a known recipient instead of retyping/pasting an
// address every time, the same convenience Binance/most wallets call an
// "address book". Nothing here is ever sent anywhere.
const TM_CONTACTS_KEY = "tm_contacts";
let contactsReturnScreen = "screen-settings";
let contactsPickerMode = false;

function getContacts() {
  return new Promise((resolve) => {
    chrome.storage.local.get([TM_CONTACTS_KEY], (res) => {
      resolve(Array.isArray(res[TM_CONTACTS_KEY]) ? res[TM_CONTACTS_KEY] : []);
    });
  });
}

function saveContacts(list) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [TM_CONTACTS_KEY]: list }, resolve);
  });
}

function openContacts(returnScreen, pickerMode) {
  contactsReturnScreen = returnScreen;
  contactsPickerMode = !!pickerMode;
  $("contacts-picker-hint").classList.toggle("hidden", !contactsPickerMode);
  hideError("contacts-error");
  showScreen("screen-contacts");
  renderContacts();
}

async function renderContacts() {
  const contacts = await getContacts();
  const root = $("contacts-list");
  root.innerHTML = "";
  $("contacts-empty").classList.toggle("hidden", contacts.length > 0);
  contacts.forEach((c, index) => {
    const row = document.createElement("div");
    row.className = "activity-entry";
    if (contactsPickerMode) row.classList.add("contact-row-pickable");
    const icon = document.createElement("span");
    icon.className = "account-identicon";
    icon.style.width = "32px";
    icon.style.height = "32px";
    icon.innerHTML = TM_IDENTICON.svgFor(c.address, 32);
    const body = document.createElement("div");
    body.className = "activity-body";
    const main = document.createElement("div");
    main.className = "activity-main";
    main.textContent = c.name;
    const sub = document.createElement("div");
    sub.className = "activity-sub";
    sub.textContent = c.address;
    body.appendChild(main);
    body.appendChild(sub);
    if (contactsPickerMode) {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        $("send-to").value = c.address;
        $("send-to").dispatchEvent(new Event("input"));
        showScreen(contactsReturnScreen);
      });
    }
    const removeBtn = document.createElement("button");
    removeBtn.className = "secondary small";
    removeBtn.textContent = TM_I18N.t("contacts.removeBtn");
    removeBtn.onclick = async (e) => {
      e.stopPropagation();
      const updated = (await getContacts()).filter((_, i) => i !== index);
      await saveContacts(updated);
      renderContacts();
    };
    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(removeBtn);
    root.appendChild(row);
  });
}

$("btn-goto-contacts").addEventListener("click", () => openContacts("screen-settings", false));
$("btn-open-contacts").addEventListener("click", () => openContacts("screen-send", true));
$("btn-contacts-back").addEventListener("click", () => showScreen(contactsReturnScreen));

$("btn-contact-add").addEventListener("click", async () => {
  hideError("contacts-error");
  const name = $("contact-name-input").value.trim();
  const address = $("contact-address-input").value.trim();
  if (!name) {
    showError("contacts-error", TM_I18N.t("contacts.nameRequired"));
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    showError("contacts-error", TM_I18N.t("contacts.invalidAddress"));
    return;
  }
  const contacts = await getContacts();
  contacts.push({ name, address });
  await saveContacts(contacts);
  $("contact-name-input").value = "";
  $("contact-address-input").value = "";
  renderContacts();
});

// record of sends made from this device, kept in chrome.storage.local.
const TM_ACTIVITY_KEY = "tm_activity";
const TM_ACTIVITY_MAX = 50;
function recordActivity(entry) {
  chrome.storage.local.get([TM_ACTIVITY_KEY], (res) => {
    const list = Array.isArray(res[TM_ACTIVITY_KEY]) ? res[TM_ACTIVITY_KEY] : [];
    list.unshift({ ...entry, ts: Date.now() });
    chrome.storage.local.set({ [TM_ACTIVITY_KEY]: list.slice(0, TM_ACTIVITY_MAX) });
  });
}
function renderActivity() {
  chrome.storage.local.get([TM_ACTIVITY_KEY], (res) => {
    const list = Array.isArray(res[TM_ACTIVITY_KEY]) ? res[TM_ACTIVITY_KEY] : [];
    const root = $("activity-list");
    root.innerHTML = "";
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = TM_I18N.t("activity.empty");
      root.appendChild(p);
      return;
    }
    list.forEach((item) => {
      const card = document.createElement("div");
      card.className = "activity-entry";

      // Directional icon -- every entry here is an outgoing send (this log
      // has no incoming/receive tracking yet), shown the same way MetaMask
      // marks a send: a small circular badge with an up-right arrow.
      const icon = document.createElement("span");
      icon.className = "activity-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>";

      const body = document.createElement("div");
      body.className = "activity-body";

      const top = document.createElement("div");
      top.className = "activity-top";
      const main = document.createElement("div");
      main.className = "activity-main";
      main.textContent = TM_I18N.t("activity.sentLabel", { amount: item.amount, asset: item.asset });
      const status = document.createElement("span");
      status.className = "activity-status";
      status.textContent = TM_I18N.t("activity.statusSent");
      top.appendChild(main);
      top.appendChild(status);

      const sub = document.createElement("div");
      sub.className = "activity-sub";
      sub.textContent = TM_I18N.t("activity.toLabel", { address: item.to });
      const time = document.createElement("div");
      time.className = "activity-time";
      time.textContent = new Date(item.ts).toLocaleString();

      body.appendChild(top);
      body.appendChild(sub);
      body.appendChild(time);

      card.appendChild(icon);
      card.appendChild(body);
      root.appendChild(card);
    });
  });
}

// ---------------------------------------------------------------- ENTRY POINT
(async function init() {
  await TM_I18N.initLanguage();
  populateLanguageSelects();
  await loadWatchlist();
  await loadCurrency();
  populateCurrencySelect();

  const params = new URLSearchParams(location.search);
  if (params.get("mode") === "approve") {
    hideSplash();
    await initApprovalFlow(params.get("requestId"));
    return;
  }

  showScreen("screen-loading");
  const status = await sendMsg("TM_GET_STATUS");
  if (!status.hasVault) {
    showScreen("screen-onboarding");
    splashAutoTimers.push(setTimeout(hideSplash, Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStartedAt))));
  } else if (!status.unlocked) {
    showScreen("screen-unlock");
    splashAutoTimers.push(setTimeout(hideSplash, Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStartedAt))));
  } else {
    await refreshMain();
    showScreen("screen-main");
    activateSplashHome();
  }
})();
