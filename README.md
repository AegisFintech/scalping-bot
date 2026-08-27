# cTrader AI Scalper

An auditable, AI-assisted market-analysis and conditional-order platform for configurable cTrader symbols, initially XAUUSD. Deterministic code—not the model—owns eligibility, price/volume normalization, account risk, OCO state, and execution authority.

> **Risk warning:** leveraged trading can lose more than expected. Backtests, replay, paper, demo, and shadow observations are not live results and do not establish profitability. The software is unfinished until every documented test and broker-specific review passes.

## Modes

Supported delivery modes are replay, backtest, paper, cTrader demo, and shadow. A live-compatible interface is present only for safety review and is disabled by default. Configuration and credentials alone never make live execution safe or enabled.

## Architecture

Node.js services handle cTrader, scheduling, AI calls, validation/risk, order lifecycle, APIs, logs, and metrics. A typed FastAPI service provides deterministic Python analytics and replay/backtest behavior. Streamlit reads Neon PostgreSQL and calls protected localhost controls. See `docs/architecture.md` and `docs/data-flow.md`.

Automatic demo scheduling uses broker timestamps and durable M1 claims. Its
five-second maintenance cadence is wall-aligned; it does not increase polling
frequency to gain model time. External-provider timeouts are displayed as
`AI_PROVIDER_TIMEOUT` and retry only with a fresh completed-candle cycle.

The Streamlit dashboard includes mode-labelled P/L, completed-candle/volume,
indicator, spread/freshness/depth, daily-risk, execution-journal, audit, and
server-resource charts. Chart queries are bounded and read-only; malformed or
forming-candle data is rejected rather than visualized as authoritative.
The **AI Analysis** tab provides a correlated decision inspector: it separates
the exact parsed AI JSON from deterministic analytics, post-model market
refresh, validation/risk, broker outcome, and the PostgreSQL/Better Stack audit
trail. Raw provider text, secrets, and broker identifiers are deliberately not
rendered; full persisted redacted input is available only through an explicit
operator checkbox.
New schema 2.1 analyses always return a mandatory buy-stop and sell-stop
proposal after deterministic input checks pass; the AI has no `NO_TRADE` or
leg-disable switch. The same tab shows prompt/request/response history, the
hash-verified system prompt, and an opt-in exact redacted user-message view.
Prompt `system-v7` is screenshot-first, self-checks both independent legs and
the configured TP-distance division by two, receives the non-sizing maximum
stop distance affordable at broker minimum volume, and keeps each confirmation
inside the configured M1-ATR reachability cap. The
dashboard shows endpoint and effective TP/R:R side by side; generated proposals
remain distinct from queued or broker-submitted orders.
After deterministic margin/sizing work, execution reconciles the account and
reacquires market state once more. It rejects changed account/candle/metadata,
rechecks spread and both proposal forms, and uses only that final quote/depth
for the unchanged placement-freshness limits.

## Prerequisites

- Debian 13+
- Node.js 22 LTS and npm 10+
- Python 3.13, `python3-venv`, and build tools
- Neon PostgreSQL connection with TLS
- cTrader Open API application and authorized **demo** account for integration work
- Optional OpenAI-compatible endpoint and Better Stack source

## Debian and Node.js setup

```bash
sudo ./scripts/setup-debian.sh
npm ci
npm run build
```

The setup script does not install secrets or start trading. For manual Node setup, install Node.js 22 from a trusted Debian-compatible source, verify `node --version`, then run `npm ci`.

## Python virtual environment

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.lock
```

## Environment configuration

```bash
cp .env.sample .env
chmod 600 .env
mkdir -p .runtime logs
touch .runtime/emergency-stop
```

Keep `EMERGENCY_STOP=true`, `AUTOMATIC_ANALYSIS_ENABLED=false`,
`LIVE_TRADING_ENABLED=false`, `SHADOW_MODE=true`, and the live acknowledgement
empty during development. Production systemd uses a root-owned
`EnvironmentFile` outside the repository.

## Neon setup and migrations

Create a least-privilege application role and a separate migration role. Put the TLS URL in the protected environment, then run:

```bash
npm run db:migrate
npm run db:status
```

Never paste the URL into logs or command history on shared systems. See `docs/database-schema.md`.

## cTrader setup

Register an Open API application, authorize a demo account, and configure the documented demo endpoints, client ID/secret, access/refresh tokens, and optional account ID. Tokens are renewable and must not be treated as permanent. Start with market data and reconciliation; enable demo submission only after mock/replay/paper checks. Exact broker symbol metadata is discovered at runtime.

Completed-candle continuity uses the symbol's broker-declared weekly schedule and
timezone. Scheduled closures may be explicitly marked; a missing bar while the
weekly session is open, malformed schedule, overlap, unmodeled holiday override,
or future quote/depth source timestamp fails closed.

## OpenAI-compatible endpoint

Configure `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, and the supported API style.
The Responses style requests strict JSON Schema output where the endpoint
supports it; all output is size-limited and validated locally regardless.
System-v6/schema 2.1 require a buy-stop plus sell-stop proposal whenever the
model is reached and tell the endpoint how the downstream TP midpoint, R:R,
target ordering, and unchanged-stop limit are validated. The exact system
prompt/hash is persisted per new request.
Compact mode computes indicators from the full configured 600/500/300 completed
M1/M5/M15 histories but sends only the newest 30/18/12 raw candles alongside
those indicators. `MODEL_COMPACT_RAW_TAIL_1M`, `_5M`, and `_15M` may override
the tails with positive counts no larger than the collected history.
AI or prompt-artifact failure rejects the cycle and creates no order. Repeated
transient AI timeout, transport, or HTTP 503 failures open the circuit only at
the configured positive threshold; a validated response resets the count.

## Better Stack

Create an ingestion source, set its token/host only in the protected environment, and set `BETTERSTACK_ENABLED=true`. Test redaction and delivery in paper mode. Logging transport failure never blocks reconciliation; critical audit persistence failure blocks new live orders.

New PostgreSQL audit events are also atomically queued for redacted delivery to
the configured source. Use the Streamlit **Operations** tab to monitor queue
status and delivery attempts, and use `event_id`, `analysis_id`, `request_id`,
or `order_group_id` to correlate Better Stack Live Tail with PostgreSQL. The
database remains the complete authoritative trail; remote delivery is
at-least-once and may contain a duplicate after a crash between HTTP acceptance
and the delivery checkpoint.

## Running services

Development commands (after dependencies and migrations):

```bash
npm run dev:market-data
npm run dev:ai
npm run dev:execution
.venv/bin/uvicorn python.analytics.api:app --host 127.0.0.1 --port 8090
.venv/bin/streamlit run apps/dashboard/app.py --server.address 127.0.0.1 --server.port 8501
```

The Node service entrypoints load the ignored local `.env` for development.
Python/Streamlit commands inherit configuration from the invoking environment;
production services use the protected systemd `EnvironmentFile`.

The analytics, market-data, AI, and execution APIs expose `/health/live` and
`/health/ready`. The execution API also exposes `/metrics` when metrics are
enabled. The Streamlit dashboard has no separate application health endpoint;
monitor its systemd unit and loopback HTTP listener.

For a PM2-managed development/VPS installation, build first and start the
checked-in ecosystem definition. It contains no credentials and each service
loads the ignored local `.env` from the repository working directory:

```bash
mkdir -p logs/pm2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

PM2 must itself be supervised by a working systemd startup unit before reboot
survival is claimed. The hardened project systemd units remain the preferred
production deployment. Never run both deployment methods simultaneously.

## Replay and backtest

```bash
.venv/bin/python -m python.replay.cli --input tests/fixtures/replay/analytics-requests.jsonl --mode replay
.venv/bin/python -m python.backtest.cli --input tests/fixtures/backtest/oco-scenario.json --output artifacts/backtest.json
```

Replay input is one versioned analytics request per JSONL line. Backtest input
contains `candles`, `buy`, `sell`, and `config` objects accepted by the typed
models. Historical depth must be real or explicitly labelled synthetic.
The checked-in replay fixture is a contract smoke test with deliberately short
history, so long-window indicators are null and it is not a trading-quality data
sample. Same-candle TP/SL ambiguity is resolved conservatively. See
`docs/testing.md`.

## Paper, demo, and shadow

```bash
TRADING_MODE=paper EMERGENCY_STOP=false npm run start:execution
TRADING_MODE=demo DEMO_TRADING_ENABLED=false EMERGENCY_STOP=true npm run start:execution
TRADING_MODE=shadow SHADOW_MODE=true EMERGENCY_STOP=false npm run start:execution
```

Paper uses deterministic simulated fills but the end-to-end service still needs
the market-data, analytics, AI, and PostgreSQL dependencies. Demo uses only demo
endpoints/accounts and still requires mode-specific placement acknowledgement.
Shadow runs live data/AI/risk but its gateway cannot submit. Results are stored
with their mode. Broker-backed daily-risk startup fails closed when a verified
start-of-day baseline and capital-flow history cannot be established.
Paper and broker-backed account identities are stored separately. For a first
demo startup after the daily opening grace, leave demo submission disabled and
the environment emergency stop active, then use the authenticated dashboard
control to initialize a one-time baseline. It succeeds only with empty
account-wide positions/orders, no current-day cTrader deals, available cash-flow
history, and no existing baseline. It never places an order. See
`docs/operations-runbook.md` before any later supervised demo enablement.
Migration `0006` and a clean durable cTrader execution-event recovery are also
mandatory before demo submission. Closed-trade outcome mapping remains
fail-closed pending supervised broker-field validation.
Automatic analysis defaults off, while reconciliation, expiry, cancellation,
and safety maintenance continue. Demo submission refuses startup unless the
exact acknowledgement, a positive `MAX_ORDERS_PER_DAY`, and a positive
per-position `MAX_POSITION_NOTIONAL` are all configured. Keep the automatic
gate off and use one authenticated loopback cycle for the first supervised
session. A later explicitly authorized campaign can set
`AUTOMATIC_DEMO_CLOSED_TRADE_LIMIT` to the required durable closed-demo-trade
sample. Rejections and unfilled expiries remain visible but do not complete that
target. `AUTOMATIC_ANALYSIS_COMPLETED_LIMIT` remains a separate finite
inference-cost ceiling; reaching either boundary pauses new analyses while
continuing broker lifecycle maintenance.
`AUTOMATIC_ANALYSIS_COMPLETED_BASELINE` must normally remain zero; it exists
only to carry a separately verified durable count through a reviewed immutable
bug-fix release and is displayed separately on Overview.
`AUTOMATIC_DEMO_CLOSED_TRADE_BASELINE` has the same reviewed carry-forward rule
for terminal demo trades and normally remains zero.

## Tests and quality gates

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

## Dashboard

Open `http://127.0.0.1:8501`. Keep it on loopback or place it behind an authenticated TLS reverse proxy. Mutating controls require `DASHBOARD_CONTROL_TOKEN`, are audited, and do not substitute for live filesystem/environment gates.

The **Analysis History** tab is the campaign ledger: it shows every counted
durable AI response, original/effective/placed BUY and SELL levels, no-order or
broker lifecycle, and closed demo win/loss results. It also exposes the selected
run's redacted prompt/response and execution evidence without account or broker
identifiers.

The **Live open trade** panel uses the exact durable broker position identity
for its cTrader P/L lookup. If the surrounding execution group requires
reconciliation but the single durable position is still `OPEN` and that exact
broker lookup succeeds, the values remain visible with a warning while all
analysis and placement gates stay blocked. Ambiguous or otherwise uncertain
position evidence still renders no value.

If Streamlit loads while the loopback execution API is restarting, it labels
the page `RECONNECTING`, states that durable history is retained, retries every
two seconds, and reruns the full dashboard after a complete status response.
This prevents a brief restart from leaving Overview and Analysis History stuck
on an old unavailable snapshot. Genuine malformed or ambiguous evidence still
remains unavailable.

## systemd installation

```bash
sudo ./scripts/install-systemd.sh
sudo systemctl daemon-reload
sudo systemctl enable --now ctrader-ai-scalper.target
systemctl status 'ctrader-*'
```

Units expect an atomic `/opt/ctrader-ai-scalper/current` symlink to a tested
release. Follow `docs/deployment-debian.md`; inspect units and paths before
installation.

## Troubleshooting

- `not ready`: inspect `/health/ready`, service journal, database, reconciliation and freshness reason codes.
- no analyses: emergency stop, pause, open/pending/unknown state, stale candles/depth, daily lockout, or AI breaker may be active.
- model rejected: inspect schema/semantic reasons; levels are not silently repaired.
- cTrader reconnecting: verify demo/live endpoint separation, token expiry/refresh, clock, and application authorization.
- dashboard controls denied: bind locally and set the protected control token; check the audit event.

## Security and log redaction

Secrets are recursively redacted by key and credential pattern before local/remote logging or payload persistence. Account identifiers are hashed where correlation is needed. No startup configuration dump is allowed. Run secret scans before commits and rotate anything accidentally exposed. See `docs/security.md`.

## Live-readiness

Live requires the exact checklist in `docs/demo-to-live-checklist.md`, including
independent environment, acknowledgement, manually created enablement file,
database/dashboard acknowledgements, startup checks, fresh market data,
reconciled empty relevant broker state, symbol metadata, valid model output,
risk approval, audit health, and no lockout. Operators must enable it manually
after review; no script or migration does so. This release intentionally wires
`DisabledLiveGateway`, so it cannot place a live order even if every
configuration gate is present. Replacing that boundary requires a separate
reviewed implementation and broker validation.

The current verification evidence, setup handoff, deliberate disablements, and
remaining review requirements are recorded in `docs/implementation-report.md`.
