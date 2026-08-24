# Architecture

## Goals and boundaries

The platform separates uncertain analysis from deterministic authority. AI proposes a waiting area and two conditional scenarios. Deterministic services decide whether the proposal is coherent, eligible, affordable, broker-valid, fresh, unique, and permitted in the current mode.

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
                                                  |
                                            cTrader Open API
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
- Calls a configurable Responses- or Chat-Completions-compatible endpoint with timeouts/retries/circuit breaker.
- Requests JSON Schema output when supported and validates the response schema
  locally. The execution coordinator independently performs semantic and risk
  validation.
- Treats refusal, incomplete output, extra prose, malformed JSON, endpoint ambiguity, or timeout as `NO_ACTION`.

### Execution service

- Owns cycle eligibility, deterministic risk, gateway selection, OCO state, expiry, cancellation, and reconciliation.
- Writes intent and idempotency state transactionally before broker calls.
- Normalizes and durably journals cTrader demo callbacks, atomically maps
  order/fill/position state, and replays bounded broker history after startup or
  reconnect before restoring readiness.
- Uses paper, demo, shadow, and live-compatible gateways behind one interface.
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
- Dashboard acknowledgement is a short-lived database record; it never creates the filesystem sentinel or modifies environment gates.

## Typed boundaries

Node/Python traffic uses JSON over local HTTP with versioned Pydantic/JSON Schema models. Prices, money, sizes, tick values, and ratios that affect decisions are decimal strings. Timestamps are UTC ISO-8601. Each request includes a schema version, request ID, analysis ID, symbol, and snapshot timestamp.

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

PostgreSQL transactions establish intent before side effects. Broker callbacks are inserted with unique event/idempotency keys. On any uncertain network result, the service records `RECONCILIATION_REQUIRED` instead of retrying submission blindly. Startup and reconnect reconciliation compare local intent with broker state and block cycles until certainty is restored.

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
