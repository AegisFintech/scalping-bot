# Database Schema

## Principles

PostgreSQL stores UTC `timestamptz`, canonical numeric columns for prices/money/volume, constrained enums/text states, unique idempotency keys, and immutable decision artifacts. JSONB is reserved for versioned/redacted payloads and bounded metadata, not core relational state. Migrations are append-only and transactional where PostgreSQL permits.

## Core tables

| Table                          | Purpose and key constraints                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `accounts`                     | pseudonymous account key, paper/broker provider and environment; unique provider key hash      |
| `symbols`                      | broker symbol ID/name, digits, tick/contract/volume-scale/margin metadata, revision/freshness  |
| `candle_snapshots`             | account/symbol/analysis timestamp, source skew, completeness; unique analysis/time             |
| `candles`                      | snapshot/timeframe/start/end/OHLCV/quality; unique snapshot/timeframe/start                    |
| `indicator_snapshots`          | versioned deterministic feature JSON and latest numeric fields                                 |
| `order_book_snapshots`         | source/receive times, bid/ask/spread/imbalance/age/discontinuity                               |
| `spread_observations`          | fresh quote/server times and exact spread; unique account/symbol UTC source minute             |
| `order_book_levels`            | snapshot/side/level/price/size; unique snapshot/side/level                                     |
| `analysis_runs`                | mode/state/expiry, versions, eligibility and rejection codes; one active per account/symbol    |
| `automatic_analysis_intervals` | durable broker-M1 scheduler claim and terminal cycle correlation; unique account/symbol/minute |
| `model_requests`               | endpoint/model/prompt/schema, exact prompt/hash, redacted payload/hash, latency/status         |
| `model_responses`              | redacted raw/parsed payload, provider IDs if non-sensitive, token/status bounds                |
| `validation_results`           | schema/semantic/risk stage, accepted flag, bounded reason/detail JSON                          |
| `risk_decisions`               | equity/risk budget/stop/tick/raw/normalized volume, margin/spread, approval/reasons            |
| `order_groups`                 | OCO analysis link, state, expiry, unique idempotency key                                       |
| `orders`                       | group/side/type/state/client/broker ID, prices/volume, ownership, version counters             |
| `fills`                        | deduplicated broker event, order, price/volume/fees/time                                       |
| `positions`                    | current/history broker position state and reconciliation version                               |
| `trades`                       | closed outcome, mode/setup/regime/version and realized results                                 |
| `broker_execution_events`      | deduplicated normalized cTrader callback/recovery evidence and mapping state                   |
| `session_statistics`           | bounded aggregate by account/symbol/session/mode                                               |
| `setup_statistics`             | aggregate/decay window by tags/regime/direction/hour/depth/vol/confidence/version              |
| `daily_risk_state`             | timezone/day baseline/current equity, net capital flows, loss utilization, durable lockout     |
| `service_health`               | service/instance state, dependency reasons and heartbeat                                       |
| `server_metrics`               | bounded sampled CPU/memory/disk/network/process data                                           |
| `audit_events`                 | append-only correlation IDs, pseudonyms, event/outcome/reason/redacted detail                  |
| `observability_outbox`         | one durable delivery state per new audit event; leased, retried, and idempotently enqueued     |
| `runtime_controls`             | emergency stop, pause, dashboard acknowledgement and versioned expiry/actor/reason             |
| `strategy_versions`            | immutable code/config/prompt/schema/feature version hashes                                     |

## Transaction boundaries

- Paper identities use `provider/environment/account_type=paper`; they cannot
  share a row or daily-risk baseline with cTrader demo/live identities.
- One-time late demo baseline initialization inserts `daily_risk_state` and its
  audit event in the same serializable transaction and refuses replacement.
- Initial candle/depth rows and analysis linkage commit together before
  analytics/model work. A post-model refresh may append a second depth snapshot
  and atomically move only the analysis depth pointer; the immutable initial
  candles remain the model context and must compare exactly with the refreshed
  completed-candle context.
- Accepted validation and risk decisions commit before order intent.
- The immutable model response stores endpoint levels. Bounded semantic
  validation details separately store the TP-distance divisor plus original and
  effective TP/R:R values, including transform rejection evidence before any
  order intent exists.
- Risk-stage validation details retain the pre-model and post-model
  `max_affordable_stop_distance` without persisting an endpoint-facing equity,
  money-budget, or volume field.
- OCO group plus both client order intents/idempotency keys commit before gateway calls.
- Each broker callback is inserted/deduplicated and its state transition commits atomically.
- Placement callbacks drain only after returned broker order IDs commit. If a
  strategy-labelled callback omits its client order ID, the committed broker ID
  is the fallback key; absence or ambiguity of both keys remains blocking.
- Demo callback readiness is the current set of journal rows that are unmapped,
  conflicting, or contain unresolved reasons. Resolved partial-fill evidence is
  retained for audit but no longer blocks after the final fill commits.
- A supported fully closed demo position, its terminal state, signed broker
  money outcome, and one immutable `trades` row commit in the same transaction.
  A conflicting second outcome is journaled as `CONFLICT` and cannot overwrite it.
- Cancellation intent commits before cancel call; result/reconciliation commits afterward.

## Retention and access

Audit, order, fill, position, trade, and risk records follow regulatory/operational retention chosen by the operator. High-volume raw depth/candle/server metrics can be partitioned/expired only through reviewed migrations/jobs that retain decision-linked evidence. Dashboard roles should not read secret-bearing configuration; runtime controls require dedicated mutation privileges.

## Migration policy

Never edit an applied migration. Destructive changes require expand/backfill/verify/contract phases, backup/restore evidence, rollback notes, and operator approval. Migration tests apply all migrations to an empty database and verify expected constraints/indexes; upgrade tests start from the previous released schema.

Migration `0005` widens only the account identity checks to admit the isolated
`paper` provider/environment/type. It preserves all legacy rows, including any
previously mixed identity, for audit; operators must select a fresh stable demo
pseudonym instead of reusing a historically paper-backed key.

Migration `0006` adds account-scoped broker order/position uniqueness, a broker
update timestamp, position-owned closing fills, and the normalized cTrader event
journal. It backfills `orders.account_id` through the existing group/analysis
foreign keys without deleting rows. Rollback is intentionally manual: stop
execution, verify that no `0006` evidence is required for reconciliation,
restore the prior constraints/indexes, and remove added objects only after an
operator-reviewed evidence-retention decision.

Migration `0007` adds the append-only `spread_observations` risk-history table.
Database checks require positive non-crossed prices, exact `spread = ask - bid`,
broker source time no later than broker server time, local receipt no later than
persistence, and an epoch-minute key matching source time. The unique
account/symbol/source-minute constraint makes process retries and restarts
idempotent. Rollback is operator-reviewed and manual: stop execution, preserve
the risk evidence, verify another approved history source or disable the
percentile-dependent workflow, then remove the new objects only if evidence
retention permits.

Migration files are byte-immutable after application. The configured database
was originally migrated with one trailing blank line in `0001` and `0002`; the
repository preserves those exact recovered bytes and pins their SHA-256 values
in migration tests. Operators must never rewrite a ledger checksum to bypass a
mismatch.

Migration `0008` adds `observability_outbox` and an `AFTER INSERT` trigger on
`audit_events`. Enqueue and audit persistence are atomic; one unique outbox row
is created for every audit event inserted after the migration. Existing audit
history is deliberately not backfilled. Status, attempt count, next attempt,
lease expiry, last error code, and delivery time support crash recovery and
operator monitoring. Rollback is manual and operator-reviewed: stop exporters,
retain required evidence, remove the trigger/function, and remove the table only
when the external mirror and retention requirements have been addressed.

Migration `0009` adds nullable paired `system_prompt` and
`system_prompt_sha256` columns to `model_requests`. Existing schema 1.0 requests
remain unchanged with both values null; new schema 2.0 requests must persist the exact
non-secret prompt only after its version, 64 KiB bound, SHA-256 syntax, and hash
match pass. A database check rejects a partial pair, oversized prompt, or
malformed hash. Rollback is manual and operator-reviewed: stop AI/execution,
retain/export required prompt evidence, deploy code that no longer writes or
reads the columns, and remove the pair plus constraint only if audit-retention
policy permits.

Migration `0010` adds `automatic_analysis_intervals`. Its primary key makes an
account/symbol/broker-minute claim durable across scheduler ticks and process
restarts. Broker time must fall within the claimed minute. Completion stores the
cycle ID, optional persisted analysis foreign key, outcome, and timestamp as a
consistent set; a preflight rejection may have no `analysis_runs` row. An
incomplete claim is retained and cannot be replayed. Rollback is manual: pause
automatic analysis, preserve the interval evidence, deploy scheduler code that
does not use the table, and remove it only after operator review.

Migration `0011` expands `broker_execution_events` to schema `1.1` with the
broker-native order type and closing-order flag. This distinguishes cTrader's
server-created SL/TP closing child from the original strategy entry even when
the child inherits its client order ID. Existing `1.0` rows remain valid and
unchanged. Rollback requires stopped execution, complete reconciliation, and
retention/export of `1.1` evidence before the columns or constraint are removed.
