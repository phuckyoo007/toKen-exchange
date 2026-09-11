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
  });
}

window.TM_ENGINE = { handleMessage };
