# ISSUE-286 — Remove unused recall code

Issue: https://github.com/AegisFintech/scalping-bot/issues/286.
Depends on the GTC operating fix #283 / merged #284 and activation receipt #285.
The operator requested removal of unused code after the persistence correction.

Graphify query and repository reference searches verified that only the retired
helper tests invoked `OrderMaintenance.recallStaleBrackets`. The operating worker
already stopped supplying recall options and calling this method in #283. Current
source now removes the method, constructor option/private field and inactive
`bracketRecallBars` policy field. The unused `RELEASES`, `ReleaseKey` and
`releasePolicy` exports also have no consumers and are removed. The live-used
STOP/fade/v3 constants remain unchanged in their consumed values.

Three obsolete tests of the removed API are retired. Current maintenance tests
remain: GTC preservation, historical GTD expiry, exact owned OCO/terminal-peer
cleanup, emergency cancellation, uncertainty/failure behavior and recovery refresh.
The four operating-loop regressions deliberately retain a fake forbidden recall
method as a tripwire; that is test instrumentation, not unused cancellation code.
No new test merely mirrors the deletion; existing behavior tests and type checks
validate the remaining paths.

Archived implementation reports and their numeric evidence retain their original
checkpoint descriptions. In particular the #283 report accurately describes the
source at that delivery, when the disconnected legacy helper was still retained.
This later cleanup removes it from current main; prior Git revisions still retain
its implementation/tests. No historical journal, SQL migration/checksum, schema,
strategy economics, risk percentage, broker precision or command authority changes.

Cleanup occurs only in the isolated development worktree. The original clean
`984f479` observer checkout, frozen registration/candidates/reports and the deployed
immutable artifacts stay untouched. No service restart, broker/provider/control
command or private environment/accounting change is needed to remove unused source.
The running worker already uses the corrected GTC path; this patch is source cleanup.

## Validation

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passes all gates:
848 Node tests, 70 isolated TLS PostgreSQL lifecycle tests and 261 Python tests,
no skips; formatting, lint, TypeScript/Python types, isolated build,
schema/migration/replay/fail-closed checks, secret scan and both dependency audits.
Fourteen focused current-maintenance tests also pass. The Node total is three lower
because the retired recall API's three tests were deleted; safety tests remain.

Exact commands/results: [validation receipt](evidence/unused-recall-validation.json).
Private evidence: `/tmp/scalper-qualification-2HVq95/checks`; source SHA-256
`10d7077cba3c46ec86ea16286688d4e8996335c7162a3b5a7d62873539cfb59e`. The initial qualifier could not fingerprint the unstaged
deleted test file; staging its removal allowed full qualification. No check was
skipped or disabled, and this occurred before database startup.

`graphify update .` succeeds: 5,470 nodes / 10,481 edges, with the existing empty
pyproject warning. Repository searches find no recall method/option/constant or
unused registry/lookup in apps/packages/scripts; only the deliberate fake recall
tripwire remains in current tests. No wildcard/dynamic policy consumers were found.
Staged diff review and secret scan precede commit; full current-head hosted checks
must pass before merge.
