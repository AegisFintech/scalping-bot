# ISSUE-346: one landscape desk, lean configuration

The operator requested removal of sidebar, native top navigation, Trade history
and Diagnostics and a reference-based cleanup of unused code/settings. The only
page is now the real read-only landscape desk, edge to edge. It is served directly
by the existing FastAPI/Uvicorn stack: no Streamlit, sidebar, top navigation,
framework WebSocket or table/chart framework remains. The browser retains the
same DOM, animation, chart/log/follow/fullscreen state. Same-origin GET polling
uses one shared bounded single-flight background reader across clients, not one
broker/database poll per browser. No-store responses, strict static-asset allowlist
and no mutation routes preserve a read-only boundary. The unchanged sanitized
model supplies independent stale-value deadlines, safe text, completed candles,
scoped decisions and Decimal money. Motion remains decorative. Existing health
probes keep working via a compatibility GET route; process health never implies
trading/evidence readiness. PM2/source/systemd launch definitions use Uvicorn;
routine dashboard access logs are disabled to avoid per-poll log growth.

## Reference audit and deletion inventory

Graphify query and repository-wide import/reference searches identified these
retired presentation modules: `diagnostics.py`, `command_centre.py`, `charts.py`,
`storage_status.py` and the legacy decision-inspector presentation library.
Their only production callers were the removed pages/renderer. The strict
`open_position_monitor_view` contract is extracted unchanged to
`position_monitor.py`; its positive/rejection tests remain. Obsolete screen-only
chart/inspector/storage-display tests are removed with their features; core storage,
reconciliation, execution and analysis tests remain. Removed HTML-escape/open-money
helpers were exclusive to the old renderer; current sanitized model and frontend
XSS/independent P/L tests remain. Retired history SQL, two unused per-poll latest/activity queries and dataframe formatting
helpers are deleted. The remaining scalar timestamp formatter no longer imports
pandas. No optional-view argument or runpy dispatch remains.

Streamlit, Plotly and psutil are removed. Their now-unreachable resolved UI
dependencies are pruned using installed package metadata and environment/extra
markers from the exact direct requirements, including pandas, NumPy, PyArrow,
Altair and PyDeck. In total 21 resolved packages are removed; 60 required packages remain. The retained lock and installed package set match exactly and pass `pip check`, clean resolution and
security audit. No new runtime dependency is added. JSON Schema, used by research/worker schema tests, is retained as an explicit quality dependency instead of relying on the removed UI stack to supply it. The current desk uses the
existing FastAPI/Uvicorn/httpx/psycopg stack. No old framework import remains in
application/source/test launch definitions.

The first full qualification stopped at npm audit on newly reported launch-editor
advisories in the transitive development-only Vite 8.2.2 tree. `npm audit fix
--ignore-scripts` updates Vite to 8.3.4 and compatible development-only dependencies;
production Node dependency versions remain unchanged. The next run stopped at
Python audit: certifi needs 2026.10.19 and eight Pillow advisories require 13.0.0.
Streamlit's declared Pillow <13 constraint conflicts with that fix, including its
[latest available release](https://pypi.org/pypi/streamlit/1.66.0/json). Rather than ignoring the audit or forcing an incompatible
dependency set, the now-unnecessary framework is removed. Pillow 13.0.0 and certifi
2026.10.19 are pinned and tested. The local Python environment shrinks from about 610 MiB to about 220 MiB. The existing analytics image renderer remains
covered; historical PNG bytes are untouched. Sources: [Vite advisory](https://github.com/advisories/GHSA-r825-w8mm-5pxw),
[Pillow 13 release](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html),
[certifi release](https://pypi.org/project/certifi/2026.10.19/).

The rest of the repository is operational, contract history, active research,
regression/failure qualification, audit documentation, immutable migrations or
review/rollback material, rather than unused dashboard implementation. Research
CLI tools, legacy provider benchmarking/client contracts, historical prompt/schema
versions and prototypes remain callable/referenced evidence; removing them merely
because production currently uses a different provider would break that use.
No frozen source, deployed artifact, ledger, current record, registration or report
is deleted. Regenerable, unused host caches are cleaned separately for rollout headroom; they are not counted as source reduction. No current trading, broker evidence or frozen research directory is part of that cache cleanup.

## Configuration boundary

The normal template drops from 19 to 16 assignments: redundant `AI_MODEL` is already
fixed by `FIXED_DEFAULTS`, with mismatched legacy values still rejected. Optional
Better Stack token/host move to the deployment inventory, not hard-coded credentials.
Their active populated values remain untouched. Identity, broker/database/local
Codex credentials and explicit demo/mode/emergency/automation authorization remain
external. `DASHBOARD_CONTROL_TOKEN` still authenticates execution API controls even
though the read-only browser has no form. Backend emergency/pause endpoints and
all operational gates remain unchanged. Ports, prompt, model, scheduling, indicator
and risk policy already reside in reviewed versioned code.

The protected runtime file is reviewed separately from the normal template. Only
redundant model and obsolete legacy API/delivery/heartbeat assignments may be
removed after effective-default comparison and protected rollback preparation.
Retained values must match byte-for-byte/parsed-value equivalence. No credentials
are printed. Policy and startup checks run before and after. Running PM2 trading
processes retain their old cached environment until a separately reviewed restart;
removed unused credentials in memory are not claimed to be erased. Only the
new dashboard process reads the trimmed file. No pause, account reset, migration,
trading restart or new broker/provider command is needed for this display cleanup.

## Verification and rollout

Focused model, actual HTTP route/payload, scoped SQL, broker-monitor rejection
and Decimal fee-accounting tests pass. Multiple clients share one loader; shutdown
closes it, partial/unavailable evidence stays withheld, arbitrary files are not
served and browser mutation routes do not exist. Former screen-only tests are
removed with their feature; fee accounting now tests actual cumulative net rather
than asserting an obsolete pandas code string. Direct-browser checks cover zero
chrome and edge-to-edge desktop/mobile, stable chart/log/motion/DOM state, light
OS colour preference, actual fetch failure and automatic recovery. An isolated
synthetic XSS/event/expiry/fullscreen/reduced-motion suite preserves failure checks.
Earlier Streamlit preview evidence is superseded by the final direct-server check. A separate real-browser probe confirms CSS animation time continues advancing across repeated snapshot polls.
Private financial screenshots stay outside Git.

Full qualification passed at `/tmp/scalper-qualification-DsSgG9/checks/results.json`:
943 Node, 94 isolated PostgreSQL and 339 Python tests (1,376 total), with all
format/lint/types/build, JSON Schema/migration/fail-closed, secret-scan and npm/pip
audits passing. Explicit HTML/CSS/MJS formatting, `pip check`, exact installed-lock
comparison and sample/protected-file policy/startup checks pass. Final executable
source SHA is `d7ca4417ed2091e3a8c7d49085e9bf5be44a74ad622325bbda5b04a206ee6904`. AST-only graph update completed with the existing zero-node pyproject/community-name notices; the existing Starlette/httpx TestClient deprecation warning remains. Failed exploratory runs are not qualification: npm and Python audit failures led to the dependency fixes above, browser/lint fixes were retested, and the first integrated run after pruning identified the research-only JSON Schema dependency now retained explicitly.

The active protected environment was reduced from 26 to 19 assignments, with its
original bytes retained privately at mode 0600. Removed keys: `AI_MODEL`,
`AI_BASE_URL`, `AI_API_KEY`, `GH_USER`, `GH_REPO`, `GH_PAT`,
`BETTERSTACK_HEARTBEAT_URL`. Every retained parsed value is identical, the exact
model default is equal and `loadExecutionConfig` is deeply equal before/after.
Both protected-file checks pass after migration. No raw credential or private URL
is published. Trading processes retain their original environment/artifact;
only the new dashboard will read the trimmed file.
[Sanitized validation](evidence/lean-dashboard-validation.json).

Immutable artifact verification, hosted checks and dashboard-only deployment are
pending. Four trading PIDs/source, worker/observer and registration must remain
unchanged.

Rollback recreates only the previous dashboard344 artifact against current state.
If the trimmed environment must be reverted, restore its protected original bytes;
never restore an old database, alter a research registration, reset locks or replay
orders. Runtime deployment and final receipts will be recorded after checks.
