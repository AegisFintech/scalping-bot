# September 24 session failure recurrence

## Evidence and limits

Execution's port 8080 was unavailable and PM2 reported more than 9,500 restarts.
Repeated startup stacks point to the unconditional initial session read in
execution main, returning MARKET_SESSION_UNAVAILABLE:503. The market process
continued recording fresh quotes and advertised ready, while its session
endpoint returned 503. Restarting only market data restored session discovery
and execution started automatically. Initial restored execution status still
reported RECONCILIATION_UNCERTAIN; recovery is not proof of order admission.

The old market process did not retain the original broker error. The September
21 rate-limit observation is NOT evidence of the September 24 trigger. Possible
connection/authentication failures cannot be distinguished retrospectively.
Earlier claims that rate limiting was the confirmed cause and that the permanent
fix was complete were unsupported.

## Confirmed code defects

1. Startup awaited a session read without recovery; PM2 repeatedly launched new
   processes when that dependency was unavailable.
2. Request admission updated its next slot after sleeping. Concurrent callers
   could sleep on the same slot and all send together. The previous backoff
   patch retained this race and its tests only checked error classification.
3. A price stream did not prove session requests worked. There was no independent
   session-health probe capable of recovering the read-only market connection.
4. Previous changes were built into the shared dist directory while old processes
   remained running. Later process restarts could load different code. A build
   in this deployment is not an isolated artifact; coordinated release handling
   remains an operational follow-up.

## Changes

Admission now serializes spacing across concurrent callers with 25ms regular and
210ms historical spacing. Active broker cooldown rejects locally, including a
second check after waiting, without replaying broker commands.

Initial execution session reads retry inside one process with 1–30 second
backoff and SIGTERM/SIGINT cancellation. They cannot authorize orders without a
successful validated session response.

The market-data-only client probes session discovery every 30 seconds. Three
failures trigger disconnect/re-authentication with 60–300 second reconnect
backoff. Concurrent probes are deduplicated. Only a later successful probe proves
recovery. Disconnect clears quotes, books and subscription markers so restored
reads must obtain new broker events. Shutdown drains any active probe.

This does not promise broker failures cannot occur. It prevents two reproduced
local failure patterns and adds bounded recovery for a failed market connection.
The first original rejection remains unknown and subsequent broker diagnostics
must be retained before assigning a cause. Existing financial history is intact.

## Validation

Targeted regression tests cover ten concurrent regular/historical requests,
repeated startup failures through the backoff cap, shutdown cancellation,
three-failure recovery, reconnect backoff, probe deduplication and failed
reconnection.

- `npm test`: 756 tests passed across 92 files.
- Targeted post-readiness-change rerun: 15 tests passed.
- `npm run build`, `npm run typecheck`: passed.
- ESLint on changed files: passed; full lint initially identified async fixture
  style errors, corrected and checked on those files.
- `python -m pytest tests/python -q`: 187 passed, three database tests skipped.
- `npm run test:integration`: one passed, 69 skipped (isolated services/database
  not configured); these are not claimed as qualified integration coverage.
- Ruff lint and mypy passed. Ruff formatting reports an existing unrelated
  `apps/dashboard/app.py` formatting issue; left untouched.
- Changed TypeScript Prettier check passed; npm production audit: zero findings.
- Graphify refreshed (4,275 nodes, 8,742 edges); existing pyproject.toml empty
  extraction warning persists.

The demo market/execution processes were restarted together at approximately
03:55 UTC September 24 using the verified build. Post-start observation is pending.
No migration, financial reset, order cancellation or live activation was issued.

## Secondary downtime consequence

The latest stored daily baseline is September 23 UTC. After downtime crossed
midnight, the September 24 baseline was missing. `DailyRiskStore.reconcile`
rejects a late baseline without explicit reconciled initialization; the prior
status exposed only RECONCILIATION_UNCERTAIN. The safe daily-risk reason is now
included in status. This is not a demo loss lockout and must not be bypassed.
The existing initializer requires emergency stop, disabled submissions, two
broker account/cash-flow/history reads proving no trading activity, and an
audited initialization. It refuses to overwrite an existing daily baseline.
That separate accounting transition has not been executed in this patch.

Additional checks: 56 schema and three migration tests passed. Python dependency
audit passed with no known vulnerabilities. Readiness tests were rerun after
the new session-failure readiness behavior. Startup logs observed two bounded
waits (one and two seconds) followed by successful service availability, without
another crash. Full trading restoration is still blocked by daily accounting.

Repository secret scan flags existing `risk-budget` document-name false
positives. Staged changes were separately inspected and scanned; no new
credential patterns were detected. These existing scan/format failures and
skipped integration tests prevent claiming all repository gates are green.

Final observed status: session OPEN, automation RUNNING, trading disabled with
DAILY_RISK_BASELINE_UNAVAILABLE and RECONCILIATION_UNCERTAIN. The missing daily
baseline is now explicitly confirmed by runtime, not merely inferred from SQL.
Graphify final refresh: 4,276 nodes / 8,744 edges. Delivery: PR #246,
implementation commit 041ffe2. No successful new trade is claimed.
