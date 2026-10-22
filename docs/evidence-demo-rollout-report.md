# ISSUE-364 — Evidence-first Codex DEMO activation

Issue: <https://github.com/AegisFintech/scalping-bot/issues/364>.
Source: [#363](https://github.com/AegisFintech/scalping-bot/pull/363), already merged
and qualified before deployment. The operator reported no trades; read-only status
confirmed the healthy server still ran the old compression release, with zero
closed trades attributed to that release. This was a source/runtime delivery gap,
not proof that the broker was offline or that market entries were profitable.

## Activation and preservation

The immutable main artifact is
`/opt/ctrader-ai-scalper/releases/evidence364-qualified`, source commit
`791d4fcab3b6914d530419fbb37a57747b4b15da`, source SHA-256
`38faf0316c1e1f91a5a3fd79c229cc4d137247b322833c5f38328677274a3ba0`.
The independent matching worker is `/opt/scalper-codex-entry-364`, with its own
qualified dependency copy, non-root import/hash checks, unchanged subscription
login and loopback authentication. Systemd drop-in `364-evidence.conf` selects
v7 / request 1.3; previous `353-plannerfix.conf` remains for reviewed rollback.
All five PM2 service paths and worker health/authentication were verified.

Before the brief audited admission hold, the broker/account runtime was ready,
unpaused and certain, with zero active positions, active groups or requesting
contexts. No existing order needed cancellation or alteration. Financial daily/
capital values were frozen and compared after reconciliation; six prior
registration digests and protected credentials matched. The database and runtime
directory remain the same. No trade/request/baseline/cooldown history was reset.
Native protection and reconciliation stayed independent of provider inference.

The application role intentionally lacks CREATE privileges on the public schema.
Its migration CLI therefore refused before applying DDL. The existing local
PostgreSQL administrator applied the exact qualified additive migration 0031
using the runner's session advisory lock, all 30 historical checksum comparisons,
a single DDL/checksum transaction and bounded lock/statement timeouts. Version 31
and preserved financial values were independently rechecked. Application privileges
were not expanded. Migration adds the WAIT order-intent interlock and unique
WAIT successor link only; historical migration bytes/data remain intact.

A preflight first refused an optional neutral external Graphify check while both
required qualification checks had succeeded. The operational gate was corrected
to require the two exact-head qualification successes and reject failed checks,
while accepting the external neutral result. No hold or deployment occurred on
that initial refusal. Private failed/preflight receipts remain preserved.

Automatic analysis resumed **22 October 2026 at 07:50:08 UTC / 15:50 Singapore**
on `0.4.3-evidence-scalp.1-codex.1`, ready and unpaused with no operational fault.
No provider request or broker command was manually forced. This remains demo;
real-money execution is disabled and shared dynamic setup risk remains at most 1%.

## Prospective observation and actual data

Exclusive mode-0400 registration:
`.runtime/evidence-study-364/registration.json`, SHA-256
`15b175a7eab3c6115464d8ea0791e3878fcd17f046df1eaa2f46b3758e9d6e8e`.
It was frozen before new-release outcomes, from **22 October 07:48:14.892196 UTC**
through **21 November at the same UTC time**, with daily and final cutoffs,
code/prompt/protocol pins, rejected/WAIT/failed/nonfill/open/partial/gap/OCO cases,
null counterfactual costs and no promotion authority. Thirty days is collection,
not qualification. Earlier registrations/observers remain unchanged; their source
mismatch after cutover is research evidence, never trading authority.

`scalper-evidence-observer-364.service` independently samples read-only status for
168 hours, writing `.runtime/issue-364-observer/status.json`. It has no credentials,
provider/order commands or policy-promotion authority. Operational status is a
bounded observation, not a complete quote/event stream or a trading result.

After dependencies restarted, the first actual-data context read was unavailable;
a fresh independent read passed before admission resumed. No stale evidence was
accepted. Deployed Node → actual broker history → Python context → production
orchestrator/planner → worker request validation passed with **720 M1 / 576 M5 /
480 M15 completed candles**, 12 raw tail rows per frame plus larger causal context,
and worker schema 1.3. The worker receipt in that smoke was explicitly simulated
WAIT; no real inference or order occurred. The compression scanner was not invoked.

The first natural provider claim was **07:50:13.577698 UTC**, available
**07:50:27.002131 UTC**, with a durably recorded `entry-wait-1.0` result. Codex
reported a bearish M15 downswing, confirmed bearish M5 MSS below the prior box,
and no newly formed two-sided base. This is the model's interpretation, not an
independently proven market explanation. The engine recorded `SCENARIO_CODEX_WAIT`
and no new-release order group at that observation.

The second natural request started **07:51:33.595829 UTC**, **66.593698 seconds**
after the first result became available, using a newer completed M1 and the unique
WAIT successor link. It completed at **07:51:44.939710 UTC**, again WAIT. Private
worker receipts independently verify the same native daily thread and distinct
turn IDs, response contract 1.1 and no execution authority. A third context was
also READY at the continuity observation; this is bounded operational evidence,
not a full event stream. Native production compaction has not yet been observed
at this checkpoint; the source's actual synthetic compaction test remains separate.

## Qualification, cleanup and rollback

The deployed source is byte-identical to the completed #362 qualification:
**1,023 Node + 103 isolated PostgreSQL + 421 Python = 1,547 tests**, all formatting,
lint, type, isolated build, schema/migration/replay/fail-closed suites, secret scan
and npm/pip audits passed. Source-head hosted runs
[push](https://github.com/AegisFintech/scalping-bot/actions/runs/39707357057) and
[PR](https://github.com/AegisFintech/scalping-bot/actions/runs/39707395242) both
succeeded before rollout. The implementation includes actual synthetic subscription
thread/compaction tests; those are not economic validation.

This operational receipt changes documentation only. No dependencies or trading
code were changed. The new isolated worker and observer are in use; immutable
older artifacts, credentials, registrations and audit receipts remain necessary
history/rollback evidence and were not deleted. Documentation formatting, diff/
staged review, secret scan, unchanged source fingerprint and Graphify AST update
precede receipt delivery. Hosted receipt-head qualification follows through its PR. No executable tracked
source changed; its fingerprint remains the exact qualified value above.

Rollback requires a reviewed analysis hold and certain active-cycle reconciliation;
preserve any accepted new GTC/protection and every newer risk/context record.
Restore the previous five-service artifact and worker drop-in only at a safe
cutover. Retain migration 0031 and all new records; never downgrade the database,
replay old requests, reinterpret the new cohort as old trades or reset financial
state. Private operational receipts are under
`.runtime/issue-364-rollout-r2/`; the preflight refusal is retained separately.

[Sanitized deployment receipt](evidence/evidence-demo-rollout-validation.json).
No fill, net profitability, improved accuracy or production-load latency is
established by a successful WAIT or process health.
