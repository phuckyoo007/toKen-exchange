// admin.js -- extracted from admin.html so the page can load under the site's
// Content-Security-Policy (script-src 'self', no inline scripts/eval). Logic is
// unchanged from the inline version; only how it's loaded differs.
(function () {
  "use strict";

  var STORAGE_KEY = "tm_admin_token"; // sessionStorage only -- cleared on tab close, never persisted to disk
  var state = { token: "", users: [], refreshTimer: null };

  var gate = document.getElementById("gate");
  var dash = document.getElementById("dash");
  var tokenInput = document.getElementById("tokenInput");
  var gateErr = document.getElementById("gateErr");

  function showToast(msg, isErr) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = "toast"; }, 3200);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "Authorization": "Bearer " + state.token }, opts.headers || {});
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
        return data;
      });
    });
  }

  function fmtDate(ms) {
    if (!ms) return "--";
    var d = new Date(ms);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render() {
    var q = document.getElementById("search").value.trim().toLowerCase();
    var users = state.users.filter(function (u) { return !q || u.username.toLowerCase().indexOf(q) !== -1; });

    var totalDisabled = state.users.filter(function (u) { return u.disabled; }).length;
    document.getElementById("statUsers").textContent = state.users.length;
    document.getElementById("statDisabled").textContent = totalDisabled;

    var tbody = document.getElementById("tbody");
    var emptyState = document.getElementById("emptyState");
    tbody.innerHTML = "";

    if (!users.length) {
      emptyState.style.display = "block";
      emptyState.textContent = state.users.length ? "No accounts match \"" + q + "\"." : "No accounts yet.";
      return;
    }
    emptyState.style.display = "none";

    users.forEach(function (u) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="mono">' + esc(u.username) + '</td>' +
        '<td>' + (u.disabled ? '<span class="badge off">Disabled</span>' : '<span class="badge ok">Active</span>') + '</td>' +
        '<td class="muted">' + fmtDate(u.createdAt) + '</td>' +
        '<td class="muted">' + fmtDate(u.updatedAt) + '</td>' +
        '<td class="mono muted">' + (u.vaultVersion || 0) + '</td>' +
        '<td class="muted">' + (u.activeSessions || 0) + '</td>' +
        '<td class="actions">' +
          '<button class="btn-ghost" data-act="signout" data-u="' + esc(u.username) + '">Sign out</button>' +
          '<button class="btn-ghost" data-act="toggle" data-u="' + esc(u.username) + '" data-disabled="' + (u.disabled ? "1" : "0") + '">' + (u.disabled ? "Enable" : "Disable") + '</button>' +
          '<button class="btn-danger" data-act="delete" data-u="' + esc(u.username) + '">Delete</button>' +
        '</td>';
      tbody.appendChild(tr);
    });
  }

  function confirmAction(title, body) {
    return new Promise(function (resolve) {
      var backdrop = document.getElementById("confirmBackdrop");
      document.getElementById("confirmTitle").textContent = title;
      document.getElementById("confirmBody").textContent = body;
      backdrop.className = "modal-backdrop show";
      function cleanup(result) {
        backdrop.className = "modal-backdrop";
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      }
      var okBtn = document.getElementById("confirmOk");
      var cancelBtn = document.getElementById("confirmCancel");
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
    });
  }

  function loadStats() {
    return api("/api/admin/stats").then(function (data) {
      state.users = data.users || [];
      document.getElementById("statSessions").textContent = data.totalActiveSessions || 0;
      render();
    });
  }

  function scheduleRefresh() {
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function () {
      loadStats().catch(function () { /* silent background refresh failure */ });
    }, 30000);
  }

  function unlock(token) {
    state.token = token;
    return api("/api/admin/stats").then(function (data) {
      sessionStorage.setItem(STORAGE_KEY, token);
      gate.style.display = "none";
      dash.style.display = "block";
      state.users = data.users || [];
      document.getElementById("statSessions").textContent = data.totalActiveSessions || 0;
      render();
      scheduleRefresh();
    });
  }

  document.getElementById("unlockBtn").addEventListener("click", function () {
    var v = tokenInput.value.trim();
    if (!v) return;
    gateErr.textContent = "";
    unlock(v).catch(function (e) {
      gateErr.textContent = e.message || "Could not verify token.";
    });
  });
  tokenInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("unlockBtn").click();
  });

  document.getElementById("lockBtn").addEventListener("click", function () {
    sessionStorage.removeItem(STORAGE_KEY);
    clearInterval(state.refreshTimer);
    state.token = "";
    tokenInput.value = "";
    dash.style.display = "none";
    gate.style.display = "block";
  });

  document.getElementById("refreshBtn").addEventListener("click", function () {
    loadStats().catch(function (e) { showToast(e.message, true); });
  });
  document.getElementById("search").addEventListener("input", render);

  document.getElementById("tbody").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var username = btn.getAttribute("data-u");
    var act = btn.getAttribute("data-act");

    if (act === "signout") {
      api("/api/admin/sign-out-all", { method: "POST", body: { username: username } })
        .then(function (r) { showToast("Signed " + username + " out of " + r.sessionsRemoved + " session(s)."); return loadStats(); })
        .catch(function (e) { showToast(e.message, true); });
      return;
    }

    if (act === "toggle") {
      var currentlyDisabled = btn.getAttribute("data-disabled") === "1";
      api("/api/admin/set-disabled", { method: "POST", body: { username: username, disabled: !currentlyDisabled } })
        .then(function () { showToast((currentlyDisabled ? "Enabled " : "Disabled ") + username + "."); return loadStats(); })
        .catch(function (e) { showToast(e.message, true); });
      return;
    }

    if (act === "delete") {
      confirmAction("Delete " + username + "?", "This permanently deletes the account and its encrypted backup. The person keeps their wallet if they have the 12-word phrase -- this only removes the server-side backup.").then(function (ok) {
        if (!ok) return;
        api("/api/admin/delete-account", { method: "POST", body: { username: username } })
          .then(function () { showToast("Deleted " + username + "."); return loadStats(); })
          .catch(function (e) { showToast(e.message, true); });
      });
      return;
    }
  });

  document.getElementById("rlUserBtn").addEventListener("click", function () {
    var u = document.getElementById("rlUsername").value.trim();
    if (!u) return;
    api("/api/admin/reset-login-limits", { method: "POST", body: { username: u } })
      .then(function (r) { showToast(r.hadLimit ? "Cleared login lockout for " + u + "." : "No active lockout for " + u + "."); })
      .catch(function (e) { showToast(e.message, true); });
  });

  document.getElementById("rlIpBtn").addEventListener("click", function () {
    var ip = document.getElementById("rlIp").value.trim();
    if (!ip) return;
    api("/api/admin/reset-ip-limits", { method: "POST", body: { ip: ip } })
      .then(function (r) { showToast(r.hadLimit ? "Cleared IP limit for " + ip + "." : "No active limit for " + ip + "."); })
      .catch(function (e) { showToast(e.message, true); });
  });

  // Auto-unlock if this tab already had a valid token this session.
  var saved = sessionStorage.getItem(STORAGE_KEY);
  if (saved) {
    tokenInput.value = saved;
    unlock(saved).catch(function () { sessionStorage.removeItem(STORAGE_KEY); });
  }
})();
