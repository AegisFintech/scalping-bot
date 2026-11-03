# Finite recurring DEMO protocol — ISSUE-519 / ISSUE-520

The existing executor gains one registered experimental programme; no second bot,
shadow broker or research-worker execution authority. Source0.10.0-demo-trials.1-codex.1
and policy0.10.0-demo-trials.1 are separate from historical0.9. This report describes
source implementation; deployment and actual natural allocations require a separate
receipt. Parent515 remains open until two different completed profile allocations
have actual entry fills, retained outcomes, a next action and restart/dedup proof.
An all-WAIT or zero-fill allocation is retained and advances, but cannot establish
that acceptance criterion or qualify a profitable strategy.

## Frozen definitions and execution

The #518 catalogue defines nine profiles in five single-dimension batches. The
entry comparison uses CODEX, original3-M1 and original5-M1 boundaries plus one
native tick; two successive completed-M5 close changes define trend direction.
All share the opposite last-five-M1 extreme as stop, buffer0/5/10ticks, target
1/0.4/0.6 GOLD PRICE UNITS,60/180-second capture-based GTD and10/30 native-point
STOP_LIMIT ranges. Native protection retains fill-relative distances, so actual
broker levels can differ from proposed structural anchors after entry slippage.
Both are recorded separately. Entries are never quote-clamped, reversed or manufactured.
Codex uses supplied SMC/DOM/context and the registered exit definition. Its WAIT
or failure never falls back to local geometry. LOCAL_RANGE is a separately selected
and labelled deterministic trial, with no provider dispatch and null token/cost
telemetry. Provider claims and deterministic proposals are counted separately.

The schedule is frozen in source and migration0041: ENTRY starts with LOCAL_RANGE3 then LOCAL_RANGE5 then CODEX; it rotates
by1-(cycle%2);
other batches rotate their listed members by one. This avoids adjacent identical
profiles, including batch/cycle boundaries. Repeated baseline hashes are explicit
replications, not different strategies or independent market samples. Completion freezes actual net, closes, WAIT/failure/incomplete counts and the
predeclared next profile. Positive observations are explicitly unqualified. No result
selects a winning subset, invents a historical request stream or promotes a champion.

Base target admission uses actual-volume commission/minima/FX and5-tick exit
allowance, requiring positive modeled net above the existing0.08-broker-pip floor.
Minimum-volume costs are diagnostic before sizing: a fixed minimum commission
must not reject geometry that is affordable at the independently risk-sized volume.
Both initial and late actual-volume admission remain mandatory; lots are never
increased to satisfy a target.
Stress target net and stop loss retain65ticks; sizing still reserves65ticks and
uses at most2.5% for this single leg inside the unchanged5% demo setup ceiling.
There is no net-RR>=1 gate in this explicitly experimental source. High win rate
alone cannot establish positive expectancy. Actual future exit costs remain null;
spread is not deducted twice and actual broker realized net includes signed fees.
Old0.8/0.9 validations and all historical registrations/accepted orders remain bound
to their original versions. Native protections, manual/partial-close handling,
unknown claims, ownership, exact terminal reconciliation and session gates remain.

New additive worker requests1.16/1.17 and responses1.9/1.10/1.11 bind the exact
profile/catalogue/source/trial/future-start registration into the system prompt.
Both Python and TypeScript verify the same canonical bytes and supplied geometry.
The protected release manifest supplies the full source fingerprint, distinct from
the registry's opaque CODE_VERSION hash. New provider traffic uses only/v3/entry-pair;
legacy routes cannot dispatch through the experimental worker. API-first Sol and
existing credit/cap subscription fallback, bounded memory and unknown cooldowns
are unchanged. Persistent memory is not training.

## Durable lifecycle and visibility

Migration0041 is additive. Catalogue/profile definitions, registrations, context
links, trial events and per-order range are immutable. A future-start allocation
and scope head are durably registered before any proposal claim. Database guards
bind original prompt/profile/geometry, scope, mode revision, source and finite
parameters. Old contexts still constrain global failure/unknown cooldowns; only
the current trial's context may authorize new admission. Mode/head locks serialize
intent against trial switching; uncertain transactions are re-read, never replayed.

The existing process checks allocations independently of inference/positions.
At20 fully closed positions or60 credited market-open minutes it drains new
admission. Clock credit requires consecutive open observations within30 seconds;
restart, unknown and oversized gaps receive zero credit and a retained resume
receipt. This is sampled open-clock accounting, not continuous quote coverage.
Accepted orders and positions finish under their original native protection and
expiry. No timer closes a filled position or cancels an order to advance research.
Only exact terminal journal proof plus fresh broker/account reconciliation allows
completion and the next future registration. An unavailable controller blocks new
admission while independent protection/reconciliation continues.

Read-only/v1/demo-trials and the existing Access-protected/learning show profile,
source, parameters, actual proposals/claims/WAIT/fills/closes/net, clock, controller
freshness and next action. Stale controller values are withheld. The landscape
labels local decisions as local; they are not Codex/provider requests. The current
runner admits the new recorded release without rewriting historical oracles;
local decisions cannot masquerade as recorded Codex proposals.

## Delivery, validation and rollback

Focused positive/failure checks cover cross-language hashes, source pin, no provider
fallback, geometry, costs, finite schedule, duplicate/restarted controllers, future
registration, immutable definitions, forbidden early drain and context identity.
Initial fixture/type/lint failures were corrected; they are not qualification passes.
Full qualification and both independent review axes must pass before merge/deploy.
Record exact commands/results and activation separately; tests never count as
broker fills, natural trials or an economically qualified edge.

Before rollout, retain the last complete old0.9 observer window and right-censor
its tail with a separate receipt; never edit its frozen registration/source/report.
Stop the retired observer only after that handover. Prepare one matched protected
release and provider artifact, preserve credentials, baselines, trade history,
accepted groups and rollback artifacts, apply only forward migration0041, validate
configuration/permissions/source/health, then enable this ONE existing demo.

Rollback retains every additive table/column/receipt and accepted order's exact
profile/range/expiry/protection. Do not drop tables or repoint a frozen research
alias. Drain safely and review source drift before starting a separately versioned
programme; restoring code does not authorize resetting history or completing an
uncertain group. No live execution, risk increase, martingale, polarity switch or
profitability claim is authorized by this programme.

## Independent pre-activation review

Standards review found two P1 transport gaps at f4720f3: FastAPI omitted the three
new receipt classes, and the executor HTTP adapter compared dynamic content with
the historical template. Both are corrected. New tests traverse the actual Python
HTTP response union for subscription/API/fallback and the full Node executor-to-
orchestrator adapter, rather than only mocking the outer response.

Spec review found one P2: excluded observation gaps lacked immutable receipts.
The controller now records bounded from/until/reason/session/zero-credit evidence,
keeps unavailable interval starts across restarts, exposes clock receipts in learning,
and forbids SQL clock credit across non-open, oversized or draining intervals.

Initial full qualification on f4720f3 passed format/lint/types/build, then failed two
migration tests: the inventory omitted0041 and the anti-destructive scanner treated
its six protective no-truncate triggers as destructive commands. The inventory now
requires the new tables/file; only those exact reviewed trigger statements are
exempted, leaving destructive SQL rejected. Historical migration bytes stay intact.
This failed run is retained separately; final full qualification and re-review are
required before activation. No broker/provider forcing or deployment occurred.

The corrected7322e7b full run passed all1,318 Node tests and every preceding
check/audit, then the TLS database suite passed162 and failed two copies of its
separate migration inventory assertion. It also needed0041. That explicit list
is corrected; no SQL or trading behavior changed in this correction. Remaining
Python checks and final combined qualification still require completion.

A separate full Python preflight passed1,319 tests, skipped12 database-required
cases without TEST_DATABASE_URL, and found one stale prompt-inventory assertion
that omitted entry-scalp-v3. The derived runtime whitelist was already correct;
the explicit assertion is updated. The final TLS-qualified run must include all
database-required cases with no skips. Broker preflight verifies XAUUSD digits2,
pipPosition2, pip/tick0.01, native volume step100 and minimum stop distance0; no
pip/point conversion is assumed from a convention or a price screenshot.

## Final qualification and real read-only runner

At b078892, `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed all
2,814 tests:1,318 Node/schema/replay,164 TLS PostgreSQL lifecycle and1,332 Python,
with no skips. Formatting, lint/types, build, secret scan and both required dependency
audit gates passed. Eleven moderate npm advisories remain below the existing high
gate; the existing Starlette/httpx deprecation warning remains. Both independent
review axes are CLEAR at that exact head. All four sample/populated deployment
policy/startup checks pass without configuration changes.
[Exact receipt](evidence/demo-trial-protocol-validation.json).

The actual SELECT-only exported05:00–05:30UTC packet was processed by the new
current runner for all nine profiles:25 contexts,23 recorded Codex WAITs and two
unavailable contexts; each local profile had12 conditional proposals,11 WAITs and
two unavailable contexts. There were no actual setups in that window; every
counterfactual fill/net remains null. The retained complete nine-profile report
hashes to de5a381068d9f9003acd4b38823d8a6eae0f0ba112203ac8cba2153d186634cf,
input90680dc45923a5fd735d0728d4ea7acaed3e12d8360d9c22f9acc9f2a29ee0eb.
This verifies real packet compatibility, not offloaded execution or strategy quality.

PR525 and matched operational activation follow these checks. Source delivery alone
does not complete parent515/520; natural two-distinct-filled allocations and restart/
dedup proof are still required. No account/history reset or forced trade occurred.

## Rollout audit: normal restart must preserve native pending orders

Before any0.10 registration/deployment, the rollout audit found that fixed
SHUTDOWN_CANCEL_PENDING=true made the existing shutdown path cancel accepted
GTD orders. This contradicted the documented normal-restart contract and would
confound trial restart evidence. A new configuration regression reproduced true
where false was required. The default is now false, conflicting true overrides
are rejected, and native GTD expiry, emergency/ownership cancellation and filled
protection remain unchanged. No existing pending order was cancelled in this
audit. Auto-merge was withheld; source requalification and fresh review are required.
The earlier2814-test receipt remains valid only for its recorded earlier source.

## Final corrected source qualification

At225cb319, the fresh complete `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`
passes2,815 tests:1,319 Node/schema/replay,164 TLS PostgreSQL lifecycle,1,332 Python,
no skips. All formatting, lint/types, build, secret and dependency-audit gates pass.
Both independent reviews are CLEAR at that exact source, and all four actual/sample
policy/startup checks pass. Source39588e8734f9f0b3d952ffeec2f7f1906417bd8e7b66824cc220e73e8e21848b
is authoritative for rollout; the earlier7e148109 receipt is historical.
[Final receipt](evidence/demo-trial-final-validation.json).

Two intervening runs are retained as failures: temporary release copies pushed
/tmp below the observer tests'2GiB reserve; removing only our unused staging
dependencies, completed merged worktrees and stopped synthetic prototype database
restored headroom. A subsequent vulnerability-service TLS reset stopped the audit.
No guard was disabled, production record removed or failed run called qualified;
the final whole-source rerun passed.
[Failure receipts](evidence/demo-trial-rollout-failures.json).

Issue526 separately adds read-only Singapore-day close-deal scorecards and a bounded
natural-trial witness. Its19 focused tests pass in its own worktree; its full review/
qualification and read-only deployment remain pending. It must not alter the frozen
0.10 executor source, registrations, risk or broker authority.
