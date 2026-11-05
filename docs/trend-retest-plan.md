# Trend breakout/retest demo experiment — ISSUE-536

Operator approved implementation after the first R:R review. This is a prospective
experiment, not promotion of a proven winner. Preserve the single existing demo,
5% setup/2.5% single-leg ceilings,65-tick sizing reserve, costs, ownership, session,
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
  sized volume and again immediately before submission; reserve65ticks for sizing.
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
   absolute pending protection and repair: implementation under qualification.
   Defaults still select0.10; this checkpoint is not deployable as0.11.
2. Additive database authority and audited source handover, controller allocation
   and same-direction mode integration: pending. Preserve all historical migrations.
3. Full integrated qualification, independent review, exact-head CI, reviewed merge,
   one-demo activation and broker/source readback: pending.

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
qualification is running and is required before any merge.
