// lib/account.js
// Client side of the optional username/password account (server: auth-api.js).
// Loaded after app.js, so $(), showScreen(), showError(), sendMsg() and
// refreshMain() already exist.
//
// WHAT LEAVES THIS DEVICE
//  - authKey: PBKDF2-SHA256(password, "tokenexchange-auth-v1:<username>",
//    600k iterations). A one-way value; the server can't get the password
//    back from it, and it is a different derivation from the one that
//    encrypts the vault (which uses a random per-vault salt).
//  - bundle: the wallet vault + account list, AES-256-GCM encrypted under the
//    wallet password (built by wallet-engine.js -- the password never comes
//    through this file except to derive authKey).
// The account password IS the wallet password, so restoring on a new device
// needs only one secret. That also means a weak wallet password weakens the
// online backup -- hence the 12-character minimum below.

(function () {
  "use strict";

  const AUTH_ITERATIONS = 600000;
  const MIN_ACCOUNT_PASSWORD = 12;
  const VERSION_KEY = "tm_account_version"; // last backup version THIS device synced
  const COMMON_PASSWORDS = [
    "password", "password1", "password12", "password123", "passw0rd1234", "123456789012",
    "1234567890123", "qwertyuiopas", "qwerty123456", "letmein12345", "iloveyou1234",
    "administrator", "welcome12345", "changeme1234", "000000000000", "111111111111",
  ];

  const enc = new TextEncoder();
  let session = null; // { username, version, updatedAt } while signed in
  let accountsUnavailable = false; // server has no account API (or it's switched off)
  let needsAttention = false; // an automatic backup hit a conflict

  // ------------------------------------------------------------ validation
  function normUsername(u) {
    return String(u == null ? "" : u).normalize("NFKC").trim().toLowerCase();
  }

  function usernameProblem(u) {
    return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(u)
      ? null
      : "Usernames are 3-32 characters: letters, numbers, dot, dash or underscore.";
  }

  function passwordProblem(pw, username) {
    if (pw.length < MIN_ACCOUNT_PASSWORD) return `Use at least ${MIN_ACCOUNT_PASSWORD} characters -- a few random words works well.`;
    const low = pw.toLowerCase();
    if (COMMON_PASSWORDS.includes(low)) return "That password is far too common. Pick something only you would think of.";
    if (username && low.includes(username)) return "Your password shouldn't contain your username.";
    if (/^(.)\1+$/.test(pw)) return "Your password can't be one repeated character.";
    return null;
  }

  // ------------------------------------------------------------------ crypto
  async function deriveAuthKey(username, password) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: enc.encode("tokenexchange-auth-v1:" + username), iterations: AUTH_ITERATIONS, hash: "SHA-256" },
      base,
      256
    );
    return TM_CRYPTO.bufToBase64(bits);
  }

  // --------------------------------------------------------------------- API
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-TM-Request": "1" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw Object.assign(new Error("Couldn't reach the server. Check your connection and try again."), { status: 0 });
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { status: res.status, data });
    return data;
  }

  async function getLocalVersion() {
    const r = await chrome.storage.local.get(VERSION_KEY);
    return r[VERSION_KEY] === undefined ? null : r[VERSION_KEY];
  }
  async function setLocalVersion(v) {
    if (v === null) await chrome.storage.local.remove(VERSION_KEY);
    else await chrome.storage.local.set({ [VERSION_KEY]: v });
  }

  async function refreshSession() {
    if (accountsUnavailable) { session = null; return null; }
    try {
      session = await api("GET", "/api/auth/me");
    } catch (e) {
      session = null;
      if (e.status === 503 || e.status === 404 || e.status === 405) accountsUnavailable = true;
    }
    return session;
  }

  // Uploads the current encrypted vault. Never overwrites a newer server copy
  // unless told to (opts.force) -- returns {status: "conflict"} instead.
  async function pushBundle(opts) {    const force = !!(opts && opts.force);
    const s = await refreshSession();
    if (!s) return { status: "signedout" };
    if (!force && (await getLocalVersion()) !== s.version) return { status: "conflict" };
    const { bundle } = await sendMsg("TM_EXPORT_BUNDLE");
    try {
      const r = await api("PUT", "/api/vault", { bundle, baseVersion: s.version, force });
      await setLocalVersion(r.version);
      session = { username: s.username, version: r.version, updatedAt: r.updatedAt };
      return { status: "ok", version: r.version };
    } catch (e) {
      if (e.status === 409) return { status: "conflict" };
      throw e;
    }
  }

  // Fire-and-forget backup after the wallet changes (new account, imported
  // key...). Silent when signed out; flags a conflict for the Account screen.
  let syncChain = Promise.resolve();
  function autoSync() {
    if (accountsUnavailable) return syncChain;
    syncChain = syncChain.then(async () => {
      try {
        const r = await pushBundle();
        needsAttention = r.status === "conflict";
      } catch (e) {
        console.warn("[account] automatic backup failed:", e.message);
      }
    });
    return syncChain;
  }

  // Language is a plain UI preference (not part of the encrypted vault), so
  // it syncs on its own tiny endpoint rather than needing a full vault
  // upload. Fire-and-forget: a failed push just means the picker stays a
  // per-device setting for now, no different from before this existed.
  async function pushLanguage(code) {
    if (accountsUnavailable) return;
    const s = await refreshSession();
    if (!s) return;
    try {
      await api("POST", "/api/auth/language", { language: code });
    } catch (e) {
      console.warn("[account] language sync failed:", e.message);
    }
  }
  document.addEventListener("tm-language-changed", (e) => {
    pushLanguage(e.detail && e.detail.lang);
  });

  // -------------------------------------------------------------- UI helpers
  function setBusy(btnId, busy, busyText) {
    const btn = $(btnId);
    if (busy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = busyText;
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.disabled = false;
    }
  }

  function showStatus(msg) {
    hideError("account-error");
    const el = $("account-status");
    el.textContent = msg;
    el.classList.remove("hidden");
  }
  function showAccountError(msg) {
    $("account-status").classList.add("hidden");
    showError("account-error", msg);
  }

  async function renderAccountScreen() {
    hideError("account-error");
    $("account-status").classList.add("hidden");
    ["account-password", "account-password-confirm", "pw-current", "pw-new", "pw-new-confirm", "account-delete-password"].forEach((id) => { $(id).value = ""; });
    await refreshSession();
    $("account-unavailable").classList.toggle("hidden", !accountsUnavailable);
    $("account-signed-out").classList.toggle("hidden", accountsUnavailable || !!session);
    $("account-signed-in").classList.toggle("hidden", !session);
    $("account-delete-box").classList.toggle("hidden", !session);
    if (session) {
      $("account-name").textContent = session.username;
      const when = session.updatedAt ? new Date(session.updatedAt).toLocaleString() : "";
      let line = `Encrypted backup saved${when ? " " + when : ""} (v${session.version}).`;
      if (needsAttention) line += " The backup on your account changed from another device -- tap \"Back up now\" to review.";
      $("account-sync-status").textContent = line;
    }
  }

  // ------------------------------------------------------------------ flows
  async function signIn() {
    hideError("signin-error");
    const username = normUsername($("signin-username").value);
    const pw = $("signin-password").value;
    if (usernameProblem(username) || !pw) return showError("signin-error", "Incorrect username or password.");
    setBusy("btn-signin-submit", true, "Signing in...");
    try {
      const authKey = await deriveAuthKey(username, pw);
      const login = await api("POST", "/api/auth/login", { username, authKey });
      try {
        const vault = await api("GET", "/api/vault");
        await sendMsg("TM_RESTORE_BUNDLE", { bundle: vault.bundle, password: pw });
        await setLocalVersion(vault.version);
        session = { username: login.username, version: vault.version, updatedAt: vault.updatedAt };
        // The account's saved language (if any) wins on sign-in -- this is
        // precisely the "follow me to a new device" case, so a fresh
        // browser with only its default/browser-detected language defers
        // to whatever this person already chose on their account.
        if (login.language && login.language !== TM_I18N.getLanguage()) {
          TM_I18N.setLanguage(login.language, { silent: true });
        }
      } catch (e) {
        api("POST", "/api/auth/logout", {}).catch(() => {}); // don't leave a session behind a failed restore
        throw e;
      }
      $("signin-password").value = "";
      await refreshMain();
      showScreen("screen-main");
    } catch (e) {
      showError("signin-error", e.message);
    } finally {
      setBusy("btn-signin-submit", false);
    }
  }

  async function createAccount() {
    hideError("account-error");
    const username = normUsername($("account-username").value);
    const pw = $("account-password").value;
    const pw2 = $("account-password-confirm").value;
    const problem = usernameProblem(username) || passwordProblem(pw, username);
    if (problem) return showAccountError(problem);
    if (pw !== pw2) return showAccountError("The two passwords don't match.");
    setBusy("btn-account-create", true, "Creating account...");
    try {
      try {
        await sendMsg("TM_VERIFY_PASSWORD", { password: pw });
      } catch (e) {
        throw new Error("That isn't this wallet's current password. Your account password has to match it (use \"Change wallet password\" below to pick a new one first).");
      }
      const authKey = await deriveAuthKey(username, pw);
      const { bundle } = await sendMsg("TM_EXPORT_BUNDLE");
      const r = await api("POST", "/api/auth/register", { username, authKey, bundle, language: TM_I18N.getLanguage() });
      await setLocalVersion(r.version);
      session = r;
      needsAttention = false;
      await renderAccountScreen();
      showStatus("Account created. Your encrypted backup is saved.");
    } catch (e) {
      showAccountError(e.message);
    } finally {
      setBusy("btn-account-create", false);
    }
  }

  async function syncNow() {
    setBusy("btn-account-sync", true, "Backing up...");
    try {
      let r = await pushBundle();
      if (r.status === "conflict") {
        const overwrite = confirm(
          "The backup on your account was changed from another device.\n\nOK = replace it with this device's wallet (the older copy is kept for a while).\nCancel = leave the account backup as it is."
        );
        if (!overwrite) return showStatus("Left the account backup unchanged.");
        r = await pushBundle({ force: true });
      }
      if (r.status === "signedout") { await renderAccountScreen(); return showAccountError("You've been signed out. Sign in again from the welcome screen after resetting, or create the account again."); }
      needsAttention = false;
      await renderAccountScreen();
      showStatus("Backed up.");
    } catch (e) {
      showAccountError(e.message);
    } finally {
      setBusy("btn-account-sync", false);
    }
  }

  async function signOut() {
    try { await api("POST", "/api/auth/logout", {}); } catch (e) { /* cookie may already be gone */ }
    session = null;
    await renderAccountScreen();
    showStatus("Signed out. The wallet on this device is unchanged.");
  }

  async function changePassword() {
    hideError("account-error");
    const cur = $("pw-current").value;
    const nw = $("pw-new").value;
    const nw2 = $("pw-new-confirm").value;
    if (!cur) return showAccountError("Enter your current password.");
    await refreshSession();
    const problem = session ? passwordProblem(nw, session.username) : (nw.length < 8 ? "Choose a password of at least 8 characters." : null);
    if (problem) return showAccountError(problem);
    if (nw !== nw2) return showAccountError("The two new passwords don't match.");
    setBusy("btn-pw-change", true, "Changing...");
    try {
      // Phase 1: verify the old password and build everything encrypted under
      // the new one -- nothing on this device changes yet.
      const prep = await sendMsg("TM_PREPARE_PASSWORD_CHANGE", { oldPassword: cur, newPassword: nw });
      // Phase 2: update the account first (if any). If this throws, the
      // device keeps the old password and nothing is out of step.
      if (session) {
        const oldKey = await deriveAuthKey(session.username, cur);
        const newKey = await deriveAuthKey(session.username, nw);
        const r = await api("POST", "/api/auth/change-password", { authKey: oldKey, newAuthKey: newKey, bundle: prep.bundle });
        await setLocalVersion(r.version);
        needsAttention = false;
      }
      // Phase 3: switch the local vault over.
      await sendMsg("TM_COMMIT_PASSWORD_CHANGE");
      await renderAccountScreen();
      showStatus(session ? "Password changed. Other devices have been signed out." : "Password changed.");
    } catch (e) {
      showAccountError(e.message);
    } finally {
      setBusy("btn-pw-change", false);
    }
  }

  async function deleteAccount() {
    hideError("account-error");
    const pw = $("account-delete-password").value;
    if (!pw) return showAccountError("Enter your password to confirm.");
    if (!confirm("Delete your account and its online backup? The wallet on this device stays, but you won't be able to restore it from the account anymore.")) return;
    setBusy("btn-account-delete", true, "Deleting...");
    try {
      const authKey = await deriveAuthKey(session.username, pw);
      await api("POST", "/api/auth/delete", { authKey });
      session = null;
      await setLocalVersion(null);
      await renderAccountScreen();
      showStatus("Account deleted.");
    } catch (e) {
      showAccountError(e.message);
    } finally {
      setBusy("btn-account-delete", false);
    }
  }

  // ------------------------------------------------------------------ wiring
  $("btn-goto-signin").addEventListener("click", () => {
    hideError("signin-error");
    showScreen("screen-signin");
  });
  $("btn-signin-submit").addEventListener("click", signIn);
  ["signin-username", "signin-password"].forEach((id) =>
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") signIn(); })
  );

  $("btn-goto-account").addEventListener("click", () => {
    showScreen("screen-account");
    renderAccountScreen();
  });
  $("btn-account-create").addEventListener("click", createAccount);
  $("btn-account-sync").addEventListener("click", syncNow);
  $("btn-account-signout").addEventListener("click", signOut);
  $("btn-pw-change").addEventListener("click", changePassword);
  $("btn-account-delete").addEventListener("click", deleteAccount);

  window.TM_ACCOUNT_UI = { autoSync };
})();
