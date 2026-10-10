// popup/popup.js
// Drives both the normal toolbar popup (onboarding/unlock/wallet/settings)
// and the "approval" mode popup window opened by the background worker when
// a dapp requests something (connect, sign, send, add network).

// ---------------------------------------------------------------- PORTFOLIO TOTAL
// The main screen's hero number used to be just the native coin's USD
// value. MetaMask and Coinbase Wallet both lead with a combined value
// across everything the account holds, so this adds the native balance's
// USD value to all tracked tokens' USD values and shows that combined
// figure as the lead number, with the native amount still visible
// underneath (see .balance-native-row). Native pricing and token pricing
// are two separate best-effort fetches that already run independently
// (refreshBalanceUsd / refreshTokens) -- each reports its own subtotal
// here and whichever finishes updates the combined total, so a slow or
// failed CoinGecko call for one half never blocks the other from showing.
// portfolioGen guards against a stale, slower fetch from a *previous*
// account/network overwriting a newer one after a fast switch.
let portfolioGen = 0;
let portfolioNativeUsd = null; // number | null (null = native price unavailable)
let portfolioTokensUsd = null; // number | null (null = tracked-token fetch failed; 0 = fetched, none priced)

function renderPortfolioTotal() {
  if (portfolioNativeUsd == null && portfolioTokensUsd == null) return showUsdUnavailable();
  const total = (portfolioNativeUsd || 0) + (portfolioTokensUsd || 0);
  document.querySelector(".balance-native-row").classList.remove("balance-lead-fallback");
  $("balance-usd").textContent = formatCurrency(total);
  $("balance-usd").classList.remove("hidden");
  if ($("balance-usd-label")) $("balance-usd-label").classList.remove("hidden");
}

// A real logo (when one is known) is layered on top of the colored-initial
// circle rather than replacing it -- the initials stay in the DOM as a
// built-in fallback, and if the image 404s or the host is unreachable, its
// onerror just removes the <img>, revealing the initials underneath with
// no flash of a broken-image icon. imageUrl is either a URL this app built
// itself from trusted, fixed pieces (see trustWalletLogoUrl below) or came
// back from CoinGecko's own /coins/markets response (see prices.js) -- not
// arbitrary third-party metadata -- so no extra sanitization is needed
// beyond the existing HTML-attribute escaping.
function tokenIconHtml(symbol, imageUrl) {
  const s = String(symbol || "?").trim();
  const initials = escapeHtml((s.slice(0, 2) || "?").toUpperCase());
  const img = imageUrl
    ? `<img class="token-icon-img" src="${escapeHtml(imageUrl)}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  return `<span class="token-icon" style="background:${tokenIconColor(s)}">${initials}${img}</span>`;
}

// Trust Wallet's public, keyless asset repository -- the same free source
// many wallets pull ERC-20 logos from by contract address, no API key or
// backend needed (consistent with the rest of this app). A wrong/missing
// mapping or an unlisted token just means tokenIconHtml's onerror fallback
// kicks in -- never a broken image or a failed render.
const TRUST_WALLET_CHAIN_FOLDER = {
  ethereum: "ethereum",
  base: "base",
  polygon: "polygon",
  bsc: "smartchain",
  arbitrum: "arbitrum",
  optimism: "optimism",
  avalanche: "avalanchec",
  linea: "linea",
  scroll: "scroll",
  zksync: "zksync",
  mantle: "mantle",
  gnosis: "xdai",
  celo: "celo",
};
// This wallet's own launched tokens are never going to show up in a
// third-party asset repo, no matter how long a listing request sits in
// review -- so instead of leaving them permanently stuck on the colored-
// initials fallback, their logos are embedded directly as inline SVG data
// URIs (self-contained, no extra network request, can't 404). Keyed by
// "<networkKey>:<checksummed contract address>".
const CUSTOM_TOKEN_LOGOS = {
  "base:0xCe2DcdD5F60033240aB504C929742Ab9B8d9da07": // NOVA
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2Ij4KICA8ZGVmcz4KICAgIDxyYWRpYWxHcmFkaWVudCBpZD0iYmciIGN4PSI1MCUiIGN5PSI0MiUiIHI9Ijc1JSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiMzYTI0NzIiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI1NSUiIHN0b3AtY29sb3I9IiMyNDE0NTQiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjMTMwYTMwIi8+CiAgICA8L3JhZGlhbEdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJzdGFyIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2ZmZjZkOCIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjQ1JSIgc3RvcC1jb2xvcj0iI2ZmZDc2YSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNlOGE4MzgiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8cmFkaWFsR3JhZGllbnQgaWQ9Imdsb3ciIGN4PSI1MCUiIGN5PSI1MCUiIHI9IjUwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNmZmU5YTgiIHN0b3Atb3BhY2l0eT0iMC41NSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNmZmU5YTgiIHN0b3Atb3BhY2l0eT0iMCIvPgogICAgPC9yYWRpYWxHcmFkaWVudD4KICA8L2RlZnM+CiAgPGNpcmNsZSBjeD0iMTI4IiBjeT0iMTI4IiByPSIxMjgiIGZpbGw9InVybCgjYmcpIi8+CiAgPGNpcmNsZSBjeD0iMTI4IiBjeT0iMTI4IiByPSI5MiIgZmlsbD0idXJsKCNnbG93KSIvPgogIDwhLS0gc21hbGwgZGlzdGFudCBzcGFya2xlcyAtLT4KICA8ZyBmaWxsPSIjZmZmZmZmIj4KICAgIDxjaXJjbGUgY3g9IjcwIiBjeT0iNjYiIHI9IjIuNiIgb3BhY2l0eT0iMC44NSIvPgogICAgPGNpcmNsZSBjeD0iMTkwIiBjeT0iODIiIHI9IjIiIG9wYWNpdHk9IjAuNyIvPgogICAgPGNpcmNsZSBjeD0iMjAwIiBjeT0iMTY4IiByPSIyLjYiIG9wYWNpdHk9IjAuOCIvPgogICAgPGNpcmNsZSBjeD0iNjIiIGN5PSIxODIiIHI9IjIiIG9wYWNpdHk9IjAuNjUiLz4KICAgIDxjaXJjbGUgY3g9IjEyOCIgY3k9IjQ2IiByPSIxLjgiIG9wYWNpdHk9IjAuNiIvPgogIDwvZz4KICA8IS0tIG1haW4gZm91ci1wb2ludCBub3ZhIGJ1cnN0IC0tPgogIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDEyOCwxMjgpIj4KICAgIDxwYXRoIGQ9Ik0wLC03OCBDMTAsLTMwIDE0LC0xNCA2MiwtMTAgQzE0LC02IDEwLDEwIDAsNTggQy0xMCwxMCAtMTQsLTYgLTYyLC0xMCBDLTE0LC0xNCAtMTAsLTMwIDAsLTc4IFoiIGZpbGw9InVybCgjc3RhcikiLz4KICAgIDxwYXRoIGQ9Ik0wLC03OCBDMTAsLTMwIDE0LC0xNCA2MiwtMTAgQzE0LC02IDEwLDEwIDAsNTggQy0xMCwxMCAtMTQsLTYgLTYyLC0xMCBDLTE0LC0xNCAtMTAsLTMwIDAsLTc4IFoiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZjhlNiIgc3Ryb2tlLW9wYWNpdHk9IjAuNCIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICAgIDwhLS0gc21hbGwgY3Jvc3Mgc3BhcmtsZSByb3RhdGVkIGZvciBhIHNlY29uZGFyeSB0d2lua2xlIC0tPgogICAgPGcgdHJhbnNmb3JtPSJyb3RhdGUoNDUpIj4KICAgICAgPHBhdGggZD0iTTAsLTMwIEM0LC0xMiA1LC01IDI0LC00IEM1LC0zIDQsNCAwLDIyIEMtNCw0IC01LC0zIC0yNCwtNCBDLTUsLTUgLTQsLTEyIDAsLTMwIFoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuODUiLz4KICAgIDwvZz4KICA8L2c+Cjwvc3ZnPgo=",
};
function trustWalletLogoUrl(networkKey, address) {
  const folder = TRUST_WALLET_CHAIN_FOLDER[networkKey];
  // No contract address means the native coin (ETH, BNB, POL, ...) -- Trust
  // Wallet keys that by the chain folder's own info/logo.png, not under
  // assets/<address>/ like an ERC-20 token, so it needs its own branch
  // rather than falling through the `!address` check below to nothing.
  if (!address) {
    return folder ? `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/info/logo.png` : null;
  }
  let checksummed;
  try {
    checksummed = ethers.utils.getAddress(address);
  } catch (e) {
    return null;
  }
  const custom = CUSTOM_TOKEN_LOGOS[`${networkKey}:${checksummed}`];
  if (custom) return custom;
  if (!folder) return null;
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${checksummed}/logo.png`;
}

// Persistent tab bar for the cube's three faces (plus the Assets shortcut),
// visible only while a cube face is showing -- its own CSS follows
// #cube-shell's hidden state, same as the cube itself.
(function wireCubeTabbar() {
  const bar = $("cube-tabbar");
  if (!bar) return;
  bar.querySelectorAll(".cube-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const goto = btn.dataset.cubeGoto;
      if (goto === "assets") {
        showScreen("screen-main");
        const tokensHeader = document.querySelector("#screen-main .tokens-header");
        if (tokensHeader) tokensHeader.scrollIntoView({ block: "start" });
      } else if (goto === "1") {
        renderActivity();
        showScreen("screen-activity");
      } else if (goto === "2") {
        setSendSpeed("standard");
        showScreen("screen-send");
        refreshSendFeePreview();
      } else {
        showScreen("screen-main");
      }
    });
  });
})();

// Most errors shown in this app are already this app's OWN plain-language
// text (e.g. "That doesn't look like a valid contract address.") -- those
// pass straight through untouched. The exception is anything that bubbled
// up from ethers/the RPC layer unhandled, which reads like
// `processing response error (body="...", error={...}, code=NETWORK_ERROR,
// version=providers/5.7.2)` -- accurate for debugging, meaningless and
// alarming for someone just trying to check a balance. This maps the
// common cases to a calm, plain-language line, and falls back to a
// generic one for anything else that still looks like a raw technical
// dump rather than a message meant for a person.
// Looks up the translated message at the moment it is shown (so a language
// switch takes effect immediately); falls back to the English default.
function friendlyText(key, fallback) {
  try {
    if (typeof TM_I18N !== "undefined" && TM_I18N.t) {
      const v = TM_I18N.t(key);
      if (v && v !== key) return v;
    }
  } catch (e) { /* fall through to English */ }
  return fallback;
}
const FRIENDLY_ERROR_PATTERNS = [
  { re: /could not detect network|NETWORK_ERROR/i, get text() { return friendlyText("errors.net.unreachable", "Couldn't reach the network. Check your connection and try again."); } },
  { re: /insufficient funds|gas required exceeds allowance|exceeds allowance|max fee per gas less than block base fee/i, get text() { return friendlyText("errors.net.noFunds", "Not enough of this network's coin (ETH on Base) to pay the network fee. Add a small amount and try again."); } },
  { re: /user rejected|ACTION_REJECTED/i, get text() { return friendlyText("errors.net.cancelled", "That request was cancelled."); } },
  { re: /nonce has already been used|nonce too low/i, get text() { return friendlyText("errors.net.nonce", "That transaction couldn't be sent right now -- please try again."); } },
  { re: /replacement (fee|transaction) too low|underpriced/i, get text() { return friendlyText("errors.net.feesChanged", "Network fees just changed -- please try again."); } },
  { re: /timeout|ETIMEDOUT/i, get text() { return friendlyText("errors.net.timeout", "The network took too long to respond. Please try again."); } },
  { re: /rate limit|too many requests|\b429\b/i, get text() { return friendlyText("errors.net.rateLimit", "Too many requests right now -- please wait a moment and try again."); } },
  { re: /call_exception|execution reverted/i, get text() { return friendlyText("errors.net.rejected", "The network rejected this request. Double-check the details and try again."); } },
  { re: /UNPREDICTABLE_GAS_LIMIT|cannot estimate gas/i, get text() { return friendlyText("errors.net.gasEstimate", "The network wouldn't accept this transaction. Check you have enough ETH for the network fee, then try again."); } },
  { re: /invalid response|server_error|processing response error/i, get text() { return friendlyText("errors.net.noResponse", "Couldn't get a response from the network. Please try again."); } },
];
function friendlyErrorMessage(raw) {
  const msg = String(raw == null ? "" : raw);
  for (const { re, text } of FRIENDLY_ERROR_PATTERNS) {
    if (re.test(msg)) return text;
  }
  // Anything else that still looks like a raw technical dump (a JSON-ish
  // blob, an ethers `code=`/`version=providers` tag, very long text) gets a
  // generic fallback instead of being shown as-is; genuinely short,
  // plain-language messages (this app's own thrown errors) pass through.
  const looksTechnical = /code=|version=providers|"jsonrpc"|\{[^}]*\}|event="/i.test(msg) || msg.length > 160;
  return looksTechnical ? friendlyText("errors.net.generic", "Something went wrong talking to the network. Please try again.") : msg;
}

function showError(id, message) {
  const el = $(id);
  el.textContent = friendlyErrorMessage(message);
  el.classList.remove("hidden");
}

document.querySelectorAll(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    showScreen(btn.dataset.back);
    if (btn.dataset.back === "screen-main") refreshMain();
  });
});


// ---------------------------------------------------------------- NATIVE BACK
// The Android app (WebView) calls this when the phone's Back gesture/button is
// used. It returns true if it handled the press (closed a sheet or went back one
// screen) and false if the app is already on a top-level screen, in which case
// the native side sends the app to the background. Safe on the website too.
window.TMNativeBack = function () {
  try {
    const picker = document.getElementById("swap-asset-picker");
    if (picker && !picker.classList.contains("hidden")) { closeAssetPicker(); return true; }
    const sheet = document.getElementById("network-picker-sheet");
    if (sheet && !sheet.classList.contains("hidden")) {
      const closeBtn = document.getElementById("network-picker-close");
      if (closeBtn) { closeBtn.click(); return true; }
    }
    // The 3D cube / globe keep their other faces rendered (just dimmed), so a
    // plain "is it displayed" check would also match the Back button on a face
    // that isn't the one being shown. Only count the active face.
    const visible = (el) => {
      if (!el || el.getClientRects().length === 0) return false;
      const face = el.closest(".cn-face, .gn-face");
      return !face || face.dataset.active === "true";
    };
    const btn = Array.from(document.querySelectorAll(".top-back-btn")).find(visible);
    if (btn) { btn.click(); return true; }
  } catch (e) { /* fall through: let the native side decide */ }
  return false;
};

let currentStatus = null;
let currentNetworks = [];
let currentNetwork = null;

// ---------------------------------------------------------------- USERNAME (this device only)
// A display name chosen when the wallet is created or imported. It is stored only on this device,
// never sent anywhere, and is NOT a credential: the wallet password is what protects the keys.
// It is shown on the unlock screen ("Welcome back, <name>") so the screen reads like a sign-in.
const TM_USERNAME_KEY = "tm_wallet_username";
function cleanUsername(raw) { return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 30); }
function saveWalletUsername(name) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set({ [TM_USERNAME_KEY]: name }, () => resolve()); } catch (e) { resolve(); }
  });
}
function refreshUnlockWelcome() {
  const el = document.getElementById("unlock-welcome");
  if (!el) return;
  try {
    chrome.storage.local.get([TM_USERNAME_KEY], (res) => {
      const name = cleanUsername(res && res[TM_USERNAME_KEY]);
      if (name) { el.textContent = TM_I18N.t("unlock.welcomeBack", { name }); el.classList.remove("hidden"); }
      else { el.textContent = ""; el.classList.add("hidden"); }
    });
  } catch (e) { el.classList.add("hidden"); }
}

// ---------------------------------------------------------------- ONBOARDING
$("btn-goto-create").addEventListener("click", () => showScreen("screen-create"));
$("btn-goto-import").addEventListener("click", () => showScreen("screen-import"));
$("btn-goto-support-onboarding").addEventListener("click", () => openSupport("screen-onboarding"));

$("btn-create-submit").addEventListener("click", async () => {
  const username = cleanUsername($("create-username").value);
  const pw = $("create-password").value;
  const pw2 = $("create-password-confirm").value;
  if (!username) return alert(TM_I18N.t("errors.usernameRequired"));
  if (pw.length < 8) return alert(TM_I18N.t("errors.passwordTooShort"));
  if (pw !== pw2) return alert(TM_I18N.t("errors.passwordMismatch"));
  try {
    const res = await sendMsg("TM_CREATE_WALLET", { password: pw });
    await saveWalletUsername(username);
    $("mnemonic-display").textContent = res.mnemonic;
    $("create-step-password").classList.add("hidden");
    $("create-step-backup").classList.remove("hidden");
  } catch (e) {
    alert(friendlyErrorMessage(e.message));
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
  const username = cleanUsername($("import-username").value);
  const pw = $("import-password").value;
  const pw2 = $("import-password-confirm").value;
  if (!username) return showError("import-error", TM_I18N.t("errors.usernameRequired"));
  if (pw.length < 8) return showError("import-error", TM_I18N.t("errors.passwordTooShort"));
  if (pw !== pw2) return showError("import-error", TM_I18N.t("errors.passwordMismatch"));
  try {
    await sendMsg("TM_IMPORT_MNEMONIC", { mnemonic, password: pw });
    await saveWalletUsername(username);
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
// Watch-only accounts have no private key in this wallet at all -- Send
// and Swap can never work for one, so they're turned off here rather
// than left clickable only to fail with a confusing signing error deeper
// in the flow. Buy still works (it's just an address to receive to).
// Called both after a fresh refreshMain() and after switching accounts in
// the dropdown, since currentStatus.selectedAddress changes in both cases.
function applyWatchOnlyGating() {
  const selectedMeta = (currentStatus.accounts || []).find((a) => a.address === currentStatus.selectedAddress);
  const isWatchOnly = !!selectedMeta && selectedMeta.type === "watch";
  $("watch-only-notice").classList.toggle("hidden", !isWatchOnly);
  $("btn-goto-send").disabled = isWatchOnly;
  $("btn-goto-swap").disabled = isWatchOnly;
  $("btn-goto-sell").disabled = isWatchOnly;
}

async function refreshMain() {
  armAutoLock(); // every path that reaches the main screen is an unlocked session
  currentStatus = await sendMsg("TM_GET_STATUS");
  const netRes = await sendMsg("TM_GET_NETWORKS");
  currentNetworks = netRes.networks;
  currentNetwork = netRes.selected;

  const accSel = $("account-select");
  accSel.innerHTML = "";
  currentStatus.accounts.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.address;
    const watchSuffix = a.type === "watch" ? ` ${TM_I18N.t("main.watchOnlySuffix")}` : "";
    opt.textContent = `${a.name} (${a.address.slice(0, 6)}...${a.address.slice(-4)})${watchSuffix}`;
    if (a.address === currentStatus.selectedAddress) opt.selected = true;
    accSel.appendChild(opt);
  });
  applyWatchOnlyGating();
  // "Add account" (already backed by TM_ADD_ACCOUNT -- see Settings) lived
  // only as a button buried in Settings, easy to miss since the account
  // picker itself never hinted more than one account was possible. Putting
  // it as the dropdown's own last option puts it exactly where MetaMask's
  // account switcher shows it: right where you'd look to add or switch
  // accounts, not off in a separate screen.
  const addAccountOpt = document.createElement("option");
  addAccountOpt.value = ACCOUNT_SELECT_ADD_VALUE;
  addAccountOpt.textContent = TM_I18N.t("main.addAccountOption");
  accSel.appendChild(addAccountOpt);

  $("network-picker-trigger-label").textContent = currentNetwork.name;
  // Only re-render if the sheet's already open (e.g. this refresh came from
  // something else, like adding a custom network) -- openNetworkPicker()
  // always builds it fresh, so there's nothing to keep in sync otherwise.
  if (!$("network-picker-sheet").classList.contains("hidden")) renderNetworkPickerGrid();

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
  if ($("balance-usd-label")) $("balance-usd-label").classList.add("hidden"); // shown once renderPortfolioTotal has a real number
  $("balance-amount").textContent = "";
  $("balance-symbol").textContent = "";
  document.querySelector(".balance-native-row").classList.remove("balance-lead-fallback");
  // Fresh generation for the combined portfolio total (see PORTFOLIO TOTAL
  // above) -- an account/network switch invalidates any total still being
  // computed for the previous one.
  portfolioGen++;
  portfolioNativeUsd = null;
  portfolioTokensUsd = null;
  refreshBalance();
  refreshTokens(); // not awaited -- same reasoning as the balance above
  refreshNfts(); // not awaited -- same reasoning as the balance above
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
    if (currentNetwork) {
      checkForIncomingBalance(
        `${currentStatus.selectedAddress.toLowerCase()}:${currentNetwork.key}:native`,
        bal.balanceWei,
        { decimals: bal.decimals, symbol: bal.symbol, networkName: currentNetwork.name }
      );
    }
  } catch (e) {
    $("balance-amount").textContent = "--";
    // No native amount to base a USD estimate on -- but tracked tokens may
    // still have a value, so let the combined-total renderer decide: it
    // shows a tokens-only total if one's available, or falls back to "--"
    // as the lead number (via showUsdUnavailable) if nothing is.
    portfolioNativeUsd = null;
    renderPortfolioTotal();
    showError("main-error", TM_I18N.t("main.balanceFetchErrorPrefix") + e.message);
  }
}

const ACCOUNT_SELECT_ADD_VALUE = "__add_account__";
$("account-select").addEventListener("change", async (e) => {
  if (e.target.value === ACCOUNT_SELECT_ADD_VALUE) {
    // Picking this option isn't a real account -- reset the dropdown back
    // to whatever's actually selected first (so it doesn't visually sit on
    // "+ Add account" if the derivation below fails), then add the next HD
    // account the same way Settings' "Add account" button always has.
    e.target.value = currentStatus.selectedAddress;
    try {
      await sendMsg("TM_ADD_ACCOUNT", {});
    } catch (err) {
      return showError("main-error", err.message);
    }
    await refreshMain();
    return;
  }
  await sendMsg("TM_SELECT_ACCOUNT", { address: e.target.value });
  currentStatus.selectedAddress = e.target.value;
  $("address-display").textContent = e.target.value;
  updateAccountIdenticon(e.target.value);
  refreshAddressQr();
  applyWatchOnlyGating();
  await refreshBalance();
  await refreshTokens();
});

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// A loose "this looks like a name, not an address" check -- good enough to
// decide whether to attempt an ENS lookup at all. The lookup itself (see
// TM_RESOLVE_NAME in wallet-engine.js) is what actually confirms it.
const NAME_LIKE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// Resolving "vitalik.eth" (or any other ENS name) to an address, the same
// convenience MetaMask and Coinbase Wallet offer -- this app previously
// required pasting a raw 0x address every time. Only ever resolved via
// ethers' own provider.resolveName() (mainnet has a known ENS registry;
// other chains predictably come back empty and the field just behaves as
// an address field, same as before). The resolved address is always shown
// before it's used for anything -- never sent to silently on trust in the
// name alone.
let resolvedNameKey = null; // the exact input text this resolution is for
let resolvedNameAddress = null;
let sendToResolveToken = 0;
let sendToResolveTimer = null;

function currentSendToAddress() {
  const val = $("send-to").value.trim();
  if (ADDRESS_RE.test(val)) return val;
  if (resolvedNameAddress && resolvedNameKey === val) return resolvedNameAddress;
  return null;
}

async function resolveSendToName(name) {
  const myToken = ++sendToResolveToken;
  $("send-to-resolved").classList.remove("hidden");
  $("send-to-resolved").textContent = TM_I18N.t("send.resolvingName", { name });
  try {
    const res = await sendMsg("TM_RESOLVE_NAME", { name });
    if (myToken !== sendToResolveToken) return;
    if (res.address) {
      resolvedNameKey = name;
      resolvedNameAddress = res.address;
      $("send-to-resolved").textContent = TM_I18N.t("send.resolvedName", { address: res.address });
      $("send-to-identicon").innerHTML = TM_IDENTICON.svgFor(res.address, 24);
      $("send-to-identicon").classList.remove("hidden");
    } else {
      resolvedNameKey = null;
      resolvedNameAddress = null;
      $("send-to-resolved").textContent = TM_I18N.t("send.nameNotFound", { name });
    }
  } catch (e) {
    if (myToken !== sendToResolveToken) return;
    resolvedNameKey = null;
    resolvedNameAddress = null;
    $("send-to-resolved").textContent = TM_I18N.t("send.nameResolutionUnsupported");
  } finally {
    if (myToken === sendToResolveToken) refreshSendFeePreview();
  }
}

$("send-to").addEventListener("input", (e) => {
  const el = $("send-to-identicon");
  const val = e.target.value.trim();
  resolvedNameKey = null;
  resolvedNameAddress = null;
  clearTimeout(sendToResolveTimer);
  sendToResolveToken++; // invalidate any in-flight lookup for the previous value

  if (ADDRESS_RE.test(val)) {
    el.innerHTML = TM_IDENTICON.svgFor(val, 24);
    el.classList.remove("hidden");
    $("send-to-resolved").classList.add("hidden");
    $("send-to-resolved").textContent = "";
  } else if (NAME_LIKE_RE.test(val)) {
    el.classList.add("hidden");
    el.innerHTML = "";
    sendToResolveTimer = setTimeout(() => resolveSendToName(val), 500);
  } else {
    el.classList.add("hidden");
    el.innerHTML = "";
    $("send-to-resolved").classList.add("hidden");
    $("send-to-resolved").textContent = "";
  }
});

// ---------------------------------------------------------------- NETWORK PICKER (neon sign sheet)
// The same glowing-sign look approved for the app's six main networks,
// reused here as the actual way you switch networks -- a bottom sheet of
// lit signs instead of a plain <select>. A network the user added
// themselves (TM_ADD_NETWORK) has no hand-drawn icon, so it falls back to
// its first letter in its own hashed dot color (networkDotColor already
// gives every custom network a consistent, distinct color rather than a
// plain "unknown" gray) instead of breaking or being left off the list.
const NETWORK_SIGN_ICONS = {
  ethereum: '<polygon points="140,20 178,60 140,138 102,60" stroke-width="2.5"/><polygon points="140,32 140,126" stroke-width="1.5"/><polygon points="102,60 178,60" stroke-width="1.2" opacity="0.7"/>',
  base: '<defs><linearGradient id="baseHexGrad" x1="0%" y1="50%" x2="100%" y2="50%"><stop offset="0%" stop-color="#4fe0c0"/><stop offset="100%" stop-color="#5c8bff"/></linearGradient></defs><path d="M114,45 L140,30 L166,45 L166,81 L140,96 L114,81 Z" stroke="url(#baseHexGrad)" stroke-width="3"/><circle cx="140" cy="63" r="22" fill="#ffffff" stroke="none"/><line x1="120" y1="65" x2="160" y2="65" stroke="#0f1c33" stroke-width="3.4" stroke-linecap="round"/><circle cx="150" cy="53" r="4.2" fill="#0f1c33" stroke="none"/>',
  polygon: '<path d="M120,50 L140,38 L160,50 L160,74 L140,86 L120,74 Z" stroke-width="2.5"/><path d="M140,50 L152,57 L152,71 L140,78 L128,71 L128,57 Z" stroke-width="2"/>',
  arbitrum: '<path d="M140,36 L118,90 L132,90 L140,68 L148,90 L162,90 Z" stroke-width="2.5"/><path d="M140,36 L152,90" stroke-width="1.5" opacity="0.7"/>',
  bsc: '<rect x="128" y="51" width="24" height="24" transform="rotate(45 140 63)" stroke-width="2.5"/><rect x="136" y="59" width="8" height="8" transform="rotate(45 140 63)" fill="#ffcf5c"/>',
  optimism: '<circle cx="140" cy="63" r="26" stroke-width="3"/><text x="140" y="72" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="30" stroke-width="2.5">O</text>',
};

// The app's own six networks get their approved short marquee labels
// (matching the reference art); anything else -- a custom network the
// user added -- falls back to its real name, sized down and truncated if
// it's long, rather than assuming every network name is a short brand word.
const NETWORK_SIGN_LABELS = {
  ethereum: ["ETHEREUM", "MAINNET"],
  base: ["BASE", ""],
  polygon: ["POLYGON", ""],
  arbitrum: ["ARBITRUM", ""],
  bsc: ["BNB", ""],
  optimism: ["OPTIMISM", ""],
  robinhood: ["ROBINHOOD", "CHAIN"],
  avalanche: ["AVALANCHE", ""],
  monad: ["MONAD", ""],
  linea: ["LINEA", ""],
  scroll: ["SCROLL", ""],
  zksync: ["ZKSYNC", "ERA"],
  mantle: ["MANTLE", ""],
  gnosis: ["GNOSIS", ""],
  celo: ["CELO", ""],
};

function networkSignLabel(network) {
  if (NETWORK_SIGN_LABELS[network.key]) return NETWORK_SIGN_LABELS[network.key];
  let name = (network.name || "?").toUpperCase();
  if (name.length > 20) name = name.slice(0, 19) + "…";
  return [name, ""];
}

function networkSignIconSvg(network) {
  if (NETWORK_SIGN_ICONS[network.key]) return NETWORK_SIGN_ICONS[network.key];
  const letter = (network.name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<circle cx="140" cy="63" r="26" stroke-width="3"/><text x="140" y="74" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="30" stroke-width="2.5">${escapeHtml(letter)}</text>`;
}

function neonSignFontSize(text) {
  const len = text.length;
  if (len <= 6) return 30;
  if (len <= 9) return 24;
  if (len <= 13) return 19;
  return 15;
}

function neonSignSvg(name1, name2, iconSvg, iconColor) {
  const big = neonSignFontSize(name1);
  const small = name2 ? neonSignFontSize(name2) - 4 : 0;
  return `
  <svg viewBox="0 0 280 140" class="network-sign-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="nsGlowCyan" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="nsGlowPink" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="nsGlowIcon" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect x="10" y="10" width="260" height="86" rx="16" fill="none" stroke="#ff5ec4" stroke-width="2.5" filter="url(#nsGlowPink)" opacity="0.9"/>
    <rect x="10" y="10" width="260" height="86" rx="16" fill="none" stroke="#5ef2ff" stroke-width="1.2" opacity="0.9"/>
    <g filter="url(#nsGlowIcon)" opacity="0.95" stroke="${iconColor}" fill="none">${iconSvg}</g>
    <text x="140" y="${name2 ? 42 : 52}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="${big}" letter-spacing="1"
          fill="#aef3ff" stroke="#5ef2ff" stroke-width="1" filter="url(#nsGlowCyan)">${escapeHtml(name1)}</text>${name2 ? `
    <text x="140" y="88" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="${small}" letter-spacing="3"
          fill="#ffc2ea" stroke="#ff5ec4" stroke-width="1" filter="url(#nsGlowPink)">${escapeHtml(name2)}</text>` : ""}
  </svg>`;
}

function closeNetworkPicker() {
  $("network-picker-sheet").classList.add("hidden");
}

function renderNetworkPickerGrid() {
  const grid = $("network-sign-grid");
  grid.innerHTML = "";
  currentNetworks.forEach((n) => {
    const [name1, name2] = networkSignLabel(n);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "network-sign-item" + (currentNetwork && n.chainId === currentNetwork.chainId ? " selected" : "");
    item.setAttribute("aria-label", n.name);
    item.innerHTML =
      neonSignSvg(name1, name2, networkSignIconSvg(n), networkDotColor(n.key)) +
      (n.swapRouter ? "" : `<span class="network-sign-caption">${escapeHtml(TM_I18N.t("addToken.swapUnavailableSuffix"))}</span>`);
    item.addEventListener("click", async () => {
      if (currentNetwork && n.chainId === currentNetwork.chainId) {
        closeNetworkPicker();
        return;
      }
      Array.from(grid.querySelectorAll(".network-sign-item")).forEach((el) => (el.disabled = true));
      try {
        await sendMsg("TM_SELECT_NETWORK", { chainId: n.chainId });
        await refreshMain();
        closeNetworkPicker();
      } catch (e) {
        showError("main-error", e.message);
        Array.from(grid.querySelectorAll(".network-sign-item")).forEach((el) => (el.disabled = false));
      }
    });
    grid.appendChild(item);
  });
}

function openNetworkPicker() {
  renderNetworkPickerGrid();
  $("network-picker-sheet").classList.remove("hidden");
}

$("network-picker-trigger").addEventListener("click", openNetworkPicker);
$("network-picker-close").addEventListener("click", closeNetworkPicker);

$("btn-copy-address").addEventListener("click", () => {
  navigator.clipboard.writeText(currentStatus.selectedAddress || "");
});

$("btn-toggle-qr").addEventListener("click", () => {
  const box = $("address-qr-box");
  const isHidden = box.classList.toggle("hidden"); // true if "hidden" was just added
  $("btn-toggle-qr").textContent = isHidden ? TM_I18N.t("main.showQrBtn") : TM_I18N.t("main.hideQrBtn");
  if (!isHidden) refreshAddressQr();
});

$("btn-settings").addEventListener("click", () => showScreen("screen-settings"));
$("btn-goto-send").addEventListener("click", () => { setSendSpeed("standard"); showScreen("screen-send"); refreshSendFeePreview(); });
$("btn-goto-swap").addEventListener("click", () => { setupSwapScreen(); showScreen("screen-swap"); });
$("btn-goto-prices").addEventListener("click", () => { showScreen("screen-prices"); refreshPrices(); });
$("btn-goto-predictions").addEventListener("click", () => { showScreen("screen-predictions"); refreshPredictions(); });
$("btn-goto-buy").addEventListener("click", () => { setupBuyScreen(); showScreen("screen-buy"); });
$("btn-goto-sell").addEventListener("click", () => { setupSellScreen(); showScreen("screen-sell"); });
$("btn-goto-add-token").addEventListener("click", () => { resetAddTokenScreen(); showScreen("screen-add-token"); });

// ---------------------------------------------------------------- TOKENS
async function refreshTokens() {
  const myGen = portfolioGen;
  let res;
  try {
    res = await sendMsg("TM_GET_TRACKED_TOKEN_BALANCES");
  } catch (e) {
    // best-effort -- don't let this disrupt the rest of the main screen,
    // but the combined portfolio total (see PORTFOLIO TOTAL above) does
    // need to know this half is unavailable rather than silently zero.
    if (myGen === portfolioGen) {
      portfolioTokensUsd = null;
      renderPortfolioTotal();
    }
    return;
  }

  const list = $("tokens-list");
  list.innerHTML = "";
  if (!res.tokens.length) {
    $("tokens-empty").classList.remove("hidden");
    if (myGen === portfolioGen) {
      portfolioTokensUsd = 0;
      renderPortfolioTotal();
    }
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
  // Verified stablecoins with no returned price still get a value (see stablecoinFallbackPrices).
  try {
    const unpriced = res.tokens
      .map((t) => t.address)
      .filter((a) => !prices[a.toLowerCase()] || typeof prices[a.toLowerCase()].price !== "number");
    if (unpriced.length) prices = Object.assign({}, prices, await stablecoinFallbackPrices(unpriced));
  } catch (e) { /* best-effort */ }

  let tokensUsdTotal = 0;
  res.tokens.forEach((t) => {
    if (!t.error && currentNetwork && currentStatus.selectedAddress) {
      checkForIncomingBalance(
        `${currentStatus.selectedAddress.toLowerCase()}:${currentNetwork.key}:${t.address.toLowerCase()}`,
        t.balanceWei,
        { decimals: t.decimals, symbol: t.symbol, networkName: currentNetwork.name }
      );
    }
    const row = document.createElement("div");
    row.className = "token-row";
    const formatted = ethers.utils.formatUnits(t.balanceWei, t.decimals);
    const priceEntry = prices[t.address.toLowerCase()];
    const usdValue = priceEntry && typeof priceEntry.price === "number" ? Number(formatted) * priceEntry.price : 0;
    if (usdValue) tokensUsdTotal += usdValue;
    const usdText = usdValue ? formatCurrency(usdValue) : "";
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

    // The whole row (icon, name, balance) opens the same in-app coin
    // detail screen the Prices tab uses -- same pattern as .price-link
    // there. It already knows how to show "you're holding X" and offer a
    // swap when the symbol matches something in this wallet, so this just
    // wires the missing entry point rather than adding new UI.
    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "token-link";
    const linkLabel = TM_I18N.t("prices.viewCoin", { name: t.name || t.symbol });
    linkBtn.setAttribute("aria-label", linkLabel);
    linkBtn.title = linkLabel;
    linkBtn.insertAdjacentHTML("beforeend", tokenIconHtml(t.symbol, trustWalletLogoUrl(currentNetwork && currentNetwork.key, t.address)));
    linkBtn.appendChild(mainEl);
    linkBtn.appendChild(balEl);
    linkBtn.addEventListener("click", () => {
      const id = TM_PRICES.COINGECKO_IDS[normalizeCoinSymbol(t.symbol)];
      openCoinDetail(
        { symbol: t.symbol, name: t.name || t.symbol, price: priceEntry && typeof priceEntry.price === "number" ? priceEntry.price : null, change24h: null, url: id ? `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}` : null },
        "screen-main"
      );
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "token-remove-btn";
    removeBtn.title = TM_I18N.t("tokens.removeTitle");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await sendMsg("TM_REMOVE_TRACKED_TOKEN", { tokenAddress: t.address });
      await refreshTokens();
    });

    row.appendChild(linkBtn);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });

  if (myGen === portfolioGen) {
    portfolioTokensUsd = tokensUsdTotal;
    renderPortfolioTotal();
  }
}

// ---------------------------------------------------------------- NFTS
// Manually added the same way tokens are (contract address, here plus a
// token ID) rather than auto-detected -- there's no indexer/API-key
// service wired into this app to enumerate "everything this address
// owns," and adding one would break the keyless, no-backend approach every
// other feature here uses. Artwork/name come from the collection's own
// metadata (see wallet-engine.js's sanitizeNftImageUrl/fetchNftMetadataJson)
// and are rendered strictly as an <img src> + textContent -- never
// innerHTML -- since that metadata is written by whoever deployed the NFT
// contract, not by this app.
async function refreshNfts() {
  let res;
  try {
    res = await sendMsg("TM_GET_TRACKED_NFTS");
  } catch (e) {
    return; // best-effort -- don't let this disrupt the rest of the main screen
  }

  const grid = $("nft-grid");
  grid.innerHTML = "";
  if (!res.nfts.length) {
    $("nfts-empty").classList.remove("hidden");
    return;
  }
  $("nfts-empty").classList.add("hidden");

  res.nfts.forEach((n) => {
    const card = document.createElement("div");
    card.className = "nft-card";

    if (n.image) {
      const img = document.createElement("img");
      img.className = "nft-thumb";
      img.src = n.image; // already scheme-checked server-side (http(s) or image data: URI only)
      img.alt = "";
      img.loading = "lazy";
      // A broken/unreachable image link falls back to the same placeholder
      // a metadata fetch failure gets, instead of showing a broken-image icon.
      img.addEventListener("error", () => {
        img.replaceWith(nftThumbFallback());
      });
      card.appendChild(img);
    } else {
      card.appendChild(nftThumbFallback());
    }

    const nameEl = document.createElement("span");
    nameEl.className = "nft-name";
    nameEl.textContent = n.name || (n.error ? TM_I18N.t("nfts.loadError") : `#${n.tokenId}`);
    card.appendChild(nameEl);

    const idEl = document.createElement("span");
    idEl.className = "nft-id";
    idEl.textContent = `#${n.tokenId}`;
    card.appendChild(idEl);

    const removeBtn = document.createElement("button");
    removeBtn.className = "nft-remove-btn";
    removeBtn.title = TM_I18N.t("nfts.removeTitle");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      await sendMsg("TM_REMOVE_TRACKED_NFT", { contractAddress: n.contractAddress, tokenId: n.tokenId });
      await refreshNfts();
    });
    card.appendChild(removeBtn);

    grid.appendChild(card);
  });
}

function nftThumbFallback() {
  const el = document.createElement("div");
  el.className = "nft-thumb-fallback";
  el.textContent = "?";
  return el;
}

function resetAddNftScreen() {
  hideError("add-nft-error");
  $("add-nft-address").value = "";
  $("add-nft-token-id").value = "";
  $("add-nft-preview").classList.add("hidden");
  $("add-nft-preview-image").classList.add("hidden");
  $("add-nft-preview-image").src = "";
  $("add-nft-meta-warning").classList.add("hidden");
  delete $("add-nft-preview").dataset.address;
}

$("btn-goto-add-nft").addEventListener("click", () => { resetAddNftScreen(); showScreen("screen-add-nft"); });

$("btn-nft-lookup").addEventListener("click", async () => {
  hideError("add-nft-error");
  $("add-nft-preview").classList.add("hidden");
  try {
    const address = $("add-nft-address").value.trim();
    const tokenId = $("add-nft-token-id").value.trim();
    if (!ethers.utils.isAddress(address)) throw new Error(TM_I18N.t("addNft.invalidAddress"));
    if (!/^\d+$/.test(tokenId)) throw new Error(TM_I18N.t("addNft.invalidTokenId"));
    const info = await sendMsg("TM_LOOKUP_NFT", { contractAddress: address, tokenId });

    const preview = $("add-nft-preview");
    $("add-nft-name").textContent = info.name || TM_I18N.t("addNft.noName");
    $("add-nft-standard").textContent = info.standard === "erc1155" ? "ERC-1155" : "ERC-721";
    if (info.image) {
      $("add-nft-preview-image").src = info.image;
      $("add-nft-preview-image").classList.remove("hidden");
    } else {
      $("add-nft-preview-image").classList.add("hidden");
    }
    $("add-nft-meta-warning").classList.toggle("hidden", !info.metaError);
    preview.dataset.address = address;
    preview.dataset.tokenId = tokenId;
    preview.dataset.standard = info.standard;
    preview.dataset.name = info.name || "";
    preview.classList.remove("hidden");
  } catch (e) {
    showError("add-nft-error", e.message);
  }
});

$("btn-nft-confirm-add").addEventListener("click", async () => {
  hideError("add-nft-error");
  try {
    const d = $("add-nft-preview").dataset;
    await sendMsg("TM_ADD_TRACKED_NFT", {
      contractAddress: d.address,
      tokenId: d.tokenId,
      standard: d.standard,
      name: d.name,
    });
    await refreshNfts();
    showScreen("screen-main");
  } catch (e) {
    showError("add-nft-error", e.message);
  }
});

// ---- FIND NFTS (auto-detect via this project's own /api/nft-list proxy,
// see nft-api.js) -- a discovery aid on top of the manual add-by-contract
// flow above, not a replacement for it: results here are shown live and
// only added to the tracked list (screen-main's NFTs grid) if the person
// taps "+ Add" on a specific one. Same untrusted-metadata handling as the
// manual flow -- images are rendered strictly as <img src>, text strictly
// as textContent, and wallet-engine.js has already run every image URL
// through its allowlist sanitizer before this ever sees it. ----
let findNftsPageKey = null;
let findNftsAddedKeys = new Set();

function findNftKey(n) { return `${n.contractAddress.toLowerCase()}:${n.tokenId}`; }

async function loadFindNfts(reset) {
  hideError("find-nfts-error");
  if (reset) {
    findNftsPageKey = null;
    findNftsAddedKeys = new Set();
    $("find-nfts-grid").innerHTML = "";
  }
  const status = $("find-nfts-status");
  const moreBtn = $("btn-find-nfts-more");
  moreBtn.classList.add("hidden");
  if (!currentStatus || !currentStatus.selectedAddress) {
    status.textContent = "";
    return;
  }
  status.textContent = TM_I18N.t("findNfts.loading");
  try {
    const res = await sendMsg("TM_GET_NFTS_FOR_OWNER", { owner: currentStatus.selectedAddress, pageKey: findNftsPageKey });
    if (!res.configured) {
      status.textContent = TM_I18N.t("findNfts.notConfigured");
      return;
    }
    if (!res.supported) {
      status.textContent = TM_I18N.t("findNfts.notSupported");
      return;
    }
    if (!res.nfts.length && !$("find-nfts-grid").children.length) {
      status.textContent = TM_I18N.t("findNfts.empty");
      return;
    }
    status.textContent = "";
    renderFindNfts(res.nfts);
    findNftsPageKey = res.pageKey || null;
    moreBtn.classList.toggle("hidden", !findNftsPageKey);
  } catch (e) {
    showError("find-nfts-error", e.message || TM_I18N.t("findNfts.loadError"));
    status.textContent = "";
  }
}

function renderFindNfts(nfts) {
  const grid = $("find-nfts-grid");
  nfts.forEach((n) => {
    const card = document.createElement("div");
    card.className = "nft-card";

    if (n.image) {
      const img = document.createElement("img");
      img.className = "nft-thumb";
      img.src = n.image; // already scheme-checked server-side + client-side (http(s) or image data: URI only)
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => { img.replaceWith(nftThumbFallback()); });
      card.appendChild(img);
    } else {
      card.appendChild(nftThumbFallback());
    }

    const nameEl = document.createElement("span");
    nameEl.className = "nft-name";
    nameEl.textContent = n.name || n.collectionName || `#${n.tokenId}`;
    card.appendChild(nameEl);

    const idEl = document.createElement("span");
    idEl.className = "nft-id";
    idEl.textContent = `#${n.tokenId}`;
    card.appendChild(idEl);

    const addBtn = document.createElement("button");
    addBtn.className = "nft-remove-btn";
    const key = findNftKey(n);
    const alreadyAdded = findNftsAddedKeys.has(key);
    addBtn.textContent = alreadyAdded ? "✓" : "+";
    addBtn.title = alreadyAdded ? TM_I18N.t("findNfts.addedBtn") : TM_I18N.t("findNfts.addBtn");
    addBtn.disabled = alreadyAdded;
    addBtn.addEventListener("click", async () => {
      addBtn.disabled = true;
      try {
        await sendMsg("TM_ADD_TRACKED_NFT", {
          contractAddress: n.contractAddress,
          tokenId: n.tokenId,
          standard: n.standard,
          name: n.name || n.collectionName || "",
        });
        findNftsAddedKeys.add(key);
        addBtn.textContent = "✓";
        addBtn.title = TM_I18N.t("findNfts.addedBtn");
        await refreshNfts();
      } catch (e) {
        addBtn.disabled = false; // e.g. "already in your list" -- let them see the error and retry/ignore
        showError("find-nfts-error", e.message);
      }
    });
    card.appendChild(addBtn);

    grid.appendChild(card);
  });
}

$("btn-find-nfts").addEventListener("click", () => {
  $("find-nfts-grid").innerHTML = "";
  showScreen("screen-find-nfts");
  loadFindNfts(true);
});

$("btn-find-nfts-more").addEventListener("click", () => loadFindNfts(false));

function resetAddTokenScreen() {
  hideError("add-token-error");
  $("add-token-address").value = "";
  $("add-token-preview").classList.add("hidden");
  delete $("add-token-preview").dataset.address;
  renderQuickAddChips(currentNetwork && currentNetwork.chainId, (t) => {
    $("add-token-address").value = t.address;
    $("btn-token-lookup").click();
  });
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
  if ($("balance-usd-label")) $("balance-usd-label").classList.add("hidden");
  document.querySelector(".balance-native-row").classList.add("balance-lead-fallback");
}

async function refreshBalanceUsd() {
  const myGen = portfolioGen;
  if (!currentNetwork) {
    portfolioNativeUsd = null;
    return renderPortfolioTotal();
  }
  try {
    const price = await TM_PRICES.getNativePriceForNetwork(currentNetwork.key, currentCurrency);
    if (myGen !== portfolioGen) return; // a newer refreshMain() has since started
    const amount = Number($("balance-amount").textContent) || 0;
    portfolioNativeUsd = price == null ? null : amount * price;
  } catch (e) {
    // Price lookups are best-effort -- a rate-limited or unreachable
    // CoinGecko shouldn't disrupt the rest of the wallet UI.
    if (myGen !== portfolioGen) return;
    portfolioNativeUsd = null;
  }
  renderPortfolioTotal();
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
      : TM_PRICES.formatMoney(c.price, currentCurrency, { price: true });
  let changeHtml = "";
  if (typeof c.change24h === "number") {
    const cls = c.change24h >= 0 ? "up" : "down";
    const sign = c.change24h >= 0 ? "+" : "";
    changeHtml = `<span class="price-change ${cls}">${sign}${c.change24h.toFixed(2)}%</span>`;
  }
  const starred = isWatchlisted(c.symbol);
  // The whole row (logo, name, price) opens the in-app coin screen; the
  // star is a separate button so pinning a coin doesn't navigate away.
  const linkLabel = TM_I18N.t("prices.viewCoin", { name: c.name });
  row.innerHTML = `
    <button type="button" class="price-link" aria-label="${linkLabel}" title="${linkLabel}"><span class="price-left">${tokenIconHtml(c.symbol, c.image)}<span class="price-id"><span class="price-name">${c.name}</span><span class="price-symbol">${c.symbol}</span></span></span><span class="price-quote"><span class="price-usd">${priceText}</span>${changeHtml}</span></button>
    <button type="button" class="star-btn ${starred ? "starred" : ""}" aria-label="${TM_I18N.t("prices.watchlistToggle")}">${starred ? "★" : "☆"}</button>
  `;
  row.querySelector(".price-link").addEventListener("click", () => {
    openCoinDetail(c, $("screen-prices").classList.contains("hidden") ? "screen-main" : "screen-prices");
  });
  row.querySelector(".star-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleWatchlist(c.symbol);
    row.replaceWith(renderPriceRow(c));
  });
  return row;
}

// Prices screen state: two tabs (crypto coins / fiat currencies) sharing one
// search box. Data is fetched once per refresh and filtered client-side as
// the person types, so searching never triggers another CoinGecko request.
let pricesTab = "crypto";
let pricesBoardData = [];
let pricesRatesData = [];

function renderCurrencyRow(r) {
  const row = document.createElement("div");
  row.className = "price-row";
  const pegSymbol = TM_PRICES.FIAT_STABLECOIN_PEG[r.code.toLowerCase()];
  const nameHtml = `<span class="price-left">${tokenIconHtml(r.code)}<span class="price-id"><span class="price-name">${escapeHtml(r.name)}</span><span class="price-symbol">${escapeHtml(r.code)}</span></span></span>`;
  const quoteHtml = `<span class="price-right"><span class="price-quote"><span class="price-usd">${TM_PRICES.formatMoney(r.rate, currentCurrency, { price: true })}</span></span></span>`;
  if (pegSymbol) {
    // Currencies with a known, well-established pegged stablecoin (see
    // FIAT_STABLECOIN_PEG in lib/prices.js) open that stablecoin's coin-
    // detail screen -- the closest thing to "this currency, as a
    // cryptocurrency". Price/change here start null; openCoinDetail's own
    // loadCoinInfo() fills them in from CoinGecko once the screen opens.
    const linkLabel = TM_I18N.t("prices.viewPeggedCoin", { currency: r.name, name: pegSymbol });
    row.innerHTML = `<button type="button" class="price-link" aria-label="${linkLabel}" title="${linkLabel}">${nameHtml}</button>${quoteHtml}`;
    row.querySelector(".price-link").addEventListener("click", () => {
      openCoinDetail(
        { symbol: pegSymbol, name: pegSymbol, price: null, change24h: null, url: `https://www.coingecko.com/en/coins/${encodeURIComponent(TM_PRICES.COINGECKO_IDS[pegSymbol])}` },
        $("screen-prices").classList.contains("hidden") ? "screen-main" : "screen-prices"
      );
    });
  } else {
    row.innerHTML = nameHtml + quoteHtml;
  }
  return row;
}

function renderPricesList() {
  const list = $("prices-list");
  const q = ($("prices-search").value || "").trim().toLowerCase();
  list.innerHTML = "";
  let count = 0;
  if (pricesTab === "crypto") {
    sortByWatchlist(pricesBoardData).forEach((c) => {
      if (q && !(c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))) return;
      list.appendChild(renderPriceRow(c));
      count++;
    });
  } else {
    pricesRatesData.forEach((r) => {
      if (q && !(r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))) return;
      list.appendChild(renderCurrencyRow(r));
      count++;
    });
  }
  if (!count) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = TM_I18N.t("prices.noResults");
    list.appendChild(p);
  }
}

function setPricesTab(tab) {
  pricesTab = tab;
  document.querySelectorAll(".prices-tab").forEach((b) => b.classList.toggle("active", b.dataset.pricesTab === tab));
  $("prices-tab-note").classList.toggle("hidden", tab !== "currencies");
  refreshPrices();
}

document.querySelectorAll(".prices-tab").forEach((b) => b.addEventListener("click", () => setPricesTab(b.dataset.pricesTab)));
$("prices-search").addEventListener("input", renderPricesList);

async function refreshPrices() {
  hideError("prices-error");
  $("prices-status").innerHTML = coinSpinnerHtml(TM_I18N.t("prices.loading"));
  $("prices-status").classList.remove("hidden");
  try {
    if (pricesTab === "crypto") pricesBoardData = await TM_PRICES.getPriceBoard(currentCurrency);
    else pricesRatesData = await TM_PRICES.getFiatRates(currentCurrency);
    renderPricesList();
    $("prices-status").classList.add("hidden");
  } catch (e) {
    $("prices-status").classList.add("hidden");
    showError("prices-error", e.message);
  }
}

// ---------------------------------------------------------------- COIN DETAIL
// The screen a Live prices row opens (same idea as MetaMask's token page):
// price + 24h change, a price chart with a few time ranges, market stats, a
// short description, and a Swap button. Swap here means "swap INTO this
// coin": it is only offered when the coin exists on the selected network as
// the native coin or as a token the person has added (matched by symbol) --
// this wallet never guesses a token contract address. The Swap screen then
// lets them choose which of their own holdings to pay with.
let coinDetail = { coin: null, days: 7, gen: 0, chartGen: 0, chartPoints: [], swapTarget: null, switchNetworkTarget: null };

function normalizeCoinSymbol(s) {
  const up = String(s || "").toUpperCase();
  return up === "MATIC" ? "POL" : up; // Polygon's native coin was renamed
}

// Native coin + tracked tokens on the selected network, with balances.
async function getHeldAssets() {
  const assets = [];
  if (!currentStatus || !currentStatus.selectedAddress || !currentNetwork) return assets;
  try {
    const bal = await sendMsg("TM_GET_BALANCE", { address: currentStatus.selectedAddress });
    assets.push({
      key: "native", address: "", symbol: bal.symbol || currentNetwork.nativeCurrency.symbol,
      decimals: bal.decimals, balance: ethers.utils.formatUnits(bal.balanceWei, bal.decimals),
    });
  } catch (e) {
    assets.push({ key: "native", address: "", symbol: currentNetwork.nativeCurrency.symbol, decimals: 18, balance: "0" });
  }
  try {
    const res = await sendMsg("TM_GET_TRACKED_TOKEN_BALANCES");
    (res.tokens || []).forEach((t) => {
      if (t.error) return;
      assets.push({
        key: t.address, address: t.address, symbol: t.symbol, decimals: t.decimals,
        balance: ethers.utils.formatUnits(t.balanceWei, t.decimals),
      });
    });
  } catch (e) { /* best-effort: native coin only */ }
  return assets;
}

// ---- Swap screen asset pickers (From = what you hold, To = any of your assets)
// Pill-button + bottom-sheet picker, replacing the old plain <select>s. Each
// side tracks its chosen asset in swapState; the hidden swap-*-custom
// inputs are kept around as the actual "which token address" source of
// truth (same contract the quote/approve/execute handlers already expect),
// just no longer directly visible/typed into except via the picker's
// custom-address entry.
let swapPopulateGen = 0;
let swapState = { held: [], fromKey: null, toKey: null, pickerSide: null };

function findHeldAsset(key) {
  return swapState.held.find((a) => a.key === key) || null;
}

// key -> the address string the quote/approve/execute code expects
// ("" / native pseudo-address for the native coin, else the contract).
function keyToAddress(key) {
  if (!key || key === "native") return "";
  return key;
}

function renderSwapAssetBtn(side, asset, customAddress) {
  const iconSlot = $(`swap-${side}-icon`);
  const symbolEl = $(`swap-${side}-symbol`);
  if (asset) {
    // trustWalletLogoUrl() now resolves a real logo for the native coin too
    // (asset.address is "" for native, which it treats as "look up the
    // chain's own info/logo.png" -- see the comment there), so this no
    // longer needs to special-case native into an initials-only null.
    const img = trustWalletLogoUrl(currentNetwork && currentNetwork.key, asset.address);
    iconSlot.innerHTML = tokenIconHtml(asset.symbol, img);
    symbolEl.textContent = asset.symbol;
  } else if (customAddress) {
    iconSlot.innerHTML = tokenIconHtml("?", null);
    symbolEl.textContent = `${customAddress.slice(0, 6)}…${customAddress.slice(-4)}`;
  } else {
    iconSlot.innerHTML = "";
    symbolEl.textContent = TM_I18N.t("swap.selectBtn");
  }
}

function renderSwapBalance() {
  const balEl = $("swap-from-balance");
  const maxBtn = $("swap-max-btn");
  const asset = findHeldAsset(swapState.fromKey);
  if (asset) {
    balEl.textContent = TM_I18N.t("swap.balanceLabel", { amount: Number(asset.balance).toLocaleString(undefined, { maximumFractionDigits: 6 }), symbol: asset.symbol });
    balEl.classList.remove("hidden");
    maxBtn.classList.toggle("hidden", !(Number(asset.balance) > 0));
  } else {
    balEl.classList.add("hidden");
    maxBtn.classList.add("hidden");
  }
}

function syncSwapAsset(side) {
  const custom = $(`swap-${side}-custom`);
  const key = side === "from" ? swapState.fromKey : swapState.toKey;
  const asset = findHeldAsset(key);
  if (asset) {
    custom.value = keyToAddress(asset.key);
    renderSwapAssetBtn(side, asset, null);
  } else if (key) {
    // Custom-pasted address: key IS the address.
    custom.value = key;
    renderSwapAssetBtn(side, null, key);
  } else {
    custom.value = "";
    renderSwapAssetBtn(side, null, null);
  }
  if (side === "from") renderSwapBalance();
  clearSwapQuote();
  scheduleSwapAutoQuote();
}

async function populateSwapSelects(pre) {
  const myGen = ++swapPopulateGen;
  const held = await getHeldAssets();
  if (myGen !== swapPopulateGen) return;
  swapState.held = held;
  const toKey = (pre && pre.toKey) || swapState.toKey;
  // "From" only offers what the person actually holds; the coin being
  // bought is never offered as its own source.
  let fromItems = held.filter((a) => Number(a.balance) > 0 && a.key !== toKey);
  if (!fromItems.length) fromItems = held.filter((a) => a.key === "native" && a.key !== toKey);
  swapState.fromKey = fromItems[0] ? fromItems[0].key : null;
  if (toKey && held.some((a) => a.key === toKey)) swapState.toKey = toKey;
  else if (toKey && /^0x[0-9a-fA-F]{40}$/.test(toKey)) swapState.toKey = toKey; // a coin not held yet, picked by address
  else swapState.toKey = (held.find((a) => a.key !== swapState.fromKey) || held[0] || null)?.key || null;
  syncSwapAsset("from");
  syncSwapAsset("to");
}

function closeAssetPicker() {
  $("swap-asset-picker").classList.add("hidden");
  swapState.pickerSide = null;
}

let pickerPriceGen = 0;

// Starred tokens (the star chip in the picker). Stored as "<chainId>:<token key>"
// in chrome.storage.local (the website shims it onto localStorage), so a star
// is per network and per token, never shared between chains.
const TM_FAV_TOKENS_KEY = "tm_fav_tokens";
let pickerFavs = new Set();
let pickerShowFavs = false;
function loadPickerFavs() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([TM_FAV_TOKENS_KEY], (res) => {
        const arr = res && res[TM_FAV_TOKENS_KEY];
        pickerFavs = new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
        resolve();
      });
    } catch (e) { resolve(); }
  });
}
function savePickerFavs() {
  try { chrome.storage.local.set({ [TM_FAV_TOKENS_KEY]: Array.from(pickerFavs) }); } catch (e) { /* best-effort */ }
}
function pickerFavId(a) {
  return `${currentNetwork.chainId}:${String(a.key).toLowerCase()}`;
}

// Network chips along the top of the picker (the "All / Solana / Ethereum..."
// row in the reference screenshot). A swap only ever runs on ONE chain, so
// tapping a chip actually switches the wallet to that network and reloads the
// list for it -- it isn't a cross-chain filter.
function renderPickerChips(side) {
  const chips = $("swap-picker-chips");
  chips.innerHTML = "";
  const starChip = document.createElement("button");
  starChip.type = "button";
  starChip.className = "asset-picker-chip asset-picker-chip-star" + (pickerShowFavs ? " active" : "");
  starChip.setAttribute("aria-label", TM_I18N.t("swap.pickerStarTitle"));
  starChip.setAttribute("aria-pressed", pickerShowFavs ? "true" : "false");
  starChip.innerHTML = "&#9733;";
  starChip.addEventListener("click", () => {
    pickerShowFavs = !pickerShowFavs;
    renderAssetPicker(side);
  });
  chips.appendChild(starChip);
  currentNetworks.forEach((n) => {
    const active = currentNetwork && n.chainId === currentNetwork.chainId;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "asset-picker-chip" + (active && !pickerShowFavs ? " active" : (active ? " current" : ""));
    b.innerHTML = networkDotHtml(n.key) + `<span>${escapeHtml(n.name)}</span>`;
    b.addEventListener("click", () => switchNetworkFromPicker(n, side));
    chips.appendChild(b);
    if (active && !chips.dataset.scrolled) { chips.dataset.scrolled = "1"; setTimeout(() => b.scrollIntoView({ inline: "center", block: "nearest" }), 0); }
  });
}

async function switchNetworkFromPicker(n, side) {
  if (currentNetwork && n.chainId === currentNetwork.chainId) return;
  const chips = $("swap-picker-chips");
  chips.classList.add("busy");
  try {
    await sendMsg("TM_SELECT_NETWORK", { chainId: n.chainId });
    await refreshMain();
    hideError("swap-error");
    $("swap-amount-in").value = "";
    clearSwapQuote();
    const unsupported = !currentNetwork.swapRouter;
    $("swap-unsupported").classList.toggle("hidden", !unsupported);
    $("swap-form").classList.toggle("hidden", unsupported);
    if (!unsupported) {
      swapState.fromKey = null;
      swapState.toKey = null;
      await populateSwapSelects({});
    }
  } catch (e) {
    showError("swap-error", e.message);
  } finally {
    chips.classList.remove("busy");
    if (swapState.pickerSide) renderAssetPicker(side);
  }
}

// Top-by-market-cap tokens on this network (25) when the search box is empty,
// or a name / symbol / contract-address search when something is typed --
// including tokens the person doesn't hold yet. Buy ("To") side only. Rows
// are appended after the held assets once CoinGecko answers (lib/token-catalog.js).
let pickerCatalogGen = 0;
async function appendCatalogRows(side, query, list, items, sugg) {
  const gen = ++pickerCatalogGen;
  if (side !== "to" || pickerShowFavs || typeof TM_CATALOG === "undefined" || !currentNetwork || !TM_CATALOG.supports(currentNetwork.key)) return;
  if (query && query.length < 2) return;
  const status = document.createElement("p");
  status.className = "hint";
  status.textContent = TM_I18N.t("swap.pickerLoadingTokens");
  list.appendChild(status);
  let rows = [];
  let failed = false;
  try {
    if (query) await new Promise((r) => setTimeout(r, 350)); // wait for typing to pause
    if (gen !== pickerCatalogGen) return;
    rows = query ? await TM_CATALOG.search(currentNetwork.key, query, 15) : await TM_CATALOG.top(currentNetwork.key, 25);
  } catch (e) { rows = []; failed = true; }
  if (gen !== pickerCatalogGen) return;
  status.remove();
  if (failed) {
    const f = document.createElement("p");
    f.className = "hint";
    f.textContent = TM_I18N.t("swap.pickerLoadFailed");
    list.appendChild(f);
    return;
  }
  const skip = new Set(
    items.map((a) => String(a.address || "").toLowerCase())
      .concat(sugg.map((t) => t.address.toLowerCase()), [String(swapState.fromKey || "").toLowerCase()])
  );
  rows = rows.filter((t) => !skip.has(t.address.toLowerCase()));
  if (!rows.length) return;
  const nomatch = list.querySelector(".picker-nomatch");
  if (nomatch) nomatch.remove();
  const h = document.createElement("p");
  h.className = "hint";
  h.textContent = TM_I18N.t(query ? "swap.pickerSearchResults" : "swap.pickerTopTokens");
  list.appendChild(h);
  rows.forEach((t) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "asset-picker-row";
    row.innerHTML = tokenIconHtml(t.symbol, t.image || trustWalletLogoUrl(currentNetwork && currentNetwork.key, t.address)) +
      `<span class="asset-picker-row-main"><span class="asset-picker-row-symbol">${escapeHtml(t.symbol)}</span>` +
      `<span class="asset-picker-row-sub">${escapeHtml(t.name)}${t.rank ? ` · #${escapeHtml(String(t.rank))}` : ""}</span></span>`;
    row.addEventListener("click", () => {
      swapState.toKey = t.address;
      syncSwapAsset("to");
      closeAssetPicker();
    });
    list.appendChild(row);
  });
}

function renderAssetPicker(side) {
  renderPickerChips(side);
  const list = $("swap-picker-list");
  list.innerHTML = "";
  const query = $("swap-picker-search").value.trim();
  const q = query.toLowerCase();
  const customBtn = $("swap-picker-custom-btn");
  const swapOk = !!(currentNetwork && currentNetwork.swapRouter);
  customBtn.classList.toggle("hidden", !swapOk);
  if (!swapOk) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = TM_I18N.t("swap.pickerNoSwapHere");
    list.appendChild(p);
    return;
  }
  // From only lists what's actually held (can't sell what you don't have);
  // To lists every held asset, since you can buy into something at zero
  // balance. Either side excludes whatever the OTHER side currently holds.
  const otherKey = side === "from" ? swapState.toKey : swapState.fromKey;
  let items = swapState.held.filter((a) => a.key !== otherKey);
  let nothingFunded = false;
  if (side === "from") {
    const funded = items.filter((a) => Number(a.balance) > 0);
    if (funded.length) items = funded;
    else nothingFunded = true; // keep the (zero-balance) assets visible instead of an empty list
  }
  if (nothingFunded && !pickerShowFavs) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = TM_I18N.t("swap.pickerNothingHeld");
    list.appendChild(p);
  }
  if (pickerShowFavs) items = items.filter((a) => pickerFavs.has(pickerFavId(a)));
  if (q) items = items.filter((a) => String(a.symbol || "").toLowerCase().includes(q) || String(a.name || "").toLowerCase().includes(q) || String(a.address || "").toLowerCase().includes(q));

  // A pasted contract address that isn't in the list becomes a one-tap row,
  // using the exact same custom-address path the old "Other token" button did.
  if (/^0x[0-9a-fA-F]{40}$/.test(query) && !items.some((a) => String(a.address).toLowerCase() === q)) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "asset-picker-row";
    row.innerHTML = tokenIconHtml("?", null) +
      `<span class="asset-picker-row-main"><span class="asset-picker-row-symbol">${escapeHtml(TM_I18N.t("swap.pickerUseAddress"))}</span>` +
      `<span class="asset-picker-row-sub">${escapeHtml(query.slice(0, 8))}…${escapeHtml(query.slice(-6))}</span></span>`;
    row.addEventListener("click", () => {
      if (side === "from") swapState.fromKey = query; else swapState.toKey = query;
      syncSwapAsset(side);
      closeAssetPicker();
    });
    list.appendChild(row);
  }
  // Issuer-verified stablecoins (known-tokens.js) not held yet. Buy side only:
  // you can't sell what you don't have.
  const sugg = side === "to" && !pickerShowFavs && typeof TM_KNOWN_TOKENS !== "undefined"
    ? TM_KNOWN_TOKENS.suggested(currentNetwork.chainId, { heldAddresses: swapState.held.map((a) => a.address), excludeAddress: swapState.fromKey, query })
    : [];
  if (!items.length && !sugg.length && !list.children.length) {
    const p = document.createElement("p");
    p.className = "hint picker-nomatch";
    p.textContent = TM_I18N.t(q ? "swap.pickerNoMatch" : (pickerShowFavs ? "swap.pickerNoFavs" : "swap.noAssetsHint"));
    list.appendChild(p);
  }
  items.forEach((a) => {
    const row = document.createElement("div");
    row.className = "asset-picker-row";
    row.dataset.key = a.key;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    const img = trustWalletLogoUrl(currentNetwork && currentNetwork.key, a.address);
    const isFav = pickerFavs.has(pickerFavId(a));
    const explorer = String(currentNetwork.blockExplorer || "");
    const canInfo = a.address && /^https:\/\//.test(explorer);
    row.innerHTML =
      `<span class="token-icon-wrap">${tokenIconHtml(a.symbol, img)}<span class="token-net-badge" style="background:${networkDotColor(currentNetwork.key)}"></span></span>` +
      `<span class="asset-picker-row-main"><span class="asset-picker-row-symbol">${escapeHtml(a.symbol)}</span>` +
      `<span class="asset-picker-row-sub">${escapeHtml(currentNetwork.name)}</span></span>` +
      `<span class="asset-picker-row-right"><span class="asset-picker-row-balance">${escapeHtml(Number(a.balance).toLocaleString(undefined, { maximumFractionDigits: 6 }))}</span>` +
      `<span class="asset-picker-row-usd"></span></span>` +
      `<button type="button" class="asset-picker-star${isFav ? " on" : ""}" aria-label="${escapeHtml(TM_I18N.t("swap.pickerStarTitle"))}" aria-pressed="${isFav}">${isFav ? "&#9733;" : "&#9734;"}</button>` +
      `<button type="button" class="asset-picker-info${canInfo ? "" : " invisible"}" aria-label="${escapeHtml(TM_I18N.t("swap.pickerInfoTitle"))}" title="${escapeHtml(TM_I18N.t("swap.pickerInfoTitle"))}" ${canInfo ? "" : "tabindex=\"-1\" disabled"}>i</button>`;
    const choose = () => {
      if (side === "from") swapState.fromKey = a.key; else swapState.toKey = a.key;
      syncSwapAsset(side);
      closeAssetPicker();
    };
    row.addEventListener("click", choose);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
    row.querySelector(".asset-picker-star").addEventListener("click", (e) => {
      e.stopPropagation();
      const id = pickerFavId(a);
      if (pickerFavs.has(id)) pickerFavs.delete(id); else pickerFavs.add(id);
      savePickerFavs();
      renderAssetPicker(side);
    });
    row.querySelector(".asset-picker-info").addEventListener("click", (e) => {
      e.stopPropagation();
      if (canInfo) window.open(`${explorer.replace(/\/+$/, "")}/token/${encodeURIComponent(a.address)}`, "_blank", "noopener,noreferrer");
    });
    list.appendChild(row);
  });
  if (sugg.length) {
    const h = document.createElement("p");
    h.className = "hint";
    h.textContent = TM_I18N.t("swap.pickerSuggested");
    list.appendChild(h);
    sugg.forEach((t) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "asset-picker-row";
      row.innerHTML = tokenIconHtml(t.symbol, trustWalletLogoUrl(currentNetwork && currentNetwork.key, t.address)) +
        `<span class="asset-picker-row-main"><span class="asset-picker-row-symbol">${escapeHtml(t.symbol)}</span>` +
        `<span class="asset-picker-row-sub">${escapeHtml(t.name)}</span></span>`;
      row.addEventListener("click", () => {
        swapState.toKey = t.address;
        syncSwapAsset("to");
        closeAssetPicker();
      });
      list.appendChild(row);
    });
  }
  appendCatalogRows(side, query, list, items, sugg);
  fillPickerPrices(items, list);
}

// Value of the issuer-verified stablecoins (USDC / USDT = 1 US dollar, EURC = 1 euro) in the
// display currency. Used ONLY when the price service has no price for one of them (rate-limited
// or unreachable), so a balance of USDC or EURC still shows its worth in dollars and cents
// instead of a blank. Matched by contract address against TM_KNOWN_TOKENS (copied from the
// issuers' own published lists), never by symbol, so a look-alike token never gets a value.
async function stablecoinFallbackPrices(addresses) {
  const out = {};
  try {
    if (!currentNetwork || typeof TM_KNOWN_TOKENS === "undefined" || !addresses || !addresses.length) return out;
    const known = TM_KNOWN_TOKENS.forChain(currentNetwork.chainId);
    const want = new Map(); // lower-case address -> currency it is pegged to
    addresses.forEach((a) => {
      const k = known.find((t) => t.address.toLowerCase() === String(a || "").toLowerCase());
      if (k) want.set(k.address.toLowerCase(), k.symbol === "EURC" ? "EUR" : "USD");
    });
    if (!want.size) return out;
    let rates = null;
    const rateFor = async (code) => {
      if (code.toLowerCase() === String(currentCurrency).toLowerCase()) return 1;
      if (!rates) rates = await TM_PRICES.getFiatRates(currentCurrency);
      const r = rates.find((x) => String(x.code).toUpperCase() === code);
      return r ? r.rate : null;
    };
    for (const [addr, code] of want) {
      let p = null;
      try { p = await rateFor(code); } catch (e) { p = null; }
      if (typeof p === "number" && p > 0) out[addr] = { price: p };
    }
  } catch (e) { /* best-effort */ }
  return out;
}

// Best-effort USD value per row; a rate-limited or unreachable price API just
// leaves the value blank rather than breaking the list.
async function fillPickerPrices(items, list) {
  const gen = ++pickerPriceGen;
  const key = currentNetwork && currentNetwork.key;
  if (!key) return;
  try {
    const held = items.filter((a) => Number(a.balance) > 0);
    if (!held.length) return;
    const addrs = held.filter((a) => a.address).map((a) => a.address);
    const [nativePrice, byAddrRaw] = await Promise.all([
      TM_PRICES.getNativePriceForNetwork(key, currentCurrency).catch(() => null),
      addrs.length ? TM_PRICES.getTokenPricesByContract(key, addrs, currentCurrency).catch(() => ({})) : Promise.resolve({}),
    ]);
    if (gen !== pickerPriceGen) return;
    // Stablecoins the price service didn't return a price for still get a value (see above).
    const byAddr = Object.assign({}, byAddrRaw || {});
    const unpriced = addrs.filter((a) => !byAddr[a.toLowerCase()] || typeof byAddr[a.toLowerCase()].price !== "number");
    if (unpriced.length) Object.assign(byAddr, await stablecoinFallbackPrices(unpriced));
    if (gen !== pickerPriceGen) return;
    held.forEach((a) => {
      const price = a.address ? ((byAddr || {})[a.address.toLowerCase()] || {}).price : nativePrice;
      if (price == null) return;
      const el = Array.from(list.querySelectorAll(".asset-picker-row")).find((r) => r.dataset.key === a.key);
      const slot = el && el.querySelector(".asset-picker-row-usd");
      if (slot) slot.textContent = formatCurrency(Number(a.balance) * price);
    });
  } catch (e) { /* best-effort */ }
}

function openAssetPicker(side) {
  swapState.pickerSide = side;
  $("swap-picker-title").textContent = TM_I18N.t("swap.selectTokenTitle");
  $("swap-picker-search").value = "";
  pickerShowFavs = false;
  $("swap-picker-chips").dataset.scrolled = "";
  renderAssetPicker(side);
  $("swap-asset-picker").classList.remove("hidden");
  loadPickerFavs().then(() => { if (swapState.pickerSide) renderAssetPicker(swapState.pickerSide); });
}

$("swap-picker-search").addEventListener("input", () => {
  // Searching should search everything -- never leave the star (favorites only)
  // filter silently on top of a search, which just looks like an empty list.
  if (pickerShowFavs && $("swap-picker-search").value.trim()) pickerShowFavs = false;
  if (swapState.pickerSide) renderAssetPicker(swapState.pickerSide);
});

$("swap-from-asset-btn").addEventListener("click", () => openAssetPicker("from"));
$("swap-to-asset-btn").addEventListener("click", () => openAssetPicker("to"));
$("swap-picker-close").addEventListener("click", closeAssetPicker);
$("swap-picker-custom-btn").addEventListener("click", () => {
  const side = swapState.pickerSide;
  const addr = (prompt(TM_I18N.t("common.tokenAddressPlaceholderParen")) || "").trim();
  closeAssetPicker();
  if (!addr) return;
  if (side === "from") swapState.fromKey = addr; else swapState.toKey = addr;
  syncSwapAsset(side);
});

$("swap-max-btn").addEventListener("click", () => {
  const asset = findHeldAsset(swapState.fromKey);
  if (!asset) return;
  $("swap-amount-in").value = asset.balance;
  clearSwapQuote();
  scheduleSwapAutoQuote();
});

$("swap-amount-in").addEventListener("input", () => {
  clearSwapQuote();
  scheduleSwapAutoQuote();
});

// ---- Coin screen
function renderCoinPrice(price, change) {
  $("coin-price").textContent = price == null ? TM_I18N.t("prices.naText") : TM_PRICES.formatMoney(price, currentCurrency, { price: true });
  const el = $("coin-change");
  if (typeof change === "number") {
    el.className = `price-change ${change >= 0 ? "up" : "down"}`;
    el.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  } else {
    el.className = "price-change hidden";
  }
}

function coinStat(label, value) {
  const d = document.createElement("div");
  d.className = "coin-stat";
  const k = document.createElement("span");
  k.className = "k";
  k.textContent = label;
  const v = document.createElement("span");
  v.className = "v";
  v.textContent = value;
  d.appendChild(k);
  d.appendChild(v);
  return d;
}

async function openCoinDetail(c, fromScreen) {
  const gen = ++coinDetail.gen;
  coinDetail.coin = c;
  coinDetail.swapTarget = null;
  coinDetail.switchNetworkTarget = null;
  $("coin-back").dataset.back = fromScreen || "screen-prices";
  hideError("coin-error");
  $("coin-icon").innerHTML = tokenIconHtml(c.symbol, c.image);
  $("coin-name").textContent = c.name;
  $("coin-symbol").textContent = c.symbol;
  $("coin-rank").classList.add("hidden");
  renderCoinPrice(c.price, c.change24h);
  $("coin-stats").innerHTML = "";
  $("coin-about").textContent = TM_I18N.t("prices.loading");
  $("coin-link-cg").href = c.url || "https://www.coingecko.com/";
  const btn = $("btn-coin-swap");
  btn.textContent = TM_I18N.t("coin.swapBtn", { symbol: c.symbol });
  btn.disabled = true;
  // Buy is always available (Transak doesn't require already holding a
  // different asset to swap from), so this button isn't gated the way Swap
  // is below -- it's the fallback that keeps a coin-detail screen from
  // dead-ending when Swap can't be offered.
  const buyBtn = $("btn-coin-buy");
  if (buyBtn) buyBtn.textContent = TM_I18N.t("coin.buyBtn", { symbol: c.symbol });
  $("coin-holding").classList.add("hidden");
  $("coin-swap-note").classList.add("hidden");
  $("btn-coin-switch-network").classList.add("hidden");
  document.querySelectorAll(".coin-range").forEach((b) => b.classList.toggle("active", b.dataset.days === String(coinDetail.days)));
  showScreen("screen-coin");
  loadCoinChart(gen);
  loadCoinInfo(gen);
  loadCoinSwapState(gen);
}

async function loadCoinInfo(gen) {
  const c = coinDetail.coin;
  try {
    const d = await TM_PRICES.getCoinDetail(c.symbol, currentCurrency, c.cgId);
    if (gen !== coinDetail.gen) return;
    if (d.price != null) renderCoinPrice(d.price, d.change24h != null ? d.change24h : c.change24h);
    if (d.rank != null) {
      $("coin-rank").textContent = `#${d.rank}`;
      $("coin-rank").classList.remove("hidden");
    }
    const stats = $("coin-stats");
    stats.innerHTML = "";
    const fm = (n) => TM_PRICES.formatMoney(n, currentCurrency, { price: true });
    if (d.marketCap != null) stats.appendChild(coinStat(TM_I18N.t("coin.marketCap"), TM_PRICES.formatMoneyCompact(d.marketCap, currentCurrency)));
    if (d.volume != null) stats.appendChild(coinStat(TM_I18N.t("coin.volume24h"), TM_PRICES.formatMoneyCompact(d.volume, currentCurrency)));
    const fmPct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
    if (d.change7d != null) stats.appendChild(coinStat("7D", fmPct(d.change7d)));
    if (d.change30d != null) stats.appendChild(coinStat("30D", fmPct(d.change30d)));
    if (d.high24h != null) stats.appendChild(coinStat(TM_I18N.t("coin.high24h"), fm(d.high24h)));
    if (d.low24h != null) stats.appendChild(coinStat(TM_I18N.t("coin.low24h"), fm(d.low24h)));
    if (d.circulatingSupply != null) stats.appendChild(coinStat(TM_I18N.t("coin.supply"), d.circulatingSupply.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })));
    if (d.ath != null) {
      const pct = d.athChange != null ? ` (${d.athChange.toFixed(1)}%)` : "";
      stats.appendChild(coinStat(TM_I18N.t("coin.ath"), fm(d.ath) + pct));
    }
    $("coin-about").textContent = d.description || TM_I18N.t("coin.aboutUnavailable");
  } catch (e) {
    if (gen !== coinDetail.gen) return;
    $("coin-about").textContent = TM_I18N.t("coin.aboutUnavailable");
    showError("coin-error", TM_I18N.t("coin.loadError"));
  }
}

async function loadCoinChart(gen) {
  const c = coinDetail.coin;
  const token = ++coinDetail.chartGen;
  const box = $("coin-chart");
  box.className = "coin-chart";
  box.innerHTML = `<div class="coin-chart-msg">${escapeHtml(TM_I18N.t("prices.loading"))}</div>`;
  $("coin-chart-readout").textContent = "";
  try {
    const pts = await TM_PRICES.getCoinChart(c.symbol, currentCurrency, coinDetail.days, c.cgId);
    if (gen !== coinDetail.gen || token !== coinDetail.chartGen) return;
    drawCoinChart(pts);
  } catch (e) {
    if (gen !== coinDetail.gen || token !== coinDetail.chartGen) return;
    box.innerHTML = `<div class="coin-chart-msg">${escapeHtml(TM_I18N.t("coin.chartUnavailable"))}</div>`;
  }
}

function coinRangeSummary() {
  const pts = coinDetail.chartPoints;
  if (pts.length < 2) return "";
  const first = pts[0][1];
  const last = pts[pts.length - 1][1];
  const pct = first ? ((last - first) / first) * 100 : 0;
  const label = { 1: "24H", 7: "7D", 30: "1M", 365: "1Y" }[coinDetail.days] || "";
  return `${label}: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function drawCoinChart(pts) {
  const box = $("coin-chart");
  coinDetail.chartPoints = pts;
  if (!pts || pts.length < 2) {
    box.innerHTML = `<div class="coin-chart-msg">${escapeHtml(TM_I18N.t("coin.chartUnavailable"))}</div>`;
    return;
  }
  const W = 320, H = 130, PAD = 6;
  const prices = pts.map((p) => p[1]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * W);
  const ys = prices.map((p) => H - PAD - ((p - min) / span) * (H - PAD * 2));
  const line = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  box.className = `coin-chart ${prices[prices.length - 1] >= prices[0] ? "up" : "down"}`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(coinRangeSummary())}">
    <path d="${area}" fill="currentColor" fill-opacity="0.12" stroke="none"></path>
    <path d="${line}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
    <line id="coin-chart-cursor" x1="0" y1="0" x2="0" y2="${H}" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0" stroke-dasharray="3 3"></line>
  </svg>`;
  $("coin-chart-readout").textContent = coinRangeSummary();
}

// Drag/hover over the chart to read the price at that moment.
(function wireCoinChartScrub() {
  const box = $("coin-chart");
  const show = (e) => {
    const pts = coinDetail.chartPoints;
    if (!pts || pts.length < 2) return;
    const rect = box.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (pts.length - 1));
    const [ts, price] = pts[idx];
    const cursor = $("coin-chart-cursor");
    if (cursor) {
      const x = (idx / (pts.length - 1)) * 320;
      cursor.setAttribute("x1", x);
      cursor.setAttribute("x2", x);
      cursor.setAttribute("opacity", "0.7");
    }
    const when = new Date(ts).toLocaleString(undefined, coinDetail.days === 1
      ? { hour: "numeric", minute: "2-digit" }
      : coinDetail.days <= 7 ? { month: "short", day: "numeric", hour: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
    $("coin-chart-readout").textContent = `${TM_PRICES.formatMoney(price, currentCurrency, { price: true })} - ${when}`;
  };
  const reset = () => {
    const cursor = $("coin-chart-cursor");
    if (cursor) cursor.setAttribute("opacity", "0");
    $("coin-chart-readout").textContent = coinRangeSummary();
  };
  box.addEventListener("pointermove", show);
  box.addEventListener("pointerdown", show);
  box.addEventListener("pointerleave", reset);
  box.addEventListener("pointerup", reset);
  box.addEventListener("pointercancel", reset);
})();

document.querySelectorAll(".coin-range").forEach((b) => {
  b.addEventListener("click", () => {
    coinDetail.days = Number(b.dataset.days);
    document.querySelectorAll(".coin-range").forEach((x) => x.classList.toggle("active", x === b));
    loadCoinChart(coinDetail.gen);
  });
});

async function loadCoinSwapState(gen) {
  const c = coinDetail.coin;
  const btn = $("btn-coin-swap");
  const note = $("coin-swap-note");
  const showNote = (text) => { note.textContent = text; note.classList.remove("hidden"); };
  if (!currentNetwork || !currentStatus || !currentStatus.selectedAddress) {
    $("btn-coin-switch-network").classList.add("hidden");
    showNote(TM_I18N.t("coin.swapNeedsWallet"));
    return;
  }
  if (!currentNetwork.swapRouter) {
    $("btn-coin-switch-network").classList.add("hidden");
    showNote(TM_I18N.t("coin.swapNoRouter"));
    return;
  }
  // Trending coins that aren't on the fixed price list: match by CONTRACT
  // ADDRESS on this network (from CoinGecko's platform data), never by
  // symbol -- a same-symbol look-alike must not stand in for the real coin.
  if (c.cgId && TM_PRICES.COINGECKO_IDS[c.symbol] !== c.cgId) {
    $("btn-coin-switch-network").classList.add("hidden");
    let addr = null;
    try { addr = await TM_CATALOG.addressFor(currentNetwork.key, c.cgId); } catch (e) { /* treated as unavailable */ }
    if (gen !== coinDetail.gen) return;
    if (!addr) {
      showNote(TM_I18N.t("coin.swapUnavailableNetwork", { symbol: c.symbol, network: currentNetwork.name }));
      return;
    }
    coinDetail.swapTarget = { key: addr, symbol: c.symbol, address: addr };
    btn.disabled = false;
    showNote(TM_I18N.t("coin.swapHint"));
    return;
  }
  const held = await getHeldAssets();
  if (gen !== coinDetail.gen) return;
  const want = normalizeCoinSymbol(c.symbol);
  const match = held.find((a) => normalizeCoinSymbol(a.symbol) === want);
  if (!match) {
    // Very often the real fix isn't "this network doesn't support this
    // coin" at all -- it's that the coin being viewed is actually some
    // OTHER network's own native coin (POL on Polygon, BNB on BSC, etc).
    // Checking that first means someone looking at POL while on Ethereum
    // Mainnet gets pointed straight at "switch to Polygon" instead of a
    // dead end, with Buy (always shown, see openCoinDetail) still there
    // as a fallback in case that's not actually what they meant.
    const nativeElsewhere = currentNetworks.find(
      (n) => n.chainId !== currentNetwork.chainId && normalizeCoinSymbol(n.nativeCurrency.symbol) === want
    );
    if (nativeElsewhere) {
      coinDetail.switchNetworkTarget = nativeElsewhere;
      showNote(TM_I18N.t("coin.swapUnavailableSwitchNetwork", { symbol: c.symbol, network: nativeElsewhere.name }));
      const switchBtn = $("btn-coin-switch-network");
      switchBtn.textContent = TM_I18N.t("coin.switchNetworkBtn", { network: nativeElsewhere.name });
      switchBtn.classList.remove("hidden");
      return;
    }
    // Not anyone's native coin either -- but if it's already sitting in
    // your tracked-token list on one of your OTHER networks (added there
    // earlier, or just being viewed from the wrong network right now),
    // that's a far more useful fix to offer than "add it here from
    // scratch". Tracked tokens are stored per network, so this can be read
    // directly without switching away from the network you're actually on.
    try {
      const stored = await chrome.storage.local.get("tm_tracked_tokens");
      if (gen !== coinDetail.gen) return;
      const byChain = stored["tm_tracked_tokens"] || {};
      const trackedElsewhere = currentNetworks.find((n) => {
        if (n.chainId === currentNetwork.chainId) return false;
        const tokens = byChain[n.chainId] || [];
        return tokens.some((t) => normalizeCoinSymbol(t.symbol) === want);
      });
      if (trackedElsewhere) {
        coinDetail.switchNetworkTarget = trackedElsewhere;
        showNote(TM_I18N.t("coin.swapUnavailableSwitchNetworkTracked", { symbol: c.symbol, network: trackedElsewhere.name }));
        const switchBtn = $("btn-coin-switch-network");
        switchBtn.textContent = TM_I18N.t("coin.switchNetworkBtn", { network: trackedElsewhere.name });
        switchBtn.classList.remove("hidden");
        return;
      }
    } catch (e) {
      // Best-effort -- if this lookup fails for any reason, fall through to
      // the normal dead-end note below instead of blocking the screen.
    }
    $("btn-coin-switch-network").classList.add("hidden");
    showNote(TM_I18N.t("coin.swapUnavailableNetwork", { symbol: c.symbol, network: currentNetwork.name }));
    return;
  }
  $("btn-coin-switch-network").classList.add("hidden");
  coinDetail.swapTarget = match;
  if (Number(match.balance) > 0) {
    const holding = $("coin-holding");
    holding.textContent = TM_I18N.t("coin.holding", {
      amount: Number(match.balance).toLocaleString(undefined, { maximumFractionDigits: 5 }),
      symbol: match.symbol,
    });
    holding.classList.remove("hidden");
  }
  btn.disabled = false;
  showNote(TM_I18N.t("coin.swapHint"));
}

$("btn-coin-swap").addEventListener("click", () => {
  const m = coinDetail.swapTarget;
  if (!m) return;
  setupSwapScreen({ toKey: m.key });
  showScreen("screen-swap");
});

$("btn-coin-switch-network").addEventListener("click", async () => {
  const net = coinDetail.switchNetworkTarget;
  if (!net) return;
  const btn = $("btn-coin-switch-network");
  btn.disabled = true;
  try {
    await sendMsg("TM_SELECT_NETWORK", { chainId: net.chainId });
    await refreshMain(); // same call the main screen's own network picker uses
    // Re-run the swap-availability check now that currentNetwork has
    // changed -- the coin being viewed is almost always this network's own
    // native coin now, so this normally just enables Swap.
    loadCoinSwapState(coinDetail.gen);
  } finally {
    btn.disabled = false;
  }
});

$("btn-coin-buy").addEventListener("click", () => {
  const c = coinDetail.coin;
  if (!c) return;
  setupBuyScreen(c.symbol);
  showScreen("screen-buy");
});

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
// Read-only display of national currencies with the stablecoins pegged to them (see lib/prices.js,
// getCurrencyStablecoins). Each row shows the stablecoin's live price and how far it is from its peg
// (green while within 0.5%, red beyond that). Tapping a row opens the in-app coin screen (chart, stats, Swap).
function renderStablecoinRow(c) {
  const row = document.createElement("div");
  row.className = "price-row";
  const priceText =
    c.price == null
      ? TM_I18N.t("prices.naText")
      : TM_PRICES.formatMoney(c.price, currentCurrency, { price: true });
  // 24-hour move, green when up (or flat) and red when down, with an arrow and the percentage.
  let changeHtml = "";
  if (typeof c.change24h === "number" && isFinite(c.change24h)) {
    const up = c.change24h >= 0;
    changeHtml = `<span class="price-change plain ${up ? "up" : "down"}">${up ? "\u2197" : "\u2198"} ${Math.abs(c.change24h).toFixed(2)}%</span>`;
  }
  const volText = typeof c.volume === "number" && c.volume > 0 ? `${TM_I18N.t("prices.volShort")} ${TM_PRICES.formatMoneyCompact(c.volume, currentCurrency)}` : "";
  const linkLabel = escapeHtml(TM_I18N.t("prices.viewCoin", { name: c.name }));
  row.innerHTML = `<button type="button" class="price-link" aria-label="${linkLabel}" title="${linkLabel}"><span class="price-left">${tokenIconHtml(c.symbol, c.image)}<span class="price-id"><span class="price-name">${escapeHtml(c.name)}</span><span class="price-symbol">${escapeHtml(c.symbol)} &middot; ${escapeHtml(c.fiat)}</span>${volText ? `<span class="price-symbol price-vol">${escapeHtml(volText)}</span>` : ""}</span></span><span class="price-quote"><span class="price-usd">${priceText}</span>${changeHtml}</span></button>`;
  row.querySelector(".price-link").addEventListener("click", () => {
    openCoinDetail(c, $("screen-predictions").classList.contains("hidden") ? "screen-main" : "screen-predictions");
  });
  return row;
}

// Which tab of the Currencies & Stablecoins screen is showing: the stablecoins, or the top coins.
let predictionsTab = "stable";
function setPredictionsTab(tab) {
  predictionsTab = tab === "top" ? "top" : "stable";
  [["pred-tab-stable", "stable"], ["pred-tab-top", "top"]].forEach(([id, t]) => {
    const b = $(id); if (!b) return;
    b.classList.toggle("active", predictionsTab === t);
    b.setAttribute("aria-selected", predictionsTab === t ? "true" : "false");
  });
  refreshPredictions();
}
$("pred-tab-stable").addEventListener("click", () => setPredictionsTab("stable"));
$("pred-tab-top").addEventListener("click", () => setPredictionsTab("top"));

async function refreshPredictions() {
  hideError("predictions-error");
  $("predictions-status").innerHTML = coinSpinnerHtml(TM_I18N.t("predictions.loading"));
  $("predictions-status").classList.remove("hidden");
  try {
    const markets = predictionsTab === "top" ? await TM_PRICES.getTopCoins(currentCurrency) : await TM_PRICES.getCurrencyStablecoins(currentCurrency);
    const list = $("predictions-list");
    list.innerHTML = "";
    if (!markets.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = TM_I18N.t("predictions.empty");
      list.appendChild(p);
    } else {
      markets.forEach((m) => list.appendChild(renderStablecoinRow(m)));
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
  list.innerHTML = `<div class="price-row skeleton">${coinSpinnerHtml(TM_I18N.t("predictions.loading"))}</div>`;
  try {
    const all = await TM_PRICES.getCurrencyStablecoins(currentCurrency);
    // One stablecoin per currency on the small card; the full screen lists them all.
    const seen = new Set();
    const markets = all.filter((m) => (seen.has(m.fiat) ? false : seen.add(m.fiat))).slice(0, MAIN_PREDICTIONS_CARD_COUNT);
    list.innerHTML = "";
    if (!markets.length) {
      list.innerHTML = `<div class="price-row skeleton">${TM_I18N.t("predictions.empty")}</div>`;
    } else {
      markets.forEach((m) => list.appendChild(renderStablecoinRow(m)));
    }
  } catch (e) {
    list.innerHTML = `<div class="price-row skeleton">${TM_I18N.t("predictions.cardUnavailable")}</div>`;
  }
}

// ---------------------------------------------------------------- BUY
// Buy's widget loads right here in an <iframe> (see README-transak-embed.md):
// tapping "Continue" fetches a fresh, single-use, 5-minute widget URL
// (same URL that used to open in a new tab) and swaps the intro view for
// the widget view. Closing -- the widget's own "← Close" link, or either
// screen's "Back" button -- sets the iframe back to about:blank, which
// fully unloads whatever Transak had running (including releasing the
// camera/microphone if a KYC step was mid-flow) and resets to the intro
// view, so reopening Buy never lands on a stale or expired widget.
// Scope: website/app only -- the extension's small toolbar popup
// (popup.html/popup.js) deliberately keeps the new-tab handoff, since
// Transak's own docs flag the KYC camera step as unreliable inside a popup
// that can lose focus and auto-close.
//
// A specific asset to default Transak's picker to, set by setupBuyScreen()
// when Buy is opened from a coin-detail screen (see btn-coin-buy above).
// Null for the plain "Buy crypto" entry point (Settings / main), where
// Transak's own picker starts from its usual default.
let buyPresetSymbol = null;
// Set when a fiat currency row (USD / EUR) is picked: Transak opens with that
// currency as its default and the matching dollar/euro coin as the crypto.
let buyPresetFiat = null;

function resetBuyWidget() {
  $("buy-iframe").src = "about:blank";
  $("buy-widget").classList.add("hidden");
  $("buy-intro").classList.remove("hidden");
}

function updateBuyPresetNote() {
  const note = $("buy-preset-note");
  const change = $("btn-buy-change-coin");
  if (note) {
    if (buyPresetSymbol) {
      note.textContent = TM_I18N.t("buy.presetNote", { symbol: buyPresetSymbol });
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }
  }
  if (change) change.classList.toggle("hidden", !buyPresetSymbol);
}

// Opening Buy with no coin chosen (Home / Settings) goes straight to the coin
// picker below; opening it from a coin's own detail screen already knows the
// coin, so it skips the picker and shows the intro with a "Change coin" link.
function setupBuyScreen(presetSymbol) {
  hideError("buy-error");
  closeBuyPicker();
  buyPresetSymbol = presetSymbol || null;
  buyPresetFiat = null;
  updateBuyPresetNote();
  resetBuyWidget();
  const btn = $("btn-buy-open");
  if (btn) { btn.disabled = false; btn.classList.remove("hidden"); }
  if (!buyPresetSymbol) openBuyPicker();
}

$("btn-buy-goto-swap").addEventListener("click", () => { closeBuyPicker(); setupSwapScreen(); showScreen("screen-swap"); });

async function startBuyWidget() {
  hideError("buy-error");
  const btn = $("btn-buy-open");
  btn.disabled = true;
  try {
    const address = (currentStatus && currentStatus.selectedAddress) || "";
    const url = await TM_TRANSAK_CONFIG.buildTransakUrl("BUY", currentNetwork.key, address, buyPresetFiat || currentCurrency, buyPresetSymbol);
    $("buy-iframe").src = url;
    $("buy-intro").classList.add("hidden");
    $("buy-widget").classList.remove("hidden");
  } catch (e) {
    showError("buy-error", e.message);
  } finally {
    btn.disabled = false;
  }
}
$("btn-buy-open").addEventListener("click", startBuyWidget);
$("btn-buy-close-widget").addEventListener("click", resetBuyWidget);
$("btn-buy-back").addEventListener("click", resetBuyWidget);
$("btn-buy-change-coin").addEventListener("click", () => openBuyPicker());

// ---- Buy coin picker -----------------------------------------------------
// Network chips along the top, a search box, then the coins people actually
// buy: the network's own coin, issuer-verified stablecoins, and the top coins
// by market cap on that network (same CoinGecko-backed lists the Swap picker
// uses). Tapping a coin sets it as Transak's default and opens Transak right
// away. The chips switch the wallet's active network, like Swap's picker.
let buyPickerGen = 0;
let buyPickerOpen = false;

function closeBuyPicker() {
  const el = $("buy-asset-picker");
  if (el) el.classList.add("hidden");
  buyPickerOpen = false;
  buyPickerGen++;
}

function openBuyPicker() {
  $("buy-picker-search").value = "";
  $("buy-picker-chips").dataset.scrolled = "";
  buyPickerOpen = true;
  renderBuyPicker();
  $("buy-asset-picker").classList.remove("hidden");
}

function renderBuyPickerChips() {
  const chips = $("buy-picker-chips");
  chips.innerHTML = "";
  currentNetworks.forEach((n) => {
    const active = currentNetwork && n.chainId === currentNetwork.chainId;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "asset-picker-chip" + (active ? " active" : "");
    b.innerHTML = networkDotHtml(n.key) + `<span>${escapeHtml(n.name)}</span>`;
    b.addEventListener("click", () => switchNetworkFromBuyPicker(n));
    chips.appendChild(b);
    if (active && !chips.dataset.scrolled) { chips.dataset.scrolled = "1"; setTimeout(() => b.scrollIntoView({ inline: "center", block: "nearest" }), 0); }
  });
}

async function switchNetworkFromBuyPicker(n) {
  if (currentNetwork && n.chainId === currentNetwork.chainId) return;
  const chips = $("buy-picker-chips");
  chips.classList.add("busy");
  try {
    await sendMsg("TM_SELECT_NETWORK", { chainId: n.chainId });
    await refreshMain();
  } catch (e) {
    showError("buy-error", e.message);
  } finally {
    chips.classList.remove("busy");
    if (buyPickerOpen) renderBuyPicker();
  }
}

function pickBuyCoin(symbol, fiat) {
  closeBuyPicker();
  buyPresetSymbol = String(symbol || "").toUpperCase() || null;
  buyPresetFiat = fiat ? String(fiat).toLowerCase() : null;
  updateBuyPresetNote();
  startBuyWidget();
}

function buyPickerRow(symbol, name, imageUrl, sub, coin, fiat) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "asset-picker-row";
  row.dataset.symbol = String(symbol).toUpperCase();
  row.innerHTML =
    `<span class="token-icon-wrap">${tokenIconHtml(symbol, imageUrl)}<span class="token-net-badge" style="background:${networkDotColor(currentNetwork.key)}"></span></span>` +
    `<span class="asset-picker-row-main"><span class="asset-picker-row-symbol">${escapeHtml(symbol)}</span>` +
    `<span class="asset-picker-row-sub">${escapeHtml(sub || name || "")}</span></span>`;
  row.addEventListener("click", () => pickBuyCoin(coin || symbol, fiat));
  return row;
}

function renderBuyPicker() {
  renderBuyPickerChips();
  const list = $("buy-picker-list");
  list.innerHTML = "";
  if (!currentNetwork) return;
  const query = $("buy-picker-search").value.trim();
  const q = query.toLowerCase();
  const matches = (sym, name) => !q || String(sym).toLowerCase().includes(q) || String(name || "").toLowerCase().includes(q);
  const seen = new Set();

  // Currencies first: US dollar / euro (fiat) and the matching dollar/euro coins.
  // A fiat row buys its coin with that currency as Transak's default.
  const knownBySymbol = {};
  (typeof TM_KNOWN_TOKENS !== "undefined" ? TM_KNOWN_TOKENS.forChain(currentNetwork.chainId) : []).forEach((t) => { knownBySymbol[String(t.symbol).toUpperCase()] = t; });
  const currencyName = (code) => {
    try { return new Intl.DisplayNames([TM_I18N.getLanguage ? TM_I18N.getLanguage() : undefined].filter(Boolean), { type: "currency" }).of(code) || code; }
    catch (e) { return code; }
  };
  const currencies = [
    { symbol: "EUR", name: currencyName("EUR"), coin: "EURC", fiat: "eur", fiatRow: true },
    { symbol: "EURC", name: (knownBySymbol.EURC || {}).name || "Euro Coin", coin: "EURC", image: knownBySymbol.EURC ? trustWalletLogoUrl(currentNetwork.key, knownBySymbol.EURC.address) : null },
    { symbol: "USD", name: currencyName("USD"), coin: "USDC", fiat: "usd", fiatRow: true },
    { symbol: "USDC", name: (knownBySymbol.USDC || {}).name || "USD Coin", coin: "USDC", image: knownBySymbol.USDC ? trustWalletLogoUrl(currentNetwork.key, knownBySymbol.USDC.address) : null },
  ].filter((c) => matches(c.symbol, c.name) || matches(c.coin, ""));
  if (currencies.length) {
    const h = document.createElement("p");
    h.className = "hint";
    h.textContent = TM_I18N.t("buy.pickerCurrencies");
    list.appendChild(h);
    currencies.forEach((c) => {
      seen.add(String(c.symbol).toUpperCase());
      list.appendChild(buyPickerRow(c.symbol, c.name, c.image || null, c.fiatRow ? `${c.name} \u2192 ${c.coin}` : c.name, c.coin, c.fiat));
    });
  }

  // Crypto: the network's own coin and USDT (issuer-verified). Other coins are
  // found by typing in the search box -- no long "top coins" list by default.
  const crypto = [];
  const nc = currentNetwork.nativeCurrency || {};
  if (nc.symbol && matches(nc.symbol, nc.name)) crypto.push({ symbol: nc.symbol, name: nc.name || nc.symbol, image: null, sub: currentNetwork.name });
  if (knownBySymbol.USDT && matches("USDT", knownBySymbol.USDT.name)) crypto.push({ symbol: "USDT", name: knownBySymbol.USDT.name, image: trustWalletLogoUrl(currentNetwork.key, knownBySymbol.USDT.address), sub: knownBySymbol.USDT.name });
  const cryptoRows = crypto.filter((c) => !seen.has(String(c.symbol).toUpperCase()));
  if (cryptoRows.length) {
    const h = document.createElement("p");
    h.className = "hint";
    h.textContent = TM_I18N.t("buy.pickerCrypto");
    list.appendChild(h);
    cryptoRows.forEach((c) => {
      seen.add(String(c.symbol).toUpperCase());
      list.appendChild(buyPickerRow(c.symbol, c.name, c.image, c.sub));
    });
  }
  if (!q) return; // nothing typed: just Currencies + Crypto
  appendBuyCatalogRows(query, list, seen);
}

async function appendBuyCatalogRows(query, list, seen) {
  const gen = ++buyPickerGen;
  if (typeof TM_CATALOG === "undefined" || !currentNetwork || !TM_CATALOG.supports(currentNetwork.key)) {
    if (!list.children.length) {
      const p = document.createElement("p");
      p.className = "hint picker-nomatch";
      p.textContent = TM_I18N.t("swap.pickerNoMatch");
      list.appendChild(p);
    }
    return;
  }
  if (query && query.length < 2) return;
  const status = document.createElement("p");
  status.className = "hint";
  status.textContent = TM_I18N.t("swap.pickerLoadingTokens");
  list.appendChild(status);
  let rows = [];
  let failed = false;
  try {
    if (query) await new Promise((r) => setTimeout(r, 350)); // wait for typing to pause
    if (gen !== buyPickerGen) return;
    rows = query ? await TM_CATALOG.search(currentNetwork.key, query, 20) : await TM_CATALOG.top(currentNetwork.key, 40);
  } catch (e) { rows = []; failed = true; }
  if (gen !== buyPickerGen) return;
  status.remove();
  if (failed) {
    const f = document.createElement("p");
    f.className = "hint";
    f.textContent = TM_I18N.t("swap.pickerLoadFailed");
    list.appendChild(f);
  }
  rows = rows.filter((t) => t.symbol && !seen.has(String(t.symbol).toUpperCase()));
  if (rows.length) {
    const h = document.createElement("p");
    h.className = "hint";
    h.textContent = TM_I18N.t(query ? "swap.pickerSearchResults" : "swap.pickerTopTokens");
    list.appendChild(h);
    rows.forEach((t) => {
      const key = String(t.symbol).toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.appendChild(buyPickerRow(t.symbol, t.name, t.image || trustWalletLogoUrl(currentNetwork.key, t.address), t.name + (t.rank ? ` · #${t.rank}` : "")));
    });
  }
  if (!list.querySelector(".asset-picker-row") && !failed) {
    const p = document.createElement("p");
    p.className = "hint picker-nomatch";
    p.textContent = TM_I18N.t("swap.pickerNoMatch");
    list.appendChild(p);
  }
}

$("buy-picker-search").addEventListener("input", () => { if (buyPickerOpen) renderBuyPicker(); });
$("buy-picker-close").addEventListener("click", () => {
  closeBuyPicker();
  // Nothing chosen: leave Buy rather than strand the person on the intro.
  showScreen("screen-main");
  refreshMain();
});

// ---------------------------------------------------------------- SELL
// Same in-app iframe pattern as Buy above.
function resetSellWidget() {
  $("sell-iframe").src = "about:blank";
  $("sell-widget").classList.add("hidden");
  $("sell-intro").classList.remove("hidden");
}

function setupSellScreen() {
  hideError("sell-error");
  resetSellWidget();
  const btn = $("btn-sell-open");
  if (btn) { btn.disabled = false; btn.classList.remove("hidden"); }
}

$("btn-sell-open").addEventListener("click", async () => {
  hideError("sell-error");
  const btn = $("btn-sell-open");
  btn.disabled = true;
  try {
    const address = (currentStatus && currentStatus.selectedAddress) || "";
    const url = await TM_TRANSAK_CONFIG.buildTransakUrl("SELL", currentNetwork.key, address, currentCurrency);
    $("sell-iframe").src = url;
    $("sell-intro").classList.add("hidden");
    $("sell-widget").classList.remove("hidden");
  } catch (e) {
    showError("sell-error", e.message);
  } finally {
    btn.disabled = false;
  }
});
$("btn-sell-close-widget").addEventListener("click", resetSellWidget);
$("btn-sell-back").addEventListener("click", resetSellWidget);

// ---------------------------------------------------------------- SETTINGS
$("btn-add-account").addEventListener("click", async () => {
  try {
    await sendMsg("TM_ADD_ACCOUNT", {});
    await refreshMain();
  } catch (e) { alert(friendlyErrorMessage(e.message)); }
});
$("btn-goto-import-key").addEventListener("click", () => showScreen("screen-import-key"));
$("btn-goto-add-watch").addEventListener("click", () => showScreen("screen-add-watch"));
$("btn-goto-approvals").addEventListener("click", () => { showScreen("screen-approvals"); renderApprovals(); });
$("btn-goto-add-network").addEventListener("click", () => showScreen("screen-add-network"));
$("btn-goto-walletconnect").addEventListener("click", () => {
  showScreen("screen-walletconnect");
  renderWcSessions();
});
$("btn-view-seed").addEventListener("click", () => showScreen("screen-view-seed"));
$("btn-goto-support-settings").addEventListener("click", () => openSupport("screen-settings"));
$("btn-lock").addEventListener("click", async () => {
  disarmAutoLock();
  await sendMsg("TM_LOCK", {});
  refreshUnlockWelcome(); showScreen("screen-unlock");
});
$("btn-goto-reset-2").addEventListener("click", () => showScreen("screen-reset"));
$("btn-reset-confirm").addEventListener("click", async () => {
  await sendMsg("TM_RESET_WALLET", {});
  await saveWalletUsername("");
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

$("btn-add-watch-submit").addEventListener("click", async () => {
  hideError("add-watch-error");
  try {
    await sendMsg("TM_ADD_WATCH_ACCOUNT", { address: $("add-watch-address").value.trim(), label: $("add-watch-label").value.trim() });
    $("add-watch-address").value = "";
    $("add-watch-label").value = "";
    await refreshMain();
    showScreen("screen-main");
  } catch (e) {
    showError("add-watch-error", e.message);
  }
});

// ---------------------------------------------------------------- APPROVALS
function approvalAmountHtml(allowanceWei, symbol, decimals) {
  if (ethers.BigNumber.from(allowanceWei).eq(ethers.constants.MaxUint256)) {
    return `<span class="decoded-unlimited">${TM_I18N.t("approve.decodedUnlimited", { symbol: escapeHtml(symbol) })}</span>`;
  }
  return escapeHtml(`${ethers.utils.formatUnits(allowanceWei, decimals)} ${symbol}`);
}

async function revokeApproval(tokenAddress, spender, btn) {
  hideError("approvals-error");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = TM_I18N.t("approvals.revokingBtn");
  try {
    await sendMsg("TM_REVOKE_APPROVAL", { tokenAddress, spender });
    await renderApprovals();
    $("approval-check-result").classList.add("hidden");
  } catch (e) {
    showError("approvals-error", friendlyErrorMessage(e.message));
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function renderApprovals() {
  hideError("approvals-error");
  const listEl = $("approvals-list");
  listEl.innerHTML = `<p class="muted small">${TM_I18N.t("approvals.loading")}</p>`;
  $("approvals-empty").classList.add("hidden");
  try {
    const res = await sendMsg("TM_LIST_APPROVALS", {});
    listEl.innerHTML = "";
    if (!res.approvals.length) {
      $("approvals-empty").classList.remove("hidden");
      return;
    }
    res.approvals.forEach((a) => {
      const row = document.createElement("div");
      row.className = "tx-details approval-row";
      const amountHtml = a.error
        ? `<span class="error">${escapeHtml(a.error)}</span>`
        : approvalAmountHtml(a.allowanceWei, a.symbol, a.decimals);
      row.innerHTML = `
        <div><span class="muted">${TM_I18N.t("approvals.tokenLabel")}</span> ${escapeHtml(a.symbol)} <span class="mono small">(${escapeHtml(a.address)})</span></div>
        <div><span class="muted">${TM_I18N.t("approvals.spenderLabel")}</span> <span class="mono small">${escapeHtml(a.spender)}</span></div>
        <div><span class="muted">${TM_I18N.t("approvals.allowanceLabel")}</span> ${amountHtml}</div>
        <button class="danger btn-revoke-approval">${TM_I18N.t("approvals.revokeBtn")}</button>
      `;
      row.querySelector(".btn-revoke-approval").addEventListener("click", (e) => revokeApproval(a.address, a.spender, e.target));
      listEl.appendChild(row);
    });
  } catch (e) {
    listEl.innerHTML = "";
    showError("approvals-error", e.message);
  }
}

$("btn-approval-check").addEventListener("click", async () => {
  hideError("approvals-error");
  $("approval-check-result").classList.add("hidden");
  const tokenAddress = $("approval-check-token").value.trim();
  const spender = $("approval-check-spender").value.trim();
  try {
    const res = await sendMsg("TM_CHECK_APPROVAL", { tokenAddress, spender });
    const amountHtml = approvalAmountHtml(res.allowanceWei, res.symbol, res.decimals);
    $("approval-check-result").innerHTML = `<div>${TM_I18N.t("approvals.allowanceLabel")} ${amountHtml}</div>`;
    if (ethers.BigNumber.from(res.allowanceWei).gt(0)) {
      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = TM_I18N.t("approvals.revokeBtn");
      btn.addEventListener("click", () => revokeApproval(tokenAddress, spender, btn));
      $("approval-check-result").appendChild(btn);
    }
    $("approval-check-result").classList.remove("hidden");
  } catch (e) {
    showError("approvals-error", e.message);
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
  refreshSendFeePreview();
});

// Estimated network fee, shown on the form itself before the user even
// taps Send -- and echoed into the confirm card below -- the same "you'll
// pay about this much in gas" preview MetaMask and Coinbase Wallet both
// show up front. This app never surfaced any fee estimate before. Always
// paid in the chain's native currency, whether the transfer itself is
// native or a token.
// Networks where the EIP-1559 base fee is burned (destroyed), so the
// "burned" line is accurate. L2s and BNB Chain are left out on purpose --
// their fee flows differ, and showing a burn number there would mislead.
function networkBurnsBaseFee() {
  const key = currentNetwork && currentNetwork.key;
  return key === "ethereum" || key === "polygon";
}

// Shows "Of that, ~X ETH is burned" from base fee x gas units. It's an
// estimate: the base fee moves block to block.
function renderBurnLine(el, baseFeeWei, gasUnits) {
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
  if (!networkBurnsBaseFee() || !baseFeeWei || !gasUnits) return;
  try {
    const burnWei = ethers.BigNumber.from(baseFeeWei).mul(ethers.BigNumber.from(gasUnits));
    const n = Number(ethers.utils.formatEther(burnWei));
    if (!(n > 0)) return;
    const burn = n < 0.000001
      ? "<0.000001"
      : n.toLocaleString(undefined, { maximumSignificantDigits: 2, maximumFractionDigits: 10 });
    el.textContent = TM_I18N.t("fee.burned", { burn, symbol: currentNetwork.nativeCurrency.symbol });
    el.classList.remove("hidden");
  } catch (e) { /* best-effort only */ }
}

let sendFeePreviewToken = 0; // guards against a slow, stale estimate landing after a newer one
let lastSendFeeWei = null;
let sendFeePreviewTimer = null;

// Adjustable send speed (gas) -- "standard" matches the network's own
// suggested fee; "slow"/"fast" scale it down/up (see scaleFeeDataForSpeed
// in wallet-engine.js). Resets to "standard" each time the Send screen is
// opened fresh, same as MetaMask/Coinbase Wallet default back to their
// middle tier rather than remembering a previous choice.
let currentSendSpeed = "standard";
let lastFeeTiers = null; // { slow, standard, fast } wei strings from the last estimate

function setSendSpeed(speed) {
  currentSendSpeed = speed;
  document.querySelectorAll(".send-speed-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.speed === speed);
  });
}

document.querySelectorAll(".send-speed-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.speed === currentSendSpeed) return;
    setSendSpeed(btn.dataset.speed);
    estimateSendFeeNow();
  });
});

function clearSendFeePreview() {
  lastSendFeeWei = null;
  lastFeeTiers = null;
  $("send-speed-row").classList.add("hidden");
  $("send-fee-preview").classList.add("hidden");
  $("send-fee-preview").textContent = "";
  renderBurnLine($("send-fee-burn"), null, null);
}

async function estimateSendFeeNow() {
  const to = currentSendToAddress(); // raw address, or a name already resolved to one -- never the unresolved name text
  const amountStr = $("send-amount").value.trim();
  const isNative = $("send-asset-select").value === "native";
  const tokenAddress = isNative ? null : $("send-token-address").value.trim();

  if (!to || !amountStr || Number(amountStr) <= 0) {
    clearSendFeePreview();
    return;
  }
  if (!isNative && !ethers.utils.isAddress(tokenAddress)) {
    clearSendFeePreview();
    return;
  }

  const myToken = ++sendFeePreviewToken;
  $("send-speed-row").classList.remove("hidden");
  $("send-fee-preview").classList.remove("hidden");
  $("send-fee-preview").textContent = TM_I18N.t("send.feeEstimateLoading");

  try {
    let amountWei;
    if (isNative) {
      amountWei = ethers.utils.parseEther(amountStr);
    } else {
      const info = await sendMsg("TM_GET_TOKEN_BALANCE", { address: currentStatus.selectedAddress, tokenAddress });
      amountWei = ethers.utils.parseUnits(amountStr, info.decimals);
    }
    const res = await sendMsg("TM_ESTIMATE_SEND_FEE", {
      to,
      amountWei: amountWei.toString(),
      tokenAddress: isNative ? null : tokenAddress,
    });
    if (myToken !== sendFeePreviewToken) return; // a newer estimate has since started

    lastFeeTiers = res.tiers || null;
    const selectedFeeWei = (lastFeeTiers && lastFeeTiers[currentSendSpeed]) || res.feeWei;
    lastSendFeeWei = selectedFeeWei;
    const symbol = (currentNetwork && currentNetwork.nativeCurrency.symbol) || "";
    const feeFormatted = Number(ethers.utils.formatEther(selectedFeeWei)).toPrecision(3).replace(/\.?0+$/, "");

    let usdText = null;
    try {
      const price = await TM_PRICES.getNativePriceForNetwork(currentNetwork.key, currentCurrency);
      if (price != null) usdText = formatCurrency(Number(ethers.utils.formatEther(selectedFeeWei)) * price);
    } catch (e) {
      // Best-effort only -- the native-amount fee line below still stands on its own.
    }
    if (myToken !== sendFeePreviewToken) return;

    $("send-fee-preview").textContent = usdText
      ? TM_I18N.t("send.feeEstimate", { fee: feeFormatted, symbol, usd: usdText })
      : TM_I18N.t("send.feeEstimateNoUsd", { fee: feeFormatted, symbol });
    renderBurnLine($("send-fee-burn"), res.baseFeeWei, res.gasUnits);
  } catch (e) {
    if (myToken !== sendFeePreviewToken) return;
    // Common and expected -- e.g. the amount exceeds the balance, or the
    // RPC is briefly unavailable. Never block sending on this: the real fee
    // is still confirmed by the wallet before anything is signed.
    lastSendFeeWei = null;
    $("send-fee-preview").textContent = TM_I18N.t("send.feeEstimateUnavailable");
  }
}

// Debounced so a fast typist doesn't fire an RPC call per keystroke.
function refreshSendFeePreview() {
  clearTimeout(sendFeePreviewTimer);
  sendFeePreviewTimer = setTimeout(estimateSendFeeNow, 500);
}

$("send-to").addEventListener("input", refreshSendFeePreview);
$("send-amount").addEventListener("input", refreshSendFeePreview);
$("send-token-address").addEventListener("input", refreshSendFeePreview);

// Send delay / cancel window -- see Settings. Every send made from this
// screen is held for this many seconds (with a visible countdown and a
// Cancel button) before it's actually signed and broadcast, so a
// fat-fingered address or a send you change your mind about can still be
// stopped. It's a UI-level safety net for sends made *through this app*
// only -- it can't do anything about a key or recovery phrase that's
// already been exposed outside Token Exchange, since anyone holding
// those can sign and broadcast directly, bypassing this screen entirely.
const TM_SEND_DELAY_KEY = "tm_send_delay_seconds";
let currentSendDelaySeconds = 30;
let pendingSendTimer = null; // { intervalId, secondsLeft, cancelled }

function loadSendDelay() {
  return new Promise((resolve) => {
    chrome.storage.local.get([TM_SEND_DELAY_KEY], (res) => {
      const stored = res[TM_SEND_DELAY_KEY];
      currentSendDelaySeconds = typeof stored === "number" ? stored : 30;
      resolve();
    });
  });
}

function populateSendDelaySelect() {
  const sel = $("send-delay-select");
  sel.value = String(currentSendDelaySeconds);
  sel.addEventListener("change", (e) => {
    currentSendDelaySeconds = Number(e.target.value) || 0;
    chrome.storage.local.set({ [TM_SEND_DELAY_KEY]: currentSendDelaySeconds });
  });
}

// ---------------------------------------------------------------- AUTO-LOCK
// unlockedSecret (see wallet-engine.js) lives in this same page's memory for
// as long as the tab stays open -- there's no separate background process
// here to time it out the way a real browser extension's service worker
// could. This is the page-level equivalent: after N minutes with no click,
// tap, or keystroke anywhere in the app, lock exactly the way the "Lock
// wallet" button does. 5 minutes by default (matching MetaMask's own
// out-of-the-box auto-lock timer), fully configurable in Settings.
const TM_AUTO_LOCK_KEY = "tm_auto_lock_minutes";
let currentAutoLockMinutes = 21; // default for anyone who has not picked a value
let autoLockTimerId = null;
let autoLockArmed = false; // only true once a real wallet session is unlocked
let autoLockLastReset = 0;

function loadAutoLockMinutes() {
  return new Promise((resolve) => {
    chrome.storage.local.get([TM_AUTO_LOCK_KEY], (res) => {
      const stored = res[TM_AUTO_LOCK_KEY];
      currentAutoLockMinutes = typeof stored === "number" ? stored : 21;
      resolve();
    });
  });
}

function populateAutoLockSelect() {
  const sel = $("auto-lock-select");
  sel.value = String(currentAutoLockMinutes);
  sel.addEventListener("change", (e) => {
    currentAutoLockMinutes = Number(e.target.value) || 0;
    chrome.storage.local.set({ [TM_AUTO_LOCK_KEY]: currentAutoLockMinutes });
    resetAutoLockTimer();
  });
}

function clearAutoLockTimer() {
  if (autoLockTimerId) {
    clearTimeout(autoLockTimerId);
    autoLockTimerId = null;
  }
}

function resetAutoLockTimer() {
  clearAutoLockTimer();
  if (!autoLockArmed || !currentAutoLockMinutes) return;
  autoLockTimerId = setTimeout(async () => {
    autoLockArmed = false;
    try {
      await sendMsg("TM_LOCK", {});
    } catch (e) {
      // Already locked, or the page is mid-navigation -- either way there's
      // nothing left to protect, so just make sure the UI reflects it.
    }
    resetSendConfirmUi();
    refreshUnlockWelcome(); showScreen("screen-unlock");
  }, currentAutoLockMinutes * 60 * 1000);
}

// Arms (or re-arms) the idle timer. Called every time the app reaches an
// unlocked, authenticated state (see refreshMain()) -- cheap and idempotent,
// so calling it again on every account/network switch is fine.
function armAutoLock() {
  autoLockArmed = true;
  resetAutoLockTimer();
}

function disarmAutoLock() {
  autoLockArmed = false;
  clearAutoLockTimer();
}

// Any real user activity resets the countdown. Throttled to roughly once
// every 2 seconds so a stream of mousemove events doesn't churn
// clearTimeout/setTimeout on every pixel of movement.
["click", "keydown", "touchstart", "scroll", "mousemove"].forEach((evt) => {
  document.addEventListener(
    evt,
    () => {
      if (!autoLockArmed) return;
      const now = Date.now();
      if (now - autoLockLastReset < 2000) return;
      autoLockLastReset = now;
      resetAutoLockTimer();
    },
    { passive: true }
  );
});

// "Known address" = already in the address book, or already sent to from
// this device -- used only to show a heads-up in the confirm step, never
// to block anything.
async function isKnownAddress(address) {
  const result = await findAddressWarning(address);
  return result.level === "known";
}

// Address-poisoning heuristic: an attacker generates a vanity address that
// shares the same leading and trailing characters as one you've genuinely
// used before (cheap to do with public vanity-address tools), then gets it
// into your history -- e.g. sending it a dust transfer -- hoping a quick
// glance at "0x1a2b...9f3c" won't catch that the middle is entirely
// different. Checked only against addresses this device already has on
// file (contacts + past send recipients), never against arbitrary chain
// data, so this can only warn about something concretely known here --
// never guess at a false match.
function isLookalikeAddress(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return false; // identical is "known", not "lookalike"
  if (x.length !== y.length) return false;
  const PREFIX = 6; // chars after "0x" that must match
  const SUFFIX = 4;
  if (x.length < 2 + PREFIX + SUFFIX) return false;
  return x.slice(0, 2 + PREFIX) === y.slice(0, 2 + PREFIX) && x.slice(-SUFFIX) === y.slice(-SUFFIX);
}

// Returns one of:
//   { level: "known" }          -- exact match on file, no warning needed
//   { level: "poison", match }  -- not on file, but a near-identical lookalike is
//   { level: "new" }            -- genuinely unseen, generic "first time" warning
async function findAddressWarning(address) {
  const target = address.toLowerCase();
  const contacts = await getContacts();
  const activity = await new Promise((resolve) => {
    chrome.storage.local.get([TM_ACTIVITY_KEY], (res) => resolve(Array.isArray(res[TM_ACTIVITY_KEY]) ? res[TM_ACTIVITY_KEY] : []));
  });
  const knownAddresses = [
    ...contacts.map((c) => c.address || ""),
    ...activity.filter((a) => a.direction === "out" && a.to).map((a) => a.to),
  ].filter(Boolean);

  if (knownAddresses.some((k) => k.toLowerCase() === target)) return { level: "known" };
  const lookalike = knownAddresses.find((k) => isLookalikeAddress(k, address));
  if (lookalike) return { level: "poison", match: lookalike };
  return { level: "new" };
}

function resetSendConfirmUi() {
  if (pendingSendTimer) {
    clearInterval(pendingSendTimer.intervalId);
    pendingSendTimer = null;
  }
  $("send-confirm-card").classList.add("hidden");
  $("send-confirm-new-address-warning").classList.add("hidden");
  $("send-confirm-poison-warning").classList.add("hidden");
  $("btn-send-submit").disabled = false;
  $("send-to").disabled = false;
  $("send-amount").disabled = false;
  $("send-asset-select").disabled = false;
  document.querySelectorAll(".send-speed-btn").forEach((btn) => { btn.disabled = false; });
}

// Cancels any in-progress countdown if the user navigates away from the
// Send screen before it fires (back button, a nav icon, anything else) --
// leaving early should never leave a send silently ticking down unseen.
const _origShowScreenForSend = showScreen;
showScreen = function (id) {
  if (pendingSendTimer && id !== "screen-send") resetSendConfirmUi();
  return _origShowScreenForSend(id);
};

async function executeSend({ to, amountStr, isNative, tokenAddress, speed }) {
  let res;
  if (isNative) {
    const amountWei = ethers.utils.parseEther(amountStr || "0");
    res = await sendMsg("TM_SEND_NATIVE", { to, amountWei: amountWei.toString(), speed });
  } else {
    const info = await sendMsg("TM_GET_TOKEN_BALANCE", { address: currentStatus.selectedAddress, tokenAddress });
    const amountWei = ethers.utils.parseUnits(amountStr || "0", info.decimals);
    res = await sendMsg("TM_SEND_TOKEN", { to, tokenAddress, amountWei: amountWei.toString(), speed });
  }
  $("send-status").textContent = TM_I18N.t("send.sentStatus", { txHash: res.txHash });
  $("send-status").classList.remove("hidden");
  const sentAsset = isNative ? (currentNetwork && currentNetwork.nativeCurrency.symbol) || "" : "token";
  // Captured at send time (not looked up again when the Activity list is
  // rendered) so a later network switch can't make an old entry link to
  // the wrong chain's explorer -- each entry always points at whichever
  // network the transaction actually went out on.
  recordActivity({
    direction: "out",
    amount: amountStr,
    asset: sentAsset,
    to,
    txHash: res.txHash,
    blockExplorer: (currentNetwork && currentNetwork.blockExplorer) || "",
    networkName: (currentNetwork && currentNetwork.name) || "",
  });
  await refreshBalance();
}

$("btn-send-cancel").addEventListener("click", () => {
  resetSendConfirmUi();
  hideError("send-error");
  $("send-status").textContent = TM_I18N.t("send.cancelledStatus");
  $("send-status").classList.remove("hidden");
});

$("btn-send-submit").addEventListener("click", async () => {
  hideError("send-error");
  $("send-status").classList.add("hidden");
  try {
    const typedTo = $("send-to").value.trim();
    const to = currentSendToAddress(); // resolves a name to its looked-up address; never sends to unresolved name text
    if (!to) throw new Error(TM_I18N.t("send.invalidRecipient"));
    const amountStr = $("send-amount").value.trim();
    const isNative = $("send-asset-select").value === "native";
    const tokenAddress = isNative ? null : $("send-token-address").value.trim();
    if (!isNative && !ethers.utils.isAddress(tokenAddress)) throw new Error(TM_I18N.t("send.invalidTokenAddress"));
    // Captured now, at the moment Send is actually pressed -- not re-read
    // later, so nothing that happens during the cancel-window countdown
    // (or a stray click) can change which tier a send goes out at.
    const speed = currentSendSpeed;

    if (!currentSendDelaySeconds) {
      // Delay turned off in Settings -- send immediately, same as before.
      await executeSend({ to, amountStr, isNative, tokenAddress, speed });
      return;
    }

    const sentAsset = isNative ? (currentNetwork && currentNetwork.nativeCurrency.symbol) || "" : "token";
    const addressWarning = await findAddressWarning(to);

    $("btn-send-submit").disabled = true;
    $("send-to").disabled = true;
    $("send-amount").disabled = true;
    $("send-asset-select").disabled = true;
    document.querySelectorAll(".send-speed-btn").forEach((btn) => { btn.disabled = true; });
    // When a name was typed, show the resolved address alongside it -- the
    // countdown/confirm step is exactly where that should be double-checked.
    const displayTo = typedTo !== to ? `${typedTo} (${to})` : to;
    $("send-confirm-summary").textContent = TM_I18N.t("send.confirmSummary", { amount: amountStr, asset: sentAsset, to: displayTo });
    if (lastSendFeeWei) {
      const symbol = (currentNetwork && currentNetwork.nativeCurrency.symbol) || "";
      const feeFormatted = Number(ethers.utils.formatEther(lastSendFeeWei)).toPrecision(3).replace(/\.?0+$/, "");
      $("send-confirm-fee").textContent = TM_I18N.t("send.confirmFeeLine", { fee: feeFormatted, symbol });
      $("send-confirm-fee").classList.remove("hidden");
    } else {
      $("send-confirm-fee").classList.add("hidden");
    }
    $("send-confirm-new-address-warning").classList.toggle("hidden", addressWarning.level !== "new");
    if (addressWarning.level === "poison") {
      $("send-confirm-poison-warning").textContent = TM_I18N.t("send.poisonWarning", { match: addressWarning.match });
      $("send-confirm-poison-warning").classList.remove("hidden");
    } else {
      $("send-confirm-poison-warning").classList.add("hidden");
    }
    $("send-confirm-card").classList.remove("hidden");

    let secondsLeft = currentSendDelaySeconds;
    $("send-confirm-intro").textContent = TM_I18N.t("send.confirmIntro", { seconds: secondsLeft });
    const intervalId = setInterval(async () => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(intervalId);
        pendingSendTimer = null;
        resetSendConfirmUi();
        try {
          await executeSend({ to, amountStr, isNative, tokenAddress, speed });
        } catch (e) {
          showError("send-error", e.message);
        }
        return;
      }
      $("send-confirm-intro").textContent = TM_I18N.t("send.confirmIntro", { seconds: secondsLeft });
    }, 1000);
    pendingSendTimer = { intervalId };
  } catch (e) {
    showError("send-error", e.message);
  }
});

// ---------------------------------------------------------------- SWAP
function setupSwapScreen(pre) {
  hideError("swap-error");
  $("swap-status").classList.add("hidden");
  closeAssetPicker();
  clearSwapQuote();
  $("swap-amount-in").value = "";
  const unsupported = !currentNetwork.swapRouter;
  $("swap-unsupported").classList.toggle("hidden", !unsupported);
  $("swap-form").classList.toggle("hidden", unsupported);
  if (!unsupported) populateSwapSelects(pre || {}).catch(() => {});
}

// Resets the quote/breakdown area back to its empty state -- called on any
// change (amount, asset, or slippage) so a stale quote/price is never left
// on screen next to inputs that no longer match it.
function clearSwapQuote() {
  swapAutoQuoteGen++;
  $("swap-quoting-hint").classList.add("hidden");
  $("swap-quote-display").classList.add("hidden");
  $("btn-swap-execute").disabled = true;
  $("swap-amount-out").textContent = "0.0";
  $("swap-amount-out").classList.remove("has-value");
  $("swap-to-usd").textContent = "";
  $("swap-from-usd").textContent = "";
  delete $("swap-quote-display").dataset.tokenIn;
  delete $("swap-quote-display").dataset.tokenOut;
  delete $("swap-quote-display").dataset.totalAmountInWei;
  delete $("swap-quote-display").dataset.netAmountInWei;
  delete $("swap-quote-display").dataset.amountOutWei;
  delete $("swap-quote-display").dataset.decimalsOut;
  delete $("swap-quote-display").dataset.needsApprove;
}

// Looks up a live unit price for a held/custom asset, in currentCurrency.
// Returns null (rather than throwing) on anything unpriced -- USD display
// is a nice-to-have here, never a blocker for getting a quote.
async function getAssetUsdPrice(address) {
  try {
    if (!address) return await TM_PRICES.getNativePriceForNetwork(currentNetwork.key, currentCurrency);
    const res = await TM_PRICES.getTokenPricesByContract(currentNetwork.key, [address], currentCurrency);
    const entry = res[address.toLowerCase()];
    return entry ? entry.price : null;
  } catch (e) {
    return null;
  }
}

function renderSwapMinReceived() {
  const ds = $("swap-quote-display").dataset;
  if (!ds.amountOutWei) return;
  const slippageBps = Number($("swap-slippage").value);
  const minWei = ethers.BigNumber.from(ds.amountOutWei).mul(10000 - slippageBps).div(10000);
  const symbolOut = ds.symbolOut || "";
  $("swap-min-received-line").textContent =
    `${ethers.utils.formatUnits(minWei, Number(ds.decimalsOut) || 18)} ${symbolOut}`;
}
// The tolerance is baked into the quote (0x calldata carries its own minimum
// output), so changing it makes the shown quote invalid: drop it and ask for a
// fresh one at the new tolerance.
$("swap-slippage").addEventListener("change", () => {
  clearSwapQuote();
  scheduleSwapAutoQuote();
});

let swapAutoQuoteGen = 0;
let swapAutoQuoteTimer = null;
function scheduleSwapAutoQuote() {
  clearTimeout(swapAutoQuoteTimer);
  swapAutoQuoteTimer = setTimeout(runSwapAutoQuote, 450);
}

async function runSwapAutoQuote() {
  const myGen = ++swapAutoQuoteGen;
  hideError("swap-error");
  const tokenIn = $("swap-from-custom").value.trim() || TM_NATIVE();
  const tokenOut = $("swap-to-custom").value.trim() || TM_NATIVE();
  const amountStr = $("swap-amount-in").value.trim();
  const amountNum = Number(amountStr);
  if (!currentNetwork.swapRouter || !amountStr || !isFinite(amountNum) || amountNum <= 0) {
    $("swap-quoting-hint").classList.add("hidden");
    return;
  }
  $("swap-quoting-hint").classList.remove("hidden");
  $("swap-quote-display").classList.add("hidden");
  $("btn-swap-execute").disabled = true;
  try {
    let decimalsIn = 18, symbolIn = (currentNetwork.nativeCurrency && currentNetwork.nativeCurrency.symbol) || "";
    if (tokenIn !== TM_NATIVE()) {
      const info = await sendMsg("TM_GET_TOKEN_BALANCE", { address: currentStatus.selectedAddress, tokenAddress: tokenIn });
      decimalsIn = info.decimals; symbolIn = info.symbol || symbolIn;
    }
    // This is the TOTAL amount the user is putting in -- the app fee comes
    // off the top of this before anything is swapped (see TM_SWAP_QUOTE in
    // background.js / lib/fee-config.js).
    const totalAmountInWei = ethers.utils.parseUnits(amountStr, decimalsIn);
    const quote = await sendMsg("TM_SWAP_QUOTE", { tokenIn, tokenOut, amountInWei: totalAmountInWei.toString(), slippageBps: Number($("swap-slippage").value) });
    if (myGen !== swapAutoQuoteGen) return; // superseded by a newer edit

    let decimalsOut = 18, symbolOut = (currentNetwork.nativeCurrency && currentNetwork.nativeCurrency.symbol) || "";
    if (tokenOut !== TM_NATIVE()) {
      const info = await sendMsg("TM_GET_TOKEN_BALANCE", { address: currentStatus.selectedAddress, tokenAddress: tokenOut });
      decimalsOut = info.decimals; symbolOut = info.symbol || symbolOut;
    }
    if (myGen !== swapAutoQuoteGen) return;

    const amountOutStr = ethers.utils.formatUnits(quote.amountOutWei, decimalsOut);
    $("swap-amount-out").textContent = Number(amountOutStr).toLocaleString(undefined, { maximumFractionDigits: 6 });
    $("swap-amount-out").classList.add("has-value");

    const rate = amountNum > 0 ? Number(amountOutStr) / amountNum : 0;
    $("swap-rate-line").textContent = `1 ${symbolIn} \u2248 ${rate.toLocaleString(undefined, { maximumSignificantDigits: 4, maximumFractionDigits: 12 })} ${symbolOut}`;
    $("swap-fee-line").textContent = TM_I18N.t("swap.appFeeValue", {
      percent: quote.feePercentLabel,
      amount: ethers.utils.formatUnits(quote.feeWei, decimalsIn),
      symbol: symbolIn,
    });

    const ds = $("swap-quote-display").dataset;
    ds.tokenIn = tokenIn; ds.tokenOut = tokenOut;
    ds.totalAmountInWei = totalAmountInWei.toString();
    ds.netAmountInWei = quote.netAmountInWei;
    ds.amountOutWei = quote.amountOutWei.toString();
    ds.decimalsOut = String(decimalsOut);
    ds.symbolOut = symbolOut;
    ds.priceImpactBps = quote.priceImpactBps == null ? "" : String(quote.priceImpactBps);
    renderPriceImpact(quote.priceImpactBps);
    renderSwapMinReceived();

    // Router allowance only ever needs to cover the NET amount -- the fee
    // portion moves as a separate plain transfer, never through the router.
    // We used to surface this as a second, separate "Approve token first"
    // button the user had to notice and click before "Swap" would even
    // enable -- confusing, and not how MetaMask's own swap UI works (it
    // just does the approve tx first, invisibly to the flow, then the swap
    // tx, behind a single click). ds.needsApprove records what we found so
    // the single btn-swap-execute handler below can do the same thing.
    ds.needsApprove = "0";
    $("btn-swap-execute").disabled = false;
    if (tokenIn !== TM_NATIVE()) {
      const allowanceRes = await sendMsg("TM_SWAP_ALLOWANCE", { tokenAddress: tokenIn });
      if (ethers.BigNumber.from(allowanceRes.allowanceWei).lt(quote.netAmountInWei)) {
        ds.needsApprove = "1";
      }
    }
    if (myGen !== swapAutoQuoteGen) return;
    $("swap-quoting-hint").classList.add("hidden");
    $("swap-quote-display").classList.remove("hidden");
    renderSwapGasEstimate(myGen, tokenIn, ds.needsApprove === "1"); // fire-and-forget

    // Live USD estimates, best-effort -- never block the quote on these.
    const [priceIn, priceOut] = await Promise.all([getAssetUsdPrice(tokenIn === TM_NATIVE() ? "" : tokenIn), getAssetUsdPrice(tokenOut === TM_NATIVE() ? "" : tokenOut)]);
    if (myGen !== swapAutoQuoteGen) return;
    $("swap-from-usd").textContent = priceIn != null ? TM_PRICES.formatMoney(amountNum * priceIn, currentCurrency) : "";
    $("swap-to-usd").textContent = priceOut != null ? TM_PRICES.formatMoney(Number(amountOutStr) * priceOut, currentCurrency) : "";
  } catch (e) {
    if (myGen !== swapAutoQuoteGen) return;
    $("swap-quoting-hint").classList.add("hidden");
    showError("swap-error", e.message);
  }
}

// ---------------------------------------------------------------- SWAP NETWORK FEE
// Shows what the whole swap (approve if needed + app-fee transfer + swap) will
// cost in network fees, and warns when the account can't pay it -- that
// shortfall is exactly what used to surface as a confusing "couldn't get a
// response from the network" on Approve. Best-effort: never blocks the swap.
// Price impact (basis points -> text) and the advisory banner. Advisory only: the
// number can be missing (aggregator route, dust amounts), in which case nothing shows.
function formatImpactPercent(bps) {
  return (bps / 100).toLocaleString(undefined, { maximumFractionDigits: bps < 100 ? 2 : 1 }) + "%";
}
function renderPriceImpact(bps) {
  const row = $("swap-impact-row"), line = $("swap-impact-line"), warn = $("swap-impact-warning");
  if (row) row.classList.add("hidden");
  warn.classList.add("hidden");
  if (bps == null) return;
  const pct = formatImpactPercent(bps);
  if (row && line) { line.textContent = "≈ " + pct; row.classList.remove("hidden"); }
  if (bps >= 300) {
    warn.textContent = TM_I18N.t(bps >= 1000 ? "swap.priceImpactHigh" : "swap.priceImpactWarn", { percent: pct });
    warn.classList.remove("hidden");
  }
}

async function renderSwapGasEstimate(gen, tokenIn, needsApprove) {
  const lineEl = $("swap-gas-line"), breakdownEl = $("swap-gas-breakdown"), warnEl = $("swap-gas-warning");
  if (!lineEl) return;
  lineEl.textContent = "\u2026";
  breakdownEl.classList.add("hidden");
  warnEl.classList.add("hidden");
  renderBurnLine($("swap-gas-burn"), null, null);
  try {
    const est = await sendMsg("TM_SWAP_GAS_ESTIMATE", { tokenIn, needsApprove });
    if (gen !== swapAutoQuoteGen) return;
    const symbol = currentNetwork.nativeCurrency.symbol;
    const fmtEth = (wei) => {
      const n = Number(ethers.utils.formatEther(wei));
      if (n === 0) return "0";
      if (n < 0.000001) return "<0.000001";
      return n.toLocaleString(undefined, { maximumSignificantDigits: 2, maximumFractionDigits: 10 });
    };
    let text = `\u2248 ${fmtEth(est.totalWei)} ${symbol}`;
    lineEl.textContent = text;
    const gwei = Number(ethers.utils.formatUnits(est.gasPriceWei, "gwei"));
    const gweiText = gwei.toLocaleString(undefined, { maximumSignificantDigits: 2, maximumFractionDigits: 6 });
    breakdownEl.textContent = est.steps.map((s) => `${TM_I18N.t("swap.gasStep_" + s.key)} ${fmtEth(s.feeWei)}`).join(" \u00b7 ")
      + ` \u00b7 ${TM_I18N.t("swap.gasPriceLabel")} ${gweiText} gwei`;
    breakdownEl.classList.remove("hidden");
    renderBurnLine($("swap-gas-burn"), est.baseFeeWei, est.steps.reduce((sum, s) => sum + s.gasUnits, 0));

    // fiat + low-balance warning, both best-effort
    const [price, bal] = await Promise.all([
      getAssetUsdPrice("").catch(() => null),
      sendMsg("TM_GET_BALANCE", { address: currentStatus.selectedAddress }).catch(() => null),
    ]);
    if (gen !== swapAutoQuoteGen) return;
    if (price != null) {
      const fiat = Number(ethers.utils.formatEther(est.totalWei)) * price;
      lineEl.textContent = `${text} (~${TM_PRICES.formatMoney(fiat, currentCurrency)})`;
    }
    if (bal && ethers.BigNumber.from(bal.balanceWei).lt(ethers.BigNumber.from(est.totalWei).mul(12).div(10))) {
      warnEl.textContent = TM_I18N.t("swap.gasLowEth", { need: fmtEth(est.totalWei), have: fmtEth(bal.balanceWei), symbol });
      warnEl.classList.remove("hidden");
    }
  } catch (e) {
    if (gen !== swapAutoQuoteGen) return;
    lineEl.textContent = TM_I18N.t("swap.gasUnavailable");
  }
}

// Single "Swap" button now does approve-then-swap as one user action when
// the router doesn't already have enough allowance -- see the needsApprove
// note in runSwapAutoQuote above. If the approve tx itself fails (rejected,
// out of gas, RPC error, etc.) we stop there and show that error; we only
// move on to TM_SWAP_EXECUTE once the approve has actually gone through.
$("btn-swap-execute").addEventListener("click", async () => {
  hideError("swap-error");
  const ds = $("swap-quote-display").dataset;
  // A very thin pool can eat most of the amount: ask before going ahead (10%+).
  const impactBps = ds.priceImpactBps === undefined || ds.priceImpactBps === "" ? null : Number(ds.priceImpactBps);
  if (impactBps != null && impactBps >= 1000 && !window.confirm(TM_I18N.t("swap.priceImpactConfirm", { percent: formatImpactPercent(impactBps) }))) return;
  $("btn-swap-execute").disabled = true;
  try {
    const tokenIn = ds.tokenIn;
    const tokenOut = ds.tokenOut;
    const totalAmountInWei = ds.totalAmountInWei;
    const netAmountInWei = ds.netAmountInWei;
    const slippageBps = Number($("swap-slippage").value);

    if (ds.needsApprove === "1") {
      $("swap-status").textContent = TM_I18N.t("swap.approvingStatus");
      $("swap-status").classList.remove("hidden");
      await sendMsg("TM_SWAP_APPROVE", { tokenAddress: tokenIn, amountWei: netAmountInWei });
      ds.needsApprove = "0";
    }

    $("swap-status").textContent = TM_I18N.t("swap.sendingStatus");
    $("swap-status").classList.remove("hidden");
    const res = await sendMsg("TM_SWAP_EXECUTE", { tokenIn, tokenOut, amountInWei: totalAmountInWei, slippageBps, quotedAmountOutWei: ds.amountOutWei });
    $("swap-status").textContent = TM_I18N.t("swap.swappedStatus", { feeTx: res.feeTxHash || TM_I18N.t("swap.feeTxNa"), tx: res.txHash });
    $("swap-amount-in").value = "";
    clearSwapQuote();
    await refreshBalance();
    populateSwapSelects({ toKey: swapState.toKey }).catch(() => {});
  } catch (e) {
    showError("swap-error", e.message);
    $("btn-swap-execute").disabled = false;
  }
});

function TM_NATIVE() { return "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; }

// ---------------------------------------------------------------- APPROVAL MODE
async function initApprovalFlow(requestId) {
  let pending;
  try {
    pending = await sendMsg("TM_GET_PENDING_REQUEST", { requestId });
  } catch (e) {
    document.body.innerHTML = `<div class="screen"><p class="error">${escapeHtml(friendlyErrorMessage(e.message))}</p></div>`;
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
  // The extension opens a SEPARATE popup window for this and closes just
  // that window when done. This standalone site has no second window to
  // close -- this same tab is the whole wallet -- so instead go back to
  // whatever screen was showing before the WalletConnect request came in.
  // (window.__tmApprovalReturnScreen is set by TM_SHOW_APPROVAL below.)
  const back = window.__tmApprovalReturnScreen || "screen-main";
  window.__tmApprovalReturnScreen = null;
  showScreen(back);
  if (back === "screen-main") refreshMain();
}

// ---------------------------------------------------------------- WEB-WALLET BRIDGE
// wallet-engine.js's openApprovalPopup() calls this instead of the
// extension's chrome.windows.create(...) -- there's nowhere else to open a
// real second window that could see this tab's in-memory unlocked wallet,
// so a WalletConnect connect/sign/transaction request is shown right in
// this page using the exact same approve screens the extension has always
// had (see initApprovalFlow/renderApproval above), and afterwards this
// page returns to whatever screen it was showing before.
window.TM_SHOW_APPROVAL = function (requestId) {
  const current = document.querySelector(".screen:not(.hidden)");
  window.__tmApprovalReturnScreen = (current && current.id) || "screen-main";
  initApprovalFlow(requestId);
};

// ---------------------------------------------------------------- TX DECODE
// Plain-language preview of a transaction's raw call data on the approve
// screen, decoded entirely from a small bundled dictionary of common
// ERC-20/router function signatures -- never a network call to a
// third-party "simulation" service, consistent with the rest of this
// wallet's "nothing leaves your device but the RPC calls you already
// trust" posture. This is NOT a real simulation: it reads the call's own
// declared parameters, it does not execute anything to see what would
// actually happen, and an unrecognized selector (most custom router/
// contract calls) is left undecoded on purpose rather than guessed at --
// the raw To/Value/Data box below it is still the source of truth.
const TM_TX_DECODE_ABI = [
  "function transfer(address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function deposit()",
  "function withdraw(uint256 amount)",
  "function multicall(bytes[] data)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
];
let tmTxDecodeInterface = null;
function tmTxDecodeTryParse(data) {
  if (!data || data === "0x" || data.length < 10) return null;
  try {
    tmTxDecodeInterface = tmTxDecodeInterface || new ethers.utils.Interface(TM_TX_DECODE_ABI);
    return tmTxDecodeInterface.parseTransaction({ data });
  } catch (e) {
    return null; // selector not in our small dictionary -- stay quiet, don't guess
  }
}

async function renderTxDecodeSummary(tx) {
  const el = $("approve-tx-decoded");
  el.classList.add("hidden");
  el.innerHTML = "";
  const parsed = tmTxDecodeTryParse(tx.data);
  if (!parsed) return;
  const { name, args, functionFragment } = parsed;

  if (name === "approve" || name === "transfer" || name === "transferFrom") {
    const amountArg = name === "transferFrom" ? args[2] : args[1];
    const targetArg = name === "transferFrom" ? args[1] : args[0];
    const isUnlimited = amountArg.eq(ethers.constants.MaxUint256);
    el.innerHTML = `<p class="decoded-line">${TM_I18N.t("approve.decodedLoading")}</p>`;
    el.classList.remove("hidden");
    let symbol = "", amountDisplay = amountArg.toString() + TM_I18N.t("approve.decodedRawUnitsSuffix");
    try {
      const info = await sendMsg("TM_LOOKUP_TOKEN", { tokenAddress: tx.to });
      symbol = info.symbol;
      if (!isUnlimited) amountDisplay = `${ethers.utils.formatUnits(amountArg, info.decimals)} ${symbol}`;
    } catch (e) { /* token lookup failed -- fall back to the raw integer amount set above */ }
    const verbKey = name === "approve" ? "approve.decodedApproveLine" : "approve.decodedTransferLine";
    const amountHtml = isUnlimited
      ? `<span class="decoded-unlimited">${TM_I18N.t("approve.decodedUnlimited", { symbol: symbol || TM_I18N.t("approve.decodedThisToken") })}</span>`
      : escapeHtml(amountDisplay);
    el.innerHTML = `<p class="decoded-line">${TM_I18N.t(verbKey, { amount: amountHtml, to: `<span class="mono">${escapeHtml(targetArg)}</span>` })}</p>`;
  } else {
    const lines = functionFragment.inputs
      .map((inp, i) => `<div class="decoded-arg"><span class="muted">${escapeHtml(inp.name || `arg${i}`)}:</span><span class="mono small">${escapeHtml(String(args[i]))}</span></div>`)
      .join("");
    el.innerHTML = `<p class="decoded-line">${TM_I18N.t("approve.decodedGenericIntro", { fn: name })}</p>${lines}`;
    el.classList.remove("hidden");
  }
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
    renderTxDecodeSummary(payload.tx); // not awaited -- best-effort, upgrades in place once (if) the token lookup resolves
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
        alert(friendlyErrorMessage(e.message));
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
const TM_LANGUAGE_FLAGS = {
  en: "\u{1F1FA}\u{1F1F8}", // English -> US
  ar: "\u{1F1F8}\u{1F1E6}", // Arabic -> Saudi Arabia
  zh: "\u{1F1E8}\u{1F1F3}", // Chinese (Simplified) -> China
  es: "\u{1F1EA}\u{1F1F8}", // Spanish -> Spain
  fr: "\u{1F1EB}\u{1F1F7}", // French -> France
  hi: "\u{1F1EE}\u{1F1F3}", // Hindi -> India
  pt: "\u{1F1F5}\u{1F1F9}", // Portuguese -> Portugal
  ja: "\u{1F1EF}\u{1F1F5}", // Japanese -> Japan
  ru: "\u{1F1F7}\u{1F1FA}", // Russian -> Russia
};

function populateLanguageSelects() {
  document.querySelectorAll(".language-select").forEach((sel) => {
    sel.innerHTML = "";
    TM_I18N.LANGS.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      const flag = TM_LANGUAGE_FLAGS[lang.code];
      opt.textContent = flag ? `${flag} ${lang.name}` : lang.name;
      sel.appendChild(opt);
    });
    sel.value = TM_I18N.getLanguage();
    sel.addEventListener("change", (e) => TM_I18N.setLanguage(e.target.value));
  });
}

function populateCurrencySelect() {
  const sel = $("currency-select-settings");
  sel.innerHTML = "";
  const groups = { fiat: document.createElement("optgroup"), crypto: document.createElement("optgroup") };
  groups.fiat.label = "Currencies";
  groups.crypto.label = "Crypto";
  Object.keys(TM_PRICES.SUPPORTED_CURRENCIES).forEach((code) => {
    const info = TM_PRICES.SUPPORTED_CURRENCIES[code];
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${info.label} - ${info.name} (${info.symbol})`;
    (groups[info.type] || groups.fiat).appendChild(opt);
  });
  sel.appendChild(groups.fiat);
  sel.appendChild(groups.crypto);
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
  // scan can't reach: the network sheet's per-item "(swap unavailable)"
  // caption (only if it's actually open right now -- openNetworkPicker()
  // always builds it fresh otherwise), and the support chat's topic chips
  // if that screen has been opened already. Past chat messages intentionally
  // stay in whatever language they were sent/answered in, like a real chat
  // history would.
  if (!$("network-picker-sheet").classList.contains("hidden")) renderNetworkPickerGrid();
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
  // Two genuinely separate pages, not a card sitting on top of another:
  // the real app-frame card stays fully invisible (not just behind the
  // splash in z-order) until this exact moment, so there's never a
  // window where both are visible/peeking at once -- see the matching
  // CSS rule for body.tm-web-wallet.tm-splash-dismissed #app-frame.
  document.body.classList.add("tm-splash-dismissed");
  const tagline = $("splash-tagline");
  if (tagline) tagline.remove();
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
    setSendSpeed("standard");
    showScreen("screen-send");
    refreshSendFeePreview();
  });
}

// Before a wallet exists (or while still locked), there's no real
// balance/activity/send data yet for the tab bar to route into -- but the
// splash art is still nicer to land on than an instant jump to a plain
// form. This keeps the same branded bar up as the landing view without
// the auto-fade-after-900ms behavior; every tab (not just Home) simply
// reveals whatever's underneath (onboarding or unlock), since that's the
// only place to go from here.
let splashLandingActivated = false;
function activateSplashLanding() {
  if (splashHomeActivated || splashLandingActivated) return;
  splashLandingActivated = true;
  clearSplashAutoTimers();
  const el = $("splash-screen");
  if (!el) return;
  // Distinct from splash-home: no wallet exists yet (or it's locked), so
  // the Home/Assets/Activity/Send bar doesn't apply here -- see the CSS
  // for #splash-screen.splash-landing. Instead this shows a language
  // picker (populateLanguageSelects(), called once during init(), already
  // wires up any .language-select it finds -- including this one, since
  // it's in the static DOM from the start) plus an explicit Continue
  // button. Deliberately NOT a whole-screen tap target anymore: that would
  // swallow clicks meant for the language <select> sitting on top of it.
  el.classList.add("splash-landing");
  const continueBtn = $("splash-continue-btn");
  if (continueBtn) continueBtn.addEventListener("click", () => hideSplash());
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

// Builds a block-explorer tx URL from data recorded at send time (see
// executeSend), the same way MetaMask/Coinbase Wallet make each Activity
// entry open its transaction on Etherscan (or that chain's equivalent).
// Both inputs are ultimately app-controlled (this wallet's own networks.js
// list, or a URL the user themselves typed in when adding a custom
// network) rather than attacker-supplied, but this still only builds a
// link for a well-formed http(s) explorer base + a real-looking tx hash --
// never for anything else -- so a bad/missing value just means no link
// instead of a broken or unexpected one. Returns null when there's nothing
// safe to link to (older activity entries recorded before this feature
// existed won't have blockExplorer/txHash in this shape, for instance).
function buildExplorerTxUrl(blockExplorer, txHash) {
  if (!blockExplorer || typeof blockExplorer !== "string" || !/^https:\/\//i.test(blockExplorer)) return null;
  if (!txHash || typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  return `${blockExplorer.replace(/\/+$/, "")}/tx/${txHash}`;
}

// ---------------------------------------------------------------- INCOMING ACTIVITY (best-effort)
// This app has no backend, no chain indexer, and (by design -- see the
// CoinGecko/Trust-Wallet-CDN choices elsewhere) no Etherscan-style API key,
// so there is no service anywhere it can ask "what has ever been sent to
// this address." The only signal available is the balance itself: if it
// went up since this device last checked, something arrived. That's cheap
// enough to piggyback on the balance/token refreshes this app already does
// (refreshBalance / refreshTokens), with no extra RPC calls of its own.
//
// What this can't do, by construction: report anything that happened
// before the FIRST time this device saw a given account+network(+token) --
// there's no earlier balance to compare against, so that first check just
// records a baseline rather than reporting the account's entire existing
// balance as "received" (which would misfire on every newly-created or
// newly-imported account, and every time a token already held is added to
// the tracked list); catch a same-poll round trip where a balance went up
// and back down between two checks; or attach a real transaction hash or
// block-explorer link, since a balance delta doesn't carry one. It only
// ever runs forward from whenever it's turned on for a given account --
// there is no historical backfill.
const TM_LAST_SEEN_BALANCES_KEY = "tm_last_seen_balances";

function loadLastSeenBalances() {
  return new Promise((resolve) => {
    chrome.storage.local.get([TM_LAST_SEEN_BALANCES_KEY], (res) => {
      const val = res[TM_LAST_SEEN_BALANCES_KEY];
      resolve(val && typeof val === "object" ? val : {});
    });
  });
}

// key identifies one account+network(+token) combination, e.g.
// "0xabc...:base:native" or "0xabc...:base:0xTokenAddress".
async function checkForIncomingBalance(key, currentBalanceWei, meta) {
  try {
    const seen = await loadLastSeenBalances();
    const prevStr = seen[key];
    const current = ethers.BigNumber.from(currentBalanceWei);
    if (prevStr != null) {
      const prev = ethers.BigNumber.from(prevStr);
      if (current.gt(prev)) {
        recordActivity({
          direction: "in",
          amount: ethers.utils.formatUnits(current.sub(prev), meta.decimals),
          asset: meta.symbol,
          networkName: meta.networkName,
        });
      }
    }
    if (prevStr == null || !current.eq(ethers.BigNumber.from(prevStr))) {
      seen[key] = current.toString();
      chrome.storage.local.set({ [TM_LAST_SEEN_BALANCES_KEY]: seen });
    }
  } catch (e) {
    // Best-effort only -- this must never interfere with the balance/token
    // display it's piggybacking on.
  }
}

// While the main screen is open, poll for incoming balance changes every
// 25s -- frequent enough to notice a receive without leaving and
// re-entering the screen, infrequent enough not to hammer a public RPC
// endpoint. Stops the moment the user navigates away, same as the
// auto-lock timer only running while genuinely on an unlocked screen.
const TM_INCOMING_POLL_MS = 25000;
let incomingPollTimerId = null;

function startIncomingPoll() {
  stopIncomingPoll();
  incomingPollTimerId = setInterval(() => {
    refreshBalance();
    refreshTokens();
  }, TM_INCOMING_POLL_MS);
}

function stopIncomingPoll() {
  if (incomingPollTimerId) {
    clearInterval(incomingPollTimerId);
    incomingPollTimerId = null;
  }
}

const _origShowScreenForIncomingPoll = showScreen;
showScreen = function (id) {
  if (id === "screen-main") startIncomingPoll();
  else stopIncomingPoll();
  return _origShowScreenForIncomingPoll(id);
};

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
      // Older entries (recorded before this field existed) have no
      // `direction` at all -- every one of those was a send, so treat a
      // missing direction the same as "out".
      const isIncoming = item.direction === "in";
      const explorerUrl = isIncoming ? null : buildExplorerTxUrl(item.blockExplorer, item.txHash);
      // A real <a> when there's somewhere to link -- free keyboard access,
      // "open in new tab", and middle-click, instead of reimplementing all
      // of that on a plain div. Falls back to a plain div (unchanged from
      // before) for entries with no usable link -- always true for a
      // balance-delta-detected incoming entry, which never has a real tx hash.
      const card = document.createElement(explorerUrl ? "a" : "div");
      card.className = "activity-entry" + (explorerUrl ? " activity-entry-linked" : "");
      if (explorerUrl) {
        card.href = explorerUrl;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
        card.title = TM_I18N.t("activity.viewOnExplorer");
      }

      // Directional icon: an up-right arrow for a send, a down-left arrow
      // (mirrored, in the app's success-green) for a detected incoming
      // transfer -- the same at-a-glance shorthand MetaMask's own activity
      // feed uses for send vs. receive.
      const icon = document.createElement("span");
      icon.className = "activity-icon" + (isIncoming ? " activity-icon-in" : "");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = isIncoming
        ? '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M17 7L7 17M7 17H15M7 17V9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
          "</svg>"
        : '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
          "</svg>";

      const body = document.createElement("div");
      body.className = "activity-body";

      const top = document.createElement("div");
      top.className = "activity-top";
      const main = document.createElement("div");
      main.className = "activity-main";
      main.textContent = isIncoming
        ? TM_I18N.t("activity.receivedLabel", { amount: item.amount, asset: item.asset })
        : TM_I18N.t("activity.sentLabel", { amount: item.amount, asset: item.asset });
      const status = document.createElement("span");
      status.className = "activity-status";
      status.textContent = isIncoming ? TM_I18N.t("activity.statusReceived") : TM_I18N.t("activity.statusSent");
      top.appendChild(main);
      top.appendChild(status);

      const sub = document.createElement("div");
      sub.className = "activity-sub";
      sub.textContent = isIncoming ? (item.networkName || "") : TM_I18N.t("activity.toLabel", { address: item.to });
      const time = document.createElement("div");
      time.className = "activity-time";
      time.textContent = new Date(item.ts).toLocaleString();

      body.appendChild(top);
      body.appendChild(sub);
      if (isIncoming) {
        const approx = document.createElement("div");
        approx.className = "activity-sub activity-approx-note";
        approx.textContent = TM_I18N.t("activity.receivedApproxNote");
        body.appendChild(approx);
      }
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
  await loadSendDelay();
  populateSendDelaySelect();
  await loadAutoLockMinutes();
  populateAutoLockSelect();

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
    activateSplashLanding();
  } else if (!status.unlocked) {
    refreshUnlockWelcome(); showScreen("screen-unlock");
    activateSplashLanding();
  } else {
    await refreshMain();
    showScreen("screen-main");
    activateSplashHome();
  }
})();
// Moves the copyright line off the global footer (was showing on
// every screen) so it only appears on the Settings page, and
// changes the text from your last name to "Token Exchange".
// Self-contained: does not touch or depend on any other code in
// the file, so it's safe to paste at the end regardless of what
// else is in app.js.
// ============================================================
(function () {
  function fixCopyrightPlacement() {
    var globalCopyright = document.querySelector("#app-footer .footer-copyright");
    if (globalCopyright) globalCopyright.remove();

    var settingsScreen = document.getElementById("screen-settings");
    if (settingsScreen && !settingsScreen.querySelector(".settings-copyright")) {
      var span = document.createElement("span");
      span.className = "footer-copyright settings-copyright";
      span.innerHTML = "&copy; 2026 Token Exchange";
      settingsScreen.appendChild(span);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fixCopyrightPlacement);
  } else {
    fixCopyrightPlacement();
  }
})();
