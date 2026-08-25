# Architecture

## Goals and boundaries

The platform separates uncertain analysis from deterministic authority. After
deterministic input eligibility passes, AI always proposes a waiting area and
two conditional scenarios. Deterministic services decide whether the proposal
is coherent, affordable, broker-valid, fresh, unique, and permitted in the
current mode.

This is a modular monorepo because shared contracts, risk code, migrations, test fixtures, and deployment files must change atomically. Node.js owns stateful external I/O and execution. Python owns numerical analytics and historical simulation. PostgreSQL is the durable coordination/audit boundary.

## Runtime topology

```text
cTrader Open API
      |
market-data-service ---- PostgreSQL ---- Streamlit dashboard
      |                       ^                 |
      v                       |                 v (protected controls)
Python analytics API --> ai-orchestrator --> execution-service
                                |                 |
                         AI-compatible API   paper/demo/shadow/live gateway
                                                  |             |
                                            cTrader Open API  Better Stack
```

All application listeners default to `127.0.0.1`. Remote access belongs behind an authenticated TLS reverse proxy. No service depends on Docker.

## Services

### Market data service

- Authenticates a configured/discovered account and discovers symbol metadata.
- Maintains quotes and top-N depth with reconnect/discontinuity flags.
- Requests/assembles completed 1m, 5m, and 15m candles. It validates the exact
  symbol weekly schedule/timezone and marks a gap only when the entire bounded
  interval is outside broker trading sessions. Open-session missing bars and
  unmodeled holiday overrides remain rejected.
- Creates logically aligned candle/depth snapshots with distinct broker-source,
  local-receive, and final broker-server timestamps. Depth is unavailable until
  a broker timestamp exists, and future quote/book sources reject the snapshot.
- Exposes typed snapshot APIs; the execution decision trail persists the raw
  snapshot before analytics/model work.
- Does not decide or submit orders.

### Analytics service

- FastAPI with Pydantic request/response models.
- Uses `Decimal` for prices at boundaries and explicit numeric conversions for indicators.
- Normalizes candles, validates completeness/order, computes deterministic features and bounded statistics.
- Runs replay/backtest through the same feature API.
- Never holds broker credentials or submits orders.

### AI orchestrator

- Builds full/compact payloads, applies token/size bounds, and records prompt/model/schema versions.
- Supplies non-sizing execution constraints—current bid/ask, precision, tick,
  stop-distance, reward/risk, ATR-distance, and expiry bounds—so the mandatory
  two-leg proposal is constructed against the same deterministic rules that
  will validate it.
- Prompt `system-v4` tells the endpoint that execution will preserve entry/SL
  and halve TP distance. It supplies a doubled proposal R:R minimum plus a
  non-sizing maximum stop distance derived from reconciled equity, configured
  setup risk, broker tick value, and broker minimum volume. No account money,
  budget, volume, or identity crosses the endpoint boundary.
- Calls a configurable Responses- or Chat-Completions-compatible endpoint with
  per-attempt timeouts/retries/circuit breaker. The execution caller derives its
  local HTTP deadline from the complete configured retry budget plus bounded
  response-processing grace, so it cannot abandon a legitimate in-process
  retry early.
- Requests JSON Schema output when supported and validates the response schema
  locally. The execution coordinator independently performs semantic and risk
  validation.
- Treats refusal, incomplete output, extra prose, malformed JSON, endpoint ambiguity, or timeout as `NO_ACTION`.
- Returns the exact versioned non-secret system prompt and hash over the
  loopback contract so the execution trail can persist what was actually sent.

### Execution service

- Owns cycle eligibility, deterministic risk, gateway selection, OCO state, expiry, cancellation, and reconciliation.
- After model inference, reacquires the full market snapshot. The completed
  candle context and execution metadata must still exactly match the model
  input; otherwise the cycle rejects. The refreshed quote and depth are
  persisted and drive final spread, semantic, risk, and placement-freshness
  checks.
- Keeps the parsed endpoint JSON immutable, records a separate Decimal TP
  midpoint transform, and validates both the original and effective proposal.
  Off-tick midpoints reject without broker-price rounding. Deterministic sizing
  uses the unchanged endpoint entry/SL and the gateway receives the validated
  effective TP.
- Rejects invalid/overflowing AI timeout budgets at startup. A local AI timeout
  or transport loss becomes a stable reason code and opens the execution-side
  circuit; it cannot create a model row, risk intent, or order command. The
  caller circuit stays closed for the configured provider reset interval, then
  half-opens at the exact boundary so a later broker minute can probe without a
  process restart. A repeated transient failure reopens it.
- Writes intent and idempotency state transactionally before broker calls.
- Starts automatic cycles only in a configured opening window of the broker's
  M1 interval. A PostgreSQL claim keyed by account, symbol, and broker minute is
  committed before the cycle, so restarts cannot issue a second model request
  for that interval. Provider failure retries on the next fresh interval; the
  post-model completed-candle identity check remains unchanged.
- Normalizes and durably journals cTrader demo callbacks, atomically maps
  order/fill/position state, and replays bounded broker history after startup or
  reconnect before restoring readiness. Placement callbacks queue until the
  returned broker IDs commit, then may use that broker ID as a fallback when a
  strategy-labelled cTrader event omits its client order ID. Readiness is
  recalculated from current unresolved journal evidence after each drain.
  A non-deal `ORDER_ACCEPTED` event establishes only its pending order; an
  optional unpriced cTrader position placeholder on that event is not persisted
  as an opened position. Fill and partial-fill events still require their deal
  plus a fully normalized, priced position.
  Callback failures expose only a stable allowlisted reason, processing stage,
  numeric event/status enums, and field-presence booleans; raw callbacks,
  labels, client IDs, broker IDs, and database error text are never logged.
- Uses paper, demo, shadow, and live-compatible gateways behind one interface.
- Samples the typed fresh-quote endpoint once per minute into an idempotent,
  account/symbol-scoped spread history even while analysis and trading are
  stopped. The sampler depends only on quote retrieval and persistence; it has
  no coordinator, model, risk-intent, gateway, or broker-command capability.
- Mirrors newly inserted audit events through a durable PostgreSQL outbox. The
  exporter claims rows with leases, sends bounded redacted summaries with
  stable correlation/event IDs, and retries with bounded backoff. Better Stack
  is searchable operational telemetry, not trading authority or the system of
  record.
- Shadow gateway cannot submit. The production composition uses a disabled live
  gateway. A separately tested live-compatible decorator exists for future
  review but is not wired to a broker-capable gateway.

### Dashboard

- Streamlit queries read-only views for overview, P/L, performance, market, analysis, orders, risk, operations, and server metrics.
- Pure Plotly builders validate and visualize completed candles/volume,
  deterministic indicators, spread/freshness/depth imbalance, mode-separated
  daily risk, cTrader execution mapping, audit severity, and host resources.
  Queries are bounded to the current account environment and symbol where the
  data is trading-specific; chart floating-point conversion is presentation-only
  and never feeds a decision boundary.
- Controls call a loopback API with a control token and are audited.
- The Operations tab shows Better Stack outbox backlog, attempts, errors, and
  recent delivery checkpoints alongside the authoritative audit-event chart.
- The AI Analysis tab scopes recent analyses to the active account environment
  and symbol, then correlates completed-candle coverage, bounded indicator and
  model-input summaries, the exact parsed/schema-validated AI response,
  refreshed market evidence, local validation/risk, broker outcome, and each
  PostgreSQL audit event with its Better Stack delivery checkpoint. Missing
  stages render as not reached rather than successful.
- The AI output view places endpoint entry/SL/TP and effective midpoint TP side
  by side, including original/effective R:R, even when later risk sizing or
  broker placement is not reached.
- The Overview distinguishes scheduler enablement from immediate order
  eligibility. Temporary AI cooldowns show their exact automatic retry time and
  retain the authoritative reason code alongside plain-language impact and
  operator action. Broker-minute history shows UTC and Asia/Singapore time so a
  bounded cooldown is not mistaken for a stopped process.
- Prompt history shows prior request/response versions and hashes. Each selected
  run defaults to the newest durable AI request and prominently shows the exact
  hash-verified system prompt with the exact persisted redacted user JSON. New
  prompts are persisted per completed request; a run without one is explicitly
  labelled as having no durable AI request record, and legacy versions use an
  explicit tracked-artifact fallback.
- Dashboard acknowledgement is a short-lived database record; it never creates the filesystem sentinel or modifies environment gates.

## Typed boundaries

Node/Python traffic uses JSON over local HTTP with versioned Pydantic/JSON Schema models. Prices, money, sizes, tick values, and ratios that affect decisions are decimal strings. Timestamps are UTC ISO-8601. Each request includes a schema version, request ID, analysis ID, symbol, and snapshot timestamp.

Derived analytics decimals are canonicalized with Python `Decimal` to no more
than ten fractional places before crossing back to Node. Positive values are
truncated toward zero, never rounded upward; the Node risk engine independently
parses the bounded string and rejects invalid or non-finite inputs.

The cTrader adapter is the authority for the broker-declared weekly session
schedule. Analytics accepts only the adapter's single
`BROKER_SESSION_GAP_BEFORE` marker on a bounded positive gap; a marker on the
first/contiguous/overlapping candle, a duplicate/unknown flag, an unmarked gap,
or an excessive gap fails closed. Per-timeframe marker counts are exposed as
model context, not as execution authority. The schedule semantics follow the
official [cTrader model messages](https://help.ctrader.com/open-api/model-messages/);
cTrader also documents in its [Open API FAQ](https://help.ctrader.com/open-api/faq/)
that a no-tick interval does not produce a trendbar, so an absent bar during an
open session is not silently treated as a closure.

Adaptive spread observations preserve broker-source, local-receive, and final
broker-server timestamps plus canonical bid/ask/spread decimals. Source-minute
uniqueness makes retries and restarts idempotent. Stale, future, malformed,
crossed, symbol-mismatched, unavailable, and database-failed samples do not
contribute to history; fewer than the configured minimum observations remains a
hard rejection.

Broker behavior is expressed by `MarketDataAdapter`, `AccountAdapter`, and `ExecutionGateway`. Gateways accept already normalized command objects; they do not accept raw model output. AI behavior is expressed by `ModelClient`, while local validators are independent of the provider.

## Mode isolation

| Mode     | Data            | Fill/order target         | Broker submission          |
| -------- | --------------- | ------------------------- | -------------------------- |
| replay   | historical      | event replay              | impossible                 |
| backtest | historical      | conservative simulator    | impossible                 |
| paper    | live or fixture | paper ledger              | impossible                 |
| demo     | cTrader demo    | demo broker               | explicit demo checks       |
| shadow   | live            | hypothetical intents only | impossible by gateway type |
| live     | live            | disabled boundary         | impossible in this release |

Account environment and endpoint are checked against mode. Paper uses a
dedicated database provider/environment/type and cannot share broker demo/live
daily-risk or performance history. A demo process cannot select a live endpoint;
a shadow process cannot construct a submitting gateway.

The scheduler's analysis gate is independent from reconciliation and order
maintenance. `AUTOMATIC_ANALYSIS_ENABLED` defaults false, so a supervised demo
can use an authenticated single-cycle request while expiry, cancellation, and
reconciliation continue. Broker demo submission additionally refuses startup
without the exact demo acknowledgement, a positive daily order-group limit, and
a positive per-position notional cap.

## Live safety gates

Any future submitting live composition must require: `TRADING_MODE=live`;
`LIVE_TRADING_ENABLED=true`; exact acknowledgement; manually created enablement
file with correct restrictive permissions/content; completed startup checks;
unexpired dashboard/database acknowledgement; no environment/file/database
emergency stop; no risk lockout; fresh aligned market data; reconciled account;
no relevant position/pending/partial/unknown state; validated current symbol
metadata; schema/semantically valid AI response; deterministic risk approval;
healthy audit database; and an unused idempotency key. This release additionally
fails the startup check and uses `DisabledLiveGateway`, so these gates cannot be
mistaken for live enablement.

Failure of any gate returns structured denial reason codes and emits an audit event/alert. No service automatically creates the enablement file, acknowledgement, or control row.

## Consistency and recovery

PostgreSQL transactions establish intent before side effects. Broker callbacks are inserted with unique event/idempotency keys. Entry and broker-created closing-order identities remain distinct even when cTrader reuses a client order ID; closing children map through the durable broker position and resolve only from exact terminal deal evidence. On any uncertain network result, the service records `RECONCILIATION_REQUIRED` instead of retrying submission blindly. Startup and reconnect reconciliation compare local intent with broker order/deal/position history and block cycles until certainty is restored.

## Dependency rationale

- TypeScript: type-safe external orchestration and protocol handling.
- Fastify: maintained, schema-oriented Node HTTP server with low overhead.
- Pino: structured JSON logs with redaction support.
- PostgreSQL/`pg`: durable transactions and Neon compatibility.
- Ajv plus formats: local JSON Schema validation.
- `decimal.js`: deterministic decimal arithmetic in Node.
- Prometheus client: health/service metrics.
- FastAPI/Pydantic: typed, observable Node/Python interface.
- pandas/Plotly: dashboard tabulation and visualization; deterministic analytics
  use Python `Decimal` at decision boundaries.
- Streamlit/Plotly: maintainable first operational dashboard.

Production versions are pinned in lockfiles. Dependency changes require tests and audits.
