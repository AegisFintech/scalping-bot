# ISSUE-378 — External intervention and fixed 1.00 TP

Operator-approved existing DEMO source `0.7.1-quick-oco.1-codex.1`, policy
`0.7.1-quick-oco.1`. This supersedes ISSUE-376 economics for NEW setups only;
older reports/prompts/schemas/registrations remain immutable. Delivery and
operational evidence: [issue #378](https://github.com/AegisFintech/scalping-bot/issues/378).

## Incident and verified outcome

The operator fully closed the demo BUY filled at4012.52 at4013.08. Direct read-only
broker history reports gross117.04, total signed commission−50.32, swap/FX0,
net **+66.72**, closed volume20900. The old local ledger stayed OPEN and new
entries correctly blocked. The broker assigned a non-bot client ID; the earlier
manual-close predicate incorrectly required null. Unusable contextual position
prices also require exact matched closing-deal entry evidence, never an invented
current price. A completed close can use its matched deal timestamp when the
contextual close timestamp is absent. Negative/malformed prices still reject. Unpriced OPEN contexts stay blocked;
partial history reconstruction uses the exact owned entry and verified remaining
broker volume instead of treating a zero-price callback as execution authority.

The correction observes already executed external market closes. It never issues
an operator close, adopts a manual position, authorizes model execution or clears
uncertainty from a flat snapshot. Closing order/deal/position identities, opposite
closing side, account/symbol ownership, original entry/open time, closed volume,
remaining volume and complete fees must agree. Arbitrary non-bot client IDs are
not themselves authority. Bot `cas-` close IDs still require the existing durable
protective-close claim. Unknown, contradictory or missing evidence blocks.

## Full closes, partial closes, cancellations and restart recovery

Additive migration0035 creates immutable `position_close_deals`: one broker deal
per scoped account, exact position/order, volume, entry, monetary components,
source time and evidence hash. No backfill, deletion or historical trade rewrite.
The existing locked event-persistence transaction verifies cumulative closed volume
against actual entry fills and the remaining position before appending each row.
UPDATE/DELETE are rejected; uniqueness prevents duplicate outcomes.

Full close produces one canonical net trade. Partial close records its observed
outcome, keeps the remaining position and broker-held protection, and blocks a new
setup. Final close aggregates all verified closing details into one net trade.
Broker closing-detail commission already includes the applicable entry/exit fees;
do not subtract the entry fill commission again. No intermediate partial result
is mislabeled as a fully closed setup. Partial volume changes reset/censor Flight
metrics for the new volume basis; raw evidence remains.

History recovery reads reconciliation, orders and deals serially. It processes
matched closes in source order, verifies the aggregate remaining broker volume,
then uses the ordinary persistence path. Missing callbacks/restarts cannot replay
an order or close. Recovery is bounded to the existing seven-day history window,
1,000-row complete history response and at most eight closing deals per position;
truncation, duplicate identity, contradictory remaining volume or larger histories
require review instead of selecting convenient outcomes. A subsequent normal
maintenance pass can settle the temporary partial-close waiting reason after the
complete terminal group proves closed.

The original journal payloads/reasons remain. Only an exact matched executed
manual close can resolve the prior acknowledgement's unsupported-close reason;
its resolution identity/time stays auditable. Partial-close waiting records are
resolved only against the same position's immutable closing-deal evidence and
final canonical close. Complete entry/peer/position/trade proof remains necessary
for terminal release and recorder-fault acknowledgement. No timer-based unlock,
accounting reset, history deletion or SQL-injected trade row is authorized.

Manual pending cancellation retains the existing ownership-scoped OCO cleanup:
confirm the cancelled leg, cancel the surviving owned pending peer, prove zero
fills/terminal state and reconcile before another setup. Manual orders are not
cancelled. Ordinary manual intervention means reconcile then continue automatically;
pausing new entries remains a separate existing authenticated control.

Dashboard read-only factors and decision tape distinguish external intervention
from a confirmed close: detected/reconciling, partial remaining exposure, or
reconciled canonical net. Broker evidence does not identify which person/device
initiated an external action. Protection is shown separately from fresh broker
observations; a partial-close label never claims protection was verified.

## Fixed TP economics

New OCO remains BUY upper / SELL lower STOP_LIMIT/GTC, with original Codex prices.
Gross TP distance is **1.00 price unit**, rounded upward to whole broker pips;
native SL distance is exactly **7× that TP**. On current pip/tick0.01 metadata,
this is TP1.00 / SL7.00, not one broker pip. The operator offered1.0 or0.8; this
release explicitly takes the first1.00 step. Accepted older orders/positions keep
original quantities and exits; no repricing or cancellation accelerates activation.

The previous1.20 target included30 entry +65 exit ticks inside profit economics.
Entry slippage is already part of the actual fill-relative entry basis. It is no
longer charged a second time inside TP. **The native entry range remains30 ticks,
risk stop reserve remains65 ticks, and the conservative TP exit reserve remains65
ticks.** Actual broker commission/conversion plus that exit reserve must still
leave at least the modeled0.08 broker-pip net objective. If1.00 cannot cover these
at minimum/actual volume or fresh placement metadata, reject; never silently widen
TP, move entries, reduce safety reserves or force an order. Spread is not charged
twice. Unknown swap/slippage remains unknown, not a guaranteed profit.

Provider cost context uses the matching fill-relative cost calculation, not the
old entry-inclusive reserve. New provider prompt `entry-quick-oco-v2` / worker
request1.8 / response1.2 and local `entry-quick-oco-execution-v2` share exact
version/hash binding. Historical request1.7/v1 and all previous schema/prompt bytes
remain unchanged. New schema risk-policy1.7 admits the new policy while retaining
exact demo-only5% / other-mode1% ceilings. Persistent memory gets the new prompt
pin; prior threads/jobs remain, not training or reset.

Sizing remains dynamic from reconciled equity, stop loss, costs, broker margin
and volume steps: at most **5% TOTAL across both race-exposed legs**, at most2.5%
each. A shorter stop can produce a different lot size; there is no fixed lot
multiplier, martingale, unused-peer reassignment or guaranteed realized loss cap.
Existing demo loss measurements, three-loss cooldown and other fail-closed gates
remain; real-money authority is not added.

## Delivery, validation and rollback

Test actual non-bot-ID manual full closes/retained acknowledgements, missed
history, partial/full sequencing, restart/idempotency/fees and wrong volume,
entry, time, ownership and bot-close identity. Preserve the historical lifecycle
permutation/failure suite and test immutable close rows. Test fixed target, exact
native7× ratio, actual-volume/late cost rejection and Node-to-Python request1.8.
Run full qualification/config/security/audits/Graphify and desktop/mobile checks;
commit/push reviewed PR, both exact-head hosted qualifications, qualifying main
and matching one-demo/worker/readonly-recorder rollout before handoff.

Deployment applies0035 through the audited local administrator after verifying
all34 prior checksums, preserving app/observer privilege boundaries and protected
state. Existing broker history must produce the verified+66.72 incident outcome
through normal code, not a manual accounting edit. Freeze a future source cohort
before collection; preserve old registrations and initial open/gap censoring.
Existing recordings and approved seven-day diagnostic retention remain distinct.

Rollback is admission hold plus a compatible forward release after all new groups
are proven terminal. Keep migration0035 and its canonical closing evidence; never
drop it, rewrite an old checksum, restore an old financial database or downgrade
an active partial-close lifecycle to incompatible code. No automatic promotion or
profitability claim follows from tests or a manual winning trade.

## Qualified checkpoint

Full Node22 `node scripts/qualify.mjs` passed all gates: 1,105 Node,
123 isolated PostgreSQL lifecycle and 458 Python tests (1,686 total). Formatting,
lint, types, build, schema/migration/fail-closed tests, secret scan and both
dependency audits passed. Both configuration checks, actual populated config,
read-only actual broker parser and desktop/mobile browser checks passed.
`graphify update .` refreshed only the AST graph (10,362 nodes, 17,083 edges,
715 communities); semantic documents were not regenerated.

Exact command/result/source fingerprint and additional checks: [validation](evidence/manual-intervention-validation.json).
Deployment awaits reviewed exact-head hosted checks/main; activation evidence
will be posted to [issue #378](https://github.com/AegisFintech/scalping-bot/issues/378).
