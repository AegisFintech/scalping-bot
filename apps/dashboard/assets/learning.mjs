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
        ? "Cloudflare Access authentication required"
        : "Request unavailable; no change confirmed",
    );
  return r.json();
}
function countsText(groups) {
  return Object.entries(groups ?? {})
    .map(
      ([name, counts]) =>
        `${name}: ${Object.entries(counts)
          .map(([state, count]) => `${state} ${count}`)
          .join(", ")}`,
    )
    .join(" · ");
}
function renderFunnel(d) {
  const study = ["CURRENT", "STALE"].includes(d.registeredStudy?.readState)
    ? d.registeredStudy
    : null;
  $("study-state").textContent = study
    ? `${study.readState} · ${study.status} · checked ${study.checkedAt} (${study.ageSeconds}s ago)`
    : "Registered study unavailable";
  $("study-window").textContent = study
    ? `${study.sourceId} · registration ${study.registrationSha256} · ${study.release} · ${study.start} to ${study.until} · retained ${study.retainedWindows}/${study.expectedWindows} windows`
    : "";
  $("study-storage").textContent = study
    ? `Storage ${(study.storageBytes / 1048576).toFixed(2)} / ${(study.storageLimitBytes / 1048576).toFixed(0)} MiB · original inputs compressed · disk free ${(study.freeBytes / 1073741824).toFixed(2)} GiB / 2 GiB reserve`
    : "";
  $("study-result").textContent = study?.latest
    ? `Latest verified window ends ${study.latest.until} · ${study.latest.origins} overlapping context origins. Thresholds ${countsText(study.latest.counts)}. Recorded level sequence ${countsText(study.latest.levelCounts)}. No executable fills or profit inferred.`
    : study
      ? "No verified completed window yet"
      : "";
  const funnelState = d.executionFunnelReadState ?? "UNAVAILABLE";
  const f = ["CURRENT", "STALE"].includes(funnelState)
    ? d.executionFunnel
    : null;
  const research =
    f &&
    d.executionResearch?.agenda?.packetSha256 === f.packetSha256 &&
    d.executionResearch?.breakout?.packetSha256 === f.packetSha256
      ? d.executionResearch
      : null;
  $("research-stage").textContent = research
    ? `RECORDED ${funnelState} · ${research.agenda.stage}`
    : "Research agenda unavailable";
  $("research-facts").textContent = research
    ? `WAIT checks ${research.agenda.waitChecks}: ${research.agenda.exactlyLinkedWaitChecks} exact links / ${research.agenda.unavailableWaitLinks} unavailable. Completed failures ${research.agenda.completedFailures}; incomplete contexts ${research.agenda.incompleteContexts}.`
    : "";
  $("research-hypotheses").textContent = research
    ? countsText(research.breakout.counts)
    : "";
  $("research-next").textContent = research
    ? `${research.agenda.question} Next: ${research.agenda.nextAction}`
    : "";
  $("funnel-window").textContent = f
    ? `RECORDED ${funnelState} · Window ${f.start} to ${f.until} · snapshot ${f.journalSnapshotAt}`
    : "Recorded execution measurement unavailable";
  $("funnel-decisions").textContent = f
    ? `Context rows ${f.contexts}: BUY ${f.decisionCounts.BUY ?? 0} · SELL ${f.decisionCounts.SELL ?? 0} · WAIT ${f.decisionCounts.WAIT ?? 0} · UNKNOWN ${f.decisionCounts.UNKNOWN ?? 0}`
    : "";
  $("funnel-orders").textContent = f
    ? `Order rows ${f.orderRecords} · mapped broker acceptance ${f.brokerAcceptedOrderRecords} · any recorded filled volume ${f.filledOrderRecords} · partial ${f.partialOrderRecords} · window closes ${f.windowClosedRows}`
    : "";
  const scope =
    f && d.executionObservationScope?.packetSha256 === f.packetSha256
      ? d.executionObservationScope
      : null;
  $("funnel-baseline").textContent = !f
    ? ""
    : scope
      ? `Historical baseline (${scope.legacyBaselineRelease}): ${scope.supportedContexts} supported / ${scope.unsupportedContexts} unavailable contexts. BUY ${scope.decisions.BUY ?? 0} · SELL ${scope.decisions.SELL ?? 0} · WAIT ${scope.decisions.WAIT ?? 0}. Unexecuted hypotheses; unsupported releases are not trading blockers or provider WAITs.`
      : "Historical baseline applicability unavailable; do not infer provider WAITs or trading blockers.";
  $("funnel-outcomes").textContent = !f
    ? ""
    : scope
      ? `Recorded window closes: ${scope.windowClosedRows}. ${scope.windowOutcomes.map((v) => `${v.originRelease} ${v.currency}: net ${v.realizedNet}, signed fees ${v.signedFees}, ${v.positive} positive / ${v.negative} negative / ${v.flat} flat`).join(" · ")} Net already includes fees; close-time rows, not a cohort return.`
      : "Recorded window outcome totals unavailable.";
  $("funnel-latency").textContent = f
    ? `Availability → acceptance: ${f.availabilityToAcceptance.known} known / ${f.availabilityToAcceptance.unknown} unknown · p50 ${f.availabilityToAcceptance.p50Micros ?? "unavailable"} µs. Local request → availability: ${f.requestToAvailability.known} known / ${f.requestToAvailability.unknown} unknown · p50 ${f.requestToAvailability.p50Micros ?? "unavailable"} / p95 ${f.requestToAvailability.p95Micros ?? "unavailable"} µs. Workflow clocks, not pure inference time.`
    : "";
}

function withhold(message) {
  renderTrials(null);
  renderDays(null);
  renderTrialEvidence(null);
  renderFunnel({});
  $("board").hidden = true;
  $("state").textContent = message;
}

function renderTrials(value) {
  const stamp = Date.parse(value?.controllerVerifiedAt),
    age = Date.now() - stamp;
  const fresh = Number.isFinite(age) && age >= -5000 && age <= 30000;
  $("trial-state").textContent = fresh
    ? `EXPERIMENTAL · ${value.reason ?? "Controller current"}`
    : "Trial controller unavailable or stale";
  const trials = fresh && Array.isArray(value.trials) ? value.trials : [];
  const current = trials.find((t) => t.state !== "COMPLETED");
  $("trial-current").textContent = current
    ? `${current.profile_id} · ${current.definition.proposalSource} · target ${current.definition.targetDistance} price units / structural stop +${current.definition.stopBufferTicks} ticks · range ${current.definition.entryRangePoints} points · expiry ${current.definition.pendingSeconds}s · source ${current.source_sha256}`
    : "No verified active trial";
  $("trial-next").textContent = current
    ? `${current.state} · session ${current.session_state} · ${current.closes} closed outcomes · ${Math.floor(Number(current.market_open_ms) / 60000)}/60 open minutes · next: ${current.state === "DRAINING" ? "wait for terminal proof and fresh reconciliation, then register next profile" : `evaluate fresh opportunities; next profile ${value.nextProfileId} after allocation and reconciliation`}`
    : "";
  $("trial-results").textContent = trials
    .map(
      (t) =>
        `${t.profile_id} [cycle ${t.cycle}, slot ${t.ordinal}] ${t.state} | ${t.proposals} proposals / ${t.provider_claims} provider claims / ${t.waits} WAIT | ${t.entry_fill_events} entry fill events / ${t.closes} closed outcomes | net ${t.realized_net ?? "unavailable"} | ${t.review?.interpretation ?? "allocation not reviewed"} | frozen review: ${t.review?.failedProposals ?? "unavailable"} failed / ${t.review?.incompleteContexts ?? "unavailable"} incomplete | clock receipts ${t.clock_receipts}; last ${t.last_clock_receipt ? `${t.last_clock_receipt.reason}: ${t.last_clock_receipt.from} to ${t.last_clock_receipt.until}; credited0ms` : "none"}`,
    )
    .join("\n");
}
function renderDays(value) {
  const age = Date.now() - Date.parse(value?.checkedAt);
  const fresh = Number.isFinite(age) && age >= -5000 && age <= 30000;
  $("days-state").textContent = fresh
    ? `${value.currency} · ${value.release} · recorded net ${value.recordedNet} · realized ledger drawdown lower bound ${value.realizedLedgerDrawdownLowerBound} · unresolved events ${value.scopeUnresolvedEvents} / open journal positions ${value.openJournalPositions}`
    : "Daily scorecard unavailable or stale";
  $("days-results").textContent = fresh
    ? value.days
        .map(
          (d) =>
            `${d.day} ${d.completeCalendarDay ? "full calendar interval" : "partial day"} | net ${d.recordedNet} | ${d.closeDeals} close deals (${d.winningCloseDeals}+ / ${d.losingCloseDeals}- / ${d.flatCloseDeals} flat) | signed fees already included ${d.signedFeesIncluded} | worst close deal ${d.worstCloseDeal ?? "none"}`,
        )
        .join("\n")
    : "";
  $("days-trial-outcomes").textContent = fresh
    ? value.trialOutcomes
        .map(
          (t) =>
            `${t.profileId} ${t.state} · source ${t.sourceSha256} / profile ${t.profileSha256} | ${t.proposals} proposals / ${t.providerClaims} provider claims / ${t.waits} WAIT / ${t.failedProposals} failed / ${t.incompleteContexts} incomplete | ${t.groups} groups: ${t.provenZeroFillGroups} proven zero-fill / ${t.provenUnsentGroups} proven unsent / ${t.provenClosedGroups} proven closed / ${t.unprovenGroups} open or unproven`,
        )
        .join("\n")
    : "";
}
function renderTrialEvidence(value) {
  const age = Date.now() - Date.parse(value?.checkedAt);
  const fresh = Number.isFinite(age) && age >= -5000 && age <= 180000;
  $("trial-evidence").textContent = fresh
    ? `Latest-window loop proof ${value.engineeringMilestoneObserved ? "observed" : "pending"} · ${value.retainedCompletedAllocations} completed allocation files retained · latest bounded window: ${value.windowFilledCompletedAllocations} filled completed allocations / ${value.windowDistinctFilledProfilesWithNextAction} different profiles with next action · restart recorded: ${value.actualRestartRecorded ? "yes" : "no"}; bound to a completed allocation: ${value.actualRestartProofBound ? "yes" : "pending"} · source ${value.sourceSha256 ?? "unavailable"}. This does not qualify profitability.`
    : "Natural trial evidence unavailable or stale";
}
function render(d) {
  renderTrials(d.demoTrials);
  renderDays(d.dayScorecard);
  renderTrialEvidence(d.naturalTrialEvidence);
  const p = d.pipeline;
  $("pipeline-health").textContent = p?.available
    ? "Fresh observed pipeline state"
    : "Pipeline unavailable or stale; progress withheld";
  $("pipeline-generation").textContent = p?.generation
    ? `Code generation: ${p.generation.status} · ${p.generation.reason || ""}`
    : "Generation status unavailable";
  $("pipeline-publisher").textContent = p?.publisher
    ? `Publisher: ${p.publisher.status} · ${p.publisher.reason}`
    : "Publisher status unavailable";
  $("pipeline-review").textContent = p?.review
    ? `Review: ${p.review.status} · ${p.review.reason || ""} · checked ${p.review.checkedAt || "unknown"} · source ${p.review.origin || p.review.baseCommit || "unknown"}`
    : "Review status unavailable";
  $("pipeline-age").textContent = p?.lastPublicationActivityAt
    ? `Last publication activity: ${p.lastPublicationActivityAt} · ${p.publicationAgeSeconds}s ago. Heartbeats do not count as progress.`
    : "No verified publication activity time";

  renderFunnel(d);

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
            : "Resource admission enabled; see pipeline state";
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
  const finding = d.finding || {};
  $("summary").textContent = finding.summary || "No verified finding available";
  $("question").textContent = finding.nextQuestion || "";
  $("finding-time").textContent = d.findingRecordedAt
    ? `Recorded ${d.findingRecordedAt} · window ${d.findingWindow?.start || "unknown"} to ${d.findingWindow?.until || "unknown"}`
    : "Finding time unavailable";
  $("evidence").textContent = finding.requiredEvidence
    ? `Required evidence: ${finding.requiredEvidence}`
    : "";
  $("falsification").textContent = finding.falsificationTest
    ? `Rejection rule: ${finding.falsificationTest}`
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
    if (v.data) {
      $("board").hidden = false;
      render(v.data);
    } else withhold(`Evidence ${v.readState}; values withheld`);
  } catch (e) {
    withhold(e.message);
  } finally {
    busy = false;
  }
}
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
