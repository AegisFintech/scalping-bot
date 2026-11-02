const $ = (id) => document.getElementById(id);
let tradeInitial = true;
let initial = true,
  busy = false;
async function call(path, body) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: body
      ? { "content-type": "application/json", "x-learning-control": "1" }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok)
    throw new Error(
      r.status === 401
        ? "Authentication required"
        : "Request unavailable; no change confirmed",
    );
  return r.json();
}
function render(d) {
  const t = d.trade;
  $("trade").textContent = t?.budget
    ? `${t.model} · ${t.provider} · USD ${(t.budget.charged / 1e6).toFixed(4)} charged/reserved / ${(t.budget.policy.dailyLimit / 1e6).toFixed(2)} daily limit`
    : t?.activation || "API budget unavailable";
  if (t?.subscriptionFallback)
    $("trade").textContent += t.creditFallbackActive
      ? " · Subscription selected after confirmed credit rejection"
      : " · Subscription fallback enabled for credit/daily API limit";
  if (t?.budget && tradeInitial) {
    $("trade-fields").disabled = false;
    $("trade-limit").value = (t.budget.policy.dailyLimit / 1e6).toFixed(2);
    $("trade-limit").max = (t.configuredCeilingMicroUsd / 1e6).toFixed(2);
    $("trade-paused").checked = t.budget.policy.paused;
    tradeInitial = false;
  }
  if (!d.policy) {
    $("state").textContent = "Learning unavailable; values withheld";
    return;
  }
  const quotaFresh =
    d.quota?.remainingPercent != null &&
    Date.now() - Date.parse(d.quota.checkedAt) <= 900000 &&
    Date.parse(d.quota.checkedAt) <= Date.now() + 5000;
  const waiting = (d.tasks || []).find((t) =>
    t.status.startsWith("WAITING_LEARNING"),
  );
  $("state").textContent = !quotaFresh
    ? "Waiting for fresh subscription quota"
    : d.policy.paused
      ? "Paused by operator"
      : d.quota?.remainingPercent < 20
        ? "Waiting for subscription quota"
        : d.remaining === 0
          ? "Waiting for budget"
          : waiting
            ? waiting.status
            : "Research admission enabled";
  $("budget").textContent =
    `${Number(d.charged).toLocaleString()} / ${Number(d.policy.dailyLimit).toLocaleString()} tokens charged or reserved`;
  $("quota").textContent = !quotaFresh
    ? "Reported quota unavailable"
    : `${d.quota.remainingPercent}% reported quota remaining · ${d.quota.checkedAt}`;
  $("model").textContent = `${d.model} · ${d.contextPolicy}`;
  const u = d.usageTotals;
  $("tokens").textContent = u
    ? `Today: input ${u.inputTokens.toLocaleString()} (cached ${u.cachedInputTokens.toLocaleString()}) · output ${u.outputTokens.toLocaleString()} (reasoning ${u.reasoningOutputTokens.toLocaleString()}) · ${u.knownReceipts} known receipts`
    : "Token breakdown unavailable; old or unmetered use is not zero.";
  $("tasks").replaceChildren(
    ...(d.tasks || []).map((t) => {
      const p = document.createElement("p");
      p.textContent = `${t.role} · ${t.status} · ${t.updatedAt}`;
      return p;
    }),
  );
  $("publications").replaceChildren(
    ...(d.publications || []).map((r) => {
      const p = document.createElement("p");
      p.textContent = `PR #${r.pullRequest} · ${r.status} · ${r.reason || ""}`;
      const a = document.createElement("a");
      a.href = `https://github.com/AegisFintech/scalping-bot/pull/${r.pullRequest}`;
      a.textContent = " Open PR";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      p.append(a);
      return p;
    }),
  );
  $("next").textContent = d.observation
    ? `Observation: ${d.observation.status} · ${d.observation.blocker || ""} · next ${d.observation.scheduledNextReviewAt || "unavailable"}`
    : "Research status unavailable; no progress inferred.";
  const f = d.finding || {};
  $("summary").textContent = f.summary || "No verified finding available";
  $("question").textContent = f.nextQuestion || "";
  $("finding-time").textContent = d.findingRecordedAt
    ? `Recorded ${d.findingRecordedAt} · window ${d.findingWindow?.start || "unknown"} to ${d.findingWindow?.until || "unknown"}`
    : "Finding time unavailable";
  $("evidence").textContent = f.requiredEvidence
    ? `Required evidence: ${f.requiredEvidence}`
    : "";
  $("falsification").textContent = f.falsificationTest
    ? `Rejection rule: ${f.falsificationTest}`
    : "";
  $("history").replaceChildren(
    ...(d.recent || []).map((r) => {
      const p = document.createElement("p");
      p.textContent = `${r.topic} · ${r.status} · ${r.actual ?? "unknown"} actual / ${r.estimate} reserved · ${r.created}`;
      return p;
    }),
  );
  if (initial) {
    $("focus").value = d.policy.focus;
    $("limit").value = d.policy.dailyLimit;
    $("guidance").value = d.policy.guidance;
    $("paused").checked = d.policy.paused;
    initial = false;
  }
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const v = await call("/api/learning");
    $("login").hidden = true;
    $("board").hidden = false;
    if (v.data) render(v.data);
    else $("state").textContent = `Evidence ${v.readState}; values withheld`;
  } catch (e) {
    $("state").textContent = e.message;
  } finally {
    busy = false;
  }
}
$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await call("/api/learning/login", { token: $("token").value });
    $("token").value = "";
    await poll();
  } catch (e) {
    $("state").textContent = e.message;
  }
});
$("controls").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const d = await call("/api/learning/control", {
      focus: $("focus").value,
      dailyLimit: Number($("limit").value),
      guidance: $("guidance").value,
      paused: $("paused").checked,
    });
    render(d);
    $("message").textContent =
      "Saved. Direction applies to new work; prior evidence is retained.";
  } catch (e) {
    $("message").textContent = e.message;
  }
});
poll();
window.setInterval(poll, 10000);

$("trade-controls").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const text = $("trade-limit").value;
    if (!/^\d+(\.\d{1,6})?$/.test(text))
      throw new Error("Enter a decimal API budget");
    const [w, f = ""] = text.split(".");
    const amount = Number(
      BigInt(w) * 1000000n + BigInt((f + "000000").slice(0, 6)),
    );
    await call("/api/learning/trading-control", {
      paused: $("trade-paused").checked,
      dailyLimitMicroUsd: amount,
    });
    $("message").textContent =
      "API resource settings saved. Position protection continues.";
  } catch (e) {
    $("message").textContent = e.message;
  }
});
