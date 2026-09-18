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
};
function trustWalletLogoUrl(networkKey, address) {
  const folder = TRUST_WALLET_CHAIN_FOLDER[networkKey];
  if (!folder || !address) return null;
  let checksummed;
  try {
    checksummed = ethers.utils.getAddress(address);
  } catch (e) {
    return null;
  }
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${checksummed}/logo.png`;
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

// ---------------------------------------------------------------- CUBE NAV
// Home, Activity and Send are the app's three "peer" destinations -- the
// same three the splash screen's own tab bar already treats as equal
// starting points (see activateSplashHome() below; Assets is the fourth
// icon there, but it's always just been screen-main scrolled to the
// tokens list, not a separate screen, so it stays that way here too).
// Once inside the app these three now live as three faces of a rotating
// cube (see cube-nav.js) instead of plain sibling screens that just swap
// with a hard cut: clicking Send from Home, or hitting Back from Send,
// turns the cube instead. Every other screen -- Settings, Swap, Buy, Add
// token, the dapp-approval dialogs, and so on -- still shows/hides exactly
// like before, as a plain overlay on top of the cube (its own Back button
// always returns to screen-main, landing back on the cube's Home face).
const CUBE_FACE_ORDER = ["screen-main", "screen-activity", "screen-send"];
let cubeNav = null;

function mountCubeNav() {
  if (cubeNav || !window.CubeNav) return;
  const stageRoot = $("cube-stage");
  if (!stageRoot) return;
  const faces = CUBE_FACE_ORDER.map((id) => ({ id, el: $(id) }));
  if (faces.some((f) => !f.el)) return;
  cubeNav = window.CubeNav.mount(stageRoot, { faces, start: 0, duration: 650, bar: false });
  // The cube keeps every face permanently in the DOM (just rotated out of
  // view) so the 3D transform has something to show on every side -- so
  // these three stop being ".hidden"-toggled like a normal screen the
  // moment the cube takes them over. CubeNav's own aria-hidden/inert/dim
  // handles "not the current face" instead.
  CUBE_FACE_ORDER.forEach((id) => $(id).classList.remove("hidden"));
  stageRoot.addEventListener("facechange", updateCubeTabbarActive);
  updateCubeTabbarActive();
}

function updateCubeTabbarActive() {
  const bar = $("cube-tabbar");
  if (!bar || !cubeNav) return;
  const activeId = CUBE_FACE_ORDER[cubeNav.index];
  bar.querySelectorAll(".cube-tab").forEach((btn) => {
    const goto = btn.dataset.cubeGoto;
    btn.classList.toggle("active", goto !== "assets" && CUBE_FACE_ORDER[Number(goto)] === activeId);
  });
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    if (!CUBE_FACE_ORDER.includes(el.id)) el.classList.add("hidden");
  });
  const shell = $("cube-shell");
  const faceIndex = CUBE_FACE_ORDER.indexOf(id);
  if (faceIndex >= 0) {
    mountCubeNav();
    if (shell) shell.classList.remove("hidden");
    if (cubeNav) cubeNav.go(faceIndex);
    else $(id).classList.remove("hidden"); // CubeNav script missing/failed -- fall back to a plain screen
  } else {
    if (shell) shell.classList.add("hidden");
    $(id).classList.remove("hidden");
  }
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
const FRIENDLY_ERROR_PATTERNS = [
  { re: /could not detect network|NETWORK_ERROR/i, text: "Couldn't reach the network. Check your connection and try again." },
  { re: /insufficient funds/i, text: "Not enough balance to cover this amount plus the network fee." },
  { re: /user rejected|ACTION_REJECTED/i, text: "That request was cancelled." },
  { re: /nonce has already been used|nonce too low/i, text: "That transaction couldn't be sent right now -- please try again." },
  { re: /replacement (fee|transaction) too low|underpriced/i, text: "Network fees just changed -- please try again." },
  { re: /timeout|ETIMEDOUT/i, text: "The network took too long to respond. Please try again." },
  { re: /rate limit|too many requests|\b429\b/i, text: "Too many requests right now -- please wait a moment and try again." },
  { re: /call_exception|execution reverted/i, text: "The network rejected this request. Double-check the details and try again." },
  { re: /invalid response|server_error|processing response error/i, text: "Couldn't get a response from the network. Please try again." },
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
  return looksTechnical ? "Something went wrong talking to the network. Please try again." : msg;
}

function showError(id, message) {
  const el = $(id);
  el.textContent = friendlyErrorMessage(message);
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

// ---------------------------------------------------------------- IDENTICONS
function updateAccountIdenticon(address) {
  const el = $("account-identicon");
  if (el) el.innerHTML = address ? TM_IDENTICON.svgFor(address, 28) : "";
}

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
$("btn-goto-send").addEventListener("click", () => { setSendSpeed("standard"); showScreen("screen-send"); refreshSendFeePreview(); });
$("btn-goto-swap").addEventListener("click", () => { setupSwapScreen(); showScreen("screen-swap"); });
$("btn-goto-prices").addEventListener("click", () => { showScreen("screen-prices"); refreshPrices(); });
$("btn-goto-predictions").addEventListener("click", () => { showScreen("screen-predictions"); refreshPredictions(); });
$("btn-goto-buy").addEventListener("click", () => { setupBuyScreen(); showScreen("screen-buy"); });
$("btn-goto-sell").addEventListener("click", () => { hideError("sell-error"); showScreen("screen-sell"); });
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

    const removeBtn = document.createElement("button");
    removeBtn.className = "token-remove-btn";
    removeBtn.title = TM_I18N.t("tokens.removeTitle");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      await sendMsg("TM_REMOVE_TRACKED_TOKEN", { tokenAddress: t.address });
      await refreshTokens();
    });

    row.insertAdjacentHTML("beforeend", tokenIconHtml(t.symbol, trustWalletLogoUrl(currentNetwork && currentNetwork.key, t.address)));
    row.appendChild(mainEl);
    row.appendChild(balEl);
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
      : `${currencySymbol()}${c.price.toLocaleString(undefined, { minimumFractionDigits: c.price < 1 ? 4 : 2, maximumFractionDigits: c.price < 1 ? 4 : 2 })}`;
  let changeHtml = "";
  if (typeof c.change24h === "number") {
    const cls = c.change24h >= 0 ? "up" : "down";
    const sign = c.change24h >= 0 ? "+" : "";
    changeHtml = `<span class="price-change ${cls}">${sign}${c.change24h.toFixed(2)}%</span>`;
  }
  const starred = isWatchlisted(c.symbol);
  row.innerHTML = `
    <span class="price-left">${tokenIconHtml(c.symbol, c.image)}<span><span class="price-name">${c.name}</span><span class="price-symbol">${c.symbol}</span></span></span>
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

// ---------------------------------------------------------------- SELL
$("btn-sell-open").addEventListener("click", () => {
  hideError("sell-error");
  try {
    const url = TM_SELL_CONFIG.buildSellUrl(currentNetwork.key, currentCurrency);
    chrome.tabs.create({ url });
  } catch (e) {
    showError("sell-error", e.message);
  }
});

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
let currentAutoLockMinutes = 5;
let autoLockTimerId = null;
let autoLockArmed = false; // only true once a real wallet session is unlocked
let autoLockLastReset = 0;

function loadAutoLockMinutes() {
  return new Promise((resolve) => {
    chrome.storage.local.get([TM_AUTO_LOCK_KEY], (res) => {
      const stored = res[TM_AUTO_LOCK_KEY];
      currentAutoLockMinutes = typeof stored === "number" ? stored : 5;
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
    showScreen("screen-unlock");
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
  // for #splash-screen.splash-landing. The whole splash becomes one big
  // "tap to continue" target instead of four nav icons that don't yet
  // mean anything.
  el.classList.add("splash-landing");
  el.addEventListener("click", () => hideSplash());
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
    showScreen("screen-unlock");
    activateSplashLanding();
  } else {
    await refreshMain();
    showScreen("screen-main");
    activateSplashHome();
  }
})();
