# Testing

## Layers

Unit tests cover ATR Wilder(15), EMA(5/19), optional indicators, Decimal canonicalization, compact features, schema/semantic validation, risk/volume/reward, daily boundaries, freshness, OCO/expiry, confidence adjustment, and redaction. cTrader schedule tests distinguish weekly closures from missing open-session bars, reject malformed/overlapping schedules, and verify separate broker-source/local-receive depth timestamps. Analytics rejects unmarked gaps, overlaps, misplaced/unknown markers, and unbounded marked gaps.

Integration tests cover Node/Python HTTP contracts, PostgreSQL migrations/constraints/transactions, AI mock variants, cTrader mock auth/events/reconciliation, paper lifecycle, reconnect/restart, and Better Stack transport failure.
Daily-risk coverage includes paper/demo identity isolation, empty deal-history
evidence, authenticated baseline controls, serializable one-time baseline/audit
persistence, and rejection of activity or duplicate initialization.

Replay tests align 1m/5m/15m by completed end time, forbid future data, label/deny missing historical depth, inject latency/spread/slippage, and choose the adverse outcome when candle OHLC permits both TP and SL with unknown path.

Failure tests include malformed/extra JSON, wrong IDs/symbol, stale/future response, impossible/inverted prices, bad R:R/precision/metadata/depth, expired token, DB/AI/network failure, partial fill/cancel race, duplicate events, restart, and partitions.
Analytics feature-boundary tests also cover high-precision positive and signed
values, tiny values, canonical zero, `None`, and non-finite rejection. The typed
HTTP integration asserts the M1 ATR string accepted by deterministic spread risk
has no more than ten fractional places.
Spread-observation tests cover exact decimal/minute derivation, 29-versus-30
history behavior, ten-place percentile output, duplicate/restart idempotency,
and rejection of stale, future, malformed, crossed, over-precision,
symbol-mismatched, unavailable, and database-invalid evidence. Fresh and
`0005`-through-`0013` migration paths exercise the database constraints,
including nullable legacy prompt artifacts and paired prompt/hash constraints.
The configured PostgreSQL integration also executes the production model-trail
transaction: UUID primary key and text request ID persist through distinct bind
parameters with the same value, request/response/validity commit together,
sensitive payload keys remain redacted, and a forced invalid validity timestamp
rolls back both new rows.

Observability-outbox tests cover recursive credential redaction, stable event
and analysis correlation, bounded exponential retry, rejected transport,
lease-based delivery, recovery to `DELIVERED`, and deliberate absence of a
historical audit backfill. The configured PostgreSQL integration verifies that
post-migration audit inserts enqueue exactly once and that the same event ID
survives a retry.

Decision-time market refresh tests simulate model and margin latency and prove
that snapshots are required both after inference and immediately before intent.
They cover refresh failure, regressed broker time, changed completed candles,
changed execution metadata/account state, stale quotes/depth, widened spread,
proposal invalidation at the final quote, refreshed risk input, and PostgreSQL
persistence that retains the original candle context while advancing the
analysis depth pointer with distinct refresh phases.

Historical TP-transform tests retain exact Decimal midpoint/quarter coverage.
Current commission-aware tests prove broker `pipPosition` and precise-fee
normalization, the smallest whole-pip positive-net BUY/SELL target, strict
gross-greater-than-fees behavior, exact `2×` SL and reward/risk `0.5`, AI
technical-envelope containment, unsupported/missing metadata rejection, actual
sized-volume revalidation, durable calculation details, and bounded Streamlit
comparison rendering. Fee-accounting regressions prove fee-inclusive stored
`realized_pnl` is never adjusted by signed fees a second time.
Minimum-volume affordability tests prove per-leg OCO budget splitting,
whole-tick downward flooring, below-one-tick rejection before inference,
non-sizing payload exclusion, exact semantic enforcement, and changed
post-model account-state rejection before risk intent.
Compact-payload configuration tests prove the 30/18/12 raw-tail defaults leave
the 600/500/300 analytics histories unchanged, accept explicit positive bounded
overrides, and reject zero, fractional, or history-exceeding values at startup.
Runtime fill-idempotency tests persist a complete deal, repeat the same deal
with its contextual position price omitted, and prove no second store mutation
or lockout occurs. A different deal ID—or the same ID after uncertain
persistence—with the missing price remains a tested fail-closed error.
Open-position monitor tests cover exact cTrader money scaling, internal broker
position matching, long-at-bid and short-at-ask marks, persisted signed
commission, zero-position short-circuiting, bounded HTTP output, and sanitized
Streamlit validation. Missing or duplicate broker P/L, multiple active
positions, uncertain durable state, symbol mismatch, malformed money, and
unexpected display fields all fail unavailable without an inferred value.
Periodic recovery-runner tests prove a normal attempt is cadence-limited, a
broker synchronization can force a refresh, concurrent timer/reconnect calls
share one attempt, and a thrown broker/history operation becomes a stable
fail-closed reason. Existing recovery tests prove an exact reconstructed SL/TP
deal closes a disappeared position while missing closing-order evidence blocks.
Recorder tests prove a new certain terminal proof clears only failures that
precede its checkpoint, while a repeated proof, an uncertain recovery, and a
later callback remain fail closed. Isolated PostgreSQL tests retain the
conflicting event payload, link its resolution to the later terminal SL/TP
event, and refuse to resolve a different trade-outcome conflict.

Hybrid-analysis tests render the exact accepted completed-candle/EMA/ATR input
twice and require byte-identical PNG/hash output, reject forming candles without
a partial chart, validate PNG signature/IHDR/size/hash across Node boundaries,
cover Responses and Chat-Completions image content, enforce strict schema 2.1
technical-map linkage, persist one bounded chart artifact in an isolated
PostgreSQL schema, and verify Streamlit rechecks bytes before display.

## Historical limitations

Candles do not reconstruct tick paths. Same-bar ordering is unknowable without tick data. Historical depth may be unavailable and synthetic depth is not equivalent. Simulated fills differ from broker fills; spread, latency, rejection, slippage, commission, swap, and liquidity need conservative modeling. Model/prompt/schema/feature changes create distinct experiment versions. Leakage/look-ahead tests are mandatory. Historical performance does not guarantee profit.

## Required commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:schemas
npm run test:migrations
npm audit --audit-level=high
.venv/bin/ruff format --check .
.venv/bin/ruff check .
.venv/bin/mypy python
.venv/bin/pytest
.venv/bin/pip-audit -r requirements.lock
./scripts/secret-scan.sh
```

CI/local acceptance also asserts that default config cannot construct a submitting live gateway, invalid model output creates no intent, duplicate commands create no duplicate order, peer cancel follows fill, expiry reconciles before a new cycle, 5% hard ceiling cannot be exceeded, daily lockout cannot be overridden, and mode labels are persisted/displayed.

## Test data

Fixtures use clearly fictional account IDs and inert illustrative prices. No real tokens, headers, database URLs, endpoints containing secrets, or production exports are allowed. Deterministic clocks, UUIDs, and seeds make failure reproduction possible.

## Result reporting

Record exact commands, versions, pass/fail/skip counts, duration, and skipped external tests. A demo test skipped for missing credentials is not a pass and does not block mock/paper implementation; it remains a live-readiness blocker.

## Latest local result

On 2026-08-27, ISSUE-056 passed Prettier, ESLint, TypeScript typecheck/build,
255 Node tests across 41 files, 17 schema tests, 3 migration tests, all 3
configured isolated-PostgreSQL/HTTP integration tests, Ruff format/lint,
strict mypy over 17 source files, and 82 Python tests. Tests cover bounded
completed-candle tails, removal of duplicated indicator candle arrays, the
64 KB stored-feature ceiling, stable database-capacity reasons, and atomic
idempotent recovery of interrupted pre-placement analyses. A configured
Streamlit AppTest during the intentional execution-service maintenance stop
reported zero exceptions. Replay/backtest smoke tests, zero-vulnerability
npm/pip audits, tracked-file secret scanning, shell/PM2 syntax, and all five
offline systemd security parses at 2.8 (`OK`) passed.

After PR #136 merged as `d1bcae6`, all five `.32` PM2 services came online.
The abandoned `.31` analysis was rejected/audited on startup and automatic
broker-minute attempts resumed. Two complete post-restart cycles persisted
30/18/12 candle tails and roughly 3 KB feature summaries, then rejected before
AI on an observed 12-point spread versus the retained 10-point limit. No row
was left active. Deployed AppTest rendered 37 dataframes, 51 metrics, and 15
tabs with zero exceptions.

On 2026-08-27, ISSUE-055 passed Prettier, ESLint, TypeScript typecheck/build,
250 Node tests across 39 files, 17 schema tests, 3 migration tests, all 3
configured isolated-PostgreSQL/HTTP integration tests, Ruff format/lint, strict
mypy over 17 source files, and 82 Python tests. Configured Streamlit AppTest
rendered 35 dataframes, 47 metrics, and 15 tabs with zero exceptions. A
read-only stored-artifact low-reasoning probe passed schema 2.1, proposal
semantics, TP transform, and effective semantics in 51.152 seconds. Tests cover
wall alignment, invalid cadence/lead configuration, safe provider error
normalization, loopback propagation, reasoning request shape, and readable
dashboard guidance. Replay/backtest, zero-vulnerability dependency audits,
tracked-file secret scan, shell/PM2 syntax, and five offline systemd security
parses at 2.8 (`OK`) passed.

After PR #133 merged, `.31` deployed under the audited pause with all five
services healthy, selected low-effort/alignment/campaign configuration, certain
reconciliation, and no open position. The first post-release broker minute was
claimed automatically at 27 Aug 2026, 09:33:00 GMT+8 and completed 43.864
seconds later as `PLACED`. PostgreSQL proved a completed system-v7/schema-2.1
request and response, exact 2.5-ATR/900/1,800/1,500-second constraints, and two
broker-confirmed pending demo stops in one `ACTIVE` group. Status showed 1/500
completed responses, 0/100 closed trades, and no AI cooldown. Deployed AppTest
rendered 42 dataframes, 65 metrics, and 15 tabs with zero exceptions.

On 2026-08-27, ISSUE-054 passed Prettier, ESLint, TypeScript typecheck/build,
244 Node tests across 39 files, 17 schema tests, 3 migration tests, all 3
configured isolated-PostgreSQL/HTTP integration tests, Ruff format/lint, strict
mypy over 17 source files, and 82 Python tests. Configured Streamlit AppTest
rendered 40 dataframes, 57 metrics, and 15 tabs with zero exceptions. Tests
prove the exact closed-demo-trade boundary, fail-closed progress handling,
pre-model context/spread stability check, broker-M1 provider deadline, semantic
entry-reachability cap, deadline propagation, and separate dashboard progress
for trade collection and inference cost. Replay/backtest, zero-vulnerability
dependency audits, tracked-file secret scan, shell/PM2 syntax, and all five
offline systemd security parses at 2.8 (`OK`) passed.

On 2026-08-26, ISSUE-053 passed Prettier, ESLint, TypeScript typecheck/build,
233 Node tests across 38 files, 16 schema tests, 3 migration tests, all 3
configured isolated-PostgreSQL/HTTP integration tests, Ruff format/lint, strict
mypy over 21 source files, and 81 Python tests. Tests prove the bounded status
shape that triggers full-page recovery, the plain reconnecting lifecycle,
strict campaign carry-forward mismatch rejection, terminal position-ID/trade
matching, and retained ambiguity rejection. Configured source AppTest had zero
exceptions, rendered 3/100 history, and did not emit the false campaign-count
error. Replay/backtest, zero-vulnerability dependency audits, secret scan,
shell/PM2 checks, and all five systemd security parses at 2.8 (`OK`) passed.

After PR #128 merged, `.29` deployed under the durable analysis pause. Selected
process evidence proved `.29`, campaign baseline `3`, five-second window, and
30/18/12 tails. Status returned `LATEST_TERMINAL / CLOSED` with one exact LONG
trade, realized demo P/L `10.06`, and fees `-0.28`. Deployed AppTest rendered
3/100 history, the same terminal result, zero exceptions, and neither the
managed-setup unavailable nor campaign-count-invalid error. The pause was then
cleared; execution readiness returned HTTP 200 with trading allowed, automatic
analysis enabled, a closed AI circuit, and zero blockers.

On 2026-08-26, ISSUE-052 passed Prettier, ESLint, TypeScript typecheck/build,
233 Node tests across 38 files, 16 JSON Schema tests, 3 migration tests, and all
3 configured isolated-PostgreSQL/HTTP integration tests. Ruff format/lint,
strict mypy over 21 source files, and 78 Python tests passed. The exact
reconciliation test proves one durable `OPEN` position plus one matching cTrader
P/L result returns bounded live values with `RECONCILIATION_REQUIRED`; an
unsupported group, uncertain position, ambiguous position, or failed broker
lookup still returns no value. Configured Streamlit AppTest rendered 42
dataframes and 57 metrics with zero exceptions. Replay/backtest smoke tests,
zero-vulnerability npm/pip audits, tracked-file secret scan, shell/PM2 syntax,
and all five offline systemd security parses at 2.8 (`OK`) passed. Source-tree
`systemd-analyze verify` reported only the expected absent future
`/opt/ctrader-ai-scalper/current` Python executables.

After PR #125 merged, `.28` deployed under the durable analysis pause. The
selected execution process showed exact release `.28`, campaign baseline `2`,
five-second start window, and 30/18/12 tails. Against the retained real demo
BUY, `/v1/open-position-monitor` returned `AVAILABLE`,
`executionState=RECONCILIATION_REQUIRED`, exact broker P/L, mark price, and
recorded commission. Deployed AppTest rendered 42 dataframes and 60 metrics,
found the reconciliation warning, and had zero exceptions. Execution readiness
remained HTTP 503 with the retained reconciliation/position blockers. The
temporary pause was then cleared; automation remained enabled and correctly
blocked from a new cycle by the existing position.

On 2026-08-26, ISSUE-051 passed Prettier, ESLint, TypeScript typecheck/build,
232 Node tests across 38 files, 16 JSON Schema tests, 3 migration tests, and all
3 configured isolated-PostgreSQL/HTTP integration tests. Ruff format/lint,
strict mypy over 21 source files, and 78 Python tests passed. Configured
Streamlit AppTest rendered 39 dataframes, 57 metrics, and 15 tabs with zero
exceptions. Replay/backtest smoke tests, zero-vulnerability npm/pip audits,
tracked-file secret scan, shell/PM2 syntax, and all five offline systemd
security parses passed. The external stored-artifact benchmark was read-only:
it did not write PostgreSQL or contact cTrader. The final category-balanced
prompt check passed strict schema, proposal semantics, TP transform, and
effective semantics for all 3 cases.

Deployment provenance caught and contained two PM2 environment-cache issues
before accepting campaign 002. Immutable `.25` produced one prompt-v6 response
with old 60/36/24 tails; new analysis was paused and its accepted demo OCO was
managed to normal expiry. `.26` remained paused with zero analyses after
selected process evidence still showed stale values. Release `.27` pins the
non-secret baseline/window/tails in the PM2 manifest. It started with only
`ANALYSES_PAUSED`, zero exposure, and campaign 0/100; selected `/proc` evidence
proved 0/5/30/18/12 before unpause. The first automatic `.27` request persisted
prompt v6/schema 2.1 and exact 30/18/12 tails, advanced to 1/100, and was safely
rejected by unchanged spread gates with no order. Deployed AppTest rendered 39
dataframes, 57 metrics, and 15 tabs with zero exceptions and showed one attempt,
one response, one spread skip, and no trade/order group. Automation remained
unpaused, circuit-closed, terminal, and eligible for the next broker minute.
The next broker minute then ran automatically, advanced `.27` to 2/100,
persisted the same v6/schema 2.1 and 30/18/12 provenance, reached `ACCEPTED`,
and placed two pending demo stops. This is direct repeat-loop evidence; it is
not a trade outcome or profitability evidence.

On 2026-08-26, ISSUE-050 passed Prettier, ESLint, TypeScript typecheck/build,
232 Node tests across 38 files, 16 JSON Schema tests, 3 migration tests, and all
3 configured isolated-PostgreSQL/HTTP integration tests. Ruff format/lint,
strict mypy over 21 source files, and 78 Python tests passed. The configured
read-only Streamlit AppTest rendered 39 dataframes, 57 metrics, 15 tabs, and
zero exceptions against the completed campaign. It reconstructed 156 attempts,
100 completed AI responses, 36 order groups, 26 exact closed demo trades, and
the 12 LONG / 14 SHORT split without exposing stored identities. Replay and
backtest smoke tests, zero-vulnerability npm/pip audits, the tracked-file secret
scan, shell/PM2 syntax, and all five offline systemd security parses passed.
No execution service, database row, or broker state was changed.

After PR #116 merged as `41e0150`, only `scalper-dashboard` restarted. Its
health endpoint returned `ok`; the execution PID remained unchanged. The
deployed-source AppTest again rendered 39 dataframes, 57 metrics, and 15 tabs
with zero exceptions and showed the exact 156/100/36/26 campaign funnel.

On 2026-08-25, ISSUE-049 passed Prettier, ESLint, TypeScript typecheck/build,
232 Node tests across 38 files, 16 JSON Schema tests, 3 migration tests, and all
3 configured isolated-PostgreSQL/HTTP integration tests. Ruff format/lint,
strict mypy over 21 source files, and 75 Python tests passed. The configured
Streamlit AppTest rendered 41 dataframes, 40 metrics, 15 tabs, and zero
exceptions. Replay/backtest smoke tests, zero-vulnerability npm/pip audits, the
tracked-file secret scan, and shell/PM2/systemd checks passed. Circuit tests
cover invalid thresholds, sub-threshold HTTP 503s, the exact opening boundary,
validated-response reset, non-transient HTTP rejection, timeout/transport,
cooldown, and half-open recovery.

The stopped `.24` rollout waited for the active `.23` setup to finish. Its BUY
filled, the SELL peer cancelled, and the BUY closed to one trade with realized
P/L `-3.14`, fees `-0.28`, and zero unresolved events. Release `.24` started
with only `ANALYSES_PAUSED`, campaign baseline 42/100, and no AI cooldown.
Execution readiness and Streamlit health returned HTTP 200; configured AppTest
rendered 39 dataframes, 37 metrics, 15 tabs, and zero exceptions. After
unpause, its first cycle persisted one completed model request/response, reached
`ACCEPTED`, advanced the campaign to 43/100, and placed two pending demo stops.

On 2026-08-25, ISSUE-048 passed Prettier, ESLint, TypeScript typecheck/build,
226 Node tests across 38 files, 16 JSON Schema tests, 3 static migration tests,
and all 3 configured isolated-PostgreSQL/HTTP integration tests through
migration `0013`. Ruff format/lint, strict mypy over 21 source files, and 75
Python tests passed. Configured Streamlit AppTest rendered 39 dataframes, 40
metrics, 15 tabs, and zero exceptions. Replay/backtest smoke tests,
zero-vulnerability npm/pip audits, the tracked-file secret scan, shell/PM2
syntax, and all five offline systemd security parses passed. A disposable
schema cloned only the affected retained demo lifecycle: migration `0013` plus
the new store replay produced two closed positions, two retained trades, a
`CLOSED` group, zero unresolved journal rows, and certain terminal proof. The
schema was dropped afterward. `systemd-analyze verify` separately reported the
expected absent future `/opt/ctrader-ai-scalper/current` executables on this
source-tree host; unit parsing/security checks passed.

The stopped `.23` rollout applied migration `0013` and recovered the observed
group to two filled orders, two closed positions, two immutable trades,
combined realized P/L `-10.09`, fees `-0.56`, and zero unresolved events.
Startup status contained only the explicit `ANALYSES_PAUSED` blocker. Execution
readiness and Streamlit health returned HTTP 200; the configured post-deploy
AppTest rendered 39 dataframes, 37 metrics, and 15 tabs with zero exceptions.
After unpause, the first automatic cycle recorded one completed external model
request/response, reached `ACCEPTED`, and placed both demo stops. Both expired
cleanly; a new automatic analysis began six seconds later. Its external HTTP
503 exposed a separate one-failure circuit-opening defect for follow-up.

On 2026-08-25, ISSUE-047 passed Prettier, ESLint, TypeScript typecheck/build,
221 Node tests across 37 files, 16 JSON Schema tests, 3 migration tests, and all
3 configured isolated-PostgreSQL integration tests. Ruff format/lint, strict
mypy over 21 source files, and 73 Python tests passed. Replay/backtest smoke
tests, zero-vulnerability npm/pip audits, the tracked-file secret scan,
shell/PM2 syntax, and all five offline systemd security parses at 2.8 (`OK`)
passed. The configured Streamlit AppTest rendered 40 dataframes and 36 metrics
with zero exceptions; its Analysis History projection matched the live durable
campaign snapshot at 14/100 and classified 8 rejected/no-order results, 5
durable closed demo losses, and 1 pending-stop setup. This verifies read-only
lifecycle presentation, not forecast quality or profitability.

On 2026-08-25, ISSUE-045 passed Prettier, ESLint, TypeScript typecheck/build,
209 Node tests across 35 files, 14 schema tests, 3 migration tests, and all 3
configured isolated-PostgreSQL/HTTP integration tests. Ruff format/lint,
strict mypy over 21 source files, and 68 Python tests passed. Configured
Streamlit AppTest rendered 35 dataframes with zero exceptions and the current
closed BUY lifecycle headline. Replay/backtest smoke tests, npm/pip audits with
zero known vulnerabilities, tracked-file secret scan, shell/PM2 syntax, and all
five offline systemd security parses at 2.8 (`OK`) passed. New failure coverage
retains a fill-slippage latch for uncertain or mismatched terminal evidence;
the success path releases it only for the same terminal group and a certain
cryptographic closing-deal proof.
PR #100 then deployed `.21` under an audited analysis pause with zero active or
unresolved broker state. Startup reported only `ANALYSES_PAUSED`, and deployed
AppTest showed the exact closed BUY result. After pause release, status was
eligible and the next broker minute was claimed automatically. Its AI call
returned orchestrator HTTP 503, so no campaign slot/order was created; AppTest
then showed `WAITING_FOR_AI` and the human GMT+8 automatic retry time with zero
exceptions. This validates scheduling/cooldown observability, not the external
provider's availability or forecast accuracy.

On 2026-08-25, ISSUE-042 passed Prettier, ESLint, TypeScript typecheck/build,
204 Node tests across 35 files, 14 schema tests, 3 static migration tests, and
all 3 configured isolated-PostgreSQL integration tests. Ruff format/lint,
strict mypy over 20 source files, and 55 Python tests passed. Configured
Streamlit AppTest had zero exceptions. Replay/backtest smoke tests, npm/pip
audits with zero known vulnerabilities, tracked-file secret scan, shell/PM2
syntax, and all five offline systemd parses at 2.8 (`OK`) passed. Before
deployment, runtime remained on `.19`, campaign progress remained `4 / 100`,
and the known callback conflict kept new trading disabled.
Post-merge deployment under the durable pause then reported `.20`, campaign
`4 / 100`, zero active groups, zero unresolved events, and one retained
resolved conflict linked to terminal evidence. Configured Streamlit AppTest
rendered 35 dataframes with zero exceptions and Overview labeled the prior
setup as terminal history. After release, the next automatic M1 cycle completed
an external-AI response, advanced the campaign to `5 / 100`, and safely
rejected an invalid downside-target sequence without creating an order.
PR #94 then merged the reason guidance and restarted only Streamlit; execution
PID `2522098` remained unchanged. Dashboard health and AppTest passed. The
unchanged automatic loop advanced to `6 / 100`, placed a new pending demo OCO,
and Overview rendered both exact legs under `ACTIVE MANAGED SETUP`.

ISSUE-044 timestamp tests cover UTC-aware, explicit GMT+8, naive database,
missing, malformed, numeric, timestamp-column selection, and display-copy
behavior. A configured pre-deployment Streamlit AppTest rendered 35 dataframes
with zero exceptions; its Overview caption showed `25 Aug 2026, 13:37:03
GMT+8`, and all 4,985 populated timestamp-table cells ended in `GMT+8` or used
the explicit missing/invalid marker. Source database/API values were unchanged.
After PR #97 merged, only Streamlit restarted and execution PID `2522098`
remained unchanged. Dashboard health and the same configured AppTest passed;
the deployed Overview caption and all 4,985 checked timestamp cells retained
the standardized GMT+8 display.

On 2026-08-25, ISSUE-041 passed Prettier, ESLint, TypeScript typecheck/build,
198 Node tests across 34 files, 14 schema tests, 3 static migration tests, and
all 3 configured isolated-PostgreSQL integration tests. Ruff format/lint,
strict mypy over 17 Python source files, and 55 Python tests passed. Configured
Streamlit AppTest rendered 34 dataframes with zero exceptions. Replay/backtest
smoke tests, npm/pip audits with zero known vulnerabilities, tracked-file secret
scan, shell/PM2 syntax, and five offline systemd parses passed. The campaign
tests cover exact-limit pause, overrun, unavailable/invalid progress, and
reconstruction from committed model history.

On 2026-08-25, ISSUE-039 passed Prettier, ESLint, TypeScript typecheck/build,
191 Node tests across 33 files, 14 schema tests, 3 static migration tests, and
all 3 configured isolated-PostgreSQL integration tests through migration
`0012`. Ruff format/lint, strict mypy over 20 Python source files, and 53 Python
tests passed. A migrated isolated-schema Streamlit AppTest rendered 19
dataframes with zero exceptions. Replay/backtest smoke tests, npm/pip audits
with zero known vulnerabilities, tracked-file secret scan, shell/PM2 syntax,
and five offline systemd parses passed. A provider-only real-image probe
completed strict schema 2.1 in 54.2 seconds without a database intent or broker
call; it proves multimodal compatibility, not forecast accuracy.

On 2026-08-24, formatting, ESLint, TypeScript typecheck/build, 136 Node unit
tests across 29 files, 12 schema tests, 3 static migration tests, Ruff, strict
mypy across the analytics and dashboard code, 41 Python tests,
npm audit, pip-audit, shell syntax, and secret scanning passed. The typed
Node/Python integration plus fresh-schema and `0005`-through-`0010` upgrade tests
passed. TLS connectivity and all ten migrations passed inside isolated Neon
schemas, which the tests dropped afterward; migrations `0001` through `0009`
are applied to the configured Neon schema under both emergency stops. The
post-migration demo
restart reported certain startup recovery with no journal exceptions or local
execution state. The host used Node 24.18.0; the supported Node 22
deployment baseline and installed systemd paths still require a Debian release
validation. Offline systemd security parsing passed for all five units with a
2.8 (`OK`) common sandbox score on systemd 257. Credentialed cTrader demo auth,
token renewal, market data, empty-state reconciliation, and audited daily-risk
baseline initialization with empty deal history passed; no demo order
or live-data shadow session was run. Versioned cTrader demo execution fixtures
cover accepted, partial-fill, full-fill, rejection, deduplication, peer cancel,
and restart recovery paths; supervised broker-field validation remains pending.
A configured-endpoint system-v2 probe returned both mandatory conditional
stops, no legacy decision/enable fields, a matching prompt hash, and passed
deterministic semantic validation. The probe made no database write or broker
call. The checked-in replay and backtest CLI
smoke fixtures also completed; the replay fixture intentionally has too little
history for long-window indicators and is not a trading-quality dataset.

After PR #44 merged as `0d2f6cf`, migration `0009` applied cleanly and the
AI/execution/dashboard processes restarted healthy with trading and automatic
analysis disabled. A probe through the deployed loopback orchestrator returned
both mandatory legs with the expected prompt artifact and passed deterministic
semantics without a database write or broker call. Configured Streamlit AppTest
rendered 11 analysis-history options, prompt history, the exact prompt/input
controls, and zero exceptions. The follow-up historical-label test ensures an
old schema 1.0 self-veto is not presented as a current schema 2.0 proposal.
The correction merged in PR #45 as `1fec8fe`; after the dashboard-only reload,
configured AppTest again reported zero exceptions with the historical notice
and prompt/input controls visible. Execution remained trading-disabled and
automatic-analysis-disabled, and durable execution-state counts stayed zero.

The first operator-authorized automated-demo restart correctly failed the
strategy-provenance check because it attempted to reuse the prior release name
with a changed automatic-analysis configuration hash. The database emergency
stop remained active, the restart loop was stopped, and no analysis or order was
created. ISSUE-023 adds a new immutable release identity and a deployment test
that prevents accidental reuse of the old name.

A configured Streamlit `AppTest` run completed without an exception and rendered
four charts from current data; its visible error/warning elements were the
expected demo emergency-stop and disabled-submission banners.

After PR #30 merged, migration `0008` was applied and the execution/dashboard
processes restarted while demo submission and automatic analysis were disabled
under both emergency stops. The startup reconciliation audit event was retried
once after a rejected HTTPS attempt, then reached `DELIVERED` on attempt two
with no remaining backlog. A configured Streamlit AppTest rendered seven charts
and the Better Stack delivery section with zero exceptions. Execution remained
ready but unable to trade, and broker execution events, order groups, orders,
active positions, and fills remained zero. No analysis cycle or broker command
was run.

After PR #9 merged, `scalper-dashboard` was restarted from `main`. The local
Streamlit health endpoint returned `ok`; the configured AppTest again rendered
four charts with zero exceptions. Execution status remained `demo` with startup
checks passed, trading disabled, and emergency stop active.

The supervised-demo scheduler/cap checkpoint adds positive and rejection tests
for manual-by-default analysis and for the exact acknowledgement, daily
order-group limit, and per-position notional limit required by demo-enabled
startup. The full gate rerun above passed with demo submission still disabled.

The immutable guardrail release was reloaded after the prior-version reuse was
correctly rejected. Execution readiness returned ready with trading false; an
authenticated cycle under environment emergency stop returned `REJECTED`,
`EMERGENCY_STOP_ENV`, and no placement. Demo journal/order/active-position/fill
counts stayed zero. Dashboard health returned `ok`, and its configured AppTest
rendered four charts with zero exceptions.

A credentialed ISSUE-014 read-only probe ran with broker order commands disabled
and execution emergency-stopped. The broker's exact schedule/timezone parsed;
600 M1, 500 M5, and 300 M15 completed candles contained 1, 2, and 3 trusted
weekly-session gaps. The updated analytics service accepted the snapshot with
no rejection and exposed those counts. This is demo market-data validation, not
an order, fill, paper result, backtest, or profitability evidence.

After PR #16 merged, the same check passed through the deployed PM2 market and
analytics loopback endpoints. All service health checks passed; execution
reported `trading_allowed=false`, both configured emergency stops remained
active, and cTrader demo execution-event/order/active-position/fill counts were
all zero.

The next supervised cycle passed strict analytics and rejected safely before
model/intent/order with `SPREAD_INPUT_INVALID`. Persisted M1 ATR had 27
fractional places versus the risk boundary's ten. Post-cycle reconciliation and
both restored stops passed; all broker/local execution counts stayed zero. The
ISSUE-015 stopped credentialed probe produced ten-place ATR and crossed into
spread validation successfully without invoking a cycle.

After PR #19 merged, production-loopback analytics again emitted ten-place ATR
and the absolute/ATR checks accepted the stopped five-point spread. Adaptive
percentile validation remained fail-closed with `SPREAD_HISTORY_MISSING` because
only 2 of 30 required recent samples existed. No thresholds were changed and
all execution-state counts remained zero.

ISSUE-016's complete Node, Python, schema, migration, configured integration,
replay/backtest, dependency-audit, secret, shell, and offline-systemd suite
passed. PR #22 merged as `3b0fd4d`; migration `0007` was applied and execution
restarted while both emergency stops remained active, automatic analysis stayed
off, and demo/live submission stayed disabled. The sampler accumulated 30
genuine consecutive broker-source minute buckets. A final read-only preflight
had 32 samples, accepted strict 600/500/300-candle analytics, and approved a
9-point spread at percentile `71.875` with no session abnormality. Execution
events, groups, orders, active positions, and fills remained zero. No cycle was
invoked.

The next fresh acknowledgement opened one bounded demo window. An initial HTTP
request with an empty JSON body was rejected by Fastify before coordinator entry;
cleanup restored the database stop and `lastCycle` remained null. The corrected
single cycle reached `MODEL_PENDING` and failed closed with PostgreSQL
`inconsistent types deduced for parameter $1`, analysis
`ca2c49d7-f133-4a5f-a4e2-b36c5465b8a7`, and no placement. The model-trail
transaction had reused one parameter for UUID `model_requests.id` and text
`request_id`, so PostgreSQL rolled it back. Both stops and disabled demo settings
were restored; execution events, groups, orders, active positions, and fills
remained zero. The operator acknowledgement is consumed.

The ISSUE-017 distinct-bind change passed formatting, ESLint, TypeScript
typecheck/build, 103 Node unit tests, 10 schema tests, 3 static migration tests,
all 3 configured integration tests, Ruff format/lint, mypy, 30 Python tests,
replay/backtest, both dependency audits, secret and shell checks, and all five
offline systemd security parses.

PR #25 merged as `eae91f6`. The execution service was rebuilt and restarted
under both emergency stops with automatic analysis and demo/live submission
disabled. Readiness and startup recovery passed; execution events, groups,
orders, active positions, and fills stayed zero. The rejected supervised
analysis retained zero model-request rows, confirming the failed pre-fix
transaction left no partial evidence. No deployment cycle was invoked.

A fresh post-fix acknowledgement authorized one bounded demo cycle. The stopped
preflight accepted 600/500/300 completed candles, complete continuous depth,
strict analytics, and a 5-point spread at percentile `33.9622641509`; the
minimum-volume notional was `4648.29` under the `5500` cap and daily loss was
zero. The cycle snapshot widened to 11 points at the 100th percentile. Analysis
`199c679e-abd5-43d5-9e39-1a161254c3ed` therefore rejected at deterministic
spread validation with `SPREAD_POINTS_EXCEEDED` and
`SPREAD_PERCENTILE_EXCEEDED`, before any model request, risk decision, intent,
or broker command. Cleanup reconciled successfully, both stops and disabled
demo settings were restored, and execution events, groups, orders, active
positions, and fills remained zero.

The documentation checkpoint for that supervised result passed formatting,
ESLint, TypeScript typecheck/build, 103 Node tests, 10 schema tests, 3 migration
tests, all 3 configured PostgreSQL integration tests, Ruff format/lint, mypy, 30
Python tests, replay/backtest smoke tests, both dependency audits, secret and
shell checks, and all five offline systemd security parses at 2.8 (`OK`).

A fifth exact acknowledgement accompanied a request for automatic demo cycles.
Automatic scheduling remained disabled because no supervised broker order
lifecycle has passed. The stopped preflight accepted the complete candle/depth
snapshot, strict analytics, and a 5-point spread at percentile `35`; the final
quote was 7 points at percentile `49.1803278688`. Analysis
`4ae9126d-d324-4b8a-8965-f689b7b479cb` reached the completed AI response but the
model returned `NO_TRADE` with `SESSION_GAPS_PRESENT` and
`MULTI_TIMEFRAME_DIRECTION_CONFLICT`. Semantic validation rejected
`MODEL_DATA_QUALITY_REJECTED` and `QUOTE_STALE` before any risk decision, intent,
or broker command. Cleanup/reconciliation passed, both stops and disabled demo
settings were restored, and all execution-state counts remained zero.

The fifth-attempt documentation checkpoint passed formatting, ESLint,
TypeScript typecheck/build, 103 Node tests, 10 schema tests, 3 migration tests,
all 3 configured PostgreSQL integration tests, Ruff format/lint, mypy, 30 Python
tests, replay/backtest smoke tests, both dependency audits, secret and shell
checks, and all five offline systemd security parses at 2.8 (`OK`).

ISSUE-019's decision-time refresh checkpoint passed formatting, ESLint,
TypeScript typecheck/build, 114 Node tests across 28 files, 10 schema tests, 3
migration tests, all 3 configured integration tests, Ruff format/lint, mypy, 30
Python tests, replay/backtest smoke tests, npm/pip dependency audits, secret and
shell checks, and all five offline systemd security parses at 2.8 (`OK`). The
PostgreSQL test verified that refreshed depth is appended and linked while the
original model candle snapshot remains unchanged. No credentialed cycle or
broker command was run for this checkpoint.

PR #33 merged as `21312cb`. The merged execution build started under immutable
strategy/code identity `0.1.0-decision-refresh.1` with demo and automatic
analysis disabled and both emergency stops active. Startup recovery/readiness
passed; the provenance row exists and demo group/order/active-position/fill and
unresolved-event counts remained zero. The startup audit reached `DELIVERED` on
its third bounded Better Stack attempt and left zero backlog. No post-deployment
cycle or broker command was invoked.

AI timeout-budget tests cover the configured three-attempt total, zero-retry
mode, nonpositive/fractional/overflowing budgets, a valid locally revalidated
response, normalized timeout and transport failures, and execution-side circuit
opening. The supervised failure that motivated them persisted no model request,
risk decision, intent, order, fill, position, or unresolved broker event.

ISSUE-020's complete checkpoint passed formatting, ESLint, TypeScript
typecheck/build, 123 Node tests across 28 files, 10 schema tests, 3 migration
tests, all 3 configured integration tests, Ruff format/lint, mypy, 30 Python
tests, replay/backtest smoke tests, npm/pip dependency audits, secret and shell
checks, and all five offline systemd security parses at 2.8 (`OK`).

PR #36 merged as `eae2aff`. The merged execution build started under immutable
strategy/code identity `0.1.0-ai-timeout-budget.1` with demo and automatic
analysis disabled and both emergency stops active. Startup recovery/readiness
passed; the new provenance row exists and demo group/order/fill/active-position
and unresolved-event counts remained zero. The slowest startup reconciliation
audit reached `DELIVERED` on attempt five and left zero Better Stack backlog.
No post-deployment cycle or broker command was invoked.

A fresh post-ISSUE-020 acknowledgement authorized one capped manual cycle. The
stopped preflight accepted complete 600/500/300 candles, continuous depth,
strict analytics, current risk/caps, empty execution state, and a 9-point spread
at percentile `66.4`. Analysis `4033a032-19d7-449d-b9c2-4a949004b091` captured
an 11-point spread and rejected with `SPREAD_POINTS_EXCEEDED` and
`SPREAD_PERCENTILE_EXCEEDED` before any model request, risk decision, intent, or
broker command. The stop trap, cancellation/reconciliation, environment reset,
zero execution-state checks, and all six first-attempt Better Stack deliveries
passed. The complete required Node/Python/integration/schema/migration,
replay/backtest, dependency, secret, shell, and systemd gate suite also passed.

The operator subsequently granted continuing authorization for bounded demo-
only attempts in the current supervised readiness campaign. It did not enable
automatic analysis or real-money live execution. A stopped preflight accepted
600/500/300 completed candles, four levels per depth side, strict analytics,
zero daily loss, current caps, empty durable execution state, and an 8-point
spread at percentile `56.8181818181`. Analyses
`6310314b-6a5f-41b1-9585-6517cd7ca92e` and
`f9fbb9b4-3835-40d7-ad07-796d43a6dfa6` began at UTC second 41/42 and completed
after the next minute boundary. Both model calls completed, then immutable
post-model validation correctly rejected `DECISION_CANDLE_CONTEXT_CHANGED`;
neither reached risk intent or placement.

A third attempt used a fresh eligible snapshot at UTC second 05: 5 spread
points, percentile `28.6764705882`, accepted analytics, complete depth, and no
durable broker state. Analysis `09b34e95-0900-4273-8acf-8d370e2a073c` stayed
inside that candle window, accepted the refreshed decision market and both
spread checks, then rejected semantically with `MODEL_DATA_QUALITY_REJECTED`.
The completed model response was `NO_TRADE`; its bounded warnings reported
multi-timeframe conflict, low M1 volume, and session gaps, while risk flags
reported low trend strength and no validated edge. The result contained zero
risk decisions, groups, orders, fills, active positions, or unresolved broker
events. Every window ended with the database stop, strategy-owned cancellation,
certain reconciliation, disabled demo submission, disabled automation, and the
environment stop restored.

The continuing-session evidence checkpoint passed Prettier, ESLint, TypeScript
typecheck/build, 123 Node tests across 28 files, 10 schema tests, 3 migration
tests, all 3 configured PostgreSQL integration tests, Ruff format/lint, mypy,
30 Python tests, replay/backtest smoke tests, npm/pip audits, secret scanning,
shell syntax, and all five offline systemd security parses at 2.8 (`OK`). The
first integration invocation reported its two database cases as skipped because
`TEST_DATABASE_URL` was absent from that process; the required configured rerun
explicitly used the protected database URL and passed all 3 tests in isolated
schemas.

ISSUE-021's decision-inspector checkpoint passed Prettier, ESLint, TypeScript
typecheck/build, 123 Node tests across 28 files, 10 schema tests, 3 migration
tests, all 3 configured PostgreSQL integration tests, Ruff format/lint, strict
mypy across analytics and dashboard code, and 37 Python tests. Replay/backtest
smoke tests, npm/pip dependency audits, secret scanning, shell syntax, and all
five offline systemd security parses at 2.8 (`OK`) also passed. A configured
Streamlit AppTest rendered both a completed model `NO_TRADE` decision and a
pre-model spread rejection without exceptions; the rejected path showed AI,
risk, and order stages as `NOT_REACHED`. No analysis cycle or broker command was
invoked by these read-only tests.

After PR #41 merged as `d64114a`, `scalper-dashboard` restarted from `main`.
The local Streamlit health endpoint returned `ok`, and the same configured
model/pre-model AppTest paths passed after deployment. Execution remained in
demo mode with trading and automatic analysis disabled, startup checks passed,
and the emergency stop active.

ISSUE-024 tests the broker-M1 opening window at its first millisecond, last
allowed millisecond, exact rejection boundary, and next-minute rollover. Invalid
broker timestamps plus zero, fractional, and excessive windows fail closed.
Configured PostgreSQL integration covers a unique interval claim, duplicate
claim after a simulated restart, completion correlated to a persisted analysis,
completion for a preflight rejection without an analysis row, and duplicate
completion rejection. Migration tests cover fresh and `0005` upgrade paths
through `0010`. The provider client additionally proves that its default retry
count makes exactly one request on a retryable HTTP failure.

ISSUE-025 adds positive normalization and PostgreSQL lifecycle coverage for one
fully closed single-deal demo position. Tests assert signed Decimal net P/L and
fees, one immutable versioned trade, terminal group state, restart idempotency,
journaled conflicting-outcome rejection, missing-detail and partial-close
rejection reasons, immediate terminal analysis release, and sanitized Streamlit
display preserving decimal strings. Malformed or sensitive display data is
rejected.

ISSUE-027 adds risk-engine cases for downward notional normalization, exact
minimum-volume notional boundary, a cap below broker minimum, the observed demo
XAUUSD metadata/price/volume scale, and preservation of the below-minimum loss
budget rejection. The approved paths assert the final volume and maximum loss;
the implementation never rounds volume upward.

ISSUE-028 adds coordinator ordering coverage proving broker callbacks flush only
after placement persistence, normalization coverage for strategy-labelled
acceptances without a client order ID, recorder coverage proving enqueue does
not race persistence, and durable readiness coverage proving a resolved partial
fill clears without restart. Configured PostgreSQL coverage additionally proves
broker-ID-only matching, duplicate-event idempotency, unresolved blocking,
final-fill resolution, and conflicting-outcome blocking.

ISSUE-029 adds callback-diagnostic rejection tests. A malformed accepted event
must retain fail-closed uncertainty while emitting only its allowlisted field
reason and structural booleans; a free-form persistence exception must collapse
to a stable generic reason. Assertions explicitly forbid the fixture's client
identifier, strategy label, malformed value, and database error text in the
diagnostic summary.
The credentialed `.8` callback showed `ORDER_ACCEPTED`, pending order, order
identity/label present, position present, no deal, and
`CTRADER_FIELD_INVALID:price`. Positive unit and configured PostgreSQL tests now
map that exact unpriced acceptance placeholder without creating a position;
the paired rejection test proves a fill still requires a priced position.

ISSUE-030 adds deterministic-clock tests for the execution caller circuit. They
assert no HTTP request occurs before the reset boundary, an exact-boundary
half-open request can succeed and clear the circuit, a second transport failure
reopens for the full interval, and zero, fractional, or timer-overflowing reset
configuration rejects before startup.

ISSUE-054 adds exact-boundary tests for the strategy-scoped closed-demo-trade
target, reviewed carry-forward, database unavailability, malformed counts, and
audited pause enforcement. Coordinator tests prove a second widened-spread
snapshot stops before AI, late broker-M1 budgets reject before inference, and
the deadline reaches the provider client. Schema/semantic tests reject BUY and
SELL confirmations beyond the configured M1-ATR cap. Deployment tests pin the
new immutable release, separate inference/trade limits, entry reachability, and
bounded expiry values without embedding trading authority or credentials.

ISSUE-055 tests wall-aligned scheduler phase and invalid alignment inputs,
provider timeout/unavailability normalization, rejection of free-form upstream
errors, exact finite-reason propagation across the loopback AI boundary, and
strict reasoning-effort configuration. A read-only stored-artifact `low`-effort
probe reached the external endpoint in 51.152 seconds and passed schema 2.1,
proposal semantics, TP transform, and effective-proposal semantics without a
database write or broker call.

ISSUE-031 adds order-type/closing-flag normalization, non-deal contextual
position handling, exact broker-ID entry recovery, and reconstruction of a
single broker SL/TP close after the position disappears from reconciliation.
Configured PostgreSQL coverage proves the closing child cannot overwrite its
entry, its acceptance blocks pending deal evidence, the exact deal atomically
closes the position/trade/group, and the retained acceptance becomes resolved.
Missing closing-order evidence remains a tested fail-closed path. Migration
tests cover fresh and `0005` upgrade paths through `0011`.

ISSUE-057 adds the observed terminal-callback regression shape: a CLOSED
contextual position with missing/zero price succeeds only when the same event
has a complete terminal deal and close detail, while OPEN or incomplete events
still reject. Recorder tests prove an already-seen terminal proof releases a
late failure only for the exact same private broker fill identity. PostgreSQL
integration checks that terminal reconciliation returns that identity.

Coordinator tests verify exact Decimal/tick derivation of BUY/SELL entry ranges,
the stop-distance range, and preferred expiry, including an unsatisfiable
failure path. AI boundary tests require finite latency/retry metadata, and the
database trail persists it. Watchdog unit/integration tests distinguish active,
managed, paused, closed-market, and genuinely stalled states and prove stall
plus recovery audits enter the Better Stack outbox.

The ISSUE-057 pre-deployment gate passed 266 Node tests across 42 files, 17
schema tests, 3 migration tests, all 3 configured integration tests, and 84
Python tests, with strict formatting/lint/type checks. Configured Streamlit
AppTest rendered 42 dataframes, 69 metrics, and 15 tabs with zero exceptions.
Replay/backtest, dependency audits, tracked-file secret scanning, shell/PM2
checks, and all five offline systemd security parses also passed.

After PR #139 merged as `568043f`, all five `.33` PM2 services returned healthy
under an audited analysis pause, and the configured Streamlit application
rendered 42 dataframes, 66 metrics, and 15 tabs with zero exceptions against
the deployed status. Removing the pause produced seven automatic cycles and
four completed `system-v8` requests by 31 Aug 2026, 09:15 GMT+8. Each request
persisted one provider attempt plus a measured 27.394--28.785 second duration.
Finite entry-distance/spread rejections returned activity to `RUNNING`; startup
and reconciliation stayed certain, the open-position monitor returned `NONE`,
and every observability outbox row was delivered.

That rollout also proved the new watchdog failure path: at 09:17:45 GMT+8 it
persisted `AUTOMATIC_ANALYSIS_STALLED` when broker reconciliation repeatedly
finished beyond the 5-second claim window while market sampling remained
fresh. The audited pause allowed an in-flight call and a preceding durable
minute claim to settle, leaving `.33` with nine attempts and six completed
responses. ISSUE-058 pins `.34`, analysis baseline 111, trade baseline 49, and a
10-second broker-time window in the PM2 contract. The schedule tests already
prove 09.999 seconds is accepted while the exact 10.000-second boundary and
later times reject.

The ISSUE-058 complete gate passed 266 Node tests across 42 files, 17 schema
tests, 3 migration tests, all 3 configured integration tests, and 84 Python
tests with formatting, lint, and strict type checks. Configured Streamlit
AppTest rendered 39 dataframes, 69 metrics, and 15 tabs with zero exceptions.
Replay/backtest, zero-vulnerability dependency audits, tracked-file secret
scanning, shell/PM2 validation, and all five offline systemd security parses at
2.8 (`OK`) passed.

The `.34` rollout proved the full automatic lifecycle. After all five services
started healthy under the audited pause, the first unpaused interval claimed at
31 Aug 2026, 09:24:05 GMT+8 and placed two cTrader demo stops. SELL filled, the
BUY peer cancelled, terminal broker evidence closed the position/trade at
09:38:16, and the temporary reconciliation/slippage reasons cleared. The next
interval claimed at 09:39:05 and completed at 09:39:37 without intervention.
PostgreSQL then contained two `.34` completed `system-v8` calls, one closed
trade, no nonterminal broker rows, and no `.34` stall event. All 14,861
observability outbox rows were delivered; service health and PM2 status were
green across all five processes.

## ISSUE-059 half-distance comparison cohort

Proposal-transform tests prove that current execution preserves the immutable
endpoint response while deriving effective SL at half the endpoint distance and
effective TP at one quarter of the endpoint distance. They cover exact BUY and
SELL arithmetic, recalculated effective R:R, off-tick SL and TP rejection
without rounding, and rejection when model invalidation does not equal the
effective SL. Coordinator coverage proves that prompt SL bounds double the
effective broker/configured minimum, reject an unsatisfiable original-stop
range before inference, pass only transformed SL/TP into deterministic sizing,
and persist both divisors. Dashboard tests cover current transform evidence,
legacy `.34` evidence, reason guidance, and prompt `system-v9` provenance.

The complete pre-deployment gate passed Prettier, ESLint, TypeScript
typecheck/build, 269 Node tests across 42 files, 17 schema tests, 3 migration
tests, all 3 configured isolated-PostgreSQL/HTTP integration tests, Ruff
format/lint, strict mypy over 17 source files, and 85 Python tests. Configured
Streamlit AppTest rendered 43 dataframes, 69 metrics, and 15 tabs with zero
exceptions. Replay/backtest smoke tests, npm/pip audits with zero known
vulnerabilities, tracked-file secret scanning, shell/PM2 checks, and all five
offline systemd security parses at 2.8 (`OK`) passed.

PR #145 was squash-merged as `42b6e5a` and deployed as `.35` under the audited
analysis pause. Selected PM2 environments matched `.35`, 0/500 completed
responses, and 0/100 closed trades across all five healthy services. A
dependency-startup race caused execution's first reload to fail while market
data was still restarting; one restart after market-data readiness restored
health with the database pause still active. This is a deployment-ordering
improvement candidate and did not create an analysis or broker command.

After unpause, the first real `system-v9` response completed in one 26.3-second
attempt and was rejected by the final unchanged point/percentile spread check.
Running that immutable response through the exact deployed pure transform
accepted with no reasons and produced tick-aligned SL/TP on both legs. The next
response completed in one 29.0-second attempt, passed the durable transform,
and created broker-accepted demo stops. PostgreSQL proves that AI SELL
entry/SL/TP `4444.10 / 4446.10 / 4435.30` became audited and durable order
levels `4444.10 / 4445.10 / 4441.90`; effective R:R was `2.2`. SELL filled and
the BUY peer cancelled. The resulting SELL position closed normally after 2
minutes 57 seconds with net demo P/L `2.05`, including fees `-0.26`; automation
returned to `RUNNING` with no blocker. This establishes deployed arithmetic and
lifecycle operation, not statistically meaningful performance or
profitability.

## ISSUE-061 commission-aware 1:2 exit policy

The `.36` pre-deployment suite passed Prettier, ESLint, TypeScript
typecheck/build, 283 Node tests across 44 files, 17 schema tests, 3 migration
tests, all 3 configured isolated-PostgreSQL/HTTP integration tests, Ruff
format/lint, strict mypy over 17 source files, and 87 Python tests. Configured
Streamlit AppTest rendered 42 dataframes, 65 metrics, and 15 tabs with zero
exceptions. Replay/backtest smoke commands, npm and pip audits with zero known
vulnerabilities, tracked-file secret scan, shell/PM2 syntax, `git diff --check`,
and five offline systemd security parses at 2.8 (`OK`) passed.

New tests cover cTrader asset/pip/precise-commission discovery, unrelated
noncanonical broker asset names, exact Decimal fee estimates, the strict
gross-greater-than-fees boundary, smallest whole-pip BUY/SELL search, exact
`2×` SL with numeric reward/risk `0.5`, technical-envelope rejection,
unsupported commission/currency rejection, final sized-volume revalidation,
current and historical dashboard transform rendering, and fee-inclusive P/L
without double-subtracting signed fees. A read-only built-client check against
the configured demo endpoint returned XAUUSD pip/tick `0.01`, minimum native
volume `100`, XAU/USD/USD assets, conversion `1`, and commission type
`USD_PER_MILLION_USD` at `30` with zero minimum and P/L-conversion fee. This is
metadata/contract evidence only; deployment and demo order evidence remain
separate.
