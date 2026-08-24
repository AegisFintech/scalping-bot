# Database Schema

## Principles

PostgreSQL stores UTC `timestamptz`, canonical numeric columns for prices/money/volume, constrained enums/text states, unique idempotency keys, and immutable decision artifacts. JSONB is reserved for versioned/redacted payloads and bounded metadata, not core relational state. Migrations are append-only and transactional where PostgreSQL permits.

## Core tables

| Table                     | Purpose and key constraints                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `accounts`                | pseudonymous account key, paper/broker provider and environment; unique provider key hash     |
| `symbols`                 | broker symbol ID/name, digits, tick/contract/volume-scale/margin metadata, revision/freshness |
| `candle_snapshots`        | account/symbol/analysis timestamp, source skew, completeness; unique analysis/time            |
| `candles`                 | snapshot/timeframe/start/end/OHLCV/quality; unique snapshot/timeframe/start                   |
| `indicator_snapshots`     | versioned deterministic feature JSON and latest numeric fields                                |
| `order_book_snapshots`    | source/receive times, bid/ask/spread/imbalance/age/discontinuity                              |
| `order_book_levels`       | snapshot/side/level/price/size; unique snapshot/side/level                                    |
| `analysis_runs`           | mode/state/expiry, versions, eligibility and rejection codes; one active per account/symbol   |
| `model_requests`          | endpoint/model/prompt/schema, redacted payload/hash, latency/status                           |
| `model_responses`         | redacted raw/parsed payload, provider IDs if non-sensitive, token/status bounds               |
| `validation_results`      | schema/semantic/risk stage, accepted flag, bounded reason/detail JSON                         |
| `risk_decisions`          | equity/risk budget/stop/tick/raw/normalized volume, margin/spread, approval/reasons           |
| `order_groups`            | OCO analysis link, state, expiry, unique idempotency key                                      |
| `orders`                  | group/side/type/state/client/broker ID, prices/volume, ownership, version counters            |
| `fills`                   | deduplicated broker event, order, price/volume/fees/time                                      |
| `positions`               | current/history broker position state and reconciliation version                              |
| `trades`                  | closed outcome, mode/setup/regime/version and realized results                                |
| `broker_execution_events` | deduplicated normalized cTrader callback/recovery evidence and mapping state                  |
| `session_statistics`      | bounded aggregate by account/symbol/session/mode                                              |
| `setup_statistics`        | aggregate/decay window by tags/regime/direction/hour/depth/vol/confidence/version             |
| `daily_risk_state`        | timezone/day baseline/current equity, net capital flows, loss utilization, durable lockout    |
| `service_health`          | service/instance state, dependency reasons and heartbeat                                      |
| `server_metrics`          | bounded sampled CPU/memory/disk/network/process data                                          |
| `audit_events`            | append-only correlation IDs, pseudonyms, event/outcome/reason/redacted detail                 |
| `runtime_controls`        | emergency stop, pause, dashboard acknowledgement and versioned expiry/actor/reason            |
| `strategy_versions`       | immutable code/config/prompt/schema/feature version hashes                                    |

## Transaction boundaries

- Paper identities use `provider/environment/account_type=paper`; they cannot
  share a row or daily-risk baseline with cTrader demo/live identities.
- One-time late demo baseline initialization inserts `daily_risk_state` and its
  audit event in the same serializable transaction and refuses replacement.
- Snapshot raw rows and analysis linkage commit together before analytics/model work.
- Accepted validation and risk decisions commit before order intent.
- OCO group plus both client order intents/idempotency keys commit before gateway calls.
- Each broker callback is inserted/deduplicated and its state transition commits atomically.
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
