# ISSUE-255 — Prospective conditional research observer

Issue: https://github.com/AegisFintech/scalping-bot/issues/255.
Depends on ISSUE-253 / ISSUE-249. This is a research observer, not a strategy
rollout or a claim that the bot has improved economically.

## Operating boundary

The observer reuses the existing read-only demo exporters and conditional sampled
path engine. It has no broker client, model request, order command, trading pause,
parameter tuner or automatic promotion. The demo analysis/place/manage/repeat
cycle, shared 1% current-equity ceiling, GTC orders and protections are unchanged.
Only a separate research timer/service is added; trading services are not restarted.

The observer records and compares the already defined candidates: approved entry
prices versus preserved model levels, and original TP versus factors 0.75 / 1.25.
Entry and TP experiments stay separate, with the existing base/stress execution
assumptions. No new inference is required. This is **prospectively registered
conditional replay**, not simultaneous broker fills or a counterfactual portfolio.

## Frozen collection protocol

`python/backtest/forward.py register` exclusively creates a private registration
before its start (within the next 24 hours). It fixes 30 consecutive 24-hour
windows, candidate names, release, source fingerprint and a ten-minute reporting
delay. The code fingerprint covers the runner, paired engine, quote primitives,
exporters, financial parsing, policy/prompt, contracts and dependency lock files.
The Python shared types and JSON Schemas document registration and report envelopes.
No SQL migration, runtime strategy key or populated environment edit is needed.

Thirty days is a bounded collection batch, **not sufficient strategy validation**
or a substitute for multi-year evidence. There is no fitted model, claimed 90%
accuracy, profitability guarantee or automatic promotion at the end. Outputs
always retain `HOLD` and null counterfactual net P/L. A future collection batch
requires a new registration; never backdate or edit the existing one.

The hourly timer processes at most one completed window per invocation. It waits
until the frozen cutoff plus ten minutes, then takes two separate bounded
read-only database snapshots: intent creation cohort and actual close-time
cohort. These cohorts are different and not claimed to be one atomic snapshot.
Zero observed intents are a valid empty result, not a broker-health assertion;
multiple account/symbol scopes, oversized exports and inconsistent zero scopes
reject. Intents with incomplete evidence remain explicitly excluded in replay.

Each private daily envelope contains the frozen input, actual closed-trade review,
all replay outcomes/limitations, tape digest, registration digest and body checksum.
Successful reports are flushed, atomically published without overwrite, and
verified on restart. An OS lock prevents concurrent manual/timer runs. Errors
publish no completed report; the next hourly invocation retries the same window.
Source drift, corrupt reports and disk-reserve failures stop research only and
emit safe error codes. Unknown broker commands are never retried by this tool.

## Evidence limits that remain

- The existing recorder is sampled quotes, not a complete tick tape. The observer
  uses verified rolling and pinned archive segments; it does not increase sampling,
  repair gaps or retrospectively invent dispatch quotes. Missing paths, ambiguous
  OCO races and already-crossed sampled entry quotes remain censored.
- Daily cutoffs censor open/pending research paths. They do **not** close real
  positions, expire GTC orders or create a new trade. Cross-window carry is not
  simulated; do not add daily gross subsets into an executable portfolio return.
- Actual reconciled commissions, financing and conversion are reported only for
  recorded closed trades. Counterfactual commissions/swap/FX/margin and provider
  costs remain unavailable. The old observed quantities are frozen, not dynamically
  resized after a hypothetical equity path.
- Late journal evidence after a successful export is not folded into that report.
  Ten minutes is a reporting delay, not proof that reconciliation has completed.
  A separately labelled later reconciliation audit may compare retained evidence;
  never overwrite the first report or silently replace its denominator.
- The fixed source release is the only included cohort. Another runtime release
  must not be silently pooled with it. Source fingerprints detect covered file
  changes, not external provider/broker identity or every deployed dependency.
- Gross complete-pair deltas are selected subsets, not after-cost superiority.
  The observer cannot establish a winning update until those limitations are
  resolved with independent evidence and a reviewed economic release.

## Resources, retention and operation

The Debian oneshot service limits CPU to 50% of one core, memory to 2 GiB with
no swap, elapsed time to ten minutes, file size to 32 MiB and tasks to 32. It uses
low CPU/IO priority, no new privileges, read-only system paths and a single
writable research directory. Export children have 60-second deadlines; existing
SQL statement timeouts, 1,000-intent/8 MB export and replay tape limits remain.
It refuses work below the larger of 2 GiB or 15% free disk. Research failure or
OOM cannot set a trading gate. Shared CPU/DB/storage contention is still possible;
these bounds reduce it, not eliminate it.

Reports are retained under ignored `.runtime/forward-study-255`, mode 0700 with
0600 files. There is no automatic evidence deletion. At most 30 reports of 32 MB
can be published per registration. An interrupted temporary file may remain and
must not be treated as a completed report. Original journal and pinned market
evidence stay governed by existing storage/backup policy; these new research
envelopes are **not yet included in the database-linked backup manifest**. Keep
an approved off-host copy separately if durable disaster recovery is required.

Register once, then use the same directory (do not regenerate it each hour):

```sh
npm run strategy:forward -- register --directory .runtime/forward-study-255 --start FUTURE_UTC_TIMESTAMP
npm run strategy:forward -- run --directory .runtime/forward-study-255
```

The checked-in service files target this host's `/root/scalping-bot` and Node 22
installation. Registration must exist before installation. Enable only the new
research timer; it has no dependency that starts/stops a trading service.
Inspect `systemctl status scalper-research-forward.timer` and sanitized
`journalctl -u scalper-research-forward.service` for reporting status. Do not
interpret a waiting observer as proof that trading/provider/broker connectivity
is healthy.

Rollback: disable/stop `scalper-research-forward.timer` and, if needed, its research
oneshot. Preserve registrations/reports; do not stop trading, cancel orders,
change `.env`, reset accounting or remove database history.

## Qualification and activation

Registered **October 2, 2026 at 03:10:49.700 UTC**, before the fixed collection
window **October 2 04:00 UTC through November 1 04:00 UTC**. The
[committed registration](evidence/forward-study-255.json) exactly matches the
private runtime copy. Registration digest:
`728f121460868714b773b369ca31cc63551ca1023572c41c1d9a71f8953e9d8f`.
No future observation was used to choose these candidates or dates.

Installed only the two new research units and enabled their timer. The actual
sandboxed oneshot exited **0 / success**, reported `WAITING_FOR_WINDOW`, and
verified zero completed windows. First report is eligible October 3 at 04:10 UTC;
the hourly schedule should execute around **October 3 12:15 SGT**, plus up to
30 seconds jitter and processing time. The timer is active; there are **no forward
results yet**. No `.env`, active trading build, provider call, broker command,
trading restart or financial row was changed.

Historical plumbing smoke: October 1 00:00 UTC through October 2 00:00 UTC,
**10 intents / 10 valid**, **320,836 quotes / 277 segments**, `HOLD`. Tape digest:
`67c0e347ecb2e1c3b571fafbf7daabe22ca582fb9129e6b10f4be9ff5fe892a8`.
Private artifact: `/tmp/issue255-historical-smoke.json`. This only verifies the
existing exporter/replay/fee-review pipeline; it is not forward evidence or a
new economic recommendation. A separate transient read-only systemd export
preflight also exercises Node/SQL access under the filesystem sandbox.
It passed with 10 exported intents, 2.546 seconds elapsed and 73 MB peak memory.

Validation commands and results (Node 22.23.2):

- `node node_modules/vitest/vitest.mjs run --exclude '**/*.integration.test.ts'`:
  **785 passed, 98 files**, including schema, migration and fail-closed suites.
  Changed export/schema suites rerun: **11 passed**.
- `.venv/bin/pytest tests/python -q`: **247 passed, 3 skipped** (isolated storage
  DB unavailable). Forward suite **28 passed**, including concurrency, restart,
  no premature reads, invalid registration, source drift during collection,
  disk reserve, safe timeout/error codes, exclusive publication and no authority.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`,
  `node node_modules/eslint/bin/eslint.js .`, `.venv/bin/ruff check python
apps/dashboard tests/python`, `.venv/bin/mypy python apps/dashboard`: passed.
  Isolated `tsc -p tsconfig.build.json --outDir /tmp/issue255-build.*`: passed;
  the running `dist/` was not overwritten. Initial test-only unsafe-member lint
  finding corrected and rechecked.
- Changed-file Prettier / Ruff formatting and `git diff --check`: passed.
  Full Prettier still reports the same five unrelated baseline files; full Ruff
  format still reports the existing dashboard difference. Neither was suppressed.
- `vitest run tests/integration --passWithNoTests`: **1 passed / 69 skipped**;
  no isolated `TEST_DATABASE_URL`. Legacy Python replay fixture exits 0 with
  `ANALYSIS_CHART_RENDER_FAILED`, not a positive chart-render validation.
- `systemd-analyze verify` for both units: passed. Actual service reports
  `CPUQuotaPerSecUSec=500ms`, `MemoryMax=2147483648`, and only the registered
  study directory writable under system protection.
- `bash scripts/secret-scan.sh`: existing nine risk-budget filename false positives;
  no credentials introduced or scanner bypass. `npm audit --audit-level=high`:
  existing three high findings (brace-expansion, fast-uri, fastify).
  `.venv/bin/pip-audit -r requirements.lock`: three existing urllib3 2.7.0
  advisories. Dependencies unchanged. An initial nonexistent Node-specific npm
  CLI path was corrected to `/usr/lib/node_modules/npm/bin/npm-cli.js` for audit.
- `graphify update .`: AST refresh, 4,746 nodes / 9,509 edges; known empty
  `pyproject.toml` warning. No semantic-document refresh claimed.

Logs: `/tmp/issue255-*`. Unrelated global qualification failures and skipped
integration prevent a qualified merge: the stacked source PR remains draft,
without auto-merge or strategy rollout. The separately authorized, bounded
read-only research observer is enabled; this is not a claim that all repository
gates or trading services are healthy.
