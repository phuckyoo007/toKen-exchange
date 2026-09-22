// background/background.js
// MV3 service worker: holds the (in-memory only) unlocked wallet secret,
// handles all popup <-> wallet messaging, and services dapp JSON-RPC
// requests forwarded from content scripts.
//
// KNOWN LIMITATION: Manifest V3 service workers are ephemeral -- Chrome can
// unload this worker after ~30s of inactivity, which wipes the in-memory
// `unlockedSecret`. That means the wallet may re-lock more often than a
// persistent-background extension would. This is a known trade-off called
// out in the README rather than solved with keep-alive hacks for this MVP.

importScripts(
  "../vendor/ethers.umd.min.js",
  "../vendor/walletconnect-sign-client.umd.js",
  "../lib/crypto-utils.js",
  "../lib/wallet.js",
  "../lib/networks.js",
  "../lib/swap.js",
  "../lib/fee-config.js",
  "../lib/sanctions-list.js",
  "../lib/walletconnect-config.js"
);

// Screens an address against the bundled OFAC sanctioned-address list (see
// lib/sanctions-list.js) and throws if it matches. Call this on both the
// sending account and any explicit destination address before a transfer
// or swap goes out. This is a local, offline check -- no address is ever
// sent anywhere to perform it.
function assertNotSanctioned(address, label) {
  if (TM_SANCTIONS.isSanctionedAddress(address)) {
    throw new Error(
      `This ${label || "address"} (${address}) matches an address on the OFAC sanctions list and cannot be used with this wallet.`
    );
  }
}

// ---- in-memory session state (cleared on lock / SW restart) ----
let unlockedSecret = null; // { mnemonic, importedKeys }
let unlockedPassword = null; // kept only in memory, needed to re-encrypt on add-account/import
let selectedAddress = null;

const APPROVED_ORIGINS_KEY = "tm_approved_origins"; // { [origin]: string[] addresses }
const pendingRequests = new Map(); // requestId -> { resolve, reject, type, payload, origin }

function newRequestId() {
  return "req_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function getApprovedOrigins() {
  const stored = await chrome.storage.local.get(APPROVED_ORIGINS_KEY);
  return stored[APPROVED_ORIGINS_KEY] || {};
}

async function setOriginApproved(origin, address) {
  const all = await getApprovedOrigins();
  all[origin] = [address];
  await chrome.storage.local.set({ [APPROVED_ORIGINS_KEY]: all });
}

async function isOriginApproved(origin) {
  const all = await getApprovedOrigins();
  return !!(all[origin] && all[origin].length);
}

// ---- tracked (user-added) ERC-20 tokens, per chain ----
// { [chainId]: [{ address, symbol, decimals, name }] } -- these are tokens
// the user explicitly asked to watch (see TM_ADD_TRACKED_TOKEN), same
// concept as MetaMask's "import token". We only ever store what
// TM_LOOKUP_TOKEN actually read back from the token's own contract, never
// anything the user typed by hand for symbol/decimals.
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

// Opens a small popup window for the user to approve/reject something
// (connect, send tx, sign message, add network). Resolves with whatever the
// popup sends back via TM_APPROVAL_RESPONSE, or rejects if the user closes
// the window without responding.
function openApprovalPopup(type, payload, origin) {
  return new Promise((resolve, reject) => {
    const requestId = newRequestId();
    pendingRequests.set(requestId, { resolve, reject, type, payload, origin });
    chrome.windows.create(
      {
        url: chrome.runtime.getURL(`popup/popup.html?mode=approve&requestId=${requestId}`),
        type: "popup",
        width: 380,
        height: 620,
      },
      (win) => {
        const windowId = win && win.id;
        const removedListener = (closedWindowId) => {
          if (closedWindowId === windowId && pendingRequests.has(requestId)) {
            pendingRequests.get(requestId).reject(new Error("User closed the approval window."));
            pendingRequests.delete(requestId);
            chrome.windows.onRemoved.removeListener(removedListener);
          }
        };
        chrome.windows.onRemoved.addListener(removedListener);
      }
    );
  });
}

async function getActiveNetwork() {
  return TM_NETWORKS.getSelectedNetwork();
}

// Which rpcUrl (by network key) most recently passed a health check, so
// repeated calls in quick succession (e.g. loading balance + running a
// swap quote) don't each re-check every URL from scratch.
const RPC_HEALTH_CACHE_TTL_MS = 20 * 1000;
const rpcHealthCache = new Map(); // network.key -> { url, checkedAt }

// Tries network.rpcUrls in order and returns the first one that actually
// answers an eth_getBalance call correctly, within a short timeout. This
// exists because public RPC endpoints occasionally return a transient
// error for specific calls even while otherwise reachable -- exactly what
// happened in practice with cloudflare-eth.com returning
// {"error":{"code":-32603,"message":"Internal error"}} for eth_getBalance.
// Built-in networks list a second RPC precisely as a backup for this case;
// this is what actually makes that backup do something, instead of every
// network-touching feature being a hard failure whenever the first-listed
// endpoint is having a bad moment. If every URL fails the check, falls
// back to the first URL anyway so the real underlying error still surfaces
// normally rather than being masked by this health check.
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
      // network error reaching this URL at all -- try the next one
    }
  }
  return urls[0]; // every URL failed the check; surface the real error instead of hiding it
}

async function getProviderFor(network) {
  const url = await pickHealthyRpcUrl(network);
  return new ethers.providers.JsonRpcProvider(url);
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

// Generic JSON-RPC passthrough for methods we don't specially handle
// (eth_call, eth_getBalance, eth_blockNumber, eth_estimateGas, etc.) so
// dapps can still read chain state through us. Tries each of the network's
// rpcUrls in order and falls through to the next one on a network error or
// a JSON-RPC error response, only throwing once every URL has failed --
// same reasoning as getProviderFor() above: a single flaky public RPC
// shouldn't be a hard failure when the network config lists a backup.
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

function broadcastEventToOrigin(origin, event, data) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "TM_EVENT", event, data, targetOrigin: origin }, () => void chrome.runtime.lastError);
    }
  });
}

// ---- dapp JSON-RPC request handling (from content-script) ----
async function handleDappRequest(method, params, origin) {
  const network = await getActiveNetwork();

  switch (method) {
    case "eth_chainId":
      return ethers.utils.hexValue(network.chainId);

    case "net_version":
      return String(network.chainId);

    case "eth_accounts": {
      if (!unlockedSecret || !(await isOriginApproved(origin))) return [];
      const acct = await getSelectedAccountMeta();
      return acct ? [acct.address] : [];
    }

    case "eth_requestAccounts": {
      if (unlockedSecret && (await isOriginApproved(origin))) {
        const acct = await getSelectedAccountMeta();
        return acct ? [acct.address] : [];
      }
      const result = await openApprovalPopup("connect", { origin }, origin);
      // result: { address }
      await setOriginApproved(origin, result.address);
      broadcastEventToOrigin(origin, "accountsChanged", [result.address]);
      return [result.address];
    }

    case "wallet_switchEthereumChain": {
      const hexId = params[0] && params[0].chainId;
      const targetId = parseInt(hexId, 16);
      const all = await TM_NETWORKS.getAllNetworks();
      const found = all.find((n) => n.chainId === targetId);
      if (!found) {
        const err = new Error("Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first.");
        err.code = 4902;
        throw err;
      }
      await TM_NETWORKS.setSelectedNetwork(targetId);
      broadcastEventToOrigin(origin, "chainChanged", ethers.utils.hexValue(targetId));
      return null;
    }

    case "wallet_addEthereumChain": {
      const p = params[0];
      const approved = await openApprovalPopup(
        "addNetwork",
        {
          chainId: parseInt(p.chainId, 16),
          name: p.chainName,
          rpcUrls: p.rpcUrls,
          nativeCurrency: p.nativeCurrency,
          blockExplorer: (p.blockExplorerUrls || [])[0] || "",
        },
        origin
      );
      if (!approved) throw new Error("User rejected adding the network.");
      return null;
    }

    case "eth_sendTransaction":
    case "personal_sign":
    case "eth_signTypedData_v4":
      return handleSigningMethod(method, params, network, origin);

    default:
      return rpcPassthrough(network, method, params);
  }
}

// The actual signing logic behind eth_sendTransaction/personal_sign/
// eth_signTypedData_v4 -- shared between the injected-provider path above
// (an `origin` is a real page hostname) and the WalletConnect path below (an
// `originLabel` is a synthesized "Dapp Name (https://dapp.url)" string,
// since a WC request has no browser tab/origin of its own). Both just need
// something readable to show on the existing approval screens.
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

// ---- WalletConnect (v2) ----
// Lets a dapp that only offers a "WalletConnect" connect option (no browser
// extension injection) pair with this wallet instead -- paste the wc:...
// URI from its QR code. Reuses the exact same approval popups/pipeline as
// the injected-provider path above (openApprovalPopup + handleSigningMethod)
// so there's no separate approval UI to build or keep in sync.
let wcClient = null;
let wcInitPromise = null;

function getWcSignClientCtor() {
  const ns = self["@walletconnect/sign-client"];
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
      // Some dapps propose with no explicit chains at all -- offer every
      // network this wallet supports rather than rejecting outright.
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

// ---- message router ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "TM_DAPP_REQUEST": {
          const result = await handleDappRequest(msg.method, msg.params || [], msg.origin);
          sendResponse({ ok: true, result });
          break;
        }

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

        case "TM_SELECT_ACCOUNT": {
          selectedAddress = msg.address;
          sendResponse({ ok: true });
          break;
        }

        case "TM_EXPORT_MNEMONIC": {
          // Re-verify password even though we're already unlocked, since this
          // reveals the seed phrase -- treat it like a step-up auth check.
          await TM_WALLET.unlockVault(msg.password);
          sendResponse({ ok: true, mnemonic: unlockedSecret.mnemonic });
          break;
        }

        case "TM_RESET_WALLET": {
          await TM_WALLET.resetWallet();
          unlockedSecret = null;
          unlockedPassword = null;
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

        // Reads a contract's own decimals/symbol/name so the "Add token"
        // screen can show a preview before the user commits to tracking it.
        // Throws a clear error if the address isn't a real ERC-20 on the
        // current network (e.g. decimals() reverts) rather than silently
        // adding something broken.
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
          const address = ethers.utils.getAddress(msg.tokenAddress); // throws on malformed input, normalizes checksum
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
                // One bad/unreachable token shouldn't blank out the rest of
                // the list -- surface its own error and keep going.
                return { ...t, balanceWei: "0", error: e.message };
              }
            })
          );
          sendResponse({ ok: true, tokens: results });
          break;
        }

        case "TM_SEND_NATIVE": {
          requireUnlocked();
          const network = await getActiveNetwork();
          const meta = await getSelectedAccountMeta();
          assertNotSanctioned(meta.address, "sending account");
          assertNotSanctioned(msg.to, "destination address");
          const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(await getProviderFor(network));
          const tx = await wallet.sendTransaction({ to: msg.to, value: ethers.BigNumber.from(msg.amountWei) });
          sendResponse({ ok: true, txHash: tx.hash });
          break;
        }

        case "TM_SEND_TOKEN": {
          requireUnlocked();
          const network = await getActiveNetwork();
          const meta = await getSelectedAccountMeta();
          assertNotSanctioned(meta.address, "sending account");
          assertNotSanctioned(msg.to, "destination address");
          const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(await getProviderFor(network));
          const c = new ethers.Contract(msg.tokenAddress, TM_SWAP.ERC20_ABI.concat(["function transfer(address to, uint256 amount) returns (bool)"]), wallet);
          const tx = await c.transfer(msg.to, ethers.BigNumber.from(msg.amountWei));
          sendResponse({ ok: true, txHash: tx.hash });
          break;
        }

        case "TM_SWAP_QUOTE": {
          // msg.amountInWei is the TOTAL amount the user is putting in. The
          // app fee comes off the top first (see lib/fee-config.js); only
          // the remainder ever touches the router, and the quote shown to
          // the user is for that remainder so it matches what they'll
          // actually receive.
          const network = await getActiveNetwork();
          const provider = await getProviderFor(network);
          const totalWei = ethers.BigNumber.from(msg.amountInWei);
          const { feeWei, netWei } = TM_FEE.computeFee(totalWei);
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
            feePercentLabel: TM_FEE.feePercentLabel(),
          });
          break;
        }

        case "TM_SWAP_ALLOWANCE": {
          const network = await getActiveNetwork();
          const provider = await getProviderFor(network);
          const meta = await getSelectedAccountMeta();
          const allowance = await TM_SWAP.getAllowance({ provider, tokenAddress: msg.tokenAddress, owner: meta.address, spender: network.swapRouter });
          sendResponse({ ok: true, allowanceWei: allowance.toString() });
          break;
        }

        // Used only by the popup's "Max" button when the From side is the
        // native coin, so filling Max doesn't leave the account with
        // nothing to actually pay for the swap's transaction(s). Rough and
        // deliberately generous: covers the app-fee transfer (a plain
        // native-coin transfer, ~21k gas) plus a Uniswap-V2-style router
        // swap (typically 120k-180k gas) at the current network gas price.
        // This is an estimate, not a simulation -- unusually congested
        // network conditions between this call and the actual swap could
        // still leave the reserve short.
        case "TM_SWAP_NATIVE_GAS_RESERVE": {
          const network = await getActiveNetwork();
          const provider = await getProviderFor(network);
          const ESTIMATED_GAS_UNITS = ethers.BigNumber.from(241000); // 21k fee transfer + ~220k router swap
          let gasPrice;
          try {
            const feeData = await provider.getFeeData();
            gasPrice = feeData.maxFeePerGas || feeData.gasPrice || (await provider.getGasPrice());
          } catch (e) {
            gasPrice = await provider.getGasPrice();
          }
          const reserveWei = ethers.BigNumber.from(gasPrice).mul(ESTIMATED_GAS_UNITS);
          sendResponse({ ok: true, reserveWei: reserveWei.toString() });
          break;
        }

        case "TM_SWAP_APPROVE": {
          requireUnlocked();
          const network = await getActiveNetwork();
          const meta = await getSelectedAccountMeta();
          assertNotSanctioned(meta.address, "account");
          const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(await getProviderFor(network));
          const tx = await TM_SWAP.sendApprove({ signer: wallet, tokenAddress: msg.tokenAddress, spender: network.swapRouter, amountWei: ethers.BigNumber.from(msg.amountWei) });
          sendResponse({ ok: true, txHash: tx.hash });
          break;
        }

        case "TM_SWAP_EXECUTE": {
          // msg.amountInWei is the TOTAL the user is putting in (same
          // convention as TM_SWAP_QUOTE). We skim the app fee off first as
          // its own transfer, wait for it to confirm (so nonces stay in
          // order and we never swap before the fee is actually paid), then
          // swap only the remainder through the router.
          requireUnlocked();
          const network = await getActiveNetwork();
          const meta = await getSelectedAccountMeta();
          assertNotSanctioned(meta.address, "account");
          const wallet = TM_WALLET.getSigningWallet(unlockedSecret, meta).connect(await getProviderFor(network));

          const totalWei = ethers.BigNumber.from(msg.amountInWei);
          const { feeWei, netWei } = TM_FEE.computeFee(totalWei);

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
  return true; // keep sendResponse alive for the async work above
});

// Relay dapp requests that arrive wrapped from content scripts with a tab
// origin context (content-script.js sends TM_DAPP_REQUEST with msg.origin
// already set from the page's location.origin).
