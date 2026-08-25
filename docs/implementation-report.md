# Implementation Report

Date: 2026-08-24

## Delivered architecture

- Node.js/TypeScript market-data, AI-orchestration, execution, cTrader,
  database, logging, observability, contract, and deterministic-risk modules.
- Typed FastAPI/Pydantic analytics boundary with completed-candle quality
  checks, deterministic indicators/features, performance statistics, replay,
  and conservative candle backtesting.
- Durable PostgreSQL decision trail, normalized schema, runtime controls,
  daily-risk lockout, OCO intents/orders, paper fills/positions/trades, audit
  events, health, and server metrics.
- Streamlit operations dashboard with mode labeling, market/analysis/risk/order
  views, a correlated AI decision inspector, system metrics, and
  token-protected loopback controls.
- Paper, disabled-by-default cTrader demo, structurally non-submitting shadow,
  and dormant live-compatible interfaces. Production live composition uses
  `DisabledLiveGateway` and fails its startup readiness check.
- Debian release layout, setup/install/backup/health scripts, and five hardened
  systemd services plus target. No Docker dependency was introduced.

## Files created

The repository was initially empty. The implementation added:

- root configuration and delivery documents: `README.md`, `plan.md`,
  `AGENTS.md`, `.env.sample`, `.gitignore`, Node/Python manifests and lockfiles;
- runtime applications under `apps/`;
- shared TypeScript packages under `packages/`;
- Python analytics/replay/backtest modules under `python/`;
- nine ordered SQL migrations under `migrations/`;
- immutable strict model schemas and prompts under `schemas/` and `prompts/`;
- operational documentation under `docs/`;
- Debian scripts/units under `scripts/` and `systemd/`;
- Node, Python, integration, failure, schema, migration, and replay fixtures/tests
  under `tests/`.

## Service commands

```bash
npm run db:migrate
.venv/bin/uvicorn python.analytics.api:app --host 127.0.0.1 --port 8090
npm run dev:market-data
npm run dev:ai
npm run dev:execution
.venv/bin/streamlit run apps/dashboard/app.py --server.address 127.0.0.1 --server.port 8501
```

Built services use `npm run build` followed by `npm run start:market-data`,
`npm run start:ai`, and `npm run start:execution`. Debian uses
`ctrader-ai-scalper.target` after a tested release is atomically linked at
`/opt/ctrader-ai-scalper/current`.

## Verification result

Local host: Node 24.18.0/npm 11.16.0, Python 3.13.5, systemd 257. Deployment is
pinned to Node 22 and still needs validation on that runtime.

- Prettier, ESLint, TypeScript typecheck, and TypeScript build passed.
- Node unit: 29 files, 136 tests passed.
- Node integration: typed Node/Python and isolated Neon migration tests passed
  (3 tests total), including fresh migration and `0005`-through-`0010` upgrade paths.
  The temporary schemas were dropped afterward.
- JSON Schema: 12 tests passed. A configured, non-trading system-v2 probe
  returned both mandatory legs, no legacy decision/enable fields, the matching
  tracked prompt hash, and passed local deterministic semantics.
- Migration structure/safety: 3 tests passed, including pinned historical
  `0001`/`0002` byte checksums; migrations through `0010` passed isolated
  fresh/upgrade testing. The configured Neon schema is at `0009`; the stopped
  migration/restart check found an empty journal/order/position/fill
  state and certain startup recovery. Backup/restore remains pending.
- Ruff format/lint, strict mypy across analytics/dashboard, and Python: 41 tests passed.
- Checked-in replay and backtest CLI smoke scenarios completed.
- npm audit and pip-audit reported no known vulnerabilities.
- Secret scan and shell syntax checks passed.
- All five service units passed offline security parsing; common systemd exposure
  score is 2.8 (`OK`). Installed-path/service startup testing remains pending.

These are engineering results, not evidence of profitability or broker fill
quality.

## Current PM2 deployment

The five services run from `ecosystem.config.cjs` under PM2 and the enabled,
active `pm2-root.service`. A saved process list was successfully resurrected by
systemd, an individual AI-service restart recovered, and all five local health
checks passed afterward. API and dashboard listeners bind only to `127.0.0.1`.
Execution is in cTrader demo mode with both environment and database emergency
stops active,
demo and live submission disabled, and `tradingEnabled=false`. Its only status
reasons are the expected demo-enable, demo-acknowledgement, database-stop, and
environment-stop gates. The demo identity has no order groups, orders, active
positions, fills, or cTrader execution events.

The dashboard has an independent protected control token, remains bound to
loopback, and `trading.aims-sg.com` returns a Cloudflare Access redirect for an
unauthenticated request. PM2 is currently root-owned because this checkout is
under `/root`; migrate to the documented `ctrader-scalper` service user/release
layout before live-readiness review.

## Demo-account setup

1. Create/authorize a cTrader Open API application for a broker demo account.
2. Put client credentials, renewable access/refresh tokens, expiry, and optional
   account ID only in the protected environment. Use
   `CTRADER_CONNECTION_MODE=demo` and the broker's demo endpoint.
3. Configure Neon and the AI endpoint, run migrations, and start with the
   environment/file emergency stops active.
4. Complete replay and paper checks. Inspect discovered symbol metadata, quote,
   candles, depth, daily baseline, reconciliation, and dashboard mode labels.
5. For a supervised demo-order session only, set `TRADING_MODE=demo`,
   `DEMO_TRADING_ENABLED=true`, the exact documented demo acknowledgement, a
   positive daily order-group limit, and a positive per-position notional cap.
   Keep automatic analysis off, then clear each emergency-stop source
   deliberately after reconciliation and invoke one authenticated cycle.
6. Observe token renewal, placement, OCO peer cancellation, partial fills,
   expiry, restart, and reconciliation. Re-enable the stop after the session.

A credentialed, emergency-stopped, non-ordering demo preflight passed: renewable token rotation,
application/account authentication, trade permission, XAUUSD discovery,
300 M15/500 M5/600 M1 completed candles, four fresh depth levels per side, and
account-wide reconciliation with no position or pending order. A distinct
cTrader demo database identity was created; current-day deal history was empty;
the stable account state and cash-flow history were sampled twice; and the
one-time daily-risk baseline plus audit event committed. The feed exposed no live
account and did not supply 20 depth levels per side. No analysis or demo order
was created; supervised placement/OCO/cancellation testing remains pending.

The supervised-demo guardrail checkpoint defaults automatic analysis off while
retaining maintenance/reconciliation, exposes that state in status/Streamlit,
and rejects demo-enabled startup unless the exact acknowledgement plus daily
order-group and per-position notional caps are present. It does not enable demo
submission or clear an emergency stop. The first deployment correctly rejected
reuse of the prior strategy version after the safety-config hash changed; the
PM2 release identity is therefore advanced to the immutable
`0.1.0-demo-guardrails.1` version rather than altering stored provenance.

The versioned process then started with certain recovery. Protected local demo
settings now cap the session at one daily OCO group, 5,500 USD per position,
0.001% setup risk, 1% margin usage, and a 10-point absolute spread; automatic
analysis remains off. At the preflight quote, minimum native volume `100` with
volume scale `0.01` represented one XAU unit and about 4,645 USD notional, so the
notional cap permits only that minimum step at the observed price. This must be
rechecked immediately before authorization. Only one current 6-point spread was
observed and no 24-hour persisted demo spread sample existed, so the 10-point
cap is deliberately provisional rather than broker-reviewed evidence.

After restart, status reported demo mode, startup checks passed, trading
disabled, automatic analysis off, and environment emergency stop active. An
authenticated manual cycle rejected with `EMERGENCY_STOP_ENV` and no placement;
the demo execution journal, order, active-position, and fill counts remained
zero. Streamlit health returned `ok` and its configured AppTest rendered four
charts with no exception.

The operator then supplied the exact acknowledgement for one bounded supervised
window. Preflight still showed one-order and 5,500 USD notional caps, a six-point
spread under the provisional ten-point limit, certain reconciliation, zero
orders/positions/fills/journal events, and no daily lockout. The one authenticated
cycle rejected before AI, risk, intent, or broker placement with M1/M5/M15 gap
reasons and an order-book future timestamp. The database and environment
emergency stops were restored immediately, demo enablement and acknowledgement
were cleared, and all execution-state counts remained zero.

ISSUE-014 addresses those data-quality causes without relaxing validation. The
cTrader adapter now validates `ProtoOASymbol.schedule` and `scheduleTimeZone`,
marks only bounded gaps wholly outside weekly trading sessions, retains strict
rejection of missing bars during open sessions, and separates broker depth
source time from local receipt time. Snapshot collection captures broker server
time last and rejects future quote/book sources. Analytics rejects unmarked,
overlapping, misplaced, duplicate, unknown, and unbounded session-gap evidence
and exposes accepted counts per timeframe. Broker holidays are deliberately not
inferred: an override inside a weekly open interval still rejects. This follows
the official [model definitions](https://help.ctrader.com/open-api/model-messages/)
and the cTrader [no-tick trendbar behavior](https://help.ctrader.com/open-api/faq/).

A credentialed read-only probe used an alternate market-data process whose
client had order commands structurally disabled, plus the updated analytics
service. It received 600 M1, 500 M5, and 300 M15 completed candles with 1, 2,
and 3 trusted session gaps; depth was complete and continuous, and strict
analytics accepted the request with no rejection. Execution stayed stopped and
no order-capable cycle or broker command was invoked. The complete local gate
suite passed. Delivery merged in
[PR #16](https://github.com/AegisFintech/scalping-bot/pull/16).

PR #16 merged as `a81cfb2` and was built from `main`. PM2 restarted analytics,
market data, and execution, then saved the process list. Analytics, market data,
execution, and Streamlit health endpoints passed; execution readiness explicitly
reported `trading_allowed=false`. Status remained demo mode with automatic
analysis and trading disabled and reason codes
`DEMO_ACKNOWLEDGEMENT_INVALID`, `DEMO_TRADING_DISABLED`,
`EMERGENCY_STOP_DATABASE`, and `EMERGENCY_STOP_ENV`.

The deployed loopback snapshot again returned 600 M1, 500 M5, and 300 M15
completed candles with session-gap counts 1, 2, and 3. Strict deployed analytics
accepted it with no rejection; depth was complete/continuous and its broker
source timestamp preceded final server time. A read-only database check found
zero cTrader demo execution events, orders, active positions, and fills. No
execution cycle or order endpoint was invoked during deployment validation.

The operator supplied a fresh exact acknowledgement for one subsequent bounded
demo cycle. Preflight passed with strict analytics, a nine-point spread below
the ten-point cap, minimum notional below the 5,500 USD cap, zero daily loss,
and empty broker/local execution state. The cycle created no intent or order: it
failed closed at deterministic spread validation with `SPREAD_INPUT_INVALID`.
Persisted evidence isolated the input contract mismatch: M1 ATR was
`2.840095457306321069040301509` in analytics features while the risk boundary
permits at most ten fractional digits; PostgreSQL independently stored the
numeric value as `2.8400954573`. Automatic post-cycle emergency-stop cleanup
reconciled successfully. Demo enablement/acknowledgement were cleared, both
stops were restored, and execution-event/group/order/active-position/fill counts
remained zero.

ISSUE-015 canonicalizes derived analytics decimals to ten fractional places
with deterministic toward-zero truncation and explicit non-finite rejection.
Focused Python/risk tests pass. A credentialed stopped snapshot produced M1 ATR
`2.9329720428`; strict analytics accepted the request and the deterministic
absolute/ATR spread validator approved its six-point spread. No order-capable
cycle was invoked for this validation. The complete local quality, integration,
replay/backtest, security, and dependency gate suite passed. Delivery is tracked
in [PR #19](https://github.com/AegisFintech/scalping-bot/pull/19).

PR #19 merged as `38e8b77`. The merged analytics service was restarted while
demo/live submission, automatic analysis, and both demo emergency stops remained
disabled/active as appropriate. Production analytics emitted canonical M1 ATR
`2.7244341586` with ten fractional places and accepted the snapshot; deterministic
absolute/ATR spread validation approved the five-point observation. Execution
state remained at zero events, orders, active positions, and fills.

The fully configured adaptive check still correctly denies with
`SPREAD_HISTORY_MISSING`: only 2 of the required 30 distinct recent observations
exist. No percentile setting or minimum was weakened. Issue #20 adds a
read-only, one-per-minute durable sampler so this prerequisite is met with
genuine history rather than synthetic or manually seeded rows.

ISSUE-016 adds migration `0007` and a structurally read-only execution-service
sampler. It accepts only typed, fresh, broker-time-consistent, non-crossed quotes,
stores exact decimal bid/ask/spread and all three timestamps, and deduplicates on
account/symbol/broker-source UTC minute across retries and restarts. Adaptive
percentile context now reads this dedicated 24-hour history and still returns no
percentile below 30 distinct observations. Repeating percentiles are truncated
to the risk boundary's ten decimal places. The sampler has no analysis, model,
risk-intent, execution-gateway, or broker-command dependency. The complete Node,
Python, schema, migration, integration, replay/backtest, security, and dependency
gate suite passed. PR #22 merged as `3b0fd4d`. Migration `0007` was applied and
execution restarted while both emergency stops remained active, automatic
analysis stayed off, and demo/live submission stayed disabled. The sampler then
accumulated 30 consecutive genuine broker-source minute buckets without manual
or synthetic seeding. A final read-only preflight had 32 recent observations,
accepted strict 600/500/300-candle analytics, and approved a 9-point spread at
percentile `71.875` with no session abnormality. Execution events, groups,
orders, active positions, and fills remained zero; no order-capable cycle was
invoked.

A subsequent fresh acknowledgement authorized one bounded demo cycle. A first
empty-body request incorrectly declared JSON and Fastify rejected it before the
coordinator; cleanup restored the database stop and no cycle was recorded. A
diagnostic then exposed the local dashboard control token in tool output. The
token was immediately rotated in the protected environment and both execution
and dashboard consumers restarted; the disclosed value is no longer valid.

The corrected single cycle passed stopped preflight and reached `MODEL_PENDING`,
then failed closed with `inconsistent types deduced for parameter $1` under
analysis `ca2c49d7-f133-4a5f-a4e2-b36c5465b8a7`. `PostgresDecisionTrail.model()`
had reused one PostgreSQL parameter for UUID `model_requests.id` and text
`request_id`; its transaction rolled back, placement was null, and execution
events, groups, orders, active positions, and fills remained zero. ISSUE-017
binds the same generated ID through two distinct typed parameters. The
configured PostgreSQL regression proves request/response/validity atomic commit,
payload redaction, and complete rollback after a forced final-update failure.
Demo enablement and acknowledgement were cleared, both emergency stops were
restored, and another order-capable cycle requires fresh acknowledgement. The
complete Node, Python, integration, schema, migration, replay/backtest, security,
and dependency-audit suite passed for the fix.

PR #25 merged as `eae91f6`. The corrected execution service was rebuilt and
restarted with demo submission disabled, automatic analysis off, and both
emergency stops active. It reports ready startup recovery but
`tradingEnabled=false`. Execution events, groups, orders, active positions, and
fills remain zero, and the rejected pre-fix analysis has no partial model rows.
No deployment cycle was invoked; the prior acknowledgement remains consumed.

The next fresh acknowledgement authorized one post-fix bounded demo cycle.
Immediately before enablement, the stopped preflight accepted 600/500/300
completed candles, complete continuous depth, strict analytics, and a 5-point
spread at percentile `33.9622641509`. The minimum-volume notional was `4648.29`
under the `5500` cap; the reconciled daily baseline/current equity were both
`1000000` with zero loss and no durable execution state. The decision snapshot
then widened to 11 points at the 100th percentile, exceeding both configured
spread gates. Analysis `199c679e-abd5-43d5-9e39-1a161254c3ed` rejected before
model, risk sizing, intent, or placement. Mandatory database stop restoration,
strategy-owned cancellation, and reconciliation succeeded. Demo enablement and
acknowledgement were cleared, the environment stop was restored, and execution
events, groups, orders, active positions, and fills remained zero.

A later fresh acknowledgement requested automatic demo trading. Automatic
scheduling was not enabled because ISSUE-001 still lacks a successful first
supervised broker order lifecycle. One bounded attempt was allowed: its stopped
preflight passed at a 5-point spread/35th percentile and its final quote passed
at 7 points/`49.1803278688`. Analysis
`4ae9126d-d324-4b8a-8965-f689b7b479cb` persisted 600/500/300 completed candles,
accepted analytics and deterministic spread validation, and completed the AI
request/response. The model returned `NO_TRADE`, marked data quality false with
`SESSION_GAPS_PRESENT` and `MULTI_TIMEFRAME_DIRECTION_CONFLICT`, and semantic
validation rejected `MODEL_DATA_QUALITY_REJECTED` plus `QUOTE_STALE`. No risk
decision, intent, or order command was created. Cleanup/reconciliation passed,
demo enablement and acknowledgement were cleared, both stops were restored, and
all execution-state counts remained zero.

The accompanying observability check found the Streamlit health endpoint ready
and its PostgreSQL views able to show the completed candles, indicators, parsed
AI JSON, validations, order state, and correlated audit transitions. Better
Stack delivery is currently disabled and has no ingestion host or source token;
the implemented remote transport covers execution-service structured logger
events, not the complete PostgreSQL decision trail.

## Durable Better Stack audit mirror

ISSUE-018 adds a forward-only `observability_outbox` migration. Every new
PostgreSQL audit event enqueues one delivery row in the same transaction. The
execution service claims due rows with `SKIP LOCKED`, uses short leases for
crash recovery, and retries rejected or failed HTTPS delivery with bounded
exponential backoff. HTTP acceptance advances the row to `DELIVERED`; a crash
between remote acceptance and that checkpoint may produce a duplicate with the
same stable `event_id`.

The remote event is a bounded, recursively redacted summary. It carries stable
event, analysis, request, and order-group correlation plus stage outcome/reason
metadata. New summaries mark snapshot persistence, analytics, model completion,
risk intent, placement, and reconciliation without copying account IDs, broker
IDs, raw candle arrays, or full AI payloads. PostgreSQL remains authoritative
and remote logging cannot grant trading authority or override reconciliation.

Streamlit's Operations tab now shows aggregate outbox state and the latest 500
delivery checkpoints alongside existing audit charts. The runbook documents
Live Tail filters and SQL queries for a complete correlated database trail.
Existing pre-`0008` history is deliberately not backfilled.

The configured Better Stack source accepted a production-transport probe with
recursive redaction. Unit, migration, and isolated Neon integration tests then
passed for stable payloads, redaction, bounded retry, failed delivery, recovery,
lease-ownership conflict, fresh migration, upgrade, and no-backfill behavior.
PR #30 merged as `81ee7bb`; migration `0008` was applied with both emergency
stops active, and the execution/dashboard processes were rebuilt and restarted.
The startup reconciliation event's first HTTPS delivery was rejected and
persisted as `RETRY`; attempt two reached `DELIVERED` with no residual backlog,
demonstrating the deployed recovery path. The execution health endpoint was
ready with `trading_allowed=false`; Streamlit health returned `ok`, and its
configured AppTest rendered seven charts plus the Better Stack delivery section
with zero exceptions. Demo submission and automatic analysis stayed disabled,
all execution-state counts remained zero, and no analysis cycle or broker
command was run.

## Decision-time market refresh

A subsequent bounded manual demo cycle completed model inference after the
three-second quote freshness window. Analysis
`70e71671-6052-4ad4-b497-255eb13cb5d8` was correctly rejected for
`MODEL_DATA_QUALITY_REJECTED` and `QUOTE_STALE`; the model itself returned
`NO_TRADE` with session-gap, multi-timeframe conflict, low-ADX, elevated-M15-
volatility, and insufficient-sample warnings. It produced no risk decision,
intent, order group, order, fill, or broker command. The acknowledgement was
consumed and cleared, cleanup reconciled, Better Stack delivery completed, and
demo/automatic analysis were disabled under both restored stops.

ISSUE-019 keeps the strict freshness limit and instead reacquires a complete
market snapshot immediately after model persistence. A changed candle context,
changed execution metadata, failed refresh, or regressed broker time rejects
the cycle. The refreshed quote and order book are appended to PostgreSQL and
become the sole inputs to final spread, semantic, risk, and placement-freshness
checks; the original persisted candles remain the immutable model context. The
new immutable release identity is `0.1.0-decision-refresh.1` so deployment does
not rewrite prior code/config provenance. This enables another supervised demo
attempt after a fresh exact acknowledgement; it does not authorize scheduling
or guarantee that market/model/risk conditions will produce an order.

PR #33 merged as `21312cb`. The execution service was rebuilt from merged
`main` and restarted through the checked PM2 ecosystem with explicit safe
overrides only. It reports production application identity, immutable strategy
and code identity `0.1.0-decision-refresh.1`, certain startup recovery, and
readiness while demo submission and automatic analysis remain disabled under
both database and environment emergency stops. The release provenance row was
created without changing any prior version. Demo order groups, orders, active
positions, fills, and unresolved broker events remain zero. The startup audit
was rejected twice by Better Stack, then the bounded outbox retry delivered it
on attempt three and returned backlog to zero. No cycle or broker command was
run after deployment.

## AI timeout-budget coordination

A fresh acknowledgement opened one bounded manual demo window only after the
stopped preflight accepted complete 600/500/300 candles, continuous depth,
strict analytics, a 9-point spread at percentile `63.5514018691`, current risk
and caps, and empty execution state. Analysis
`672f21d7-d7dd-462b-8ec0-9854602dd4a1` reached `MODEL_PENDING` and then failed
closed because execution's 35-second local HTTP deadline expired while the AI
orchestrator was configured to permit up to three 30-second provider attempts.
The mandatory stop trap fired, strategy cancellation/reconciliation was
certain, and demo enablement/acknowledgement were cleared under both restored
stops. No model row, risk decision, intent, order, fill, active position, or
unresolved broker event exists; all eight analysis audit events were delivered
to Better Stack.

ISSUE-020 derives the local deadline from the full retry budget plus five
seconds of bounded grace, rejects invalid or platform-unsafe timer budgets at
startup, and maps timeout/abort and other transport failures to stable
`AI_ORCHESTRATOR_TIMEOUT`/`AI_ORCHESTRATOR_UNAVAILABLE` codes while opening the
caller circuit. The new immutable release identity is
`0.1.0-ai-timeout-budget.1`. This corrects coordination; it does not extend any
market freshness limit or authorize another demo window.

PR #36 merged as `eae2aff`. The merged execution service was rebuilt and
restarted with explicit safe overrides under immutable strategy/code identity
`0.1.0-ai-timeout-budget.1`. Production application identity, startup recovery,
and readiness passed while demo submission and automatic analysis remained
disabled under both database and environment emergency stops. The release
provenance row exists; demo groups, orders, fills, active positions, and
unresolved broker events remain zero. The slowest startup reconciliation audit
recovered through bounded Better Stack backoff and reached `DELIVERED` on
attempt five, returning backlog to zero. No cycle or broker command was run
after deployment.

A subsequent fresh acknowledgement authorized one capped post-fix demo cycle.
The stopped preflight accepted complete 600/500/300 candles, continuous depth,
strict analytics, current daily risk and caps, empty durable execution state,
and a 9-point spread at percentile `66.4`. Analysis
`4033a032-19d7-449d-b9c2-4a949004b091` then captured an 11-point spread and
rejected on both absolute-point and adaptive-percentile protection before any
model request, risk decision, intent, order group, or broker command. The
mandatory stop trap fired, cancellation/reconciliation was certain, demo
enablement and acknowledgement were cleared, both stops were restored, and
orders, fills, active positions, and unresolved broker events remained zero.
All six correlated audit events reached Better Stack on their first attempt.

The operator later made one exact acknowledgement continuing authorization for
bounded broker-demo attempts in the current readiness campaign. That scope did
not authorize real-money live execution or unattended automatic analysis. The
first two windows completed model calls but spanned M1 completed-bar rollovers;
analyses `6310314b-6a5f-41b1-9585-6517cd7ca92e` and
`f9fbb9b4-3835-40d7-ad07-796d43a6dfa6` therefore rejected
`DECISION_CANDLE_CONTEXT_CHANGED` before deterministic risk or any broker
command. This was expected immutable-context protection, not permission to
widen freshness or reuse stale inputs.

A third window was deliberately timed inside one completed-candle interval.
Its stopped snapshot had complete 600/500/300 candles, continuous four-by-four
depth, accepted analytics, a 5-point spread at percentile `28.6764705882`, and
empty durable execution state. Analysis
`09b34e95-0900-4273-8acf-8d370e2a073c` accepted the post-model market refresh
and both spread validations. The model returned `NO_TRADE` and marked data
quality unacceptable for multi-timeframe direction conflict, low M1 volume,
session-gap history, low trend strength, and no validated edge. Semantic
validation rejected `MODEL_DATA_QUALITY_REJECTED`; risk decisions, order groups,
orders, fills, active positions, and unresolved broker events all remained
zero. All three mandatory stop/cancel/reconciliation cleanups were certain, and
the deployment returned to disabled demo submission, disabled automatic
analysis, and both emergency stops active.

This evidence-only checkpoint passed formatting, linting, TypeScript
typecheck/build, 123 Node tests, 10 schema tests, 3 migration tests, all 3
configured PostgreSQL integration tests, Ruff format/lint, mypy, 30 Python
tests, replay/backtest, both dependency audits, secret and shell checks, and all
five offline systemd security parses at 2.8 (`OK`).

## Correlated Streamlit decision inspector

ISSUE-021 replaces the shallow AI-analysis row dump with a bounded read-only
inspector scoped to the dashboard's current account environment and symbol.
For a selected analysis it shows the pipeline state; completed-candle coverage;
initial and refreshed quote/depth records; deterministic analytics; request,
model, prompt, schema, strategy, payload mode, and immutable request hash; the
exact parsed/schema-validated AI JSON; every semantic/risk result; order and
cTrader callback state; and the chronological PostgreSQL audit trail with each
Better Stack delivery checkpoint.

The view does not change execution behavior or database contracts. Full candle
arrays, returns/pivot arrays, the full request, raw provider response text,
credentials, account IDs, and broker IDs are not rendered. Pure helpers retain
decimal strings, summarize array counts/boundaries, recursively redact audit
details, reject sensitive keys in model output, enforce display bounds, and
label missing validation/risk/order stages `NOT_REACHED`. Configured Streamlit
AppTest rendered both a complete model `NO_TRADE` path and a pre-model spread
rejection with zero exceptions; the latter explicitly showed AI, risk, and
order stages as not reached.

The complete checkpoint passed Prettier, ESLint, TypeScript typecheck/build,
123 Node tests across 28 files, 10 schema tests, 3 migration tests, all 3
configured PostgreSQL integration tests, Ruff format/lint, strict mypy across
analytics and dashboard code, 37 Python tests, replay/backtest smoke tests,
npm/pip dependency audits, secret scanning, shell syntax, and all five offline
systemd security parses at 2.8 (`OK`). No analysis cycle or broker command was
run.

PR #41 merged as `d64114a`. The PM2 dashboard process restarted from `main`,
the local Streamlit health endpoint returned `ok`, and configured AppTest again
passed the completed-model and pre-model-rejection paths. Execution remained in
demo mode with trading and automatic analysis disabled, startup checks passed,
and the emergency stop active. No execution service was restarted and no cycle
or broker command was invoked.

## Mandatory two-leg proposal contract and prompt history

ISSUE-022 introduces immutable system-v2/schema 2.0 for future analyses while
retaining system-v1/schema 1.0 artifacts for historical interpretation. The new
response has no decision field, `NO_TRADE` value, enabled/disabled leg switch,
or AI-controlled data-quality acceptance flag. Both conditional stop objects
are required. Conflicts and weak evidence remain visible through bounded
confidence, regime, evidence, risk, and warning fields rather than suppressing
the proposal.

The request now supplies exact non-sizing execution constraints: bid/ask,
digits, tick size, broker/configured minimum stop distance, reward-to-risk,
maximum ATR stop distance, and expiry bounds. It still excludes account money,
risk budget, volume, credentials, and execution authority. Post-model candle
identity, refreshed spread/quote/depth, semantic price rules, deterministic
sizing/exposure/margin, reconciliation, mode, and emergency gates remain
independent and fail closed.

Migration `0009` stores the exact non-secret system prompt and SHA-256 as a
bounded pair for each new request while leaving legacy rows null. The
orchestrator/consumer/database/dashboard verify the artifact rather than trust
an unbound label. Streamlit adds a scoped prompt/response history table, exact
system prompt, and opt-in exact persisted redacted user JSON. It labels model
levels as proposals, never as queued or broker orders.

The complete pre-merge gate rerun passed Prettier, ESLint, TypeScript
typecheck/build, 130 Node tests across 28 files, 12 schema tests, 3 migration
tests, all 3 configured PostgreSQL integration tests, Ruff format/lint, strict
mypy across analytics/dashboard, 41 Python tests, replay/backtest smoke tests,
npm/pip audits, secret scanning, shell syntax, and all five offline systemd
security parses at 2.8 (`OK`). The configured AI probe above used current
persisted market context only as read input and did not create an analysis run,
database row, execution state, or broker command. A preliminary ad-hoc semantic
probe passed an empty optional environment string where production supplies
`null` and therefore reported `SEMANTIC_DECIMAL_INVALID`; after matching the
production normalization, the repeated response passed with no semantic reason
codes.

PR #44 merged as `0d2f6cf`. Migration `0009` then applied with environment and
database emergency stops active. The AI, execution, and dashboard processes
restarted healthy under immutable identity `0.1.0-actionable-oco.1`; execution
reported demo mode, startup checks passed, trading false, and automatic analysis
false. Order groups, orders, fills, active positions, broker execution events,
and schema 2.0 request rows all remained zero. A probe through the deployed
loopback orchestrator returned both mandatory legs, no legacy switches, the
matching prompt artifact, and passed deterministic semantics. It did not write
the database or contact cTrader. Configured Streamlit AppTest rendered 11
historical runs, prompt history, exact prompt/input controls, and zero
exceptions. A follow-up display-only correction explicitly labels the selected
schema 1.0 self-veto as historical instead of calling it a current two-leg
proposal. That correction merged in PR #45 as `1fec8fe`; only the dashboard was
reloaded. Final health checks passed, configured AppTest showed the historical
notice, prompt/input controls, 11 history options, and zero exceptions, and the
execution service remained stopped with no order, fill, active-position, or
broker execution-event state.

## Automated demo release identity

The operator-authorized `.env` transition enables demo submission and automatic
analysis while retaining `TRADING_MODE=demo`, `CTRADER_CONNECTION_MODE=demo`,
`LIVE_TRADING_ENABLED=false`, the exact demo acknowledgement, positive daily
order-group/notional caps, and the active database emergency stop during staged
startup. Reusing `0.1.0-actionable-oco.1` correctly failed closed with
`STRATEGY_VERSION_IMMUTABILITY_VIOLATION` because automatic analysis is part of
the protected configuration hash. The failed process never became reachable,
the database stop was not cleared, and no analysis or broker command ran.

ISSUE-023 assigns `0.1.0-actionable-oco-auto-demo.1` instead of rewriting prior
provenance. Execution remains stopped until that identity passes the full gates,
merges, and starts successfully under the database emergency stop. Its complete
pre-merge suite passed 130 Node tests, 12 schema tests, 3 migration tests, all 3
configured PostgreSQL integration tests, 41 Python tests, formatting/lint/type
checks/build, replay/backtest, both dependency audits, secret/shell checks, and
all five offline systemd security parses at 2.8 (`OK`).

The identity merged in PR #48 and started successfully while the database stop
remained active. After that stop was cleared, schema-2 automatic analyses
`b0a366cc-cc27-479d-be72-7e97e2bd4fe7` and
`bfcf3355-511f-465f-8774-24b40737a4a9` persisted the exact system-v2 prompt,
redacted request, and mandatory two-leg response. Their 62.2-second and
32.7-second lifetimes crossed the next completed M1 boundary, so unchanged
post-model validation rejected `DECISION_CANDLE_CONTEXT_CHANGED`. No order
intent or broker command was created. New analyses were then paused while the
scheduler race was corrected.

## Broker-M1 automatic analysis scheduling

ISSUE-024 makes each automatic attempt a durable account/symbol/broker-minute
operation. The scheduler reads broker server time from the typed quote API,
allows a start only within the configured opening M1 window, and inserts the
unique PostgreSQL interval claim before calling the coordinator. A restart or
second scheduler tick cannot reuse that interval. Invalid server time,
out-of-range configuration, database failure, active prior state, and every
existing analysis/risk/reconciliation gate remain fail closed. Manual cycles
are unchanged.

The AI client and both runtime services now default to zero same-interval
retries. A provider timeout/failure waits for a new completed-candle interval
instead of extending inference across the current one. The post-model candle
fingerprint is still mandatory. Migration `0010` records interval, broker time,
cycle/analysis correlation, outcome, and completion; incomplete claims are
retained rather than replayed. Immutable release identity
`0.1.0-actionable-oco-auto-demo.2` protects the scheduling configuration.
The complete pre-merge suite passed format/lint/typecheck/build, 136 Node tests
across 29 files, 12 schema tests, 3 migration tests, all 3 configured PostgreSQL
integration tests, Ruff, mypy, 41 Python tests, replay/backtest, both dependency
audits, secret/shell checks, and all five offline systemd security parses at
2.8 (`OK`).

Credentialed deployment then proved that interval claims began inside the
broker-M1 opening window and that a schema-2 model response plus market refresh
completed without a candle-context rollover. The refreshed quote had already
crossed the proposed buy-stop entry, so the existing semantic executable-price
check rejected it before an order intent. Later provider HTTP failure opened the
bounded circuit as designed; a service restart or the configured reset interval
returns scheduling to later broker minutes.

## Terminal demo outcomes and automatic repetition

ISSUE-025 maps a fully closed single-deal demo position to one immutable trade.
It uses Decimal arithmetic over the cTrader close detail's signed gross profit,
swap, commission, and P/L conversion fee, and retains model, prompt, schema,
strategy, setup, regime, confidence, direction, and timestamps. The same event
deduplicates after restart. A different event attempting a second outcome is
journaled as a conflict and blocks readiness. Missing close detail and partial
closing state also remain explicit reconciliation blockers.

Order maintenance now releases an accepted analysis immediately after its group
is durably `CLOSED`, `EXPIRED`, or `FAILED`; it does not wait for `valid_until`.
The automatic scheduler can therefore claim a later broker minute after a
terminal lifecycle while active or uncertain state still blocks it. Streamlit
adds durable broker-minute claim history and the sanitized closed-trade outcome.
The first stopped PM2 deployment registered immutable release identity
`0.1.0-actionable-oco-auto-demo.3` with the retained prior daily cap of one.
Injecting the intended bounded cap of 20 afterward correctly failed with
`STRATEGY_VERSION_IMMUTABILITY_VIOLATION`. Both database controls remained
active, the execution API stayed offline, and no cycle or order ran. The
provenance row is not rewritten; ISSUE-026 assigns
`0.1.0-actionable-oco-auto-demo.4` and requires the cap to be present before its
first execution startup.

The pre-merge gate passed formatting, linting, TypeScript typecheck/build, 138
Node tests across 29 files, 12 schema tests, 3 migration tests, all 3 configured
PostgreSQL integration tests, Ruff, strict mypy, 43 Python tests,
replay/backtest, npm/pip dependency audits, secret and shell checks, and all five
offline systemd security parses at 2.8 (`OK`).

PR #54 preserved `.3` and deployed `.4` with the intended daily cap present
before the first execution startup. Startup recovery passed under the database
pause and emergency stop; active groups, orders, positions, and unresolved
broker events were all zero. The deployed Streamlit AppTest rendered the new
automatic-cycle and terminal-trade sections with zero exceptions. After release,
broker minutes 10:16 through 10:21 UTC repeated without operator action. They
terminated on spread, minimum-risk volume, stale quote, moved-entry semantics,
or notional volume as recorded in PostgreSQL; no order was submitted.

## Downward notional volume normalization

The 10:21 cycle showed both legs had loss-budget-valid raw volume but exceeded
the configured per-position notional if submitted at that size. ISSUE-027 floors
the positive notional ceiling to broker-native volume steps and takes the lower
of risk-normalized, notional-normalized, and broker-maximum volume. It then
recomputes maximum loss, margin, and final notional. A cap below broker minimum
still rejects, as does raw risk volume below broker minimum. This cannot increase
volume or any configured ceiling. Immutable candidate identity
`0.1.0-actionable-oco-auto-demo.5` protects the behavior.

The complete pre-merge gate passed format/lint/typecheck/build, 143 Node tests
across 29 files, 12 schema tests, 3 migration tests, all 3 configured PostgreSQL
integration tests, Ruff, strict mypy, 43 Python tests, replay/backtest, npm/pip
dependency audits, secret/shell checks, and all five offline systemd security
parses at 2.8 (`OK`).

PR #56 merged the notional correction and immutable `.5` started under the
database pause and emergency stop with the cap of 20 already protected by its
strategy hash. Startup recovery was certain and its broker scope was empty.
After release, analysis `1d484be6-9932-48fe-8313-0645b6ecebdf` placed cTrader
demo OCO group `29f9bc8e-8e50-4230-824d-2e1005aeab15` at 10:29 UTC. Both
minimum-volume legs were broker accepted: buy 4650.10 / stop 4646 / target
4658.30 and sell 4642.40 / stop 4646 / target 4635.20. Each final volume was
100, each estimated margin was 4.64, and each maximum-loss budget was 5. Better
Stack received the correlated analysis, risk, intent, and placement stages.
The still-pending OCO expired automatically at 10:34:17 UTC; the analysis,
group, and both orders became terminal with `ANALYSIS_EXPIRED` and no manual
broker action.

## Demo callback ordering and durable readiness

The first credentialed expiry exposed a post-terminal readiness defect. cTrader
can synchronously emit an order acceptance before the placement response has
returned and before its broker order ID is committed to the local intent. The
callback was therefore unmatched, and the recorder retained that reason in
memory even after durable terminal reconciliation. Order maintenance performed
the correct expiry/cancellation, but automatic analysis remained blocked until
a stopped execution restart rebuilt readiness from PostgreSQL.

ISSUE-028 queues raw placement callbacks until the OCO placement transaction has
stored both broker IDs, drains them before the accepted state transition, and
allows a strategy-labelled callback without a client order ID to match by its
broker order ID. Recorder readiness now reflects current unresolved PostgreSQL
journal rows instead of permanently latching a persistence result: a final fill
may resolve prior partial evidence while the retained rows remain auditable.
Normalization exceptions, persistence failures, unmapped/conflicting rows, and
unresolved reasons still block. The new immutable candidate is
`0.1.0-actionable-oco-auto-demo.6`; deployment remains stopped until the full
gate suite and merge complete.

The complete ISSUE-028 pre-merge suite passed Prettier, ESLint, TypeScript
typecheck/build, 146 Node tests across 29 files, 12 JSON Schema tests, 3 static
migration tests, all 3 configured isolated-PostgreSQL integration tests, Ruff
format/lint, strict mypy over 19 source files, 43 Python tests, replay/backtest
smoke tests, npm/pip audits with zero known vulnerabilities, secret and shell
checks, and all five offline systemd security parses at 2.8 (`OK`).

PR #58 merged ISSUE-028 as `565d9fb`. Immutable `.6` started under both
database controls with one matching strategy-version row, certain startup
recovery, and zero active groups, orders, positions, or unresolved events.
After release, broker minutes 10:43 through 10:47 repeated automatically through
post-model refresh, stale-market, and spread rejections. At 10:48:36 UTC, `.6`
automatically placed cTrader demo OCO group
`639eefab-6bba-4316-abfa-03595dbb984f`; both minimum-volume legs returned broker
IDs and pending status. They and the accepted analysis expired terminally at
10:49 UTC. The unchanged PID `2470326` nevertheless retained
`OPERATIONAL_RISK_LOCKOUT` and `RECONCILIATION_UNCERTAIN`. The database had zero
callback journal rows/unresolved rows and only 2 of the configured 20 daily
groups, isolating the remaining failure to a callback normalization or
persistence exception before insertion. Both database controls were reactivated
before further development.

ISSUE-029 introduces a diagnostic-only immutable `.7` boundary. Recorder
exceptions remain fail closed, but an allowlisted stable reason, processing
stage, execution/order enums, and field-presence booleans are sent to the local
structured log and Better Stack and included in status. Raw broker payloads,
labels, client/broker IDs, and untrusted database error text are excluded by
construction and negative tests. `.7` does not claim to fix or clear the broker
exception; issue #59 remains open until the observed shape is corrected and a
terminal same-PID automatic repeat is demonstrated.

The `.7` observation release passes Prettier, ESLint, TypeScript
typecheck/build, 148 Node tests across 29 files, 12 JSON Schema tests, 3 static
migration tests, all 3 configured isolated-PostgreSQL tests, Ruff format/lint,
strict mypy over 19 source files, 43 Python tests, replay/backtest smoke tests,
npm/pip audits with zero known vulnerabilities, secret and shell checks, and
all five offline systemd security parses at 2.8 (`OK`).

The `.7` observation session automatically claimed broker minutes 10:55 through
11:01 UTC under PID `2471803`; stale market/book and spread failures repeatedly
released without intervention. At 11:01 the external AI path returned HTTP 503.
The execution-side `AiOrchestratorHttpClient` set a permanent boolean circuit,
while execution safety then blocked every future `analyze()` call that could
clear that same boolean. The provider breaker had a configured 300-second reset,
but the caller could not reach its half-open state without an execution restart.
Both database controls were reactivated and issue #61 records the deadlock.

ISSUE-030 replaces only that caller boolean with a validated reset timestamp.
Timeout, transport loss, and HTTP 503 open it for the unchanged configured
interval; the getter remains fail closed before the boundary and becomes
eligible exactly at expiry. A later normal scheduler cycle acts as the half-open
probe. A fully validated response clears the timestamp; another transient
failure reopens it. Zero, fractional, unsafe, or timer-overflowing reset values
reject startup. Immutable candidate identity is
`0.1.0-actionable-oco-auto-demo.8`.

The complete `.8` suite passes Prettier, ESLint, TypeScript typecheck/build, 154
Node tests across 29 files, 12 JSON Schema tests, 3 static migration tests, all
3 configured isolated-PostgreSQL tests, Ruff format/lint, strict mypy over 19
source files, 43 Python tests, replay/backtest smoke tests, npm/pip audits with
zero known vulnerabilities, secret/shell checks, and all five offline systemd
security parses at 2.8 (`OK`).

Deployed `.8` PID `2473046` received a real HTTP 503 at 11:10:38 UTC. It stayed
blocked for the configured interval, half-opened automatically at 11:15:37, and
claimed broker minute 11:16 without restart. That probe received another 503,
reopened, and again half-opened at 11:21:43. Broker minute 11:22 then completed
the AI/risk path and automatically placed OCO group
`cb2eb248-34ce-4af8-8116-fb6650883bcc`, proving repeated caller recovery.

The `.7` diagnostic boundary identified the remaining callback failure without
raw payloads: execution type 2 (`ORDER_ACCEPTED`), order status 1 (pending),
order/client ID/strategy label present, position present, and no deal, with
`CTRADER_FIELD_INVALID:price`. Official cTrader fields permit `position.price`
to be absent. Because pending acceptance has no deal and does not establish a
position, ISSUE-029's `.9` candidate validates ownership/symbol and persists the
accepted order while ignoring only that acceptance-time position placeholder.
Fill and partial-fill events continue to require authoritative deal evidence
and a priced position. The pending `.8` OCO was cancelled through the audited
emergency control; both orders, group, and analysis became terminal before code
changes began.

The complete `.9` suite passes Prettier, ESLint, TypeScript typecheck/build, 156
Node tests across 29 files, 12 JSON Schema tests, 3 static migration tests, all
3 configured isolated-PostgreSQL tests, Ruff format/lint, strict mypy over 19
source files, 43 Python tests, replay/backtest smoke tests, npm/pip audits with
zero known vulnerabilities, secret/shell checks, and all five offline systemd
security parses at 2.8 (`OK`).

The credentialed `.9` cycle then proved the complete broker side of the POC:
one stop entry filled, its OCO peer cancelled, and cTrader's server-created
SL/TP order closed the position. The callback adapter treated the unpriced
non-deal cancellation context as a position and treated the closing child's
new broker order ID as a conflict with the inherited entry client ID. ISSUE-031
adds journal schema `1.1`, preserves exact entry identity, maps the child through
the durable position, and recovers the terminal single-deal close from broker
history when reconciliation no longer returns the position. Candidate `.10`
remained stopped until migration, merge, deployment recovery, and an unattended
terminal repeat proved the same PID could continue automatically.

The `.10` pre-merge suite passes Prettier, ESLint, TypeScript typecheck/build,
161 Node tests across 29 files, 12 JSON Schema tests, 3 static migration tests,
all 3 configured isolated-PostgreSQL integration tests, Ruff format/lint,
strict mypy over 16 source files, 43 Python tests, replay/backtest smoke tests,
zero-vulnerability npm/pip audits, secret and shell checks, and all five
offline systemd security parses.

PR #65 merged as `1f20fffb`. Migration `0011` applied under both database
controls, and `.10` started as PID `2476750`. Startup recovery used the original
mapped entry fill plus the exact broker-created closing order/deal to produce a
closed position/group, expired analysis, one demo trade with realized P/L
`-4.83`, and zero unresolved event rows. The pause and emergency controls were
then released; status reported automatic analysis and demo trading enabled,
startup checks passed, and no reason codes.

The same PID automatically claimed 11:47 and 11:53 UTC. The external endpoint
returned HTTP 503 on each; both intervals completed rejected without orders,
and the execution caller half-opened after each configured cooldown without a
restart. The 11:59 claim stored a completed AI response but the post-model
refresh rejected stale market/book data. The terminal rejection released
immediately, and 12:00 was claimed automatically; its completed AI/validation/
risk path rejected both risk-based volumes below the broker minimum. PID,
controls, and readiness remained healthy. This is active unattended demo
automation, while every invalid or unsafe cycle continues to create no order.

## Operator-readable automation and AI request trail

The reported midnight stop was a presentation problem, not a dead scheduler.
PostgreSQL showed continuing broker-minute claims through 01:05 UTC on August
25 (09:05 Asia/Singapore) under PID `2476750`. Five-minute gaps followed real
external-AI HTTP 503 responses because the execution caller correctly retained
its 300-second circuit cooldown, then resumed under the same PID. Other claimed
minutes ended as explicit market-data, spread, refresh, or minimum-volume
rejections. Those terminal cycle outcomes did not disable later scheduling.

ISSUE-032 exposes the caller's bounded circuit expiry as a non-secret local
status timestamp. Streamlit now separates scheduler enablement, immediate order
eligibility, the last terminal cycle, and active safety gates. Every status
keeps its exact reason code while adding plain-language impact and next action;
`AI_CIRCUIT_OPEN` is labelled as a temporary automatic wait with UTC and
Asia/Singapore retry times, not a permanent trading stop.

The AI inspector defaults to the newest analysis with a durable model request,
labels analyses with and without one, and opens the exact hash-verified system
message plus exact persisted redacted user JSON near the top. Endpoint URLs,
authorization headers, account identifiers, and credentials remain excluded.
PostgreSQL contained completed model requests with both prompt artifacts and
redacted payloads after midnight; runs that failed before a durable response
remain honestly labelled as having no durable AI request rather than implying a
prompt record exists.

The pre-merge checkpoint passed Prettier, ESLint, TypeScript typecheck/build,
161 Node tests across 29 files, 12 JSON Schema tests, 3 static migration tests,
all 3 configured isolated-PostgreSQL integration tests, Ruff format/lint, strict
mypy over 19 source files, and 49 Python tests. The configured Streamlit AppTest
rendered the current database with the automation explanation and exact-request
section visible and zero exceptions. Replay/backtest smoke tests, npm/pip audits
with zero known vulnerabilities, secret and shell checks, and all five offline
systemd security parses also passed. The host used Node 24.18.0; Node 22 remains
the supported deployment baseline. Delivery is tracked in
[PR #68](https://github.com/AegisFintech/scalping-bot/pull/68).

## Shadow-mode setup

After demo market-data validation, use a separately authorized live-data account
with `TRADING_MODE=shadow`, `CTRADER_CONNECTION_MODE=live`,
`SHADOW_MODE=true`, and `LIVE_TRADING_ENABLED=false`. The shadow gateway records
hypothetical outcomes but has no broker submission method. Clear emergency stops
only for an intentional supervised observation period and verify the dashboard
banner before relying on collected evidence.

No credentialed shadow session was run in this checkout.

## Deliberately disabled or incomplete

- Live broker order submission is not wired and cannot be enabled by
  configuration.
- Demo order submission defaults off and needs a separate exact acknowledgement.
- Demo execution callbacks now enter a normalized, deduplicated PostgreSQL
  journal and atomically update order/fill/position/trade state. Bounded startup
  and reconnect history recovery is fail closed. Fully closed single-deal
  outcomes are supported; partial/multiple closes remain blocked.
- Streamlit now renders bounded, mode-labelled operational charts through pure
  validated builders. Completed-candle, malformed OHLC, enum, numeric, empty,
  and mode-separation paths are covered; a configured AppTest run rendered four
  current-data charts without an exception. The merged dashboard was restarted,
  its local health endpoint returned `ok`, and the same configured render check
  passed after deployment while demo submission stayed disabled and emergency
  stop stayed active.
- A quote/deposit currency conversion provider is absent; mismatched currencies
  fail closed.
- Better Stack rotating/remote structured logging and the durable audit-event
  mirror run in execution-service only. Persistent host/process metrics remain
  in PostgreSQL; OTLP export and the optional Better Stack heartbeat URL are not
  implemented.
- Demo full-close field ordering still needs credentialed supervised evidence;
  unresolved callback/recovery evidence and reconciliation counts fail closed.
- Remote dashboard access depends on the externally managed Cloudflare Access
  application; the repository deliberately bundles no identity provider.

## Requirements before live-readiness review

1. Implement and independently review broker-capable live composition; retain
   every gate in `docs/demo-to-live-checklist.md` and add exhaustive denial tests.
2. Review the applied target Neon migrations, exercise outage behavior, and
   prove encrypted backup plus isolated restore.
3. Validate Node 22/Debian deployment, installed systemd services, permissions,
   restart behavior, and graceful shutdown.
4. Validate exact broker symbol IDs, precision, native volume scale, tick value,
   contract/margin semantics, minimum distances, depth support, capital-flow
   classifications, and currency conversion.
5. Complete repeated supervised demo and shadow sessions, including partial fill,
   cancellation race, disconnect, token refresh, restart, duplicate event,
   stale-data, and daily-lockout drills.
6. Extend and validate structured logs/metrics/heartbeats across services;
   exercise Better Stack alerts and critical audit failure behavior.
7. Review and drill Cloudflare Access policies/audit retention, least-privilege
   database roles, retention policies, time synchronization monitoring, and
   operator runbooks.
8. Obtain broker-reviewed spread, slippage, session, margin, exposure, and stop
   settings for the exact account/symbol.

Even after those items, live trading must still require the environment boolean,
exact runtime acknowledgement, manually created restrictive enablement file,
successful startup checks, short-lived dashboard/database acknowledgement, no
emergency stop or risk lockout, fresh data, empty reconciled relevant broker
state, current metadata, valid AI output, deterministic risk approval, and
healthy critical audit persistence. Nothing should enable those gates
automatically.
