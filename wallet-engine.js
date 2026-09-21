// wallet-engine.js -- the standalone-website port of background/background.js.
//
// The browser extension splits into two JS contexts: a service worker
// ("background") that holds the unlocked wallet secret and does all the
// real work, and the popup UI, which talks to it via
// chrome.runtime.sendMessage. A plain webpage has no service worker and no
// second context to split across -- there's just this one page. So this
// file is that same background logic, moved into this page's own global
// scope, with app.js (the ported popup.js) still calling
// chrome.runtime.sendMessage exactly as before -- shim.js is what makes
// that call land here instead of crossing an extension message boundary.
// Net effect: app.js needed no changes at all for this part.
//
// Dropped entirely versus the extension's background.js: everything that
// only existed to service requests FORWARDED FROM AN INJECTED PROVIDER ON
// SOME OTHER WEBSITE (handleDappRequest, broadcastEventToOrigin, approved-
// origins tracking, wallet_switchEthereumChain/wallet_addEthereumChain as
// dapp-triggered RPC methods). A plain webpage cannot inject a provider
// into other sites' pages the way an extension's content script can, so
// there is no dapp connection path here other than WalletConnect -- kept
// below, unchanged, since it never depended on any of that.

// ---------------------------------------------------------------- SEND SPEED
// A single "worst-case ceiling" fee estimate (see TM_ESTIMATE_SEND_FEE
// below) works fine as a preview, but real wallets let the sender trade
// speed for cost: pay closer to the network's current suggested fee and
// wait longer ("slow"), or pay a premium to jump the queue ("fast").
// Multiplying the provider's own fee suggestion is a coarse approximation
// (a real fee market would look at pending-block fee percentiles), but it's
// a safe one: this only ever raises the ceiling the sender is willing to
// pay, it never lowers a transaction's chance of being included below what
// "standard" already gets, and it needs no extra RPC calls beyond the one
// getFeeData() every send already made.
const SEND_SPEED_MULTIPLIER_BPS = { slow: 100, standard: 115, fast: 140 };

// Scales a provider's getFeeData() result for the given speed tier, in
// integer basis-points math (BigNumber has no floating point), returning
// only the override fields that apply to this chain's fee model -- EIP-1559
// chains quote maxFeePerGas/maxPriorityFeePerGas, older chains only
// gasPrice, and passing both to ethers on the wrong chain type throws.
function scaleFeeDataForSpeed(feeData, speed) {
  const bps = SEND_SPEED_MULTIPLIER_BPS[speed] || SEND_SPEED_MULTIPLIER_BPS.standard;
  const scale = (bn) => bn.mul(bps).div(100);
  if (feeData.maxFeePerGas) {
    const maxPriorityFeePerGas = scale(feeData.maxPriorityFeePerGas || feeData.maxFeePerGas);
    return { maxFeePerGas: scale(feeData.maxFeePerGas), maxPriorityFeePerGas };
  }
  return { gasPrice: scale(feeData.gasPrice || ethers.BigNumber.from(0)) };
}

// The single number used for a fee PREVIEW (what the Send screen shows
// before committing) -- the ceiling this tier could cost, same "worst
// case, may come in lower" framing TM_ESTIMATE_SEND_FEE already used.
function feePerGasForPreview(overrides) {
  return overrides.maxFeePerGas || overrides.gasPrice || ethers.BigNumber.from(0);
}

function assertNotSanctioned(address, label) {
  if (TM_SANCTIONS.isSanctionedAddress(address)) {
    throw new Error(
      `This ${label || "address"} (${address}) matches an address on the OFAC sanctions list and cannot be used with this wallet.`
    );
  }
}

// ---- in-memory session state (cleared on lock / page reload -- there is no
// persistent background process here, so "session" means "this tab, until
// you close or reload it") ----
let unlockedSecret = null; // { mnemonic, importedKeys }
let unlockedPassword = null;
let selectedAddress = null;
// Set by TM_PREPARE_PASSWORD_CHANGE, consumed by TM_COMMIT_PASSWORD_CHANGE --
// see those cases below for why this is split into two steps.
let pendingNewPassword = null;

// Set by TM_SWAP_QUOTE, read by TM_SWAP_ALLOWANCE/TM_SWAP_APPROVE/
// TM_SWAP_EXECUTE so those steps use whichever spender/transaction the
// quote actually used (the 0x aggregator, or this network's own router)
// without app.js's swap-screen code needing to know or care which. See
// swapRouteKey()/aggregatorRouteMatches() below for how staleness (a
// network switch, or the user changing the pair) is guarded against.
let lastSwapRoute = null;

// Loose key (chain + input token only) -- safe for picking WHICH SPENDER
// to approve, since approving the real 0x allowance-holder contract for a
// token is harmless even if the trade that prompted it never happens.
function swapRouteKey(network, tokenIn) {
  return `${network.chainId}:${(tokenIn || "native").toLowerCase()}`;
}

// Strict match -- required before ever broadcasting the aggregator's
// saved transaction, since that calldata encodes an exact
// tokenIn/tokenOut/amount. Anything less exact and we fall back to the
// direct router path instead of risking a swap into the wrong asset.
function aggregatorRouteMatches(route, network, tokenIn, tokenOut, netAmountInWei) {
  return !!(
    route &&
    route.kind === "aggregator" &&
    route.chainId === network.chainId &&
    route.tokenIn === (tokenIn || "native").toLowerCase() &&
    route.tokenOut === (tokenOut || "native").toLowerCase() &&
    route.netAmountInWei === netAmountInWei.toString()
  );
}

const pendingRequests = new Map(); // requestId -> { resolve, reject, type, payload, origin }

function newRequestId() {
  return "req_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---- tracked (user-added) ERC-20 tokens, per chain ----
const TRACKED_TOKENS_KEY = "tm_tracked_tokens";

async function getTrackedTokens(chainId) {
  const stored = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
  const all = stored[TRACKED_TOKENS_KEY] || {};
  return all[chainId] || [];
}

async function saveTrackedTokens(chainId, tokens) {
  const stored = await chrome.storage.local.get(TRACKED_TOKENS_KEY);
  const all = stored[TRACKED_TOKENS_KEY] || {};
  all[chainId] = tokens;
  await chrome.storage.local.set({ [TRACKED_TOKENS_KEY]: all });
}

// ---- tracked (user-added) NFTs, per chain -- same shape/pattern as tracked
// ERC-20 tokens above, storing just enough to look the NFT back up
// (contract + token ID + standard) rather than caching its artwork/name,
// which is re-fetched from the collection's own metadata each time. ----
const TRACKED_NFTS_KEY = "tm_tracked_nfts";

async function getTrackedNfts(chainId) {
  const stored = await chrome.storage.local.get(TRACKED_NFTS_KEY);
  const all = stored[TRACKED_NFTS_KEY] || {};
  return all[chainId] || [];
}

async function saveTrackedNfts(chainId, nfts) {
  const stored = await chrome.storage.local.get(TRACKED_NFTS_KEY);
  const all = stored[TRACKED_NFTS_KEY] || {};
  all[chainId] = nfts;
  await chrome.storage.local.set({ [TRACKED_NFTS_KEY]: all });
}

// An NFT's tokenURI/metadata is written by whoever deployed or minted that
// contract -- it's untrusted input, same category as a webpage's own
// content, not something this wallet's own code produced. Every helper
// below treats it that way: a narrow IPFS rewrite, a bounded fetch, and an
// image-URL allowlist rather than a blocklist, so a malicious collection
// can't do anything worse than fail to display.
const NFT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

function resolveMaybeIpfsUri(uri) {
  if (!uri || typeof uri !== "string") return uri;
  if (uri.startsWith("ipfs://")) {
    return NFT_IPFS_GATEWAY + uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  return uri;
}

// Only http(s) URLs or genuine image data: URIs are ever handed to the UI
// for use as an <img src> -- never javascript:, text/html, or anything
// else that could do something unexpected just by being displayed. This is
// an allowlist, not an attempt to blocklist specific bad schemes.
function sanitizeNftImageUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  const url = resolveMaybeIpfsUri(raw.trim());
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(url)) return url;
  return null;
}

async function fetchNftMetadataJson(tokenUri) {
  const url = resolveMaybeIpfsUri(tokenUri);
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("This NFT's metadata URI isn't a fetchable http(s)/ipfs link.");
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Metadata fetch failed (HTTP ${res.status}).`);
    const text = await res.text();
    if (text.length > 500000) throw new Error("Metadata response was too large to use.");
    return JSON.parse(text);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Tries ERC-721's tokenURI(id) first, then falls back to ERC-1155's
// uri(id) -- there's no on-chain "which standard is this" call, so
// attempting the more common one first and falling back is the same
// approach MetaMask's own NFT detection uses. The {id} placeholder handling
// on the 1155 path is required by that standard itself (EIP-1155), not
// optional cleanup.
async function readNftTokenUri(provider, contractAddress, tokenIdBn) {
  try {
    const c721 = new ethers.Contract(contractAddress, ["function tokenURI(uint256) view returns (string)"], provider);
    const tokenUri = await c721.tokenURI(tokenIdBn);
    return { standard: "erc721", tokenUri };
  } catch (e721) {
    const c1155 = new ethers.Contract(contractAddress, ["function uri(uint256) view returns (string)"], provider);
    let tokenUri = await c1155.uri(tokenIdBn);
    if (tokenUri && tokenUri.includes("{id}")) {
      tokenUri = tokenUri.replace("{id}", tokenIdBn.toHexString().slice(2).padStart(64, "0"));
    }
    return { standard: "erc1155", tokenUri };
  }
}

// Shows the SAME approve screens the extension's popup.html has always had
// (screen-approve-connect/tx/sign/addnetwork -- see index.html), just
// in-place in this one page instead of in a second popup window, since
// there's nowhere else for a second window to get its own copy of
// `unlockedSecret` from. Only WalletConnect calls this now (see below) --
// there's no injected-provider path left to call it from a real dapp
// origin. window.TM_SHOW_APPROVAL is defined in app.js's small web-wallet
// bridge at the bottom of this page's script list.
function openApprovalPopup(type, payload, origin) {
  return new Promise((resolve, reject) => {
    const requestId = newRequestId();
    pendingRequests.set(requestId, { resolve, reject, type, payload, origin });
    if (typeof window !== "undefined" && typeof window.TM_SHOW_APPROVAL === "function") {
      window.TM_SHOW_APPROVAL(requestId);
    } else {
      pendingRequests.delete(requestId);
      reject(new Error("Approval UI is unavailable on this page."));
    }
  });
}

async function getActiveNetwork() {
  return TM_NETWORKS.getSelectedNetwork();
}

async function getSelectedAccountMeta() {
  const meta = await TM_WALLET.getAccountsMeta();
  if (!meta.length) return null;
  if (selectedAddress) {
    const found = meta.find((a) => a.address.toLowerCase() === selectedAddress.toLowerCase());
    if (found) return found;
  }
  return meta[0];
}

function requireUnlocked() {
  if (!unlockedSecret) {
    const err = new Error("Wallet is locked.");
    err.code = "TM_LOCKED";
    throw err;
  }
}

// ---- RPC provider / fallback (unchanged from the extension) ----
const RPC_HEALTH_CACHE_TTL_MS = 20 * 1000;
const rpcHealthCache = new Map();

async function pickHealthyRpcUrl(network) {
  const urls = network.rpcUrls || [];
  if (urls.length <= 1) return urls[0];

  const cached = rpcHealthCache.get(network.key);
  if (cached && Date.now() - cached.checkedAt < RPC_HEALTH_CACHE_TTL_MS && urls.includes(cached.url)) {
    return cached.url;
  }

  for (const url of urls) {
    try {
      const healthy = await Promise.race([
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: ["0x0000000000000000000000000000000000000000", "latest"] }),
        })
          .then((res) => res.json())
          .then((json) => !!json && !json.error && typeof json.result !== "undefined"),
        new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      if (healthy) {
        rpcHealthCache.set(network.key, { url, checkedAt: Date.now() });
        return url;
      }
    } catch (e) {
      // try the next URL
    }
  }
  return urls[0];
}

async function getProviderFor(network) {
  const url = await pickHealthyRpcUrl(network);
  return new ethers.providers.JsonRpcProvider(url);
}

async function rpcPassthrough(network, method, params) {
  const urls = network.rpcUrls && network.rpcUrls.length ? network.rpcUrls : [undefined];
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = await res.json();
      if (json.error) {
        lastError = new Error(json.error.message || "RPC error");
        continue;
      }
      return json.result;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("RPC request failed and no endpoint was configured.");
}

// The signing logic behind eth_sendTransaction/personal_sign/
// eth_signTypedData_v4 -- reused, unchanged, by the WalletConnect path
// below (originLabel is a synthesized "Dapp Name (https://dapp.url)"
// string, since a WC request has no browser tab/origin of its own).
async function handleSigningMethod(method, params, network, originLabel) {
  if (method === "eth_sendTransaction") {
    requireUnlocked();
    const txParams = params[0];
    assertNotSanctioned(txParams.from, "sending account");
    if (txParams.to) assertNotSanctioned(txParams.to, "destination address");
    await openApprovalPopup("transaction", { tx: txParams, origin: originLabel }, originLabel);
    const meta = (await TM_WALLET.getAccountsMeta()).find(
      (a) => a.address.toLowerCase() === (txParams.from || "").toLowerCase()
    );
    if (!meta) throw new Error("Unknown sending account.");
    const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(await getProviderFor(network));
    const tx = await wallet.sendTransaction({
      to: txParams.to,
      value: txParams.value || 0,
      data: txParams.data || "0x",
      gasLimit: txParams.gas,
    });
    return tx.hash;
  }

  if (method === "personal_sign") {
    requireUnlocked();
    const [message, address] = params;
    await openApprovalPopup("sign", { message, address, origin: originLabel }, originLabel);
    const meta = (await TM_WALLET.getAccountsMeta()).find((a) => a.address.toLowerCase() === address.toLowerCase());
    if (!meta) throw new Error("Unknown signing account.");
    const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta);
    const msgBytes = ethers.utils.isHexString(message) ? ethers.utils.arrayify(message) : ethers.utils.toUtf8Bytes(message);
    return wallet.signMessage(msgBytes);
  }

  // eth_signTypedData_v4
  requireUnlocked();
  const [address, typedDataJson] = params;
  const typedData = typeof typedDataJson === "string" ? JSON.parse(typedDataJson) : typedDataJson;
  await openApprovalPopup("signTypedData", { typedData, address, origin: originLabel }, originLabel);
  const meta = (await TM_WALLET.getAccountsMeta()).find((a) => a.address.toLowerCase() === address.toLowerCase());
  if (!meta) throw new Error("Unknown signing account.");
  const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta);
  const { domain, types, message } = typedData;
  delete types.EIP712Domain;
  return wallet._signTypedData(domain, types, message);
}

// ---- WalletConnect (v2) -- unchanged from the extension. This is now the
// ONLY way this page can connect to an external dapp at all (there is no
// content script / injected provider possible from a plain website), which
// makes it more central here than it was for the extension. ----
let wcClient = null;
let wcInitPromise = null;

function getWcSignClientCtor() {
  const ns = window["@walletconnect/sign-client"];
  return ns && (ns.SignClient || ns.default);
}

async function getWcClient() {
  if (wcClient) return wcClient;
  if (!wcInitPromise) wcInitPromise = initWcClient();
  wcClient = await wcInitPromise;
  return wcClient;
}

async function initWcClient() {
  if (!TM_WC_CONFIG.PROJECT_ID) {
    throw new Error(
      "WalletConnect isn't configured yet -- add a free Project ID from cloud.reown.com in lib/walletconnect-config.js."
    );
  }
  const SignClient = getWcSignClientCtor();
  if (!SignClient) throw new Error("WalletConnect library failed to load.");
  const client = await SignClient.init({
    projectId: TM_WC_CONFIG.PROJECT_ID,
    metadata: TM_WC_CONFIG.METADATA,
  });
  wireWcEvents(client);
  return client;
}

function wireWcEvents(client) {
  client.on("session_proposal", async (proposal) => {
    const { id, params } = proposal;
    try {
      const requiredNs = params.requiredNamespaces || {};
      const optionalNs = params.optionalNamespaces || {};
      const chainsOf = (ns) => (ns.eip155 && ns.eip155.chains) || [];

      const allNetworks = await TM_NETWORKS.getAllNetworks();
      const supportedChainIds = new Set(allNetworks.map((n) => n.chainId));
      const requestedChains = [...new Set([...chainsOf(requiredNs), ...chainsOf(optionalNs)])];
      const usableChains = requestedChains.filter((c) => supportedChainIds.has(parseInt(c.split(":")[1], 10)));
      const finalChains = usableChains.length ? usableChains : allNetworks.map((n) => `eip155:${n.chainId}`);

      const requiredChainsUnmet = chainsOf(requiredNs).some((c) => !finalChains.includes(c));
      if (requiredChainsUnmet) {
        await client.reject({ id, reason: { code: 5000, message: "This wallet doesn't support one of the chains this dapp requires." } });
        return;
      }

      const proposerMeta = params.proposer.metadata || {};
      const label = `${proposerMeta.name || "Unknown dapp"} (${proposerMeta.url || "no URL given"})`;
      const approved = await openApprovalPopup("connect", { origin: label }, `wc:${proposerMeta.url || label}`);

      const methods = [
        ...new Set([
          ...((requiredNs.eip155 && requiredNs.eip155.methods) || []),
          ...((optionalNs.eip155 && optionalNs.eip155.methods) || []),
          "eth_sendTransaction",
          "personal_sign",
          "eth_signTypedData_v4",
          "eth_accounts",
        ]),
      ];
      const events = [
        ...new Set([
          ...((requiredNs.eip155 && requiredNs.eip155.events) || []),
          ...((optionalNs.eip155 && optionalNs.eip155.events) || []),
          "chainChanged",
          "accountsChanged",
        ]),
      ];

      await client.approve({
        id,
        namespaces: {
          eip155: {
            accounts: finalChains.map((c) => `${c}:${approved.address}`),
            methods,
            events,
          },
        },
      });
    } catch (e) {
      try {
        await client.reject({ id, reason: { code: 5000, message: e.message || "User rejected the connection." } });
      } catch (_) {}
    }
  });

  client.on("session_request", async (event) => {
    const { id, topic, params } = event;
    const { request, chainId } = params;
    try {
      const numericChainId = parseInt(String(chainId).split(":")[1], 10);
      const allNetworks = await TM_NETWORKS.getAllNetworks();
      const network = allNetworks.find((n) => n.chainId === numericChainId);
      if (!network) throw new Error(`This wallet doesn't have network ${chainId} configured.`);

      const session = client.session.get(topic);
      const peerMeta = (session && session.peer && session.peer.metadata) || {};
      const originLabel = `${peerMeta.name || "Unknown dapp"} (${peerMeta.url || "no URL given"})`;

      let result;
      if (request.method === "eth_accounts" || request.method === "eth_requestAccounts") {
        const acct = await getSelectedAccountMeta();
        result = acct ? [acct.address] : [];
      } else if (request.method === "eth_chainId") {
        result = ethers.utils.hexValue(numericChainId);
      } else if (["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"].includes(request.method)) {
        result = await handleSigningMethod(request.method, request.params, network, originLabel);
      } else {
        result = await rpcPassthrough(network, request.method, request.params);
      }
      await client.respond({ topic, response: { id, jsonrpc: "2.0", result } });
    } catch (e) {
      await client.respond({
        topic,
        response: { id, jsonrpc: "2.0", error: { code: 5000, message: e.message || "Request failed." } },
      });
    }
  });
}

async function wcPair(uri) {
  const client = await getWcClient();
  await client.core.pairing.pair({ uri });
}

async function wcGetSessions() {
  const client = await getWcClient();
  return client.session.getAll().map((s) => ({
    topic: s.topic,
    name: (s.peer && s.peer.metadata && s.peer.metadata.name) || "Unknown dapp",
    url: (s.peer && s.peer.metadata && s.peer.metadata.url) || "",
  }));
}

async function wcDisconnect(topic) {
  const client = await getWcClient();
  await client.disconnect({ topic, reason: { code: 6000, message: "User disconnected." } });
}

// ---- message router -- the same switch/case the extension's
// chrome.runtime.onMessage listener ran, just called directly instead of
// crossing a real extension-messaging boundary. Every case here is
// byte-for-byte the same logic as background.js (only the TM_DAPP_REQUEST
// case, which only ever arrived from a content script, is gone). ----
async function handleMessage(msg) {
  return new Promise((resolvePromise) => {
    const sendResponse = resolvePromise;
    (async () => {
      try {
        switch (msg.type) {
          case "TM_GET_STATUS": {
            const hasVault = await TM_WALLET.hasVault();
            const accounts = hasVault ? await TM_WALLET.getAccountsMeta() : [];
            const network = await getActiveNetwork();
            sendResponse({
              ok: true,
              hasVault,
              unlocked: !!unlockedSecret,
              accounts: accounts.map((a) => ({ address: a.address, name: a.name, type: a.type })),
              selectedAddress: (await getSelectedAccountMeta())?.address || null,
              network,
            });
            break;
          }

          case "TM_CREATE_WALLET": {
            const { mnemonic, address } = await TM_WALLET.createNewVault(msg.password);
            unlockedSecret = { mnemonic, importedKeys: [] };
            unlockedPassword = msg.password;
            selectedAddress = address;
            sendResponse({ ok: true, mnemonic, address });
            break;
          }

          case "TM_IMPORT_MNEMONIC": {
            const { address } = await TM_WALLET.importFromMnemonic(msg.mnemonic, msg.password);
            unlockedSecret = { mnemonic: msg.mnemonic.trim().toLowerCase().replace(/\s+/g, " "), importedKeys: [] };
            unlockedPassword = msg.password;
            selectedAddress = address;
            sendResponse({ ok: true, address });
            break;
          }

          case "TM_UNLOCK": {
            const secret = await TM_WALLET.unlockVault(msg.password);
            unlockedSecret = secret;
            unlockedPassword = msg.password;
            const meta = await TM_WALLET.getAccountsMeta();
            selectedAddress = meta[0]?.address || null;
            sendResponse({ ok: true, accounts: meta });
            break;
          }

          case "TM_LOCK": {
            unlockedSecret = null;
            unlockedPassword = null;
            pendingNewPassword = null;
            sendResponse({ ok: true });
            break;
          }

          case "TM_ADD_ACCOUNT": {
            requireUnlocked();
            const address = await TM_WALLET.addHdAccount(unlockedSecret, unlockedPassword);
            sendResponse({ ok: true, address });
            break;
          }

          case "TM_IMPORT_PRIVATE_KEY": {
            requireUnlocked();
            const address = await TM_WALLET.importPrivateKey(unlockedSecret, unlockedPassword, msg.privateKey);
            sendResponse({ ok: true, address });
            break;
          }

          case "TM_ADD_WATCH_ACCOUNT": {
            requireUnlocked(); // not technically needed (no key material) -- required only for a consistent Settings flow
            const address = await TM_WALLET.addWatchAccount(msg.address, msg.label);
            sendResponse({ ok: true, address });
            break;
          }

          case "TM_SELECT_ACCOUNT": {
            selectedAddress = msg.address;
            sendResponse({ ok: true });
            break;
          }

          case "TM_EXPORT_MNEMONIC": {
            await TM_WALLET.unlockVault(msg.password);
            sendResponse({ ok: true, mnemonic: unlockedSecret.mnemonic });
            break;
          }

          // ---- optional online account backup (lib/account.js / auth-api.js) ----
          // These four exist for the "Backup & account" screen: confirming the
          // wallet password before linking an account, exporting/restoring the
          // whole wallet as one encrypted blob the account server can store
          // (it never sees the plaintext), and changing the local wallet
          // password in lockstep with that account's backup.

          case "TM_VERIFY_PASSWORD": {
            requireUnlocked();
            if (msg.password !== unlockedPassword) throw new Error("Incorrect password.");
            sendResponse({ ok: true });
            break;
          }

          // Packages everything needed to fully restore this wallet elsewhere
          // (seed phrase, any imported private keys, and the account list --
          // names, watch addresses, HD/imported indices) into one blob
          // encrypted the same way the local vault already is, under the
          // wallet's own current password. The server only ever sees this
          // ciphertext (see auth-api.js's header comment).
          case "TM_EXPORT_BUNDLE": {
            requireUnlocked();
            const accountsMeta = await TM_WALLET.getAccountsMeta();
            const payload = { v: 1, mnemonic: unlockedSecret.mnemonic, importedKeys: unlockedSecret.importedKeys, accountsMeta };
            const bundle = await TM_CRYPTO.encryptJSON(payload, unlockedPassword);
            sendResponse({ ok: true, bundle });
            break;
          }

          // The inverse of TM_EXPORT_BUNDLE -- only ever called from the
          // sign-in screen, which is only reachable pre-wallet (onboarding),
          // so this refuses rather than silently overwriting if a vault
          // already exists on this device.
          case "TM_RESTORE_BUNDLE": {
            if (await TM_WALLET.hasVault()) {
              throw new Error("A wallet already exists on this device. Reset it first if you want to restore a different one.");
            }
            const payload = await TM_CRYPTO.decryptJSON(msg.bundle, msg.password);
            if (payload.v !== 1 || typeof payload.mnemonic !== "string" || !Array.isArray(payload.importedKeys) || !Array.isArray(payload.accountsMeta)) {
              throw new Error("This backup looks corrupted and can't be restored.");
            }
            const secret = { mnemonic: payload.mnemonic, importedKeys: payload.importedKeys };
            await TM_WALLET.persistVault(secret, msg.password);
            await TM_WALLET.setAccountsMeta(payload.accountsMeta);
            unlockedSecret = secret;
            unlockedPassword = msg.password;
            selectedAddress = payload.accountsMeta[0]?.address || null;
            sendResponse({ ok: true, address: selectedAddress });
            break;
          }

          // Phase 1 of a password change (see lib/account.js's changePassword):
          // verifies the current password and builds a bundle encrypted under
          // the new one, but changes nothing on this device yet. If there's a
          // linked account, the caller uploads this bundle to replace the
          // server's copy BEFORE phase 3 commits locally -- so a failed
          // upload (offline, server error) leaves the device's password
          // exactly as it was, never out of step with the account.
          case "TM_PREPARE_PASSWORD_CHANGE": {
            requireUnlocked();
            if (msg.oldPassword !== unlockedPassword) throw new Error("Incorrect password.");
            if (!msg.newPassword || msg.newPassword.length < 8) throw new Error("Choose a password of at least 8 characters.");
            const accountsMeta = await TM_WALLET.getAccountsMeta();
            const payload = { v: 1, mnemonic: unlockedSecret.mnemonic, importedKeys: unlockedSecret.importedKeys, accountsMeta };
            const bundle = await TM_CRYPTO.encryptJSON(payload, msg.newPassword);
            pendingNewPassword = msg.newPassword;
            sendResponse({ ok: true, bundle });
            break;
          }

          // Phase 3: re-encrypts the local vault under the password staged by
          // TM_PREPARE_PASSWORD_CHANGE. Always the last step, whether or not
          // there's a linked account -- this IS the wallet's own "change
          // password" (there is no separate, account-free path).
          case "TM_COMMIT_PASSWORD_CHANGE": {
            requireUnlocked();
            if (!pendingNewPassword) throw new Error("No password change is pending.");
            await TM_WALLET.persistVault(unlockedSecret, pendingNewPassword);
            unlockedPassword = pendingNewPassword;
            pendingNewPassword = null;
            sendResponse({ ok: true });
            break;
          }

          case "TM_RESET_WALLET": {
            await TM_WALLET.resetWallet();
            unlockedSecret = null;
            unlockedPassword = null;
            pendingNewPassword = null;
            selectedAddress = null;
            sendResponse({ ok: true });
            break;
          }

          case "TM_GET_NETWORKS": {
            const networks = await TM_NETWORKS.getAllNetworks();
            const selected = await getActiveNetwork();
            sendResponse({ ok: true, networks, selected });
            break;
          }

          case "TM_ADD_NETWORK": {
            const networks = await TM_NETWORKS.addCustomNetwork(msg.network);
            sendResponse({ ok: true, networks });
            break;
          }

          case "TM_SELECT_NETWORK": {
            await TM_NETWORKS.setSelectedNetwork(msg.chainId);
            sendResponse({ ok: true });
            break;
          }

          case "TM_GET_BALANCE": {
            const network = await getActiveNetwork();
            const provider = await getProviderFor(network);
            const balanceWei = await provider.getBalance(msg.address);
            sendResponse({ ok: true, balanceWei: balanceWei.toString(), symbol: network.nativeCurrency.symbol, decimals: network.nativeCurrency.decimals });
            break;
          }

          case "TM_GET_TOKEN_BALANCE": {
            const network = await getActiveNetwork();
            const provider = await getProviderFor(network);
            const { decimals, symbol } = await TM_SWAP.getErc20Info(provider, msg.tokenAddress);
            const c = new ethers.Contract(msg.tokenAddress, TM_SWAP.ERC20_ABI, provider);
            const balanceWei = await c.balanceOf(msg.address);
            sendResponse({ ok: true, balanceWei: balanceWei.toString(), decimals, symbol });
            break;
          }

          // Resolves a human-readable name (currently ENS, e.g. "vitalik.eth")
          // typed into the Send "To" field into an address -- the same
          // convenience MetaMask and Coinbase Wallet offer instead of making
          // every send start with a raw 0x address. ethers' JsonRpcProvider
          // only knows an ENS registry address for networks it recognizes as
          // having one (mainnet); on every other chain this predictably
          // resolves to null rather than erroring, and the UI falls back to
          // requiring a raw address there, same as before this existed.
          case "TM_RESOLVE_NAME": {
            const network = await getActiveNetwork();
            const provider = await getProviderFor(network);
            let address = null;
            try {
              address = await provider.resolveName(msg.name);
            } catch (e) {
              address = null; // no ENS registry on this network, or a lookup error -- treat the same as "not found"
            }
            sendResponse({ ok: true, address });
            break;
          }

          case "TM_LOOKUP_TOKEN": {
            if (!ethers.utils.isAddress(msg.tokenAddress)) {
              throw new Error("That doesn't look like a valid contract address.");
            }
            const network = await getActiveNetwork();
            const provider = await getProviderFor(network);
            const c = new ethers.Contract(msg.tokenAddress, TM_SWAP.ERC20_ABI, provider);
            let decimals, symbol, name;
            try {
              [decimals, symbol, name] = await Promise.all([
                c.decimals(),
                c.symbol().catch(() => "TOKEN"),
                c.name().catch(() => ""),
              ]);
            } catch (e) {
              throw new Error(
                `Couldn't read this as an ERC-20 token on ${network.name}. Double-check the address and that you're on the right network.`
              );
            }
            sendResponse({ ok: true, decimals, symbol, name });
            break;
          }

          case "TM_ADD_TRACKED_TOKEN": {
            const network = await getActiveNetwork();
            const address = ethers.utils.getAddress(msg.tokenAddress);
            const existing = await getTrackedTokens(network.chainId);
            if (existing.some((t) => t.address.toLowerCase() === address.toLowerCase())) {
              throw new Error("That token is already in your list.");
            }
            const tokens = [
              ...existing,
              { address, symbol: msg.symbol, decimals: msg.decimals, name: msg.name || "" },
            ];
            await saveTrackedTokens(network.chainId, tokens);
            sendResponse({ ok: true, tokens });
            break;
          }

          case "TM_REMOVE_TRACKED_TOKEN": {
            const network = await getActiveNetwork();
            const existing = await getTrackedTokens(network.chainId);
            const tokens = existing.filter((t) => t.address.toLowerCase() !== (msg.tokenAddress || "").toLowerCase());
            await saveTrackedTokens(network.chainId, tokens);
            sendResponse({ ok: true, tokens });
            break;
          }

          case "TM_GET_TRACKED_TOKEN_BALANCES": {
            const network = await getActiveNetwork();
            const tokens = await getTrackedTokens(network.chainId);
            if (!tokens.length) {
              sendResponse({ ok: true, tokens: [] });
              break;
            }
            const provider = await getProviderFor(network);
            const meta = await getSelectedAccountMeta();
            const address = meta ? meta.address : null;
            const results = await Promise.all(
              tokens.map(async (t) => {
                if (!address) return { ...t, balanceWei: "0", error: null };
                try {
                  const c = new ethers.Contract(t.address, TM_SWAP.ERC20_ABI, provider);
                  const balanceWei = await c.balanceOf(address);
                  return { ...t, balanceWei: balanceWei.toString(), error: null };
                } catch (e) {
                  return { ...t, balanceWei: "0", error: e.message };
                }
              })
            );
            sendResponse({ ok: true, tokens: results });
            break;
          }

          // Read-only preview of an NFT before it's added -- mirrors
          // TM_LOOKUP_TOKEN's "look up, show a preview, then confirm" flow.
          case "TM_LOOKUP_NFT": {
            if (!ethers.utils.isAddress(msg.contractAddress)) {
              throw new Error("That doesn't look like a valid contract address.");
            }
            let tokenIdBn;
            try {
              tokenIdBn = ethers.BigNumber.from(msg.tokenId);
              if (tokenIdBn.isNegative()) throw new Error();
            } catch (e) {
              throw new Error("Enter a valid token ID (a non-negative whole number).");
            }
            const network = await getActiveNetwork();
            const provider = await getProviderFor(network);
            let standard, tokenUri;
            try {
              ({ standard, tokenUri } = await readNftTokenUri(provider, msg.contractAddress, tokenIdBn));
            } catch (e) {
              throw new Error(
                `Couldn't read this as an ERC-721 or ERC-1155 NFT on ${network.name}. Double-check the contract address, token ID, and network.`
              );
            }
            let name = "";
            let image = null;
            let metaError = null;
            try {
              const metadata = await fetchNftMetadataJson(tokenUri);
              name = typeof metadata.name === "string" ? metadata.name.slice(0, 200) : "";
              image = sanitizeNftImageUrl(metadata.image || metadata.image_url);
            } catch (e) {
              metaError = e.message;
            }
            sendResponse({ ok: true, standard, name, image, metaError });
            break;
          }

          case "TM_ADD_TRACKED_NFT": {
            const network = await getActiveNetwork();
            const address = ethers.utils.getAddress(msg.contractAddress);
            const tokenId = ethers.BigNumber.from(msg.tokenId).toString();
            const existing = await getTrackedNfts(network.chainId);
            if (existing.some((n) => n.contractAddress.toLowerCase() === address.toLowerCase() && n.tokenId === tokenId)) {
              throw new Error("That NFT is already in your list.");
            }
            const nfts = [
              ...existing,
              { contractAddress: address, tokenId, standard: msg.standard, name: msg.name || "" },
            ];
            await saveTrackedNfts(network.chainId, nfts);
            sendResponse({ ok: true, nfts });
            break;
          }

          case "TM_REMOVE_TRACKED_NFT": {
            const network = await getActiveNetwork();
            const existing = await getTrackedNfts(network.chainId);
            const nfts = existing.filter(
              (n) =>
                !(
                  n.contractAddress.toLowerCase() === (msg.contractAddress || "").toLowerCase() &&
                  n.tokenId === String(msg.tokenId)
                )
            );
            await saveTrackedNfts(network.chainId, nfts);
            sendResponse({ ok: true, nfts });
            break;
          }

          case "TM_GET_TRACKED_NFTS": {
            const network = await getActiveNetwork();
            const nfts = await getTrackedNfts(network.chainId);
            if (!nfts.length) {
              sendResponse({ ok: true, nfts: [] });
              break;
            }
            const provider = await getProviderFor(network);
            const results = await Promise.all(
              nfts.map(async (n) => {
                try {
                  const tokenIdBn = ethers.BigNumber.from(n.tokenId);
                  let tokenUri;
                  if (n.standard === "erc1155") {
                    const c = new ethers.Contract(n.contractAddress, ["function uri(uint256) view returns (string)"], provider);
                    tokenUri = await c.uri(tokenIdBn);
                    if (tokenUri && tokenUri.includes("{id}")) {
                      tokenUri = tokenUri.replace("{id}", tokenIdBn.toHexString().slice(2).padStart(64, "0"));
                    }
                  } else {
                    const c = new ethers.Contract(n.contractAddress, ["function tokenURI(uint256) view returns (string)"], provider);
                    tokenUri = await c.tokenURI(tokenIdBn);
                  }
                  const metadata = await fetchNftMetadataJson(tokenUri);
                  const name = typeof metadata.name === "string" ? metadata.name.slice(0, 200) : n.name;
                  const image = sanitizeNftImageUrl(metadata.image || metadata.image_url);
                  return { ...n, name: name || n.name, image, error: null };
                } catch (e) {
                  return { ...n, image: null, error: e.message };
                }
              })
            );
            sendResponse({ ok: true, nfts: results });
            break;
          }

          case "TM_SEND_NATIVE": {
            requireUnlocked();
            const network = await getActiveNetwork();
            const meta = await getSelectedAccountMeta();
            assertNotSanctioned(meta.address, "sending account");
            assertNotSanctioned(msg.to, "destination address");
            const provider = await getProviderFor(network);
            const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(provider);
            // Fee overrides are computed fresh at send time, not reused from
            // an earlier preview -- gas prices move, and this is the number
            // that actually gets signed into the transaction.
            const feeOverrides = scaleFeeDataForSpeed(await provider.getFeeData(), msg.speed);
            const tx = await wallet.sendTransaction({ to: msg.to, value: ethers.BigNumber.from(msg.amountWei), ...feeOverrides });
            sendResponse({ ok: true, txHash: tx.hash });
            break;
          }

          case "TM_SEND_TOKEN": {
            requireUnlocked();
            const network = await getActiveNetwork();
            const meta = await getSelectedAccountMeta();
            assertNotSanctioned(meta.address, "sending account");
            assertNotSanctioned(msg.to, "destination address");
            const provider = await getProviderFor(network);
            const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(provider);
            const c = new ethers.Contract(msg.tokenAddress, TM_SWAP.ERC20_ABI.concat(["function transfer(address to, uint256 amount) returns (bool)"]), wallet);
            const feeOverrides = scaleFeeDataForSpeed(await provider.getFeeData(), msg.speed);
            const tx = await c.transfer(msg.to, ethers.BigNumber.from(msg.amountWei), feeOverrides);
            sendResponse({ ok: true, txHash: tx.hash });
            break;
          }

          // Read-only preview of what a send would cost, shown on the Send
          // screen (and echoed into the confirm card) *before* the user
          // commits -- the same "you'll pay about this much in network fees"
          // preview MetaMask and Coinbase Wallet both show, which this app
          // never surfaced before. Never signs or broadcasts anything.
          case "TM_ESTIMATE_SEND_FEE": {
            requireUnlocked();
            const network = await getActiveNetwork();
            const meta = await getSelectedAccountMeta();
            const provider = await getProviderFor(network);
            const from = meta.address;
            const amountWei = ethers.BigNumber.from(msg.amountWei || "0");
            let gasLimit;
            if (msg.tokenAddress) {
              const c = new ethers.Contract(
                msg.tokenAddress,
                TM_SWAP.ERC20_ABI.concat(["function transfer(address to, uint256 amount) returns (bool)"]),
                provider
              );
              gasLimit = await c.estimateGas.transfer(msg.to, amountWei, { from });
            } else {
              gasLimit = await provider.estimateGas({ from, to: msg.to, value: amountWei });
            }
            const feeData = await provider.getFeeData();
            // estimateGas is a lower bound in practice (state can shift
            // between the estimate and the real send) -- pad it the same
            // ~20% most wallets use so the preview doesn't undersell it.
            const paddedGasLimit = gasLimit.mul(120).div(100);
            // One getFeeData() call covers all three speed tiers -- each is
            // just that same data scaled differently (see scaleFeeDataForSpeed
            // above), same worst-case-ceiling framing as before: the actual
            // charge can come in lower once the block is mined.
            const tiers = {};
            ["slow", "standard", "fast"].forEach((speed) => {
              const overrides = scaleFeeDataForSpeed(feeData, speed);
              tiers[speed] = paddedGasLimit.mul(feePerGasForPreview(overrides)).toString();
            });
            sendResponse({ ok: true, feeWei: tiers.standard, tiers });
            break;
          }

          case "TM_SWAP_QUOTE": {
            const network = await getActiveNetwork();
            const provider = await getProviderFor(network);
            const meta = await getSelectedAccountMeta();
            const totalWei = ethers.BigNumber.from(msg.amountInWei);

            // 0x bakes its own ~0.15% protocol fee into the quote it
            // returns (already netted out of the buyAmount -- not
            // something we separately collect), so an aggregator-routed
            // swap is skimmed at the higher AGGREGATOR_* rate (see
            // lib/fee-config.js) to keep this wallet's own take the same
            // either way. We have to compute that rate's netWei BEFORE
            // asking 0x for a quote, since the quote is for an exact
            // sell amount -- if 0x can't help, we fall back to the base
            // rate below and quote the plain router instead.
            const { feeWei: aggFeeWei, netWei: aggNetWei } = TM_FEE.computeFee(totalWei, { viaAggregator: true });

            const aggQuote = meta
              ? await TM_SWAP.tryAggregatorQuote({
                  network,
                  tokenIn: msg.tokenIn,
                  tokenOut: msg.tokenOut,
                  amountInWei: aggNetWei,
                  taker: meta.address,
                  slippageBps: msg.slippageBps || 100,
                })
              : null;

            if (aggQuote) {
              lastSwapRoute = {
                key: swapRouteKey(network, msg.tokenIn),
                chainId: network.chainId,
                tokenIn: (msg.tokenIn || "native").toLowerCase(),
                tokenOut: (msg.tokenOut || "native").toLowerCase(),
                netAmountInWei: aggNetWei.toString(),
                kind: "aggregator",
                spender: aggQuote.allowanceTarget || network.swapRouter,
                transaction: aggQuote.transaction,
                amountOutWei: aggQuote.amountOutWei.toString(),
                minAmountOutWei: aggQuote.minAmountOutWei.toString(),
              };
              sendResponse({
                ok: true,
                amountOutWei: aggQuote.amountOutWei.toString(),
                path: null,
                feeWei: aggFeeWei.toString(),
                netAmountInWei: aggNetWei.toString(),
                feePercentLabel: TM_FEE.feePercentLabel({ viaAggregator: true }),
                route: "aggregator",
              });
              break;
            }

            const { feeWei, netWei } = TM_FEE.computeFee(totalWei, { viaAggregator: false });
            lastSwapRoute = { key: swapRouteKey(network, msg.tokenIn), chainId: network.chainId, kind: "router" };
            const { amountOutWei, path } = await TM_SWAP.getQuote({
              network,
              provider,
              tokenIn: msg.tokenIn,
              tokenOut: msg.tokenOut,
              amountInWei: netWei,
            });
            sendResponse({
              ok: true,
              amountOutWei: amountOutWei.toString(),
              path,
              feeWei: feeWei.toString(),
              netAmountInWei: netWei.toString(),
              feePercentLabel: TM_FEE.feePercentLabel({ viaAggregator: false }),
              route: "router",
            });
            break;
          }

          case "TM_SWAP_ALLOWANCE": {
            const network = await getActiveNetwork();
            const provider = await getProviderFor(network);
            const meta = await getSelectedAccountMeta();
            const routeKey = swapRouteKey(network, msg.tokenAddress);
            const spender =
              lastSwapRoute && lastSwapRoute.key === routeKey && lastSwapRoute.kind === "aggregator" && lastSwapRoute.spender
                ? lastSwapRoute.spender
                : network.swapRouter;
            const allowance = await TM_SWAP.getAllowance({ provider, tokenAddress: msg.tokenAddress, owner: meta.address, spender });
            sendResponse({ ok: true, allowanceWei: allowance.toString(), spender });
            break;
          }

          case "TM_SWAP_APPROVE": {
            requireUnlocked();
            const network = await getActiveNetwork();
            const meta = await getSelectedAccountMeta();
            assertNotSanctioned(meta.address, "account");
            const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(await getProviderFor(network));
            const routeKey = swapRouteKey(network, msg.tokenAddress);
            const spender =
              lastSwapRoute && lastSwapRoute.key === routeKey && lastSwapRoute.kind === "aggregator" && lastSwapRoute.spender
                ? lastSwapRoute.spender
                : network.swapRouter;
            const tx = await TM_SWAP.sendApprove({ signer: wallet, tokenAddress: msg.tokenAddress, spender, amountWei: ethers.BigNumber.from(msg.amountWei) });
            sendResponse({ ok: true, txHash: tx.hash });
            break;
          }

          // ---- allowance/approval manager --------------------------------
          // Scoped honestly: this can only ever surface approvals for (a)
          // tokens the user has actually added to their tracked-token list,
          // checked against (b) this wallet's own configured swap router --
          // the one spender this wallet itself ever asks for an approval.
          // A full "every approval you've ever granted to any dapp" scan
          // would need an unbounded eth_getLogs sweep across the whole
          // chain's history with no contract-address filter, which public
          // RPC endpoints routinely reject or truncate -- unreliable enough
          // to be actively misleading (a wallet that says "no approvals
          // found" when it just couldn't finish the scan is worse than not
          // offering this at all). The manual lookup below covers the gap:
          // paste in any token + spender you already know about (from a
          // dapp you used elsewhere) and it reads the real on-chain
          // allowance directly, same as the auto-list does.
          case "TM_LIST_APPROVALS": {
            const network = await getActiveNetwork();
            const meta = await getSelectedAccountMeta();
            if (!meta || !network.swapRouter) {
              sendResponse({ ok: true, approvals: [], swapRouter: network.swapRouter || null });
              break;
            }
            const tokens = await getTrackedTokens(network.chainId);
            const provider = await getProviderFor(network);
            const results = await Promise.all(
              tokens.map(async (t) => {
                try {
                  const allowanceWei = await TM_SWAP.getAllowance({ provider, tokenAddress: t.address, owner: meta.address, spender: network.swapRouter });
                  return { ...t, spender: network.swapRouter, allowanceWei: allowanceWei.toString(), error: null };
                } catch (e) {
                  return { ...t, spender: network.swapRouter, allowanceWei: "0", error: e.message };
                }
              })
            );
            sendResponse({
              ok: true,
              swapRouter: network.swapRouter,
              approvals: results.filter((r) => r.error || ethers.BigNumber.from(r.allowanceWei).gt(0)),
            });
            break;
          }

          case "TM_CHECK_APPROVAL": {
            if (!ethers.utils.isAddress(msg.tokenAddress)) throw new Error("That doesn't look like a valid token contract address.");
            if (!ethers.utils.isAddress(msg.spender)) throw new Error("That doesn't look like a valid spender address.");
            const network = await getActiveNetwork();
            const meta = await getSelectedAccountMeta();
            if (!meta) throw new Error("No account selected.");
            const provider = await getProviderFor(network);
            const c = new ethers.Contract(msg.tokenAddress, TM_SWAP.ERC20_ABI, provider);
            const [allowanceWei, symbol, decimals] = await Promise.all([
              c.allowance(meta.address, msg.spender),
              c.symbol().catch(() => "TOKEN"),
              c.decimals().catch(() => 18),
            ]);
            sendResponse({ ok: true, allowanceWei: allowanceWei.toString(), symbol, decimals });
            break;
          }

          case "TM_REVOKE_APPROVAL": {
            requireUnlocked();
            if (!ethers.utils.isAddress(msg.tokenAddress)) throw new Error("That doesn't look like a valid token contract address.");
            if (!ethers.utils.isAddress(msg.spender)) throw new Error("That doesn't look like a valid spender address.");
            const network = await getActiveNetwork();
            const meta = await getSelectedAccountMeta();
            assertNotSanctioned(meta.address, "account");
            const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(await getProviderFor(network));
            const tx = await TM_SWAP.sendApprove({ signer: wallet, tokenAddress: msg.tokenAddress, spender: msg.spender, amountWei: ethers.BigNumber.from(0) });
            sendResponse({ ok: true, txHash: tx.hash });
            break;
          }

          case "TM_SWAP_EXECUTE": {
            requireUnlocked();
            const network = await getActiveNetwork();
            const meta = await getSelectedAccountMeta();
            assertNotSanctioned(meta.address, "account");
            const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(await getProviderFor(network));

            const totalWei = ethers.BigNumber.from(msg.amountInWei);

            // Figure out which rate applies the same way TM_SWAP_QUOTE
            // did, without a second call to 0x: if the remembered route
            // is still an exact match for this pair/amount at the
            // AGGREGATOR rate, this swap goes through 0x and is skimmed
            // at that higher rate; otherwise it's a plain router swap at
            // the base rate. aggregatorRouteMatches() is just comparing
            // against what TM_SWAP_QUOTE already fetched and saved.
            const { feeWei: aggFeeWei, netWei: aggNetWei } = TM_FEE.computeFee(totalWei, { viaAggregator: true });
            const useAggregator = aggregatorRouteMatches(lastSwapRoute, network, msg.tokenIn, msg.tokenOut, aggNetWei);
            const { feeWei, netWei } = useAggregator
              ? { feeWei: aggFeeWei, netWei: aggNetWei }
              : TM_FEE.computeFee(totalWei, { viaAggregator: false });

            let feeTxHash = null;
            if (feeWei.gt(0)) {
              if (TM_SWAP.isNative(msg.tokenIn)) {
                const feeTx = await wallet.sendTransaction({ to: TM_FEE.FEE_RECIPIENT, value: feeWei });
                await feeTx.wait();
                feeTxHash = feeTx.hash;
              } else {
                const erc20 = new ethers.Contract(
                  msg.tokenIn,
                  TM_SWAP.ERC20_ABI.concat(["function transfer(address to, uint256 amount) returns (bool)"]),
                  wallet
                );
                const feeTx = await erc20.transfer(TM_FEE.FEE_RECIPIENT, feeWei);
                await feeTx.wait();
                feeTxHash = feeTx.hash;
              }
            }

            if (useAggregator) {
              try {
                const aggTx = await TM_SWAP.executeAggregatorSwap({ signer: wallet, transaction: lastSwapRoute.transaction });
                sendResponse({
                  ok: true,
                  feeTxHash,
                  feeWei: feeWei.toString(),
                  txHash: aggTx.hash,
                  quotedAmountOutWei: lastSwapRoute.amountOutWei,
                  minAmountOutWei: lastSwapRoute.minAmountOutWei,
                  route: "aggregator",
                });
                break;
              } catch (e) {
                // The aggregator's saved transaction failed to broadcast
                // (stale quote, a gas re-estimate mismatch, etc). The fee
                // is already paid at this point either way, so fall
                // through to the direct router path below rather than
                // leaving the user stuck having paid the fee with nothing
                // to show for it -- same slippage tolerance either way.
                // Note this is the one edge case where a router-executed
                // swap ends up charged at the (higher) aggregator rate:
                // 0x looked available at quote time and then couldn't
                // actually broadcast. Rare, and never a double-charge --
                // the swapped amount (netWei) always matches whichever
                // feeWei was actually sent above.
              }
            }

            const { tx, quotedAmountOutWei, minAmountOutWei } = await TM_SWAP.executeSwap({
              network,
              signer: wallet,
              tokenIn: msg.tokenIn,
              tokenOut: msg.tokenOut,
              amountInWei: netWei,
              slippageBps: msg.slippageBps || 100,
              recipient: meta.address,
            });
            sendResponse({
              ok: true,
              feeTxHash,
              feeWei: feeWei.toString(),
              txHash: tx.hash,
              quotedAmountOutWei: quotedAmountOutWei.toString(),
              minAmountOutWei: minAmountOutWei.toString(),
              route: "router",
            });
            break;
          }

          case "TM_GET_PENDING_REQUEST": {
            const pending = pendingRequests.get(msg.requestId);
            if (!pending) {
              sendResponse({ ok: false, error: "This request has expired or was already handled." });
            } else {
              sendResponse({ ok: true, type: pending.type, payload: pending.payload, origin: pending.origin });
            }
            break;
          }

          case "TM_APPROVAL_RESPONSE": {
            const pending = pendingRequests.get(msg.requestId);
            if (pending) {
              if (msg.approved) pending.resolve(msg.result);
              else pending.reject(new Error(msg.error || "User rejected the request."));
              pendingRequests.delete(msg.requestId);
            }
            sendResponse({ ok: true });
            break;
          }

          case "TM_WC_PAIR": {
            await wcPair(msg.uri);
            sendResponse({ ok: true });
            break;
          }

          case "TM_WC_GET_SESSIONS": {
            const sessions = TM_WC_CONFIG.PROJECT_ID ? await wcGetSessions() : [];
            sendResponse({ ok: true, configured: !!TM_WC_CONFIG.PROJECT_ID, sessions });
            break;
          }

          case "TM_WC_DISCONNECT": {
            await wcDisconnect(msg.topic);
            sendResponse({ ok: true });
            break;
          }

          default:
            sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e), code: e.code });
      }
    })();
  });
}

window.TM_ENGINE = { handleMessage };
