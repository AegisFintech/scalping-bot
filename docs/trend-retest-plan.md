# Trend breakout/retest demo experiment — ISSUE-536

Operator approved implementation after the first R:R review. This is a prospective
experiment, not promotion of a proven winner. Preserve the single existing demo,
5% setup/2.5% single-leg ceilings,65-tick exit reserve, costs, ownership, session,
freshness, reconciliation, unknown-command handling and native protection.

Build a new versioned catalogue and release; retain0.10 definitions, registrations,
accepted orders and research artifacts unchanged. Use the existing allocation
controller and late actual-volume cost validation, not a second executor.

Candidate rules are frozen before activation:

- Same M5 direction from two successive completed-close changes. Original range is
  five completed M1 candles; confirmation profiles exclude the newest M1 candle
  from that range and require its close beyond the original boundary by one tick.
- Compare immediate STOP_LIMIT versus confirmed STOP_LIMIT, then confirmed STOP_LIMIT
  versus same-direction LIMIT at the original boundary. A limit is a retest entry,
  never the historical mode's reversal mapping. Never shift levels to the quote.
  60-second capture-based GTD,30-point stop-limit range; retest limits have no stop
  trigger or stop-limit range. Original opposite range extreme is invalidation.
- Target is the nearest known three-candle-confirmed M5/M15 swing in the trend
  direction within the last12completed candles of each frame, bounded to7price units.
  Older swings are outside this fixed search window. Structural SL/TP remain absolute
  after a fill; the30-point adverse entry allowance reduces modeled reward and
  increases modeled loss before the net R:R check. No fabricated room or widened target to pass
  an R:R check. Admission requires at least1:1 modeled net reward/risk at actual
  sized volume and again immediately before submission; sizing reserves95points for
  STOP_LIMIT (30entry+65exit) and65for LIMIT.
- Preserve Codex WAIT and explicit proposal provenance; no local fallback on a
  failed/unknown provider request. Historical controls retain their original rules.
- New future registrations and exact terminal reconciliation precede source/catalogue
  handover. Do not restart into a mismatched old source head or force-close an active
  trade to advance the experiment. Rollback preserves all additive evidence.

Acceptance spans deterministic geometry, actual transport/worker contracts, database
identity/order guards, sizing and late cost checks, UI provenance, integration/failure
checks, independent review, full qualification, exact-head CI, deployment and readback.
A geometry module alone is not completed delivery. Record bounded milestones and
unresolved integration work on issue536; never claim a profitable result from tests.

## Delivery checkpoints

1. Geometry, registration/prompt/transport contracts, actual-volume payoff gate,
   absolute pending protection and repair: implemented and qualified as a foundation checkpoint.
   At that checkpoint defaults selected0.10; it was not deployable as0.11.
2. Additive database authority and audited source handover, controller allocation
   and same-direction mode integration: implemented. Preserve all historical migrations.
3. Full integrated qualification, independent review, exact-head CI, reviewed merge,
   one-demo activation and broker/source readback: complete; see activation receipt.

The worker validates versioned registration, source, output geometry bounds and
provider claims. The executor verifies exact candle-derived prices and owns actual
volume/cost and broker admission; no second Python geometry implementation is needed.
New request versions1.18/1.19 and response versions1.12–1.14 preserve historical
worker contracts, API-first/explicit-credit fallback, unknown-dispatch cooldown and WAIT.

The broker supports absolute protection on pending orders; limited-risk accounts
require different handling and must be checked before activation. Source:
[cTrader message contract](https://help.ctrader.com/open-api/messages/#protooaneworderreq).
No account compatibility or new broker submission is claimed by unit tests.

Before activation, account for both the30-point adverse entry bound and65-point
exit reserve in sizing as well as net R:R. A net-R:R rejection alone does not prove
that the independent loss budget was sized with the same combined assumptions.

## Checkpoint review

Independent spec and standards reviews covered checkpoint1 only. The spec review
found inherited whole-pip distance restrictions rejecting valid one-tick structural
entries when pip size exceeds tick size. Trend profiles now retain tick alignment
without that legacy restriction; historical strategies keep their existing rules.
The independent rerun passed9 focused tests. Standards review found no blocker;
full deployment/integration review remains outstanding.

Focused checks also cover native absolute SL/TP, tighter existing protection,
actual-volume commission and adverse-entry costs, missing/invalid history, source
mismatch, failed/unknown claim reuse, preserved WAIT, and API/subscription/explicit
credit fallback through real local HTTP serialization. No paid provider or broker
order was used for tests.

Integration must also update the deployment factories and typed dashboard/research
readers; accepting the new HTTP schema alone does not activate its strategy.
Catalogue handover must retain the old head's evidence, avoid the existing
scope/cycle/ordinal uniqueness collision, and use an audited retirement reason
rather than labeling an interrupted allocation economically complete. Freeze new
source registrations before outcomes; old observers may halt on source drift.
The independent sizing budget must reserve95points for STOP_LIMIT (30entry plus
65exit) and65for LIMIT, without changing the percentage ceilings. Verify this
against actual-volume risk tests before activation.

Operational check on November5: existing five PM2 services remained online on
trials519-main/repair528-main. Both frozen research collectors failed with
LOSS_STUDY_STORAGE_RESERVE when free space fell below2GiB. Cleared only npm's
regenerable download cache (about670MiB); free space recovered to2.7GiB. Both
existing collectors then completed normally at09:41SGT, writing RR window0029
and loss-control window0033 (cutoff01:30UTC). Registrations/history were retained;
failure intervals remain in service logs. Their existing timers remain active.

Validation commands: `npm run qualify` (isolated PostgreSQL/TLS, Node and Python
suites, format/lint/types/build, schemas/migrations, secrets and dependency audits),
`npm run config:check -- .env.sample` and the protected deployment env, each also
with `--startup`. All four configuration checks passed under the unchanged0.10
policy; there is intentionally no development `.env`. Cross-language registration,
profile/catalogue and exact prompt-hash parity also passed. An initial full run
found one outdated prompt whitelist expectation; updated it and extended registry
routing coverage through1.19. The focused rerun passed47 tests; final complete
qualification passed20 checks and2,924 tests with no skips (1,334 Node,165 database,
1,425 Python). The existing FastAPI/httpx deprecation warning remains. This validates
the foundation, not pending execution integration or profitability.

Qualified source: `995fd2e4b09647159ca5ff27e2537f972835c438be3ce4d320e1da61f5ce7860`.
Private receipt: `/var/lib/scalper-experiments515-evidence/qualification536-checkpoint1.json`.
[Draft PR537](https://github.com/AegisFintech/scalping-bot/pull/537) preserves the
checkpoint; issue536 remains open and the existing demo is unchanged.

## Integrated implementation and preflight

Forward migration0042 retains old catalogue and immutable identities. A source
handover accepts only the pinned deployed0.10 source39588e87, fresh reconciliation,
complete terminal broker proof and an append-only destination receipt. The head
trigger binds the actual successor source/catalogue/version/cycle/slot to that receipt.
Shortened allocations are explicitly SOURCE_HANDOVER and excluded from completion
witness counts. No accepted order is repriced/cancelled to make a transition happen.
Four slots alternate immediate/confirmed and confirmed/retest; direction stays intact.

The executor and provider route the new request, provider prompt and local execution
artifact together. Runtime hashes include the actual structural limits/catalogue,
95-point STOP_LIMIT sizing and65-point LIMIT sizing. Account inspection at2026-11-05
confirmed an explicit false limited-risk flag; every new structural placement reads
it again and rejects true/unknown before an order command. This is account compatibility,
not a test fill. [Broker contract](https://help.ctrader.com/open-api/messages/#protooaneworderreq).

Status1.1 and scorecard1.1 preserve historical1.0 contracts. Scorecards select the
actual registered head release and its own start/outcomes; historical P/L is never
relabeled. Reconstruction validates the actual broker order type for structural
LIMIT/STOP_LIMIT. Historical counterfactual candidate screens remain unchanged.
Provider market projection retains its original hashed input and excludes stress
fields from the immutable research schema, as before.

Independent reviews found and corrected destination binding, local prompt routing,
LIMIT admission and policy-hash limit selection. The isolated database suite passes
173tests, including all three complete structural order lifecycles and malformed
geometry/source rejection.73focused tests independently passed review. Final whole-source
qualification is still required; early database-only runs also execute all Python
tests and failed their real disk-reserve checks. Their failures remain recorded.
Two unused temporary node_modules installs were checked for active users and removed;
source trees, lockfiles, broker history and research artifacts remain intact.

Final rollout requires matched protected provider/executor artifacts, forward migration,
reviewed main, frozen future observation registration and exact source/config/health
readback. Existing frozen observers must retain a separate censored-tail handover
receipt. No forced provider call or order is part of deployment verification.

## Final integrated qualification

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed all20checks and2,947tests:
1,344Node,173PostgreSQL lifecycle and1,430Python, with no skips. Formatting, lint,
TypeScript/Python types, build, schemas/migrations, secrets and both dependency audits
passed. Source fingerprint: `de2eead48727bcd55815648f0952c7353ef58380b3083f569add66a0ebeda143`.
Private receipt: `/var/lib/scalper-experiments515-evidence/qualification536-integrated.json`;
logs: `/tmp/scalper-qualification-nPvPdQ/checks`. Both independent review axes are clear.
All four policy/startup checks on `.env.sample` and the actual protected environment
passed with0.11. Graphify's AST graph updated; pyproject.toml produces no graph nodes.
Earlier lint/fixture-type/storage failures remain failed runs, not qualification.
At qualification time, reviewed merge and activation remained separate delivery steps;
the verified activation below completes them.

## Verified demo activation —2026-11-05

[PR537](https://github.com/AegisFintech/scalping-bot/pull/537) merged after independent
approval and both exact-head hosted qualification jobs passed. Merged mainc493be7
has the same qualified source as the prepared e67dccc artifact. All five PM2 processes
now run from `/opt/ctrader-ai-scalper/releases/trend536-main`; the provider and read-only
workers use matched protected `/opt/scalper-trend536-de2eead48727` files.
[Activation receipt](evidence/trend536-activation.json).

The runtime database role correctly refused DDL. The local database owner applied
0042 in one transaction under the migration advisory lock after verifying every
existing checksum. PM2 reload initially retained old working directories; replacing
only the five existing process definitions corrected that, preserving runtime state.
The initial future-trial readiness fault retried automatically after60seconds and
cleared; no pause, accounting reset, provider/order force or manual latch clear occurred.

The exact old source completed with SOURCE_HANDOVER after terminal reconciliation.
New TREND_BREAKOUT registered02:50:39.823UTC, future start02:50:40.823UTC. The first
natural request used entry-scalp-v4 at02:51:47.528UTC and returned READY/WAIT at
02:51:53.394UTC. Executor startup checks, operational readiness and trading-enabled
status are true with no reason codes. This proves the new flow is running, not a win.
Both dashboard routes return200; `/api/learning` validates trial/status1.1 and the
new release's scorecard1.1. Historical P/L has not been reset or relabeled.

Old529/532 registrations and reports remain intact. A separate handover receipt
right-censors their remaining tails; new loss and R:R registrations begin03:00UTC
(11:00SGT). The first full report is due around03:34UTC (11:34SGT). Their original
persistent timers and the observation feed now point to the new frozen code and
separate state directories. Initial read-only runs succeeded, waiting for the future
window. Pre-window trades remain in broker journals/Flight and are not backfilled
into a prospective window. Next economic review retains the existing complete-cohort
floor and censoring rules; tests and startup health do not establish profitability.
