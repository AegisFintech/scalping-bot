# ISSUE-073: readable dashboard and background updates

Issue: [#176](https://github.com/AegisFintech/scalping-bot/issues/176).
Branch: `issue-073-dashboard-background-refresh`; baseline: merged PR #175.

## Problem and implementation

The previous dashboard forced light metric/sidebar backgrounds while text could
follow the browser's dark theme. Its ten-second fragment included the title,
navigation and all view content; sequential HTTP/database reads ran on the
rendering thread. Diagnostics recovery could also trigger a whole-app rerun.

Metric surfaces now derive from inherited theme colors; labels and values retain
full text contrast. The emergency button uses a darker red with white text, and
history charts use Streamlit's theme rather than a forced white Plotly template.
Both light and dark themes are supported without a new operator setting.

Overview/history snapshots use a read-only background worker per view. Only one
request per reader can be in flight, and new reads are admitted every ten seconds
while a view is being polled. HTTP and SQL retain their timeouts. SQL uses one
connection per snapshot, exact account/symbol/mode bind parameters, and a read-only
transaction. An unavailable/ambiguous account or partial query failure publishes
no financial/exposure snapshot. Workers never invoke Streamlit or a control/order
endpoint. Account identifiers are not included in the presentation fields.

Two-second fragments collect ready results without waiting for IO. Navigation,
title and authenticated forms are outside the timer; stable element keys and
Plotly `uirevision` preserve interactive state in the live sections. Fragment
elements are emitted on every tick: an initial browser test caught that omitting
an unchanged element lets Streamlit remove it. There is no browser reload or
automatic whole-app rerun. This is background IO with partial rendering, not a
claim that Streamlit sends no rendering updates.

Fresh data can remain displayed during an in-flight read, for at most 30 seconds
from the previous observation's start. Failed reads discard it; stale or late
completions cannot become fresh merely because they were collected later. The
existing financial timestamp rules also remain in force. Missing current capital
telemetry on the older execution release remains explicitly unavailable.

Diagnostics are stable inspection snapshots. Recovery checks update a small
notice in the background; a complete inspection reload happens only after the
user presses **Reload diagnostic snapshot** or changes their selection. Pause
and emergency authorization and execution behavior are unchanged.

The implementation follows the installed Streamlit 1.62 API and its official
[fragment lifecycle documentation](https://docs.streamlit.io/develop/api-reference/execution-flow/st.fragment)
and [threading guidance](https://docs.streamlit.io/develop/concepts/design/multithreading).
Worker code does not attach a Streamlit session context. No dependency upgrade
or execution-service change is required.

## Verification

Full repository checks passed on Node 22.23.2 and Python 3.13.5: **335 Node
tests, 116 Python tests, 19 schema tests, 3 static migration tests and all 3
configured isolated-database integration tests**. Formatting/lint/types/build,
secret scanning, replay/backtest fixtures and both dependency audits passed.
The first full Python run caught the existing fee-accounting source guard still
looking in `app.py` after SQL moved to `snapshot.py`. The guard now checks both
files and still enforces fee-inclusive P&L; the complete Python suite then passed.

New tests prove nonblocking reads under a deliberately blocked worker, no
overlapping requests, failure redaction/recovery, stale-value withholding, late
completions retaining their original age, exact account/symbol/mode binds,
rejection of ambiguous identities, and no partial financial snapshot after a
database failure. The existing rendered authorization test remains passing.

Chromium checked light and dark modes across two completed background observations
per overview and a further history update. In both themes, title/navigation DOM
nodes, form text, focus and cursor position persisted; all four metrics stayed
visible at every 200 ms sample. The history chart and navigation DOM nodes remained
mounted across polling, with zero browser exceptions. No control was submitted.
Raw browser evidence is ignored under `artifacts/dashboard-refresh/`. An additional animation-frame
sample kept all four metrics visible in all 667 frames. Final screenshot checks
measured these foreground/background contrast ratios:

| Theme | Metric text | Captions | Emergency button |
| ----- | ----------- | -------- | ---------------- |
| Light | 11.47:1     | 12.53:1  | 6.57:1           |
| Dark  | 16.19:1     | 18.11:1  | 6.57:1           |

[Light overview](images/dashboard-overview.png) · [Dark overview](images/dashboard-overview-dark.png) · [Light history](images/dashboard-history.png) · [Dark history](images/dashboard-history-dark.png).

The source checkpoint uses an isolated local preview on port 18501 against existing
read-only demo state. After merge, activation is limited to restarting
`scalper-dashboard` and checking the rendered page; execution, market-data, AI and
analytics processes must retain their PIDs. Trading-service rollout and the
existing missing equity floor remain separate from this UI task.

Screenshots show the existing demo deployment; they are operational presentation
evidence, not live trading results or a profitability claim.

## Rollback

Restore the previous dashboard source and restart only `scalper-dashboard` (or the
dashboard systemd unit). Do not restart execution, change trading authorization,
apply database migrations or restore the old populated environment for a UI rollback.

## Exact quality-gate commands

Raw logs are ignored under `artifacts/dashboard-refresh/gates/`. The configured
integration command passes the existing connection through a child environment
and does not print it or migrate deployment.

| Command                                                                                                                                                                                                                                                                      | Result                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `node --version`                                                                                                                                                                                                                                                             | Passed                                               |
| `npm run format:check`                                                                                                                                                                                                                                                       | Passed                                               |
| `npm run lint`                                                                                                                                                                                                                                                               | Passed                                               |
| `npm run typecheck`                                                                                                                                                                                                                                                          | Passed                                               |
| `npm run build`                                                                                                                                                                                                                                                              | Passed                                               |
| `npm test`                                                                                                                                                                                                                                                                   | Passed                                               |
| `npm run test:schemas`                                                                                                                                                                                                                                                       | Passed                                               |
| `npm run test:migrations`                                                                                                                                                                                                                                                    | Passed                                               |
| `node --input-type=module -e "import 'dotenv/config'; import {spawnSync} from 'node:child_process'; const r=spawnSync('npm',['run','test:integration'],{env:{...process.env,TEST_DATABASE_URL:process.env.DATABASE_URL},stdio:'inherit'}); process.exitCode=r.status ?? 1;"` | Passed                                               |
| `.venv/bin/ruff format --check python apps/dashboard tests/python`                                                                                                                                                                                                           | Passed                                               |
| `.venv/bin/ruff check python apps/dashboard tests/python`                                                                                                                                                                                                                    | Passed                                               |
| `.venv/bin/mypy python apps/dashboard`                                                                                                                                                                                                                                       | Passed                                               |
| `.venv/bin/pytest -q`                                                                                                                                                                                                                                                        | Passed after updating the moved SQL guard; 116 tests |
| `npm run config:check -- .env.sample --startup`                                                                                                                                                                                                                              | Passed                                               |
| `npm run config:check -- .env`                                                                                                                                                                                                                                               | Passed                                               |
| `bash scripts/secret-scan.sh`                                                                                                                                                                                                                                                | Passed                                               |
| `npm audit --audit-level=high`                                                                                                                                                                                                                                               | Passed                                               |
| `.venv/bin/pip-audit -r requirements.lock`                                                                                                                                                                                                                                   | Passed                                               |
| `.venv/bin/python -m python.replay.cli --input tests/fixtures/replay/analytics-requests.jsonl`                                                                                                                                                                               | Passed; fixture only                                 |
| `.venv/bin/python -m python.backtest.cli --input tests/fixtures/backtest/oco-scenario.json --output artifacts/dashboard-refresh/backtest-smoke.json`                                                                                                                         | Passed; fixture only                                 |
