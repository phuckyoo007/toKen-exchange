// lib/token-scan.js
// "Scan wallet for tokens": finds which well-known tokens an address holds on the
// current network. Shared by the extension worker (background.js), the website
// engine (wallet-engine.js) and both UIs.
//
// How it works
//   * candidates(network)  -- UI side. The list to check: the hand-verified issuer
//     stablecoins (lib/known-tokens.js) plus the biggest tokens on this network by
//     market cap from CoinGecko (lib/token-catalog.js). Because only ranked, listed
//     tokens are ever checked, airdropped spam / lookalike tokens are never shown.
//   * scanBalances(provider, owner, addresses) -- engine side. Reads balanceOf for
//     every candidate in batches through Multicall3 (one RPC call per batch) and
//     falls back to one call per token if the chain has no Multicall3. Only tokens
//     with a non-zero balance are read further (decimals / symbol / name).
//
// Nothing is added to the wallet automatically: the UI lists what was found and the
// person chooses what to add (through the existing TM_ADD_TRACKED_TOKEN message).
// Read-only: no keys, no transactions, only public balanceOf / metadata reads.
(function () {
  const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const MULTICALL_ABI = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)",
  ];
  const ERC20_IFACE = new ethers.utils.Interface([
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function name() view returns (string)",
  ]);
  const BATCH = 100;
  const MAX_CANDIDATES = 300;

  const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max || 32);

  async function multicall(provider, calls) {
    const mc = new ethers.Contract(MULTICALL3, MULTICALL_ABI, provider);
    const out = [];
    for (let i = 0; i < calls.length; i += BATCH) {
      const chunk = calls.slice(i, i + BATCH);
      const res = await mc.aggregate3(chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.callData })));
      res.forEach((r) => out.push({ success: r.success, data: r.returnData }));
    }
    return out;
  }

  // Same shape as multicall() but one eth_call per entry, for chains without Multicall3.
  async function singleCalls(provider, calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += 10) {
      const part = await Promise.all(calls.slice(i, i + 10).map(async (c) => {
        try { return { success: true, data: await provider.call({ to: c.target, data: c.callData }) }; }
        catch (e) { return { success: false, data: "0x" }; }
      }));
      out.push(...part);
    }
    return out;
  }

  async function batchCall(provider, calls) {
    if (!calls.length) return [];
    try {
      const code = await provider.getCode(MULTICALL3);
      if (code && code !== "0x") return await multicall(provider, calls);
    } catch (e) { /* fall through to single calls */ }
    return singleCalls(provider, calls);
  }

  function decode(fn, r) {
    if (!r || !r.success || !r.data || r.data === "0x") return null;
    try { return ERC20_IFACE.decodeFunctionResult(fn, r.data)[0]; } catch (e) { return null; }
  }

  // Returns [{ address, balanceWei, decimals, symbol, name }] for tokens with balance > 0.
  async function scanBalances(provider, owner, addresses) {
    if (!ethers.utils.isAddress(owner)) throw new Error("No account selected.");
    const seen = new Set();
    const list = [];
    for (const a of Array.isArray(addresses) ? addresses : []) {
      let c;
      try { c = ethers.utils.getAddress(String(a)); } catch (e) { continue; }
      if (seen.has(c)) continue;
      seen.add(c);
      list.push(c);
      if (list.length >= MAX_CANDIDATES) break;
    }
    const balData = ERC20_IFACE.encodeFunctionData("balanceOf", [owner]);
    const balances = await batchCall(provider, list.map((t) => ({ target: t, callData: balData })));
    const held = [];
    list.forEach((address, i) => {
      const bal = decode("balanceOf", balances[i]);
      if (bal && ethers.BigNumber.from(bal).gt(0)) held.push({ address, balanceWei: ethers.BigNumber.from(bal).toString() });
    });
    if (!held.length) return { checked: list.length, found: [] };

    const metaCalls = [];
    held.forEach((h) => ["decimals", "symbol", "name"].forEach((fn) => metaCalls.push({ target: h.address, callData: ERC20_IFACE.encodeFunctionData(fn, []) })));
    const meta = await batchCall(provider, metaCalls);
    const found = [];
    held.forEach((h, i) => {
      const decimals = decode("decimals", meta[i * 3]);
      if (decimals == null) return; // not a readable ERC-20 -- skip rather than show something we can't format
      found.push({
        address: h.address,
        balanceWei: h.balanceWei,
        decimals: Number(decimals),
        symbol: clean(decode("symbol", meta[i * 3 + 1]) || "TOKEN", 16),
        name: clean(decode("name", meta[i * 3 + 2]) || "", 48),
      });
    });
    return { checked: list.length, found };
  }

  // UI side: the addresses worth checking on this network (checksummed, de-duplicated).
  async function candidates(network, topN) {
    const out = new Map();
    const add = (t) => {
      try { const a = ethers.utils.getAddress(String(t.address)); if (!out.has(a)) out.set(a, a); } catch (e) { /* skip malformed */ }
    };
    if (typeof knownTokensForChain === "function" && network) knownTokensForChain(network.chainId).forEach(add);
    let catalogOk = false;
    if (typeof TM_CATALOG !== "undefined" && network && TM_CATALOG.supports(network.key)) {
      try { (await TM_CATALOG.top(network.key, topN || 250)).forEach(add); catalogOk = true; } catch (e) { /* known tokens still get checked */ }
    }
    return { addresses: [...out.values()], catalogOk };
  }

  self.TM_TOKEN_SCAN = { MULTICALL3, MAX_CANDIDATES, scanBalances, candidates };
})();
