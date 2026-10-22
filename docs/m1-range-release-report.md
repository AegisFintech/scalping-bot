# ISSUE-366 — M1-first Codex breakout range

Issue: <https://github.com/AegisFintech/scalping-bot/issues/366>.
The operator explicitly authorized immediate implementation and deployment after
reviewing the frequency problem. One existing demo account/bot remains canonical;
tested `main` is deployed after reviewed qualification. No separate trading trial
process or real-money activation is introduced.

At 08:48 UTC on 22 October, the v7 release had 42 provider contexts, all READY
WAIT, zero entry pairs and zero order groups since activation at 07:50 UTC.
Runtime was ready/unpaused with no fault. The latest explanations cited M5/M15
resistance, opposing FVGs and an insufficiently mature M1 pause. This diagnoses
abstention behavior, not missed winning trades or evidence that forced trading
would improve net returns.

## Change and limits

Strategy `0.4.3-evidence-scalp.1-codex.2`, unchanged economic policy
`0.4.3-evidence-scalp.1`, prompt `entry-pair-v8`, worker request 1.4 and unchanged
response 1.1. V8 selects an actionable nearby range from completed M1, preferring
recent five/ten candles with older supplied history where needed. A brief visible
consolidation can qualify without a mature M5/M15 box. Higher-frame trends,
SMC/order blocks/FVGs and broker DOM remain descriptive context; perfect alignment
and a guaranteed obstacle-free route to TP are not prerequisites. Actual conflicts,
cost dominance, crossed/unexecutable levels and absent usable ranges may still
justify WAIT. No invented opposing leg, price clamping or quota is allowed.

Dual STOP_LIMIT/GTC/OCO, opposite-box native stop and equal gross TP, dynamic
shared 1% setup risk, exact-volume fee/margin/precision checks and late operational
gates remain unchanged. Smaller TP/local profit-taking are outside this change.
Stop-limit orders can miss moves; more decisions do not guarantee more fills or
positive expectancy. No automatic learning/policy promotion is introduced.

Historical v7/request 1.3 bytes and all prior contracts remain unchanged. New
request 1.4 inherits the same validated technical/execution payload, bounded
persistent daily memory, strict OCO/WAIT receipts and no-tool transport. Prompt
identity/hash/day pins isolate the new native daily thread without deleting old
memory or overriding fresh data. Worker/orchestrator mismatch rejects before
provider dispatch; old context cannot authorize new-version execution. Existing
WAIT successor unique claims, 60-second/new-M1 retry, five-minute failed/unknown
cooldowns and database WAIT intent rejection remain intact. No migration is needed.

## Validation and maintenance

Targeted schema, client, planner and Python tests cover the current prompt/request
pin, OCO and WAIT receipts, and refusal of legacy/new worker mismatches before
provider claims. A stale test expected request 1.3; corrected to the new version
before full qualification. Tests establish contract behavior, not market accuracy.
`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed all 20 checks on
source SHA-256 `20db57f3302a33e047ba5896aa12639be703c96097aa55a6b8d6f2fc8067e512`.
Private logs: `/tmp/scalper-qualification-ePnAsL/checks/results.json`.
Node 22.23.2: **1,024 tests / 127 files**; isolated PostgreSQL: **103 / 7**;
Python: **424**, total **1,551 passed**. Formatting, ESLint, TypeScript/build,
schema/migration/replay/fail-closed/lifecycle suites, Ruff/mypy, secret scan,
npm/pip audits and disposable database cleanup passed. One pre-existing
Starlette/httpx deprecation warning remains. Both sample policy and `--startup`
configuration checks passed with 16 normal keys. Early test body-string typing
and Python import-order lint failures were corrected before this frozen run.
[Sanitized validation receipt](evidence/m1-range-validation.json).
Hosted exact-head checks follow the pushed PR before merge/deployment.

No new dependencies, unnecessary services or removable unused source were found.
Historical prompts/schemas, prior implementation tests, frozen observers and
immutable deployment artifacts remain referenced audit/rollback dependencies.
Graphify refresh is local AST only; document semantics are not freshly extracted.
No server cleanup, record pruning or credential migration is part of this change.

## Deployment and rollback contract

After successful exact-head qualification and PR merge, prepare a clean `main`
artifact and matching isolated worker. Preserve protected credentials, current
PostgreSQL/runtime, all migration checksums and financial/request history. Hold
new analyses briefly, let in-flight requests finish and require certain terminal
cycles before switching; do not cancel or modify accepted GTC/protection merely
to accelerate deployment. Freeze a new future observation registration before
new-version outcomes with daily/open/gap/OCO censoring, null counterfactual costs
and no promotion authority. Thirty days is collection, not qualification.

Verify worker auth/version, all five supervisor paths and current broker
reconciliation, perform a fresh-data read-only schema/planner smoke with explicitly
simulated provider receipt, then restore original automatic admission and observe
natural decisions without forced requests/orders. Preserve previous registrations
unchanged; their source mismatch only limits research. Native daily compaction
continuity is not training or a profitability result.

Rollback requires a reviewed hold and certain cycle reconciliation, retaining any
new accepted GTC/protection and all newer journals/financial/context state. Restore
only matching old main/worker artifacts; never downgrade the database, replay old
requests or reset accounting. Runtime activation is pending at this checkpoint;
subsequent operational evidence is appended to the GitHub issue before handoff.
