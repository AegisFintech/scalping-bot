# ISSUE-374 — Lean operational storage and weekly logs

The operator requested retaining necessary learning/operational data and rotating
logs every seven days. This is maintenance only; entry, TP, money management,
orders, accounting and provider behavior do not change. Maintenance source is
`0.6.0-entry-modes.1-codex.3`, with the same policy/prompt/worker contracts.

## Inventory and retention boundary

Read-only inventory on 24 October: current database 597,972,671 bytes (~570 MiB),
logs ~11 MiB. Largest allocations: candle references 171 MB, canonical audit
109 MB, indicator snapshots 55 MB, validation outcomes 43 MB, order-book levels
40 MB and observability delivery receipts 39 MB. These are approximate physical
allocations including indexes, not reclaimable-byte estimates.

805,380 decision candle references already share 6,391 distinct values; the legacy
candle table is empty. Preserve exact completed data, provenance, decisions/WAITs,
rejections, provider inputs/results, fills, costs, risk baselines, protection,
controls, journals and frozen research. They are needed to reconstruct failed
trades and censor unavailable paths. Do not retain only winners/trades.

A temporary-table comparison of 500 real indicator samples found PGLZ 1,505,988
bytes versus LZ4 1,779,865 bytes (~18% larger); exact text content was identical.
Retain PGLZ. The experiment changed no persistent source rows.

## Bounded completed-delivery receipt cleanup

The observability outbox contains only delivery bookkeeping; its FK references
an authoritative audit event. At inventory all 178,676 rows were DELIVERED and
less than seven days old, so none were eligible. Proposed cleanup removes only
DELIVERED receipts older than seven days, with no lease, joined to an existing
canonical event for the configured instance. At most 1,000 rows per five-minute
maintenance pass; row locks skip concurrent leases. Pending/retry/in-flight and
other-instance rows remain. The audit event itself and every trading/learning
record stay unchanged. Database/transaction failure rolls back the cleanup.

Migration 0034 adds a partial delivered-at index and lower autovacuum/analyze
thresholds for the churn-heavy outbox. It deletes no rows and changes no historical
migration. Online VACUUM (ANALYZE), without FULL or a blocking table rewrite,
recycles dead space and refreshes planner statistics; it need not reduce file size.
Cleanup activation requires the operator's concrete retention review and an exact
scoped `delivered-receipt-retention-approval.json` in the runtime directory. Missing
approval skips receipt deletion; malformed/wrong-scope approval fails closed. No deletion
is inferred from the migration alone.

## Logs and current deployment jobs

Structured logs roll every seven days, with the existing 20 MiB early size roll.
PM2 logs rotate weekly or at 2 MiB, compress closed rotations and retain closed
routine logs for seven days. Existing combined 200 MiB cap and open-file protection
remain; a diagnostic log is not the durable trading journal. Weekly rotation and
seven-day closed-log retention are separate rules. Size caps can rotate earlier.

The maintenance installer now accepts explicit protected env/runtime/log paths,
validates systemd-safe absolute paths and writes tested units. This avoids the
existing services' stale release/env references. Keep the existing five-minute
maintenance/daily backup schedules and database activation marker. Never overwrite
populated environment credentials or bind jobs to a historical database.

## Transition, rollback and validation

Before activation: qualify/push reviewed issue PR, exact-head checks and main;
obtain operator review of the delivered-only retention scope, record scoped
eligible counts, preserve protected financial/account/order evidence, apply the
additive migration through the local administrator under existing migration locks
and checksum checks, and update matching artifact/timer paths. No app CREATE/DDL
privilege escalation. Existing broker protection/GTC and all freezes remain.

Rollback disables the receipt cleanup job; a later forward migration can drop the
new index and reset outbox autovacuum options. Retired receipts cannot be restored
from this table, but their original audit events remain; recreating a queue entry
could resend external telemetry and must not happen automatically. No down
migration, financial restore or trade-history deletion is part of rollback.

Tests cover exact cutoff, scope, pending/retry/lease preservation, canonical audit
preservation, transaction rollback, idempotency, 1,000-row bound, unsafe service
paths/commands and weekly/size/age policy. Full qualification and operational
receipt are recorded in [issue #374](https://github.com/AegisFintech/scalping-bot/issues/374).

## Final source qualification

Frozen full qualification passed all gates and **1,646 tests**: 1,090 Node,
115 isolated PostgreSQL and 441 Python. Formatting/lint/types/build, schema and
migration/lifecycle/replay/fail-closed, secret scanning and both dependency audits
passed. Both sample configuration checks, JavaScript syntax and AST Graphify
passed. [Exact commands, results and fingerprints](evidence/lean-storage-validation.json).

Audit gates exposed newly reported npm and filelock advisories. Exact pins now
use Fastify 5.12.7, Zod 4.6.7, Vitest 4.1.12, filelock 4.2.1 and patched transitive
fast-uri. Both audits are clean. The Zod upgrade changed generated datetime
syntax; the HTTP parser explicitly retains the immutable market-session 1.0
grammar instead of changing the published schema. Calendar/offset positive and
failure tests cover that compatibility boundary. Preliminary migration-list,
Python test-style and dependency/schema failures were fixed before the final run.

Online VACUUM (ANALYZE) reduced estimated dead tuples in the three selected tables
from 13,999 to zero without changing their physical sizes or deleting live rows.
Existing PGLZ and candle deduplication stay intact. Matching artifacts/jobs and
operational receipts follow in issue #374. Completed-receipt deletion stays
inactive until exact operator review; the source is independently usable for
weekly logs and non-destructive maintenance.
