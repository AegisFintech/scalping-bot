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
  views, system metrics, and token-protected loopback controls.
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
- five ordered SQL migrations under `migrations/`;
- strict model schema and prompt under `schemas/` and `prompts/`;
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
- Node unit: 26 files, 90 tests passed.
- Node integration: typed Node/Python and isolated Neon migration tests passed
  (3 tests total), including fresh migration and `0005`-to-`0006` upgrade paths.
  The temporary schemas were dropped afterward.
- JSON Schema: 10 tests passed, plus a real configured-endpoint structured-output
  probe that returned a locally validated, identity-matched `NO_TRADE`.
- Migration structure/safety: 3 tests passed, including pinned historical
  `0001`/`0002` byte checksums; migration `0006` passed isolated
  fresh/upgrade testing and is applied to the configured Neon schema. The
  stopped migration/restart check found an empty journal/order/position/fill
  state and certain startup recovery. Backup/restore remains pending.
- Ruff format/lint, strict mypy across analytics/dashboard, and Python: 25 tests passed.
- Checked-in replay and backtest CLI smoke scenarios completed.
- npm audit and pip-audit reported no known vulnerabilities.
- Secret scan and shell syntax checks passed.
- All five unit files passed offline security parsing; common systemd exposure
  score is 2.8 (`OK`). Installed-path/service startup testing remains pending.

These are engineering results, not evidence of profitability or broker fill
quality.

## Current PM2 deployment

The five services run from `ecosystem.config.cjs` under PM2 and the enabled,
active `pm2-root.service`. A saved process list was successfully resurrected by
systemd, an individual AI-service restart recovered, and all five local health
checks passed afterward. API and dashboard listeners bind only to `127.0.0.1`.
Execution is in cTrader demo mode with the environment emergency stop active,
demo and live submission disabled, and `tradingEnabled=false`. Its only status
reasons are the expected demo-enable, demo-acknowledgement, and environment-stop
gates. The new demo identity has no analyses, order groups, positions, or risk
lockouts.

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
  journal and atomically update order/fill/position state. Bounded startup and
  reconnect history recovery is fail-closed. Closed-trade P/L remains blocked
  until supervised broker evidence confirms commission/swap/conversion signs.
- Streamlit now renders bounded, mode-labelled operational charts through pure
  validated builders. Completed-candle, malformed OHLC, enum, numeric, empty,
  and mode-separation paths are covered; a configured AppTest run rendered four
  current-data charts without an exception. The merged dashboard was restarted,
  its local health endpoint returned `ok`, and the same configured render check
  passed after deployment while demo submission stayed disabled and emergency
  stop stayed active.
- A quote/deposit currency conversion provider is absent; mismatched currencies
  fail closed.
- Better Stack rotating/remote structured logging and persistent host/process
  metrics currently run in execution-service only. OTLP export and the optional
  Better Stack heartbeat URL are not implemented.
- Demo closed-trade persistence awaits supervised event-field validation;
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
