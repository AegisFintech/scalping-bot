# ISSUE-344 — Live animated landscape command centre

Issue: https://github.com/AegisFintech/scalping-bot/issues/344.
PR: https://github.com/AegisFintech/scalping-bot/pull/345.
The operator approved the #342/#343 prototype and explicitly requested connecting
and deploying that design. This release replaces Overview's report layout with
the full-width animated desk. Qualification and rollout receipts follow below.

## What changes

A native Streamlit v2 component hosts the approved layout with isolated styles.
It keeps the same DOM across two-second fragment updates: the bot core keeps
animating, M1/M5/M15 choice and motion preferences persist, and scrolling the tape
up pauses follow without incoming events pulling the reader away. Reduced motion
is respected. Native Overview / Trade history / Diagnostics navigation and the
existing authenticated/audited operator form remain outside the fragment. No
browser/worker creates a trading command; browser verification never submits a
control. Fullscreen exits via its button or Escape before using native controls.

All simulated scenes, candles, values and timed event generators stay in the
separate immutable design prototype. Production assets contain no simulator or
fixture fallback. The UI now reads the existing status, sanitized broker position
monitor and scoped database snapshot. One background reader refreshes Overview
every two seconds, allows only one in-flight load and keeps bounded timeouts;
workers never call Streamlit. No market/provider endpoint or extra broker command
was added. Missing current quotes are unavailable, including when no fresh book
or position-monitor quote exists. Historical decision candles are not a live feed.

Recorded context factors, deterministic validation and modeled leg allocations
are distinct from AI reasoning. Codex supplies two prices; narrative reasoning,
confidence, exact holding-box edges, news and consolidated order flow remain
unavailable. The chart distinguishes model breakout levels, intended order
SL/TP and fresh broker protection. The corridor is buffered entry geometry,
not an exact returned holding box. Download/process stages have no invented
timers or percentage completion. The active highlight follows observed state,
including protective maintenance while analysis is paused.

The tape performs four bounded reads, each scoped to the same account/symbol/mode:
12 contexts, 24 execution checks, 32 broker messages and 16 closed outcomes. Context
request time is labelled a durable local claim, never provider receipt. Availability
and failure use their recorded times. Broker rows use receipt time and separately
show broker time; order submission time is not used as broker acceptance. Close
cause is never inferred from net P/L. Raw payloads and identifiers are removed;
only bounded safe reason codes and whitelisted lifecycle states reach the view.
Opaque row hashes and source times provide deterministic deduplication/order.
Mutable journal tables only expose the retained latest transitions, not a complete
lifecycle tape. Late arrivals are sorted, the browser keeps at most 160 rows,
repeated polls append nothing, and bounded-window/gap limitations stay visible.

Money is formatted and cumulative net is summed with Decimal before the plotting
boundary. Positive/negative amounts retain signs. Closed net includes signed fees;
future closing costs stay unknown. UTC-day accounting requires the current UTC
day. P/L, current quotes, current spread, broker protection and session each keep
their independent evidence deadlines. The browser checks deadlines every second,
so a lost connection cannot leave a green P/L, a verified SL/TP or an open-session
badge appearing fresh. A whole snapshot ages out after 30 seconds, at which point
current values/exposure/stages are withheld. Past tape rows remain historical.
The curve covers the latest 300 scoped closed outcomes across releases; it is
not account equity, a return series or evidence of release profitability.

The risk display now recognizes the existing reviewed `0.4.0-breakout-scalp.1`
policy shape and its explicit demo loss-limit enforcement flag. It still requires
fresh reconciled equity/capital, shares at most 1% across both race-exposed legs,
and rejects unknown/mismatched policy modes. This fixes presentation of the
current policy; sizing/admission/strategy constants are unchanged. Unavailable
capital evidence remains unavailable rather than manufacturing a budget.

## Integrity and rollout boundary

Qualification source fingerprints now include runtime HTML/CSS alongside JS/Python;
changing a panel asset after qualification invalidates its source binding.
Documentation/prototypes remain excluded. Immutable release tree verification
continues to pin all artifact bytes and reject unsupported external links.
A failure test covers HTML/CSS source changes and documentation exclusion.

No API/DB journal schema, migration, credential, strategy, prompt, order management,
risk engine, historical trade or prospective registration change. The old trading
artifact, Codex worker and observers remain fixed. A new immutable artifact will
be verified and selected for `scalper-dashboard` alone with the existing protected
environment. Recreate that one PM2 process to avoid cached working-directory
configuration; save PM2 only after checking the selected path. The four trading
service PIDs/paths and registration must match the before receipt. Rollback
recreates the previous dashboard against the current database, without restoring
old risk/history or restarting trading.

## Verification

Focused tests cover Decimal net and price precision, failed/cold/stale/future
snapshots, wrong UTC day, independent broker quote/P&L/protection deadlines,
invalid/forming/duplicate candles, null/future outcomes (whole curve withheld),
scoped bounded reads, safe event identities/codes/receipt times, unresolved broker
mapping and the current risk display's dynamic budget/mode failure. Existing
unauthorized-control/outage AppTests now inspect the native component's actual
payload, not removed metric widgets. Browser checks use existing installed
Playwright; no runtime dependency is added.

```sh
PLAYWRIGHT_MODULE_PATH=/path/to/installed/playwright \
PLAYWRIGHT_CHROMIUM_PATH=/path/to/installed/chromium \
node scripts/check-landscape-live.mjs http://127.0.0.1:8600 /tmp/private-ui-evidence
```

The script only accepts loopback and refuses screenshots inside the repository.
Private screenshot directories/files use 0700/0600. Real preview tests cover
1920×1080, 1440×900, 1280×720 and 390×844, next-action visibility, stable component
identity/chart/motion/follow across ticks, unsubmitted control values, red/white
emergency-button contrast, all views and zero browser exceptions. An isolated
synthetic frontend harness additionally verifies text injection rejection,
deduplication/late ordering/bounded retention, partial payload rejection,
independent and disconnected-client expiry, reduced motion and fullscreen.
The harness never calls an external endpoint or claims fixture trading results.
Full completion commands/results and rollout are recorded after final checks.

## Final qualification and deployed evidence

Full qualification passed at `/tmp/scalper-qualification-S3n27W/checks/results.json`:
943 Node / 94 isolated PostgreSQL / 405 Python tests (1,442 total), including all
format/lint/types/build, schema/migration/fail-closed, secret-scan and npm/pip audit
gates. Explicit HTML/CSS/JS formatting and both protected-environment policy and
`--startup` configuration checks passed. The earlier intentionally interrupted
run is not qualification. The existing Starlette/httpx deprecation warning remains.
AST-only Graphify completed with its existing pyproject zero-node/community-name
notices. No runtime package was added. Preview, light-base compatibility and the
deployed 8501 panel all passed the browser/harness checks above with zero page
exceptions. Real financial screenshots remain private outside Git; only sanitized
[validation results](evidence/live-landscape-validation.json) are published.

Both exact source-head hosted qualification checks passed before deployment.
Verified artifact `f7bf7f5e126c4da5303b30a605594a5ffdb518c7`, executable source SHA
`aaf57c684c80ee45ae98da760b62c6fa08a34db61c44995d8b292dde9aa17261`,
is installed at `/opt/ctrader-ai-scalper/releases/dashboard344`. The single-dashboard
supervisor definition was verified while the previous panel stayed online, then
only `scalper-dashboard` was recreated and PM2 state saved. The running dashboard
selects that artifact and the existing protected environment; cached configuration
for all four trading services remains at their original artifact/PIDs. Credentials
were not changed. No populated environment or database was migrated.

At `2026-10-20T08:00:49.684226Z`, dashboard HTTP health was 200 and execution
readiness was `ready`. All four other service PIDs/paths, the prospective
registration and the protected environment checksum matched the before receipt.
Analysis pause and emergency stop were false, operational fault null, and the
trading strategy remained `0.4.0-breakout-scalp.1-codex.1`. The Codex worker and
breakout observer stayed active. The deployed browser suite then passed all four
viewports, stable state, navigation and unsubmitted form checks. No trading control
or provider/broker command was submitted by this task. The trading artifact and
research registrations remain unchanged; the dashboard's new fingerprint is
intentional. [Sanitized rollout receipt](evidence/live-landscape-rollout.json).

The previous `/opt/ctrader-ai-scalper/releases/dashboard340` remains the dashboard
rollback target against the current database. Temporary preview servers are
stopped after validation. Regenerable local type-check cache and synthetic
animation intermediate frames were removed for disk headroom; no trade, audit,
qualification log, source artifact or research evidence was deleted. Final
receipt-head hosted checks and normal PR merge follow this recorded deployment.
