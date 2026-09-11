# ISSUE-095: Unattended lifecycle recovery

Status: implemented, tested and deployed to demo. Sustained operational qualification remains in progress. [Issue #221](https://github.com/AegisFintech/scalping-bot/issues/221).
Release `0.2.5-market-stop.8`; unchanged `market-stop-v2` policy; demo authority only.

## Incident and recovery contract

The September 10 SELL filled at 21:42:53 SGT and closed at 21:42:56 SGT.
Its missing SL was amended; the amended protective order itself then filled.
The trade, position and group closed correctly, but an earlier replacement event
remained unresolved. On September 11 the broker was flat and the execution
process was alive, while that journal marker and the fill-slippage latch blocked
new cycles. ISSUE-093 covered a different protective child being cancelled after
a market close. It did not cover the amended child itself filling.

`PostgresDemoExecutionStore.reconcileTerminalEvidence` now establishes terminal
fills per position before choosing the latest group proof. An accepted/amended
native protective child resolves through either its exact zero-fill cancellation
or its exact full closing fill. Both require the existing closed owned group,
closed positions, immutable trades, terminal entry/peer orders, account/symbol
scope and complete evidence. Closing-fill volume must equal the position's summed
entry fills; stored fill, position identity and trade/position close times must
agree. Each child matches its own position and broker order, including two fills
in an OCO race. Its occurrence cannot follow the claimed closing fill.

Only the two existing acknowledgement/replacement reason codes are eligible.
Additional reasons, conflicts, missing/foreign/partial evidence or an incomplete
peer remain blocked. Original event payloads/reasons remain; resolution time and
proof reference are recorded. Replay and restart use the same durable procedure.
No timeout or flat-account observation authorizes a state reset.

`CTraderDemoGateway.acknowledgeCertainTerminalRecovery` now receives the two exact
terminal entry orders from that proof. It validates both identities and terminal
states before replacing stale callback state and removing completed orders from
the active callback cache. The idempotent response remains available so repeating
the same command cannot create another pair. A slippage latch releases only for
the group that caused it. An older group's proof cannot release a newer incident.
Fresh broker reconciliation can still report unexpected exposure independently.

Terminal-proof transactions use a five-second lock timeout and a fifteen-second
statement timeout. PostgreSQL rolls back a blocked attempt; normal serialized
periodic recovery retries. There is no detached/overlapping recovery and no broker
command in this proof step. Unexpected top-level recovery errors use a stable
public failure code. These bounds do not claim to bound every dependency in the
application.

## Qualification and scope

The dedicated `unattended-lifecycle.integration.test.ts` suite uses isolated
PostgreSQL schemas and synthetic broker fixtures. It exercises all 24 arrival
orders of acknowledgement, amendment, closing fill and peer cancellation, with
duplicates and fresh store instances between steps, alternating BUY and SELL.
It also covers a database lock timeout/rollback/retry, periodic recovery after
failure, cancelled distinct children, double fills and missing/contradictory
proof. Gateway tests cover stale callbacks, exact-identity rejection, idempotent
replay and an older proof arriving during a newer slippage incident. These are
correctness tests, not economic or live-broker evidence.

Existing tests separately cover protection repair/close claims, provider timeout,
OCO cancellation retry, missed closing-deal history recovery, account failures,
durable request cooldowns, emergency controls and backup/restore. Unattended
qualification must preserve all of them; passing one sequence cannot establish
general production readiness.

No trading-schema, migration, provider prompt, environment or economic policy changes.
The internal terminal-recovery result adds exact order evidence; historical
journal records and migration checksums remain unchanged. Current-equity 1%
combined OCO risk, cost/margin sizing, SL/TP maintenance and demo loss-policy
authorization remain as approved. Live execution remains disabled.

## Operational acceptance

Process uptime alone is insufficient. Use `/health/ready`, `/v1/status`, fresh
broker exposure, unresolved journal evidence and the existing automatic-analysis
watchdog together. Expected provider backoff, market closure and stale data are
different from a closed trade leaving a permanent internal blocker. The existing
watchdog records stall/recovery through the durable observability outbox; no new
notification recipient or trading control is introduced.

The read-only `scripts/observe-unattended.ts` command samples the local execution
status every fifteen seconds with a ten-second HTTP timeout. Its versioned
`unattended-observation-1.0.json` checkpoint contains only allowlisted operational
fields, aggregate counters and the last 64 transitions. Atomic private writes
preserve failures and gaps across restart; invalid checkpoints stop observation
without overwriting evidence. Mode/release mismatch cannot produce a good sample.
The observer has no broker, provider, database or control authority. A completed
observation is not an automatic production certificate. Sampled status can miss
brief broker events; use the durable trade/protection journal for those.

After building, start a bounded observation with:

```sh
node dist/scripts/observe-unattended.js --release 0.2.5-market-stop.8 --hours 24 --output .runtime/issue-095/unattended-observation.json
```

The 24-hour wall-clock window is an initial observation, not the 24 market-open
hours required below. Retained not-ready samples include legitimate active-trade
reconciliation and must be interpreted with their setup state/reasons. Keep the
same checkpoint when restarting; choose a new evidence path for a new window.

Before calling this suitable for unattended production, retain a prospective
demo observation covering at least 24 market-open hours, multiple protected
fill/close/new-cycle transitions, a normal restart, reconnect/dependency recovery
and UTC rollover without manual unlocks. Confirm alert delivery and restore of a
current paired backup. This is an engineering acceptance window, not a guarantee
of future uptime or profitability. Live promotion remains a separate reviewed
decision. Broker sessions and dependency outages can prevent new trading.
Prospective qualification is tracked in [ISSUE-096 / #222](https://github.com/AegisFintech/scalping-bot/issues/222).

Known limits remain: partial/multiple closing deals without supported complete
accounting, unknown command dispatch, contradictory broker evidence and outages
may require operator reconciliation. Never clear those records to satisfy an
uptime target. Retained in-process idempotency records are not a durable archival
replacement; normal process restart must recover from PostgreSQL.

## Validation and rollout

All 22 required check categories pass: **658 Node, 162 Python, 40 JSON Schema,
three migration and 43 PostgreSQL integration tests**, including the 38 new
lifecycle cases. Both dependency audits are clean. Fixture/type-import/lint
issues found during development were corrected. The replay retry used a fresh
output path, preserving the original immutable output. Exact commands, failures,
reruns and observations are in [validation evidence](evidence/unattended-recovery-validation.json).

Before rollout, the broker independently confirmed zero orders/positions. A
paired backup restored into an isolated empty database with all **45 table
counts/fingerprints matching**; the scratch database was then removed. Native
PM2/PostgreSQL supervision and both storage timers are enabled. Disk use was 44%.
Graphify was refreshed with five source-grounded report links and no provider
calls; the known pyproject.toml empty-node/community-label warnings remain.

At **13:37:22 SGT on September 11**, startup resolved the original replacement
marker through its retained closing evidence. The row/reason were preserved with
a proof reference. Automatic provider inference completed in 5.157 seconds. A
new pair was created at 13:37:42 and independently broker-confirmed at 13:38:02:
BUY STOP 4341.02 / SELL STOP 4333.54, both GTC with relative SL and TP instructions.
Their combined modeled budget was 6538.6818 against equity 653868.18, exactly 1%.
This confirms order acceptance and attached instructions, not a filled position.

At 13:39–13:40 SGT, a controlled normal execution-worker restart preserved both
exact broker order identities, entry prices and protection instructions. Startup
reconciliation resumed automatically with the existing group; no replacement
pair or provider request was created. This exercises accepted GTC recovery on
demo; it does not substitute for a full prospective filled-position lifecycle.

The environment and original loss/high-water records are unchanged. PM2 has no
cached policy/database overrides; the deployment and controlled drill are the
only execution restarts in this verification window.
No manual analysis, journal reset or control unlock was used. All five services
are online. A separate read-only observation job is sampling successfully from
**13:38:09 SGT**, with the initial wall-clock window ending September 12 at the
same time. Its direct Node launcher was verified after correcting PM2's CLI
entry-point wrapping. PM2 state is saved privately. This short rollout does not
establish unattended production readiness; the prospective qualification above
is still required.

## Rollback

Keep the prior source release and paired database/chart backup. Reconcile owned exposure
before reverting a running worker; normal shutdown preserves accepted GTC orders.
Do not restore an old database over new trades or erase commands/events to retry.
No migration or environment rollback is required. Reverting reintroduces the
amended-child recovery gap, so it is not a remedy for the incident.
