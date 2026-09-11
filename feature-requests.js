// lib/feature-requests.js
// A small public "feature request board" -- lets any user post an idea or
// complaint and upvote other people's, so the ones people actually want
// float to the top. Backed by a couple of tiny JSON endpoints in server.js
// (see api/feature-requests.js on the server side); nothing here touches
// wallet keys, balances, or any chain -- it's just a feedback list.
//
// Loaded after app.js, so $()/showScreen()/TM_I18N are already available.

const TM_FEEDBACK_UPVOTED_KEY = "tm_feedback_upvoted_ids";

function tmFeedbackGetUpvoted() {
  try {
    const raw = localStorage.getItem(TM_FEEDBACK_UPVOTED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function tmFeedbackMarkUpvoted(id) {
  try {
    const ids = tmFeedbackGetUpvoted();
    if (!ids.includes(id)) {
      ids.push(id);
      localStorage.setItem(TM_FEEDBACK_UPVOTED_KEY, JSON.stringify(ids));
    }
  } catch (e) {
    // localStorage unavailable (private mode, etc.) -- upvote still
    // happens server-side, the button just won't remember it was clicked.
  }
}

async function tmFeedbackFetchList() {
  const res = await fetch("/api/feature-requests");
  if (!res.ok) throw new Error("request failed: " + res.status);
  const data = await res.json();
  return Array.isArray(data.requests) ? data.requests : [];
}

async function tmFeedbackSubmit(title, description) {
  const res = await fetch("/api/feature-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "request failed: " + res.status);
  }
  return res.json();
}

async function tmFeedbackUpvote(id) {
  const res = await fetch(`/api/feature-requests/${encodeURIComponent(id)}/upvote`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("request failed: " + res.status);
  return res.json();
}

function tmFeedbackRenderList(requests) {
  const root = $("feedback-list");
  root.innerHTML = "";
  $("feedback-empty").classList.toggle("hidden", requests.length > 0);
  const upvoted = tmFeedbackGetUpvoted();

  requests
    .slice()
    .sort((a, b) => (b.votes - a.votes) || (b.createdAt - a.createdAt))
    .forEach((r) => {
      const row = document.createElement("div");
      row.className = "activity-entry";

      const body = document.createElement("div");
      body.className = "activity-body";
      const main = document.createElement("div");
      main.className = "activity-main";
      main.textContent = r.title;
      body.appendChild(main);
      if (r.description) {
        const sub = document.createElement("div");
        sub.className = "activity-sub";
        sub.textContent = r.description;
        body.appendChild(sub);
      }

      const voteWrap = document.createElement("div");
      voteWrap.style.display = "flex";
      voteWrap.style.flexDirection = "column";
      voteWrap.style.alignItems = "center";
      voteWrap.style.gap = "2px";

      const alreadyUpvoted = upvoted.includes(r.id);
      const voteBtn = document.createElement("button");
      voteBtn.className = "secondary small";
      voteBtn.textContent = `▲ ${r.votes}`;
      voteBtn.title = TM_I18N.t(alreadyUpvoted ? "feedback.upvotedBtn" : "feedback.upvoteBtn");
      voteBtn.disabled = alreadyUpvoted;
      voteBtn.onclick = async () => {
        voteBtn.disabled = true;
        try {
          const updated = await tmFeedbackUpvote(r.id);
          tmFeedbackMarkUpvoted(r.id);
          voteBtn.textContent = `▲ ${updated.votes}`;
        } catch (e) {
          voteBtn.disabled = false;
        }
      };
      voteWrap.appendChild(voteBtn);

      row.appendChild(body);
      row.appendChild(voteWrap);
      root.appendChild(row);
    });
}

async function tmFeedbackRefresh() {
  hideError("feedback-error");
  try {
    const requests = await tmFeedbackFetchList();
    tmFeedbackRenderList(requests);
  } catch (e) {
    showError("feedback-error", TM_I18N.t("feedback.loadError"));
  }
}

function openFeedback() {
  showScreen("screen-feedback");
  $("feedback-status").classList.add("hidden");
  tmFeedbackRefresh();
}

$("btn-goto-feedback").addEventListener("click", openFeedback);

$("btn-feedback-submit").addEventListener("click", async () => {
  hideError("feedback-error");
  $("feedback-status").classList.add("hidden");
  const title = $("feedback-title-input").value.trim();
  const description = $("feedback-desc-input").value.trim();
  if (!title) {
    showError("feedback-error", TM_I18N.t("feedback.titleRequired"));
    return;
  }
  $("btn-feedback-submit").disabled = true;
  $("feedback-status").textContent = TM_I18N.t("feedback.submittingStatus");
  $("feedback-status").classList.remove("hidden");
  try {
    const created = await tmFeedbackSubmit(title, description);
    tmFeedbackMarkUpvoted(created.id); // can't un-vote your own post
    $("feedback-title-input").value = "";
    $("feedback-desc-input").value = "";
    $("feedback-status").textContent = TM_I18N.t("feedback.submittedStatus");
    await tmFeedbackRefresh();
  } catch (e) {
    $("feedback-status").classList.add("hidden");
    showError("feedback-error", e.message);
  } finally {
    $("btn-feedback-submit").disabled = false;
  }
});
