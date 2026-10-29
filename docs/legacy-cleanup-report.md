# Approved legacy-data cleanup — #440

On 29 October 2026 the operator explicitly approved deleting the four previously
identified legacy Docker volumes and unnecessary files. This extends the
[earlier server cleanup](server-cleanup-report.md), retaining its dependency and
historical-evidence boundaries.

## Result

Available space increased from **4,713,398,272** to **9,326,706,688 bytes**:
**4,613,308,416 bytes (4.30 GiB) net**, measured at 06:03:23 UTC. The filesystem
was 91% full before cleanup and 82% afterward. Measurements include concurrent
normal writes; allocated directory sizes are not additive reclaimable estimates.
[Sanitized receipt](evidence/legacy-cleanup-440.json).

All five demo processes retained their original PIDs and qualified release.
Startup/account readiness remained true, pause false and reason codes empty.
Four protected environment/manifest files matched their prior hashes. The deployed
artifact passed RELEASE_VERIFIED; Codex worker and Flight remained active. Cleanup
issued no broker/provider commands and did not restart the bot, change strategy
or reset accounting. Ordinary bot activity continued independently.

## Removed

- The four specifically authorized Docker volumes: `aiquanttrader-grafana-data`,
  `aiquanttrader-native-data`, `aiquanttrader-native-state` and
  `aiquanttrader-prometheus-data`. Docker had no containers/images; no host process
  held their data paths. Named `docker volume rm` succeeded without force, leaving
  zero Docker volumes. Their legacy contents are permanently deleted; no new
  backup was created.
- 40 reproducible mypy/pytest/Ruff cache directories in development worktrees.
- 105 generated qualification build directories; their check logs/results remain.
- One pip download cache and three duplicate Graphify outputs in completed
  temporary recovery worktrees. Primary/current graphs and source remain.
- Two isolated temporary test database directories. One PostgreSQL process had
  been orphaned for ten days: its exact temporary data directory/test role were
  verified, no other client connections or unexpected databases existed, and
  `pg_ctl -m smart -w stop` completed before removal. The live PostgreSQL cluster
  was untouched. Test qualification logs were retained.
- 114 known safety-test fixture/empty qualification directories. Nonempty safety
  fixtures had to match the exact test instance/account placeholder and expiry;
  arbitrary files were not treated as fixtures.

The 151 disposable directories accounted for 964,718,592 allocated bytes before
removal. Each candidate was checked for symlinks and current process references;
tracked files were excluded from development-cache/Graphify deletion. The active
`/tmp/pytest-of-root` directory was explicitly retained.

## Preserved and research verification

Current and historical trading databases, financial/account/order records,
provider history, secrets, original recovery proof/receipts, frozen registrations,
research reports, qualification logs, deployment/rollback artifacts and source
worktrees remain. Installed browser/Node/Python/Graphify dependencies, current and
fallback Codex versions and other projects' backup/data directories remain. No
source module was deleted without a demonstrated absence of consumers. Routine
log rotation continues under the existing seven-day policy.

The research disk-reserve threshold is now satisfied. The next **normal scheduled**
fast-exit job ran at 06:00:19–06:00:41 UTC and exited 0; it was not forced or retargeted.
The separate entry-study job still reports ENTRY_OBSERVER_RUNNING_SOURCE_DRIFT,
as expected for its frozen release. That is an explicit research halt, not a bot
outage or permission to change its registration. This resolves the identified
#430 disk dependency while preserving the frozen-study limitation. Continuous
current-release monitoring qualification remains in #431.

## Verification and delivery

Private before/after snapshots, exact removal manifests and preserved test logs
remain under `.runtime/cleanup-440`. Reported paths/receipts contain no credentials,
account identities or broker payloads. Documentation-only source delivery uses
the existing qualified source fingerprint: 1,271 Node +147 isolated PostgreSQL
+670 Python tests (2,088 total). Formatting, secret scan and unchanged-source
checks passed before commit; independent review and exact-head hosted checks
precede merge. Runtime integrity, stable processes and the natural research run
are the operational checks; profitability was not evaluated.

The first read-only test-cluster connection used the default database role and
was rejected; inspection succeeded with the documented qualification role. No
production database connection or state change was involved.

Deleted legacy data has no rollback from this task. Development caches/builds can
be regenerated from retained source and lockfiles; old runtime state must never
be reactivated to undo cleanup.
