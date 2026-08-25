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

PR #68 merged as `aabeffc2`. Deployment briefly activated the audited database
analysis pause, confirmed no analysis remained in progress, rebuilt from merged
`main`, and restarted only execution and Streamlit. Execution PID `2487239`
reported demo mode, automatic analysis enabled, startup checks passed, the new
`aiCircuitOpenUntil` status field, and the expected pause reason. Dashboard PID
`2487252` returned healthy; configured AppTest rendered the plain-language
automation state, exact system message, and exact redacted user JSON with zero
exceptions. The pause was then cleared with an audited reason. Status returned
trading eligible with no emergency stop or reason codes.

At 01:16:01 UTC (09:16:01 Singapore), the restarted scheduler claimed the next
broker minute without operator invocation. It completed at 01:16:07 with a
terminal deterministic spread rejection (`SPREAD_PERCENTILE_EXCEEDED` and
`SPREAD_POINTS_EXCEEDED`) before AI, order intent, or order group creation. This
is post-deployment evidence that the automatic loop resumed while preserving
fail-closed behavior; it is not a trade or profitability result.

## ISSUE-033 endpoint TP midpoint

Issue [#70](https://github.com/AegisFintech/scalping-bot/issues/70) versions the
current endpoint instructions as `system-v3`. The exact request tells the model
that execution will preserve entry and stop loss while dividing TP distance by
two. It supplies a proposal minimum R:R equal to twice the configured effective
minimum, preventing a valid 2:1 execution target from being requested as only a
2:1 pre-transform target and then reduced below policy.

The schema-validated endpoint JSON remains immutable in `model_responses`.
After the post-model market refresh, the coordinator validates that original
proposal, computes each TP midpoint with Decimal arithmetic, rejects rather than
rounds an off-tick midpoint, recomputes R:R, and validates the effective proposal
before deterministic sizing. `validation_results.details` and the corresponding
redacted audit event retain the divisor plus both original/effective TP and R:R
values. Streamlit displays that comparison immediately under the exact AI
output. The gateway still receives only normalized commands after freshness,
spread, daily-loss, exposure, reconciliation, idempotency, mode, and risk gates.
No database migration is required: prompt versions are unconstrained text and
the existing bounded `validation_results.details` JSONB contract already owns
stage-specific deterministic evidence.

The existing broker-minute scheduler and terminal lifecycle are unchanged: an
active/uncertain OCO or position blocks another cycle; expiry, placement failure,
or a fully reconciled TP/SL closure releases a later fresh broker minute. Live
broker composition remains unwired, and no default demo/live enablement was
added.

The 2026-08-25 pre-merge suite passed Prettier, ESLint, TypeScript typecheck and
build, 165 Node tests across 30 files, 12 JSON Schema tests, 3 static migration
tests, and all 3 configured isolated-PostgreSQL integration tests, including the
new durable transform/audit-detail assertion. Ruff format/lint, strict mypy over
19 source files, and 51 Python tests passed. Configured Streamlit AppTest rendered
30 dataframes with zero exceptions. Replay/backtest smoke tests, zero-vulnerability
npm/pip audits, tracked-file secret scan, shell/PM2 syntax checks, and all five
offline systemd security parses at 2.8 (`OK`) passed. The host used Node 24.18.0,
npm 11.16.0, and Python 3.13.5; Node 22 remains the supported deployment
baseline. PR #71 merged as `8f3364a`. Release `.11` deployed under the audited
analysis pause, registered `system-v3`/schema 2.0, passed startup reconciliation,
and resumed automatic demo analysis. The first complete endpoint cycle persisted
original 4:1 levels, effective midpoint 2:1 levels, and unchanged entry/SL; its
transform validation event reached Better Stack. ISSUE-033 is complete.

## ISSUE-034 broker-minimum stop affordability

That first complete deployed `system-v3` cycle returned 6.00-wide buy and sell
stops. At broker minimum volume, both exceeded the configured half-setup-risk
budget, so deterministic sizing correctly rejected
`BUY_RISK_VOLUME_BELOW_MIN` and `SELL_RISK_VOLUME_BELOW_MIN` before intent.

Issue [#72](https://github.com/AegisFintech/scalping-bot/issues/72) addresses
that observed request-contract gap without changing a returned SL or bypassing
risk. Before inference, the coordinator reconciles account state and derives
the maximum whole-tick stop distance that broker minimum volume can afford when
the configured setup risk is split across both OCO legs. Prompt `system-v4`
receives only that distance—never equity, a money budget, volume, or account
identity—and requires both proposed SL distances to remain within it. The
coordinator recomputes the constraint after inference; a lower budget or changed
metadata rejects the unchanged endpoint output. The existing risk engine still
independently sizes volume and enforces loss, notional, margin, daily, exposure,
freshness, reconciliation, idempotency, and demo-mode gates.

Automatic analyses are paused during implementation so repeated paid endpoint
calls do not reproduce the already-understood rejection. Maintenance and
reconciliation continue.

The 2026-08-25 pre-merge suite passed Prettier, ESLint, TypeScript typecheck and
build, 171 Node tests across 30 files, 13 JSON Schema/semantic tests, 3 static
migration tests, and all 3 configured isolated-PostgreSQL integration tests.
Ruff format/lint, strict mypy over 19 source files, and 51 Python tests passed.
Configured Streamlit AppTest rendered 32 dataframes with zero exceptions.
Replay/backtest smoke tests, zero-vulnerability npm/pip audits, tracked-file
secret scan, shell/PM2 syntax checks, and all five offline systemd security
parses at 2.8 (`OK`) passed. No migration is required because the payload is a
versioned request artifact and the existing bounded validation-detail contract
stores the derived constraint. PR #73 merged as `b07022a`; release `.12`
registered `system-v4`/schema 2.0 and restarted healthy under an audited pause.
The endpoint needed longer than the prior 30-second operational timeout, so the
ignored mode-0600 environment now uses 60 seconds; no risk or execution gate
changed. The supervised automatic 10:11 GMT+8 cycle then completed a durable
request with `max_affordable_stop_distance=4.99`. Both returned stop distances
were within it; proposal 4:1 semantics, TP midpoint 2:1 semantics, and sizing
all passed. ISSUE-034 is complete.

## ISSUE-035 final pre-placement refresh

That `.12` cycle still rejected `MARKET_DATA_STALE` at the placement gate. The
post-model quote was fresh when validated, but deterministic broker margin work
consumed the remaining three-second freshness budget. Reusing it would be
unsafe, while increasing the freshness threshold would weaken the documented
contract.

Issue [#74](https://github.com/AegisFintech/scalping-bot/issues/74) therefore
adds a second, explicitly labelled `PRE_PLACEMENT` refresh after sizing. Account
state is reconciled first and any changed equity, balance, margin, exposure,
pending/fill/cancel, or certainty evidence rejects. The final snapshot must
preserve completed candles and execution metadata; spread and both immutable AI
proposal/effective TP semantics run again. Only its quote/depth ages drive the
unchanged placement gate. Unit tests cover slow-margin success, unavailable
final market data, changed account state, and a trigger invalidated by the final
quote. PostgreSQL integration records both refresh phases while retaining the
original candle context. No migration is required because the existing bounded
audit and validation detail JSON owns the new phase/scope evidence.

The 2026-08-25 pre-merge suite passed Prettier, ESLint, TypeScript typecheck and
build, 176 Node tests across 30 files, 13 JSON Schema/semantic tests, 3 static
migration tests, and all 3 configured isolated-PostgreSQL integration tests.
Ruff format/lint, strict mypy over 16 Python source files, and 51 Python tests
passed. Configured Streamlit AppTest rendered 32 dataframes with zero
exceptions. Replay/backtest smoke tests, zero-vulnerability npm/pip audits,
tracked-file secret scan, shell/PM2 syntax checks, and all five offline systemd
security parses at 2.8 (`OK`) passed. PR
[#75](https://github.com/AegisFintech/scalping-bot/pull/75) merged as
`e8cb49c685094a2ea07d9597b1c23a045d4a3414`; release `.13` deployed. The next
automatic `.14` cycle at 10:27 Asia/Singapore recorded both refresh phases,
passed the repeated account, market, spread, semantic, and freshness checks,
placed and mapped both demo pending stops, and finished `ACCEPTED`. ISSUE-035
is complete.

## ISSUE-036 compact endpoint tails

A supervised `.13` compact request serialized to roughly 71 KB. About 61 KB
(87%) was duplicated raw candle arrays: 180 M1, 100 M5, and 50 M15 bars. The
deterministic analytics service had already computed every indicator/statistic
from the full 600/500/300 completed-candle histories. The next external call
exceeded the 60-second budget; longer inference also increases the chance that
a conditional entry is crossed before post-model validation.

Issue [#76](https://github.com/AegisFintech/scalping-bot/issues/76) changes only
compact raw-tail defaults to 60/36/24. Full analytics history, derived features,
order-book/performance context, execution constraints, strict response schema,
and every downstream gate remain unchanged. Explicit overrides must be positive
integers no larger than collected history or startup rejects. Release `.14`
versions this model-input change; unit tests cover defaults, bounded overrides,
and fail-closed invalid configuration.

Applying the new tails to the exact prior durable request estimates 31,687
serialized bytes versus 70,953, a 55.3% reduction before HTTP-envelope overhead.
The 2026-08-25 pre-merge suite passed Prettier, ESLint, TypeScript typecheck and
build, 179 Node tests across 31 files, 13 schema tests, 3 migration tests, and
all 3 configured isolated-PostgreSQL integration tests. Ruff format/lint,
strict mypy over 16 Python source files, and 51 Python tests passed. Configured
Streamlit AppTest rendered 31 dataframes with zero exceptions. Replay/backtest,
zero-vulnerability npm/pip audits, tracked-file secret scan, shell/PM2 syntax,
and all five offline systemd security parses at 2.8 (`OK`) passed. PR
[#77](https://github.com/AegisFintech/scalping-bot/pull/77) merged as
`b909be75af526fcf3b017c5958800f0330abe5d6` and release `.14` deployed. The
first deployed request retained explicit ignored-environment overrides of
180/100/50; those local values were corrected to 60/36/24 and loaded by release
`.15`. The unattended `.16` cycle at 10:56 Asia/Singapore then durably recorded
exactly 60 M1, 36 M5, and 24 M15 raw candles in a 34,714-byte redacted request,
versus 77,597 bytes for the prior 180/100/50 request, a measured 55.3% reduction.
Model-pending at 10:56:10.363 to model-completed at 10:56:39.238 measured 28.9
seconds. The full 600/500/300 analytics histories and derived features remained;
the response passed validation and placed both demo pending stops. ISSUE-036 is
complete.

## ISSUE-037 repeated fill callback deduplication

The first fully automated demo OCO placed both pending stops. Its sell leg later
filled and the buy peer cancelled. The valid entry deal mapped durably; five
seconds later cTrader repeated execution type 3 with order, position, and deal
present but omitted the open-position `price`. Strict normalization correctly
rejected `CTRADER_FIELD_INVALID:price`, but it ran before PostgreSQL could use
the already-mapped deal ID to recognize the duplicate, leaving an operational
lockout.

Issue [#78](https://github.com/AegisFintech/scalping-bot/issues/78) adds a
process-local optimization around the durable authority: the recorder remembers
a broker fill ID only after normalization and certain store persistence. An
exact repeat can then be discarded before parsing weaker contextual position
data. A new deal ID, first malformed callback, or uncertain/failed persistence
still enters strict normalization and fails closed. Database uniqueness and
restart recovery remain unchanged. Release `.15`, unit tests, dashboard reason
guidance, and operator documentation cover the observed shape; deployment waits
for the current demo position to reach a safe terminal boundary.

The 2026-08-25 pre-merge suite passed Prettier, ESLint, TypeScript typecheck and
build, 182 Node tests across 31 files, 13 schema tests, 3 migration tests, and
all 3 configured isolated-PostgreSQL integration tests. Ruff format/lint,
strict mypy over 16 Python source files, and 51 Python tests passed. Configured
Streamlit AppTest rendered 34 dataframes with zero exceptions. Replay/backtest,
zero-vulnerability npm/pip audits, tracked-file secret scan, shell/PM2 syntax,
and all five offline systemd security parses at 2.8 (`OK`) passed.

PR [#81](https://github.com/AegisFintech/scalping-bot/pull/81) merged as
`087d6f451c70a5c5bce185828c2c385753ed4f0c`. Release `.16` deployed with the
durable analysis pause active. Startup recovery and readiness passed with zero
active local groups, orders, positions, or unresolved broker events. Clearing
only that pause produced a healthy status: demo mode, automatic analysis on,
trading enabled, and no blocking reasons.

The scheduler then claimed every broker minute without operator cycles. Runs
from 10:48 through 10:55 ended explicitly on live spread protection or a
transient market-snapshot 503. The 10:56 run passed collection/analytics,
persisted the compact external-AI request and response, repeated final market
and account validation, finished `ACCEPTED`, and placed/mapped one pending BUY
and one pending SELL in the demo OCO group. The running system therefore has
the requested automatic state: while those orders or a resulting position are
active it waits; after expiry or exact TP/SL closure, the 15-second recovery and
next eligible broker-minute scheduler continue without an operator restart.
ISSUE-038 is complete.

PR [#79](https://github.com/AegisFintech/scalping-bot/pull/79) merged as
`8fead83ed2b071653415d8d80abbb2e76fb7b041`. Broker reconciliation then showed
that the sell position had already closed at its stop loss and that no broker
position or order remained; the terminal callback had not reached the durable
journal. Analyses were durably paused, release `.15` deployed, and bounded
startup recovery mapped the exact closing order/deal. The local position and
group became `CLOSED`, and the demo trade recorded −3.27 realized P/L including
−0.28 fees. Startup checks passed with no unresolved broker state. The corrected
60/36/24 compact-tail values are loaded in the running process. ISSUE-037 is
complete.

## ISSUE-038 automatic running terminal recovery

The stop-loss evidence proved that callback-only lifecycle progress is not
sufficient for continuous automation: cTrader history contained the exact
terminal closing order/deal, but the same running process retained an open local
position until startup recovery ran. Operator restarts must not be part of the
automatic trading loop.

Issue [#80](https://github.com/AegisFintech/scalping-bot/issues/80) therefore
runs the existing bounded history recovery before scheduler safety evaluation,
at a default 15-second cadence configurable only from 5 through 300 seconds.
Broker-reconnect refreshes and timer attempts share one in-flight operation. A
unique complete closing order/deal can atomically close the position, trade, and
group; open broker state or missing, ambiguous, paginated, multiple, invalid,
or failed evidence remains blocking. Release `.16` adds the serialized runner,
stable dashboard explanation, sample configuration, and positive, throttle,
concurrency, invalid-configuration, and thrown-recovery tests. Automatic demo
analysis remains durably paused pending merge and stopped-state rollout.

The 2026-08-25 pre-merge suite passed Prettier, ESLint, TypeScript typecheck and
build, 185 Node tests across 32 files, 13 schema tests, 3 migration tests, and
all 3 configured isolated-PostgreSQL integration tests. Ruff format/lint,
strict mypy over 19 Python source files, and 51 Python tests passed. Configured
Streamlit AppTest rendered 34 dataframes with zero exceptions. Replay/backtest,
zero-vulnerability npm/pip audits, tracked-file secret scan, shell/PM2 syntax,
and all five offline systemd security parses at 2.8 (`OK`) passed.

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

## Deterministic hybrid chart analysis

ISSUE-039 adds analytics response 1.1, prompt `system-v5`, and model response
schema 2.1. Analytics renders a deterministic 1600x1200 PNG from the exact
accepted M15/M5/M1 completed candles and per-candle EMA/ATR values. The PNG is
bounded to 1 MiB and carries its SHA-256, renderer version, dimensions, candle
counts, and latest end times. A quality or render rejection returns no partial
image. The compact numeric payload retains its existing features and adds only
the image provenance; the typed AI request attaches the bytes as high-detail
multimodal content for both Responses and Chat-Completions styles.

The schema 2.1 technical map records the immediate decision zone,
support/resistance zones, buffered bullish/bearish confirmation prices, and
ordered targets. Deterministic semantics require waiting-area equality, entry
equality with the corresponding confirmation, tick-aligned zones/targets, and
exact equality between each first target and the configured post-transform
broker TP. Existing sizing, volume, precision, freshness, spread, account,
reconciliation, daily-loss, idempotency, emergency-stop, and mode gates remain
unchanged.

Migration `0012` stores one bounded chart artifact per analysis. The analytics
client, AI client, PostgreSQL trail, and Streamlit inspector independently
verify PNG signature/IHDR dimensions and SHA-256. Streamlit displays the exact
image beside the exact persisted prompt and redacted numeric JSON, followed by
the parsed technical map and effective OCO comparison.

A provider-only probe used the configured endpoint and the durable 10:56
Asia/Singapore numeric snapshot plus its newly rendered image. It completed in
54.2 seconds with strict schema 2.1; no database intent or broker call was made.
The returned buy/sell entries exactly equalled their named confirmation prices,
and the configured midpoint transform resolved exactly to the first
upside/downside targets. This proves transport/structured-output compatibility,
not forecast accuracy or profitability. Deployment remains gated on merge,
migration review, a durable analysis pause, and certain empty broker state.

The pre-merge gate run passed Prettier, ESLint, TypeScript typecheck/build, 191
Node tests across 33 files, 14 schema tests, 3 static migration tests, and all 3
configured isolated-PostgreSQL integration tests. Ruff format/lint, strict mypy
over 20 Python source files, and 53 Python tests passed. A migrated isolated
schema Streamlit AppTest rendered 19 dataframes with zero exceptions.
Replay/backtest smoke tests, zero-vulnerability npm/pip audits, the tracked-file
secret scan, shell/PM2 syntax, and all five offline systemd security parses also
passed.

PR #84 merged as `6c6650e`; migration `0012` applied and release `.17`
restarted analytics, AI, execution, and Streamlit under a durable analysis
pause. Startup recovery found the prior demo group/position closed with one
trade and no unresolved events. A paused manual cycle rejected before market or
AI work, and the deployed dashboard rendered without exceptions. After the
pause was released, automatic broker minutes resumed. The first minute that
reached the new image path ended at `AI_ORCHESTRATOR_TIMEOUT`: PM2 still held an
obsolete 30-second execution-caller timeout while `.env` and the provider path
used 60 seconds. The earlier provider-only probe's 54.2-second latency explains
the mismatch.

Changing the timeout under `.17` correctly failed the immutable strategy
configuration check, so no unversioned behavior was accepted and no order was
placed. ISSUE-040 registers release `.18`, updates the sample timeout to 60
seconds, and deploys it under a renewed database analysis pause before the next
automatic proof cycle.

The `.18` change is tracked by
[PR #86](https://github.com/AegisFintech/scalping-bot/pull/86). Its pre-merge
gate run passed Prettier, ESLint, TypeScript
typecheck/build, 191 Node tests across 33 files, 14 schema tests, 3 static
migration tests, and all 3 configured isolated-PostgreSQL integration tests.
Ruff format/lint, strict mypy over 17 Python source files, and 53 Python tests
passed. Configured Streamlit AppTest rendered 23 dataframes with zero
exceptions. Replay/backtest smoke tests, zero-vulnerability npm/pip audits, the
tracked-file secret scan, shell/PM2 syntax, and all five offline systemd parses
at 2.8 (`OK`) passed. The durable analysis pause remains active until the
merged release starts with certain reconciliation and completes an automatic
image-backed schema 2.1 cycle within the corrected caller budget.

PR #86 merged as `5738787`. Execution was deleted and recreated under the
durable analysis pause so no inherited PM2 environment survived; the new
process reported release `.18` and `AI_TIMEOUT_MS=60000`. Its startup endpoint
was ready, PostgreSQL registered `.18`, and reconciliation showed zero active
groups, orders, positions, or unresolved execution events. The pause was then
released through the authenticated audited control API. Status reported demo
automatic analysis and trading enabled, no emergency stop, no open AI circuit,
and no blocking reasons.

The 11:45 Asia/Singapore automatic cycle persisted its chart but correctly
stopped before AI on absolute and percentile spread limits. The 11:46 cycle
passed those gates, persisted a 65,785-byte 1600x1200 PNG whose bytes matched
its SHA-256, and supplied it with the persisted `system-v5` prompt whose bytes
matched its recorded hash. The transition audit measured 38,819 ms from
`MODEL_PENDING` to `VALIDATING`, within the corrected timeout. The completed
schema 2.1 response linked BUY entry/confirmation at 4642.00 with first target
4652.00 and SELL entry/confirmation at 4631.80 with first target 4623.40. All
recorded semantic/risk validations and both side risk decisions were accepted.

The coordinator placed the demo OCO. Its SELL stop filled and its BUY peer was
cancelled; the protected SELL position remained open awaiting the
broker-generated TP/SL deal at the evidence checkpoint. During that state the
service exposes `RELEVANT_POSITION_EXISTS` and
`DEMO_CLOSING_ORDER_AWAITING_DEAL`, preventing a duplicate analysis or order as
intended. A post-cycle configured Streamlit AppTest rendered 34 dataframes with
zero exceptions, including the exact prompt/response history. Normal automation
remains enabled and will re-arm only after the terminal deal is reconciled.
This rollout evidence is tracked by
[PR #87](https://github.com/AegisFintech/scalping-bot/pull/87).

## Bounded 100-analysis demo campaign

ISSUE-041 is tracked by
[PR #89](https://github.com/AegisFintech/scalping-bot/pull/89) and adds an
optional restart-safe automatic campaign boundary without changing live
authority or any model/risk contract. A positive
`AUTOMATIC_ANALYSIS_COMPLETED_LIMIT` counts distinct analyses having both a
durable completed model request and completed response for the current account,
symbol, and immutable strategy release. The default zero is unbounded and does
not enable automation. The scheduler checks the PostgreSQL count before a
broker-minute claim and after each cycle. Missing or invalid progress fails
closed; result 100 may finish its existing validation/placement path, then the
service durably pauses new analyses before result 101. Order maintenance,
callbacks, expiry, TP/SL handling, and reconciliation continue.

Streamlit exposes the target, completed and remaining counts, progress, and a
plain-language completed-for-review state. Unit tests cover disabled, running,
exact-limit, overrun, malformed, unavailable, pause, and reconstruction paths;
the configured PostgreSQL integration test proves a newly constructed campaign
counter sees the previously committed completed response. Release `.19`
isolates the campaign count and configuration from `.18` history. Deployment
will occur under a durable analysis pause and configure an exact 100-result
limit plus a compatible independent daily OCO-group ceiling.

The `.19` pre-merge gate run passed Prettier, ESLint, TypeScript
typecheck/build, 198 Node tests across 34 files, 14 schema tests, 3 static
migration tests, and all 3 configured isolated-PostgreSQL integration tests.
Ruff format/lint, strict mypy over 17 Python source files, and 55 Python tests
passed. Configured Streamlit AppTest rendered 34 dataframes with zero
exceptions. Replay/backtest smoke tests, zero-vulnerability npm/pip audits, the
tracked-file secret scan, shell/PM2 syntax, and all five offline systemd parses
at 2.8 (`OK`) passed.

PR #89 merged as `b18322b`. Before deployment, the prior `.18` demo position
had closed. Periodic recovery showed zero active groups, orders, positions, and
unresolved execution events, although its malformed terminal callback had left
the known process-local `CTRADER_FIELD_INVALID:price` latch. New analyses were
durably paused, then execution was deleted/recreated as `.19`; certain startup
reconciliation cleared only that transient latch. The process reported the
configured 100-result limit and an independent daily OCO-group cap of 103,
representing three already-created trading-day groups plus the requested 100.

Under pause, status and PostgreSQL both reported release `.19`, campaign
progress `0 / 100`, and no active or unresolved broker state. Streamlit AppTest
rendered 34 dataframes, 19 metrics, one campaign progress element, and zero
exceptions. The pause was cleared with an audited reason at 12:07
Asia/Singapore. The 12:08 automatic broker minute completed the first durable
external-AI response and advanced the campaign to `1 / 100`. Its subsequent
fresh-market placement gate rejected `PLACEMENT_CANDLE_CONTEXT_CHANGED`, so no
order was created. The completed model response correctly consumes a campaign
slot; the unchanged candle-context gate correctly prevents stale placement.
The scheduler continues automatically with 99 completed responses remaining
and will write the review pause at 100. This rollout evidence is tracked by
[PR #90](https://github.com/AegisFintech/scalping-bot/pull/90).

## Terminal callback recovery and operator-readable Overview

ISSUE-042 is tracked by
[issue #91](https://github.com/AegisFintech/scalping-bot/issues/91). During the
`.19` campaign the count reached `4 / 100`. The latest OCO then completed at the
broker and bounded history recovery durably closed its order group, position,
and trade with no active local order or position. An earlier same-key callback
payload conflict and a process-local invalid-price callback nevertheless kept
readiness blocked.

Release `.20` adds a narrow terminal-evidence reconciliation. It retains the
conflicting journal row and may mark only
`DEMO_BROKER_EVENT_KEY_CONFLICT` resolved when the exact same demo group has
two strategy-owned terminal orders, one strategy-owned closed position and
trade, and a later mapped broker-created SL/TP deal with complete fill and
close details. The resolution references that terminal event. Recorder failure
checkpoints acknowledge only failures preceding a new certain terminal proof;
later failures and repeated/uncertain proofs remain blocking. No schema,
precision, freshness, deterministic risk, reconciliation, ownership, or mode
gate is removed.

The execution status now includes a read-only current/latest managed setup
projection scoped internally by the configured account and symbol. Overview
prominently states the automation state and immediate operator action, shows
whether the setup is active or terminal history, and lists exact order/position
entry, SL, TP, volume, expiry, and update time without exposing broker or
account identifiers. A reviewed completed-analysis baseline is separately
validated, hashed, and displayed so `.20` can continue from the four durable
`.19` results instead of silently resetting the requested campaign.

Pre-merge gates passed: Prettier, ESLint, TypeScript typecheck/build, 204 Node
tests across 35 files, 14 schema tests, 3 static migration tests, all 3
configured isolated-PostgreSQL integration tests, Ruff format/lint, strict mypy
over 20 source files, 55 Python tests, configured Streamlit AppTest with zero
exceptions, replay/backtest smoke tests, zero-vulnerability npm/pip audits,
tracked-file secret scan, shell/PM2 syntax, and five offline systemd security
parses at 2.8 (`OK`). Runtime remained unchanged on `.19`; status still showed
`4 / 100` and the expected callback-conflict lockout before merge/deployment.
Implementation is proposed in
[PR #92](https://github.com/AegisFintech/scalping-bot/pull/92).

PR #92 merged as `cc15df7`. Before rollout, the durable pause was enabled and
the exact `.19` scope was rechecked at four completed responses, zero active
groups, and one unresolved callback conflict. The ignored mode-`0600` local
environment was set to baseline four, and all five PM2 services loaded `.20`.
One initial execution start raced the simultaneously reloading market-data
listener and received a loopback connection refusal; PM2 retried automatically
and the next PID started ready. Under pause, status reported baseline `4`,
release completed `0`, total `4 / 100`, and only `ANALYSES_PAUSED`. PostgreSQL
reported zero active groups, zero unresolved execution events, one retained and
resolved conflict row, and one `.20` strategy identity. Overview displayed the
old BUY order as `CANCELLED`, SELL order as `FILLED`, and SELL position as
`CLOSED` terminal history with exact entry/SL/TP levels.

The pause was then released. Status reported automatic analysis and demo
trading enabled with no blocking reasons. The next eligible broker M1 window
started a fresh automatic cycle, completed the external-AI response, and
advanced the campaign to `5 / 100` (`1` on `.20` plus baseline `4`). Semantic
validation rejected `DOWNSIDE_TARGETS_INVALID`, created no order, and returned
the service to ready with no blocking reason. This proves scheduler recovery
and campaign continuation, not forecast accuracy or profitability. ISSUE-043
adds operator-readable guidance for that exact target-map rejection without
changing its fail-closed behavior.

PR #94 merged as `799c3fc`. Only the Streamlit PM2 process was restarted;
execution PID `2522098` remained online and unchanged. Dashboard health passed,
and configured AppTest rendered 35 dataframes with zero exceptions. The new
guidance describes the observed downside-target rejection as a target not
below the sell entry, off broker tick, or not strictly descending, followed by
a fresh automatic request rather than an operator bypass.

While that dashboard-only update was delivered, the unchanged `.20` loop
completed another external-AI response and advanced the campaign to `6 / 100`.
This cycle passed validation and placed a new demo OCO. The final evidence
snapshot showed no position yet and two active pending orders: BUY entry
`4646.6000000000`, SL `4642.6000000000`, TP `4654.6000000000`; SELL entry
`4641.1000000000`, SL `4645.1000000000`, TP `4633.1000000000`; both expiring at
`2026-08-25T05:37:03.364Z`. Overview rendered
`SYSTEM STATUS: ACTIVE_CYCLE_OR_SETUP` and `ACTIVE MANAGED SETUP`, correctly
explaining that automatic analysis waits while the broker manages those stops.
All five PM2 services were online on `.20`. These are broker-demo results, not
live-money or profitability evidence.

## Human-readable GMT+8 dashboard timestamps

ISSUE-044 is tracked by
[issue #96](https://github.com/AegisFintech/scalping-bot/issues/96). Streamlit
previously displayed a mix of raw UTC ISO values and ad hoc Singapore strings.
The dashboard now has one display-only conversion layer using the IANA
`Asia/Singapore` timezone and format `DD Mon YYYY, HH:MM:SS GMT+8`. It applies
to Overview expiry/update and AI retry captions, analysis/audit selectors, and
every timestamp column passed to a Streamlit dataframe. The duplicate SQL-side
Singapore columns in automatic-cycle history were removed in favor of the same
presentation layer.

Naive database datetimes are explicitly treated as UTC. Missing values display
as `—`, while malformed or unsupported values display as `Unavailable` rather
than implying a valid time. PostgreSQL, service/API contracts, Plotly source
frames, and exact persisted AI/audit JSON are not mutated. Focused tests pass,
and a configured AppTest rendered 35 dataframes with zero exceptions. The
Overview example changed from `2026-08-25T05:37:03.364Z` to `25 Aug 2026,
13:37:03 GMT+8`; 4,985 timestamp-table cells were checked for the standardized
display form. The active demo OCO and execution process were not changed.
The full pre-merge gate suite passed: 204 Node tests across 35 files, 14 schema
tests, 3 migration tests, all 3 configured PostgreSQL integration tests, strict
formatting/lint/type checks, 60 Python tests across 21 source files, configured
AppTest, replay/backtest smoke tests, zero-vulnerability npm/pip audits,
tracked-file secret scan, shell/PM2 checks, and five systemd parses at 2.8
(`OK`). Implementation is proposed in
[PR #97](https://github.com/AegisFintech/scalping-bot/pull/97).

PR #97 merged as `b27b66f`. Only `scalper-dashboard` restarted; execution PID
`2522098` remained online and unchanged, so the active broker-demo lifecycle
was not interrupted. Dashboard health passed. The deployed-source AppTest
again rendered 35 dataframes with zero exceptions and verified 4,985 timestamp
cells. Its Overview caption read `Group expires: 25 Aug 2026, 13:37:03 GMT+8 ·
last updated: 25 Aug 2026, 13:30:10 GMT+8`. ISSUE-044 is complete.

## Human-readable closed demo lifecycle and terminal slippage recovery

ISSUE-045 is tracked by
[issue #99](https://github.com/AegisFintech/scalping-bot/issues/99). The
observed `.20` setup is durably closed: the BUY stop requested at
`4646.6000000000` filled at `4646.9100000000`, its SELL peer cancelled, and the
BUY position closed at 25 Aug 2026, 13:30:10 GMT+8. PostgreSQL records realized
demo P/L `-4.6500000000`, fees `-0.2800000000`, and no unresolved execution
journal row. The 31-tick difference at the broker's `0.0100000000` tick exceeded
the configured five-point slippage limit, so the unchanged running process
correctly blocked replacement risk but exposed only the generic
`RECONCILIATION_UNCERTAIN` reason.

Release `.21` adds a read-only terminal trade result to the managed-setup HTTP
projection and a plain **RIGHT NOW** Streamlit state. The Overview now answers
separately whether a broker order is waiting, a trade is open, a setup is
closed/expired/failed history, nothing exists, or exposure is unknown. A closed
trade states that no strategy order or position is active, shows durable
direction/P&L/fees/close time, and names the next automatic action. Bounded
reconciliation source reasons are retained beside the generic fail-closed gate,
including fill slippage, audit persistence, and a durable group awaiting
reconciliation.

The slippage latch is not cleared merely because time passed or the broker no
longer displays a position. The terminal-evidence transaction now returns the
exact local order-group ID paired with its cryptographic closing-deal proof.
The in-memory demo gateway accepts that acknowledgement only when recovery and
the recorder are certain, the proof is syntactically valid, the same tracked
group exists, and both tracked legs are terminal. Mismatched groups, uncertain
proof, active/unknown legs, unresolved journal evidence, local active state, or
other safety failures remain blocking. Focused TypeScript and Python tests cover
the retained/released latch plus active, pending, closed, idle, unavailable,
malformed, and inconsistent dashboard projections. Full pre-merge and rollout
evidence is recorded after the required gates complete.

Pre-merge gates passed: Prettier, ESLint, TypeScript typecheck/build, 209 Node
tests across 35 files, 14 schema tests, 3 migration tests, all 3 configured
PostgreSQL/HTTP integration tests, Ruff formatting/lint, strict mypy over 21
source files, 68 Python tests, configured Streamlit AppTest with 35 dataframes
and zero exceptions, replay/backtest smoke tests, zero-vulnerability npm/pip
audits, tracked-file secret scan, shell/PM2 syntax, and five offline systemd
security parses at 2.8 (`OK`). The AppTest headline against the unchanged `.20`
runtime was `RIGHT NOW: BUY demo trade closed — no order or position is active`.
The `.20` process was not restarted before review and remained fail-closed on
the retained slippage event.

PR #100 merged as `844fb02`. Before rollout, the durable analysis pause was
enabled and status/SQL confirmed campaign `6 / 100`, one latest terminal
`CLOSED` group, and zero active groups, orders, positions, or unresolved
execution events. The ignored mode-`0600` environment's reviewed carry-forward
baseline was changed from four to six. All five PM2 services loaded immutable
release `.21` in dependency order; startup checks passed with only
`ANALYSES_PAUSED`, campaign baseline six plus zero current-release completions,
and the exact durable LONG result (`-4.6500000000` realized P/L,
`-0.2800000000` fees). The prior in-memory slippage latch was no longer present.

Deployed AppTest rendered 35 dataframes with zero exceptions and showed `RIGHT
NOW: BUY demo trade closed — no order or position is active` plus `AUTOMATION
STATUS: PAUSED`. After the pause was released, status became eligible with no
reason codes. The scheduler claimed the 13:57 GMT+8 broker-minute cycle without
manual triggering. That cycle ended `REJECTED` because the local AI orchestrator
returned HTTP 503; it produced no completed external-AI response, did not
consume a campaign slot, and created no broker order. The automatic circuit
cooldown is eligible at 25 Aug 2026, 14:03:08 GMT+8. A second deployed AppTest
rendered 36 dataframes with zero exceptions and showed the same closed-trade
headline, `AUTOMATION STATUS: WAITING_FOR_AI`, the human GMT+8 retry time, and
the no-restart guidance. Automation and demo authority remain enabled; the
scheduler will half-open automatically. This is demo operational evidence, not
a profitability claim. ISSUE-045 is complete.

## Live open-position price, P/L, and commission monitor

ISSUE-046 is tracked by
[issue #102](https://github.com/AegisFintech/scalping-bot/issues/102). Release
`.22` adds a display-only execution endpoint and a two-second Streamlit Overview
fragment for the one exact strategy-owned open position. The endpoint combines
the typed fresh market quote, cTrader's exact per-position gross/net unrealized
P/L response, and already persisted fill commission. BUY positions use bid and
SELL positions use ask as the current close mark. Decimal values remain strings
through service and dashboard boundaries, timestamps render in GMT+8, and no
account, order, fill, or broker position identifier is exposed.

The monitor is intentionally outside the coordinator and broker-command path.
No position produces `NONE`; multiple positions, non-`OPEN` active state,
missing internal broker identity, missing/duplicate cTrader P/L, quote or symbol
mismatch, malformed money, or invalid time produces `UNAVAILABLE`. No price or
P/L is estimated. Commission is explicitly incurred-to-date and signed; the
durable terminal trade remains authoritative for final realized P/L and fees.
Focused TypeScript and Python tests cover both sides, exact scaling, bounded
output, zero-state short circuit, and the rejection paths. Pre-merge gates pass:
Prettier, ESLint, TypeScript typecheck/build, 221 Node tests across 37 files, 16
JSON Schema tests, 3 migration tests, all 3 configured PostgreSQL/HTTP
integration tests, Ruff format/lint, strict mypy over 21 source files, 70 Python
tests, configured Streamlit AppTest with 35 dataframes and zero exceptions,
replay/backtest smoke tests, zero-vulnerability npm/pip audits, tracked-file
secret scan, shell/PM2 checks, and five systemd parses at 2.8 (`OK`). Rollout
evidence will be recorded after merge.
