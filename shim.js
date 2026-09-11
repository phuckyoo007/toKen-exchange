// shim.js -- a minimal `chrome.*` surface so the extension's own
// lib/*.js and app.js (a near-verbatim copy of the extension's popup.js)
// run completely unmodified in a plain webpage. Two things are shimmed:
//
// 1. chrome.storage.local -- backed by IndexedDB in THIS browser only
//    (never synced, never sent anywhere). Supports both call styles the
//    existing code already uses: callback-style (chrome.storage.local.get(
//    keys, cb)) and promise-style (await chrome.storage.local.get(keys)),
//    same dual mode the real extension API has.
//
// 2. chrome.runtime.sendMessage -- routed directly into wallet-engine.js's
//    handleMessage() in this same page, instead of crossing a real
//    extension message boundary to a separate service-worker process.
//    There is no second process here for it to cross to.
//
// Also: chrome.tabs.create (used once, to open the MoonPay buy widget in a
// new tab) -> window.open.
(function () {
  const DB_NAME = "token_exchange_web_wallet";
  const STORE = "kv";
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("This browser doesn't support IndexedDB, which this wallet needs to store your (encrypted) vault."));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function idbGetAll() {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const store = tx.objectStore(STORE);
          const keysReq = store.getAllKeys();
          const valsReq = store.getAll();
          let keys, vals;
          function maybeDone() {
            if (keys !== undefined && vals !== undefined) {
              const out = {};
              keys.forEach((k, i) => (out[k] = vals[i]));
              resolve(out);
            }
          }
          keysReq.onsuccess = () => {
            keys = keysReq.result;
            maybeDone();
          };
          valsReq.onsuccess = () => {
            vals = valsReq.result;
            maybeDone();
          };
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function idbGetKeys(keys) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const store = tx.objectStore(STORE);
          const out = {};
          let remaining = keys.length;
          if (!remaining) return resolve(out);
          keys.forEach((k) => {
            const r = store.get(k);
            r.onsuccess = () => {
              if (r.result !== undefined) out[k] = r.result;
              remaining--;
              if (remaining === 0) resolve(out);
            };
            r.onerror = () => reject(r.error);
          });
        })
    );
  }

  function storageGet(keys) {
    if (keys == null) return idbGetAll();
    if (typeof keys === "string") return idbGetKeys([keys]);
    if (Array.isArray(keys)) return idbGetKeys(keys);
    // An object of { key: defaultValue } -- fill in defaults for any key
    // that isn't in storage yet, same as the real chrome.storage.local API.
    return idbGetKeys(Object.keys(keys)).then((out) => {
      Object.keys(keys).forEach((k) => {
        if (!(k in out)) out[k] = keys[k];
      });
      return out;
    });
  }

  function storageSet(items) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          Object.keys(items).forEach((k) => store.put(items[k], k));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function storageRemove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          list.forEach((k) => store.delete(k));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  // Wraps a promise-returning function so it also accepts a trailing
  // Node/Chrome-style callback, matching the real chrome.storage.local API
  // (which supports both calling conventions) -- this codebase uses both.
  function withCallback(promiseFn) {
    return function (...args) {
      const maybeCb = args[args.length - 1];
      if (typeof maybeCb === "function") {
        const rest = args.slice(0, -1);
        promiseFn(...rest)
          .then((result) => maybeCb(result === undefined ? {} : result))
          .catch((e) => {
            console.error("[token exchange] storage error:", e);
            maybeCb({});
          });
        return undefined;
      }
      return promiseFn(...args);
    };
  }

  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: withCallback(storageGet),
      set: withCallback(storageSet),
      remove: withCallback(storageRemove),
    },
  };

  window.chrome.runtime = {
    // Always undefined here -- there's no second process for a message to
    // fail to reach; a failure inside handleMessage() instead shows up as
    // { ok: false, error } in the response itself (see wallet-engine.js).
    lastError: undefined,
    getURL: (path) => path,
    sendMessage: function (msg, callback) {
      const run = () => window.TM_ENGINE.handleMessage(msg);
      if (typeof callback === "function") {
        run()
          .then((response) => callback(response))
          .catch((e) => callback({ ok: false, error: (e && e.message) || String(e) }));
        return undefined;
      }
      // MV3's real chrome.runtime.sendMessage also returns a Promise when
      // no callback is given -- support that shape too, just in case.
      return run();
    },
  };

  window.chrome.tabs = {
    create: (opts) => {
      if (opts && opts.url) window.open(opts.url, "_blank", "noopener");
    },
  };
})();
