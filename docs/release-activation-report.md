# ISSUE-260: pinned demo release activation

Main PR #274 merged as `3817834`. The qualified source `61602fb` was prepared
exclusively at `/opt/ctrader-ai-scalper/releases/61602fb`, using the full
qualification report `/tmp/scalper-qualification-jOUCti/checks/results.json`.
Its manifest verified before launch and again after service startup/restart.
This is the operational follow-up to the source-only main integration report.

## Activation and checks

The private environment passed policy and startup checks: fade-limit.3, literal
Grok, 20 normal keys / 24 file keys, no obsolete keys. Its SHA-256 remained
unchanged across activation. No migration, accounting reset, baseline overwrite,
manual order cancellation, old-context replay or live enablement was requested.
Normal shutdown retains accepted GTC orders and broker-held protection.

The first PM2 `startOrReload` attempt restarted the old definitions while retaining
old cwd/executable paths. Post-start inspection caught this; online status alone
was not accepted. The five named services were stopped normally, their supervisor
entries removed and recreated from the verified explicit release configuration.
Only supervisor records were removed; journal, broker orders and financial state
were not deleted. Old PM2 restart counters remain documented in earlier reports;
new definition counters are not evidence that historical failures disappeared.

All five services now have the exact release cwd and `/opt/scalper-node22/bin/node`.
Python services use the copied environment through the release module launcher.
At October 5 06:02 UTC, analytics/AI/dashboard endpoints responded successfully;
execution reported demo fade-limit.3, startup checks passed, operational ready,
trading enabled and no reason codes. Session, quote and snapshot components were
independently HEALTHY. Private environment values and original checkout remain
unchanged. The original checkout is still clean at `984f479`.

A normal market-only restart was observed. Session and quote recovery succeeded;
snapshot remained UNKNOWN while no snapshot was requested. The initial drill
assertion requiring three HEALTHY components consequently did not pass within
its bounded window. This was an overly strict observation criterion, not a
production fault: UNKNOWN does not certify freshness, but the documented health
contract permits it when no failure has been observed. A separate bounded
read-only snapshot request (10 completed candles per timeframe, depth 5) then
returned HTTP 200; all three components became HEALTHY and execution remained
ready. No provider analysis or order was explicitly triggered by the drill.
Both original and follow-up evidence are retained privately, not overwritten.

PM2 saved the verified definitions after successful checks. Existing storage
maintenance/backup timers and the separate #255 research timer remain configured;
the frozen research checkout/registration/report history was not changed.
The #222 read-only observer retained deployment unavailability samples rather
than resetting its checkpoint. This finite startup/restart check does not prove
24 market-open hours, future outage recovery, economics or profitability.
Backup work remains deferred by operator; no restore success is claimed.

## Repeatable path change procedure

Review and verify the target release and protected environment first. When cwd
or executable paths change, stop the five named services normally, remove only
their PM2 definitions, and start the verified release configuration with explicit
`SCALPER_RELEASE_DIR`, `SCALPER_NODE_BINARY` and `SCALPER_ENV_FILE`. Preserve GTC,
state links and the original environment. Do not use reload as proof of a path
change; inspect actual cwd, executable, entry arguments and component health.
Save supervisor definitions only after checks pass. Never stop unrelated apps.

Rollback requires a reviewed matching prior definition, its pinned binaries and
fresh broker/state reconciliation; never restore an older accounting database,
replay commands or reset losses. The original checkout remains available as
historical source evidence, not an automatically verified rollback release.

## Qualification and evidence

No executable source changed in this receipt. Full source qualification passed
824 Node / 70 disposable TLS database / 261 Python tests, no skips, clean audits;
format/lint/types/build/schema/migration/replay/fail-closed/secret checks passed.
Hosted main PR checks: runs 37269566030 and 37269563140 both passed. Actual
bundle preparation, supervisor verification, normal startup, market restart,
bounded snapshot and post-start manifest checks passed as described above.
Private operational evidence: `/tmp/scalper-260-predeploy.json`,
`/tmp/scalper-260-market-restart-evidence.json`, and
`/tmp/scalper-260-post-restart-snapshot.json`. The first drill's failed criterion
remains explicit. Continuing unattended qualification is tracked in #222;
prospective economic collection remains #255/#262.
