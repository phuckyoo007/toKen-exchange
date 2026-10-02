// ui-common.js -- helpers and constants that the website (app.js) and the Chrome
// extension popup (popup.js) both use. They used to be pasted into each file
// and had to be edited twice; now there is one copy.
//
// Loaded as a plain classic script BEFORE app.js / popup.js, so everything
// declared here is a global both files can use directly. Do not redeclare any of
// these names in app.js or popup.js (tests/shared-ui.test.js checks that).
// Needs, at call time: TM_PRICES, TM_IDENTICON, qrcode, chrome.storage/runtime,
// and (for the cube helpers) window.CubeNav.

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
  return TM_PRICES.formatMoney(amount, currentCurrency);
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
  robinhood: "#9BE400",
  avalanche: "#E84142",
  monad: "#836EF9",
  linea: "#61DFFF",
  scroll: "#FFEEDA",
  zksync: "#8C8DFC",
  mantle: "#65B3AE",
  gnosis: "#04795B",
  celo: "#FCFF52",
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

function escapeHtml(str) {
  // Escapes &, <, > AND both quote characters. The old version (textContent ->
  // innerHTML) left " and ' alone, which is unsafe anywhere the result lands
  // inside an attribute value such as src="..." or aria-label="...".
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function hideError(id) { $(id).classList.add("hidden"); }

// ---------------------------------------------------------------- IDENTICONS
function updateAccountIdenticon(address) {
  const el = $("account-identicon");
  if (el) el.innerHTML = address ? TM_IDENTICON.svgFor(address, 28) : "";
}

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
