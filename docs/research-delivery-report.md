# Research delivery lineage

Issue [#466](https://github.com/AegisFintech/scalping-bot/issues/466), after the
[#464 scheduled handoff](holding-pipeline-report.md) and
[#465 independent reviewer](research-reviewer-report.md). This installment adds
read-only visibility; natural-cycle and restart/failure proof follow activation.
No trading, risk, order, accounting or automatic economic promotion changes.

## Selected evidence, not a stitched narrative

The protected parent exposes a strict whitelist of its current job, phase, base
and publication digest. The original frozen generation request supplies the actual
selected question, window, trial/result/finding hashes and recorded closed-row
count. A later observation question cannot replace this provenance. The root
reviewer exposes only bounded status/head/PR/merge fields. A PR is linked as the
candidate's review only when its exact publication digest matches. A research
merge is explicitly distinct from the currently deployed trading release.

Private source, envelopes, model output, credentials and broker identifiers remain
in their existing protected stores. Public metadata files live in separately
provisioned read-only observation directories. They confer no authority. The
existing restricted research-health reader transports review metadata; no extra
inbound service or credentials are introduced. Collection remains bounded.

New `research-health-1.1` and `harness-health-1.1` envelopes compose the existing
strict models without modifying historical1.0 schemas. The consumer accepts old
snapshots during rolling deployment. Each component expires after five minutes,
with a five-second future-clock tolerance; the collector still expires after
three minutes. Browser ticks independently withhold expired lineage and PR links.
Missing and unknown evidence never becomes zero activity, approval or completion.

## Recorder health

Previously the monitor used the dashboard Flight projection, which is withheld
when broker/account evidence is unavailable. That could hide a running recorder.
The recorder now publishes at most once per second a separate public heartbeat:
process clock, original recording clock, RECORDING/LAST_COMPLETED/GAP/UNAVAILABLE,
and explicit false authority/complete-tick-tape flags. It exposes no summaries,
private recording names or account data. The original recorded clock must itself
be fresh; a new heartbeat cannot refresh old evidence. A current GAP status remains
blocked. Current RECORDING means the loop is recording, never that its historical
coverage is complete; historical gap records remain in the private evidence.

The recorder's original private records and fault behavior are unchanged. Failure
of public metadata publication does not clear a gap or affect trading. Provision
`/var/lib/scalper-flight-health` for its existing UID and add it to the recorder's
systemd ReadWritePaths before the observer-only artifact restart. The read-only
monitor requires no recorder/database credentials or access to private recordings.

## Validation and rollout

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed all gates:1,275 Node,
147 database and1,066 Python tests (2,488 total), formatting/lint/types/build,
schemas/replay/fail-closed, secret scanning and both dependency audits.
[Qualification receipt](evidence/research-delivery-validation.json) binds source
`33b537f455e46d55f629cc1bb7917fb77a348dc9d5902e87e61dca91f976252b`. All four
`npm run config:check -- .env.sample [--startup]` checks, repeated against the
existing populated deployment file, pass.85 focused tests pass.
`node scripts/check-harness-health.mjs` passed using the installed headless browser:
keyboard,1920/1440/1280/390px bounds, text safety, exact match/mismatch and expiry.
Graphify AST update:15,062 nodes/25,549 edges/892 communities; existing pyproject
zero-node warning remains. No paid semantic extraction or broker/provider requests.

The first full qualification was intentionally stopped/cleaned before adding
non-object JSON guards. The following full run exposed one missing-head legacy
fixture failure (1,065 passed); projection now preserves null and public writing
belongs to the main service boundary. The final complete rerun passes, without
weakening source guards or tests. The existing Starlette/httpx warning remains.
No new generation/reviewer timer is activated by source delivery.

## Standards

APPROVE: strict projections, immutable historical schemas, bounded original-clock
heartbeat and nullable missing-head evidence preserve the documented rules.
No remaining documented-standard or actionable heuristic finding.

## Spec

APPROVE after fixing empty-discovery timestamps, the merge-between-guards SHA,
non-object JSON and missing-head compatibility. Exact digest matching and expiry
meet this installment; actual natural-cycle proof remains separate.

Final findings:0 Standards blockers,0 Spec blockers.

## Installation boundary

Install all reviewed artifacts before first generation so installation commits do
not invalidate an immutable candidate's captured main. Preserve existing claims
and archives on rollback; absence/staleness of a public receipt is never authority
for replay, reset, recovery or economic activation.
