# ISSUE-090: Local PostgreSQL and compact trading evidence

Status: implementation and isolated recovery validation complete; operational
activation deferred. [Issue #211](https://github.com/AegisFintech/scalping-bot/issues/211).
[PR #212](https://github.com/AegisFintech/scalping-bot/pull/212), implementation
checkpoint `1508a2f`, is pushed for review. On September 10 the operator instructed
us to leave the blocked task and move forward. The remaining recovery/cutover work
is now [ISSUE-091 / #213](https://github.com/AegisFintech/scalping-bot/issues/213),
separate from delivery of the verified storage implementation. Merging this
release neither switches the runtime database nor resumes trading.

The hosted PostgreSQL compute quota prevents the execution service from starting.
The operator approved native local PostgreSQL, bounded disposable storage, cache
cleanup and restore-tested backups on September 10. This changes storage and
operations; the current demo strategy and risk policy remain unchanged.

The newest available local database dump was captured September 9 at 16:32 SGT.
Its archive directory is readable but later authoritative records are missing
until source recovery is proven. No historical restore is treated as current
state, and no risk lock, capital baseline or dispatch claim is reset.

## Delivered preparation and deferred activation

Native PostgreSQL 18.6 is installed under systemd, listening only on loopback with
verified TLS/SCRAM and separate application/migration/test roles. Node and Python
both passed TLS connection checks. The runtime environment file is byte-for-byte
unchanged and still points to the hosted database. PM2 does not cache a
`DATABASE_URL` value for these five processes; they load configuration through
their startup wrappers. No local production database has been activated.

A direct broker reconciliation showed zero positions and zero pending orders
before execution was stopped for this approved migration. The stopped execution
state is saved in PM2 so a reboot cannot resume the maintenance window by
accident. The other four services remain online. No order submission,
cancellation, protection change or trading-strategy change was performed.

The last hosted-source check rejected reads with SQLSTATE `53000` (compute quota).
Further source recovery is deferred; no repeated access attempts are needed to
finish the independent implementation delivery. Temporary source access is
needed to export records newer than September 9,
16:32 SGT. A broker deal history alone cannot reconstruct exact model dispatch
claims, consumed contexts and every capital high-water observation. No balance,
daily/drawdown lock, model history or journal was reset to make startup pass.

The restored database is explicitly **historical recovery**, without broker
authority. Its backup date is not presented as the date of current trading state.
Local installation, cleanup and restore rehearsal are complete; current-state
cutover, enabled maintenance timers and demo resumption remain pending. Live
execution stays disabled. No paid hosted upgrade was purchased. Deferring old
history is not treated as permission to initialize a new risk/accounting baseline;
that separate operator choice is pending. The original hosted source and local
archive remain preserved whichever operational transition is later authorized.

## Cleanup evidence

Root filesystem free space increased from 20,431,085,568 to 29,866,926,080 bytes
during the approved cleanup: **9,435,840,512 bytes (9.44 GB / 8.79 GiB)** reclaimed.
Later PostgreSQL installation, recovery databases and paired backups consume some
of that space; the cleanup figure is not a claim about final free capacity.
After installation and recovery rehearsal, 28,121,165,824 bytes remained free
on the 52,591,984,640-byte root filesystem.

Removed only npm/pip/uv/apt regenerable caches and unused Docker image/build
cache after reference checks. All four Docker volumes, installed dependencies,
browser binaries, original chart files, trading archives and rollback sets were
preserved. Protected before/after inventories and command results are retained
under `.runtime/issue-090/cleanup.*`; the before manifest identifies 7,163 cache
files. No broad runtime, volume, containerd or user-file deletion was used.

## Evidence storage changes

Release `0.2.5-market-stop.4` changes storage and transport contracts, with the
same DeepSeek request pin, market-data depth, entry parsing, TP/SL, OCO lifecycle
and deterministic risk policy.

- Analytics `/v2/analyze-numeric` uses request/response schema 2.0, the same
  quality and numerical feature computations, `artifactPolicy: numeric-v1` and
  explicit null chart. `/v1/analyze` retains its original image contract.
- Production entry inference uses `/v2/entry-pair`. The pre-dispatch transaction
  stores exact provider user JSON and the **provider** prompt, separately from
  the local execution prompt. Prompt text is content-addressed. Available model
  output text, including rejected readable responses, is committed with the
  terminal context update. Raw response text is not attached to enumerable
  error/log properties. Secret redaction still applies. Network/timeout failures
  without a complete response remain unknown; no response is fabricated.
- Migration 0023 stores typed candle values once and references them from the
  original snapshots. Corrected revisions remain distinct. IDs, decimal values,
  completion/quality flags and snapshot capture/source timestamps are retained.
  The `decision_candles` view reads both formats throughout the transition.
- Numeric runs no longer render/archive a display-only PNG automatically.
  Diagnostics can regenerate charts from recorded candles; the UI labels them
  regenerated and keeps unavailable volume unavailable. Exact historical PNGs
  remain hash-verified and backed up.
- Sample segments overlapping model context and setup/trade lifecycles are
  copied into immutable local evidence storage and linked before cache eviction.
  Active/uncertain groups extend retention. Database failure or failed commit
  leaves cache files intact. These are sampled quotes, not a complete tick tape.
- No trading/audit rows, model claims, financial outcomes, controls, protection
  observations or original chart bytes are subject to routine retention.

On the restored copy, **302,580 original candle rows reconstruct exactly from
10,418 distinct values**. Candle storage including all indexes decreased from
63,086,592 to 59,162,624 bytes, **6.22%**. The modest physical saving reflects
retained provenance and integrity indexes; it is not a 96% disk reduction.
An initial measurement exposed retained empty/index pages, so the reviewed bulk
transition now rebuilds indexes after vacuuming. All nine checked financial,
risk, control, context and broker-journal table fingerprints remained identical.

## Retention and recovery

Systemd unit files and logrotate configuration are installed and verified, but
the timers are **not enabled** until current-state recovery is verified:

| Material                                     | Treatment                                                       |
| -------------------------------------------- | --------------------------------------------------------------- |
| Unreferenced sampled market cache            | Seven days; 1 GiB budget                                        |
| Referenced market evidence                   | Permanent archive, outside cache eviction                       |
| Routine logs                                 | Seven days / combined 200 MiB; active PM2 logs rotated at 2 MiB |
| Detailed infrastructure metrics              | Seven days                                                      |
| Hourly infrastructure summaries              | 30 days                                                         |
| Managed current recovery sets                | Seven daily / four weekly, plus latest restore-proven set       |
| Historical/rollback sets and original charts | Preserved; excluded from automatic retirement                   |

Maintenance runs every five minutes; paired backups are scheduled at 00:20 UTC.
Systemd bounds each job to ten minutes. Database statements, child processes and
decoded segment sizes also have limits. A local process lock prevents overlap.
Routine PM2 logs use copytruncate; a narrow rotation race can lose routine log
lines, so essential trading evidence remains in the durable database journal.
Open logs are never unlinked by cache pruning. If active logs exceed the combined
budget, status reports it rather than deleting an open file.

A backup exports one repeatable-read PostgreSQL snapshot, captures all table
counts and row fingerprints, creates a custom dump, and copies every referenced
local PNG/market artifact with SHA-256 verification. Only a verified completed
set is renamed into the recovery directory. Failed preparations remain separate.
Restore refuses a populated target, stops on errors, and verifies every table's
count/fingerprint. Backup rotation requires a valid restore proof and keeps the
latest proven set. Original hosted/local rollback sets are untouched.

The original dump restored 282 historical trades with all 22 original migration
checksums and 5,358 chart references verified (zero missing/corrupt). After adding
0023, a new paired historical backup restored into a second empty database with
all **45 tables** matching. This proves the recovery machinery, not recovery of
the missing newer interval. Encrypted export passed an encrypt/decrypt test and
includes only manifest-listed backup files. No off-server copy exists yet; an
operator-selected destination and recipient public key are still needed.

Disk space below 15%, overdue backups over 30 hours and storage faults are
observational alerts, not new trading pauses. Database startup retries use safe
reason codes and bounded delays up to 30 seconds, preserving durable-state
requirements and avoiding the previous rapid supervisor restart loop. Dashboard
Diagnostics / Server can read these local observations during a database outage;
stale/unavailable files never imply health.

A real local PostgreSQL stop/start test recovered over verified TLS after two
failed probes. All nine protected table fingerprints survived the restart, and
the probe had no broker client or authority. Failure to write an observational
dashboard status file does not block an otherwise available database; required
trading-journal integrity checks remain independent.

## Deferred ISSUE-091 sequence after source access is restored

1. Keep execution held, preserve the hosted source and all local recovery sets,
   and obtain a fresh consistent database-plus-artifact recovery set. Reconcile
   every record after the September 9 cutoff; do not substitute the historical
   rehearsal database for the current source.
2. Restore into an empty local production database owned by the migration role.
   Verify all migration checksums, table counts/fingerprints, chart references,
   controls, dispatch claims and sticky capital/daily locks. Apply 0023 once.
   Give the application role table/sequence access and schema usage, including
   default privileges for future migrations; keep DDL with the migration role.
3. Create and restore-test a paired current backup before legacy compaction.
   `compact-candles` checks its backup/restore proof, locks the affected tables,
   refuses changed legacy input, checks exact reconstruction, and only then
   removes the redundant legacy rows. Reserve temporary space for indexes and
   keep writers held during this reviewed transition.
4. Update only `DATABASE_URL` in the protected populated environment; preserve
   all other credentials/settings. Run policy/startup configuration checks and
   verify PM2/runtime configuration separately. Record the verified current
   activation marker with the database identity, then enable the prepared jobs.
5. Restart compatible application services, reconcile current broker truth and
   preserved journal/risk state, and resume the already authorized demo only
   after acceptance checks pass. Confirm the dashboard and first durable cycle.

Administration commands use the configured protected environment, with no
database credentials in command arguments:

```sh
node scripts/storage-maintenance.mjs backup
node scripts/storage-maintenance.mjs verify --directory /absolute/backup-set
node scripts/storage-maintenance.mjs restore-check --directory /absolute/backup-set
node scripts/storage-maintenance.mjs compact-candles --directory /absolute/backup-set
node scripts/storage-maintenance.mjs export --directory /absolute/backup-set --recipient /absolute/recipient.asc --output /absolute/backup.tar.gpg
node scripts/install-storage-timers.mjs --prepare
node scripts/install-storage-timers.mjs
```

`restore-check` requires the isolated empty target's connection loaded into the
environment. Use a migration-role connection for migrations/compaction.
`--scope historical-recovery` labels rehearsal backups and never activates
retention/trading. Backup/export commands have no broker authority. The older
`backup-postgres.sh` wrapper now also keeps credentials out of process arguments,
but its standalone dump still needs a matching artifact set for full recovery.

## Rollback

Before local trading starts, retain the original protected environment/build/PM2
snapshot and hosted source. Do not drop 0023 or rewrite previous migration
checksums. The normalized reader remains compatible with legacy rows. If an old
candle-only reader must be restored, under maintenance reinsert missing legacy
rows from `decision_candles` with their original IDs, verify fingerprints, and
keep the newer dashboard for numeric/chart history. The reverse transition is
tested. Full paired backups remain the recovery authority.

After any new local trading, the hosted database is stale: rollback requires
transferring and reconciling newer local history before switching. Never point
execution at two independent writers or reset locks/claims to force resumption.

## Quality evidence

All 22 required checks passed: formatting/lint/types/build, **619 Node tests,
155 Python tests, 36 schema tests, three migration tests and five TLS integration
tests**, configuration policy/startup checks, replay/fail-closed exercises, secret
scanning and dependency audits. Python includes three isolated SQL storage tests.
Light/dark browser checks preserved form focus/caret and navigation across timed
updates; historical trade charts and local storage status remained visible.
The preview issued zero mutation requests. Graphify was updated without model
calls. Commands and exact results are in the
[validation record](evidence/local-storage-validation.json).
The source change is not considered a completed live cutover while the source
quota and newer-history gap remain unresolved.

The independent implementation delivery was rechecked on September 10: all 22
gates passed again. Scenario replay initially exercised its existing-output
refusal; rerunning with a fresh artifact succeeded without code changes or
overwriting earlier evidence. Exact commands, results and the initial rejection
are retained under `independent_delivery` in the validation record. The graph was
updated with AST extraction only. This delivery follow-up made no hosted-source
read, runtime database change, risk/accounting reset or trading restart.
