# cTrader scalper

A Debian-compatible, AI-assisted XAUUSD analysis and execution system. The model
proposes prices; deterministic code controls money, validation and execution.
**Live submission is disabled. The tested strategies have not demonstrated
positive net expectancy.**

The current source release is `0.2.0-overhaul.1`, policy `conservative-v1`, prompt
`system-v16`, model-response schema `2.1`. This repository update does not launch
trading or deploy services. See the [implementation and evidence report](docs/overhaul-report.md)
for what was measured, what changed, and what remains unverified.

## Overview

![Dashboard overview](docs/images/dashboard-overview.png)

The Streamlit dashboard has **Overview**, **Trade history**, and **Diagnostics**.
Overview shows operating state and reasons, fresh equity and net P&L, drawdown,
remaining budget, active exposure and the latest decision/execution. Read-only
snapshots refresh in a background worker every ten seconds; small live sections
update independently while navigation and control inputs stay in place.
Light and dark themes retain readable contrast. Financial observations older
than 30 seconds are withheld.
The screenshots show the new UI reading the existing demo deployment; new
capital-policy telemetry remains unavailable until its migration and reviewed
rollout. Prompts, analytics, provider details and infrastructure live in diagnostics.
Authenticated pause and emergency controls remain available in the sidebar.

[Trade history screenshot](docs/images/dashboard-history.png)

[Dark theme screenshot](docs/images/dashboard-overview-dark.png) ·
[Refresh and contrast validation](docs/dashboard-refresh-report.md)

## Safety and money management

- Paper is the default mode; emergency stop starts active and automation is off.
  Credentials never authorize demo or live trading.
- One strategy setup at a time. Other-symbol account exposure, partial fills,
  unknown orders and incomplete reconciliation block new risk. Manual orders
  are never cancelled. Maintenance selects only the configured account/symbol.
- The conservative policy preserves the audited deployment's **0.001% total
  setup risk**, **1% daily loss limit**, **1% margin ceiling**, and **10-point
  absolute spread ceiling**, alongside ATR/percentile spread checks. Both OCO
  legs share the setup budget, including simultaneous-fill race exposure.
- Sizing reserves round-trip commission and ten ticks of adverse execution,
  floors broker-native volume, and respects explicit notional/equity limits.
  Minimum volume is rejected when unaffordable. Stops cannot cap gap losses.
- Cash-flow-adjusted high-water accounting survives restarts. Drawdown/daily
  losses can reduce risk to half or quarter; a 5% drawdown lockout is durable.
  Recovery is bounded and documented in the [risk model](docs/risk-model.md).
- Protective maintenance has its own serialized two-second loop. Slow inference
  cannot block expiry, peer cancellation or recovery. Broker-held protections
  continue during model outages. Emergency stop does not flatten positions.

## Model and decision path

The existing EPRToken endpoint accepted the exact requested identifier
`gpt-6-astra/u64` with Responses and strict JSON Schema, returning `gpt-6-astra`.
Both identifiers, timing and available token usage are retained. Later benchmark
requests returned HTTP 403; continuous availability and pricing remain unresolved.
No fallback model is substituted. Temperature and reasoning-effort parameters
are omitted; the `/u64` suffix is sent literally, not interpreted by this code.

The default provider input is bounded structured data. A small matched benchmark
saved 65.8% of request bytes without the image but did **not** demonstrate lower
latency or better trading quality. Image benchmarking remains available. Every
output still passes local schema and semantic checks. Timeouts, one in-flight
request, bounded response bodies and circuit breaking contain provider failures.
Unknown model cost is `null`, never zero.

Production analysis retains one durable claim per completed M1 context and
60-second preferred pending validity (120-second hard maximum). After inference
and again before placement, quotes/account state are refreshed and the completed
candle identity must still match. Broker STOP_LIMIT orders provide the event
trigger. This is not institutional HFT. Faster/directional alternatives are
research candidates; the available evidence does not justify enabling them.

## Configuration and migration

The normal [.env.sample](.env.sample) has **22 settings, down from 176 (87.5%)**.
It contains deployment identity, credentials/endpoints, explicit authorization,
and two capital limits. Stable internals are fixed in a typed policy, not another
operator tuning file. Conflicting legacy overrides produce errors naming keys
without printing values. Broker symbol/contract metadata remains authoritative.
`AI_MODEL=gpt-6-astra/u64` is explicit; other AI and strategy tuning is fixed in
code. The authorized local migration reduced the populated `.env` from **176 to
26** entries, preserving all credentials and existing capital/mode choices. Its
four additional entries preserve deployment credentials. See the
[migration evidence and rollout blockers](docs/environment-migration-report.md).

For an existing installation, **do not overwrite `.env`**. Read the
[configuration inventory and migration instructions](docs/configuration.md), then:

```sh
npm ci
npm run config:check -- .env.sample
npm run config:check -- .env
npm run config:check -- .env --startup
npm run build
```

The policy check rejects conflicting legacy settings; `--startup` also checks
execution configuration, including explicit demo capital limits. Neither check
contacts the broker or authorizes trading. Keep secrets in ignored mode-0600 files
or a credential store. Migration
`0015` is additive and must be applied as a separate reviewed rollout while new
analysis is paused. Historical migrations and audit data remain intact.

Node 22 and Python 3.13 are the deployment baselines. Install Python dependencies
from `requirements.lock`. Headless services and hardened systemd units are in
[systemd/](systemd/); see [Debian deployment](docs/deployment-debian.md) and the
[operations runbook](docs/operations-runbook.md). Docker is not required.

## Reproducible research and validation

```sh
# Read-only export, scoped by existing account identity; never exports broker IDs.
npm run evaluation:export -- 0.1.0-actionable-oco-auto-demo.43 artifacts/legacy-plans.json
.venv/bin/python -m python.evaluation.cli .runtime/market-data artifacts/evaluation.json \
  --legacy-plans artifacts/legacy-plans.json --until-ms 1788743999922
# Paid, bounded inference only; local archived inputs are required.
npm run provider:benchmark -- artifacts/benchmark-inputs.json artifacts/provider-results.json
```

The quote evaluator verifies manifests, rejects unordered/nonfinite data, removes
ambiguous timestamps, uses earlier completed sampled minutes, and evaluates
frozen candidates on two chronological holdouts. It models bid/ask, execution
latency, stop-limit nonfills, adverse fills, commissions, partial-fill scenarios,
and model-cost sensitivity. Missing paths are censored; total P&L is withheld
when exposure cannot be resolved. These recordings are sampled quotes, not a
complete tick tape. M1 fixtures and smoke tests are not profitability evidence.

At audit, demo release `.43` had 23 closed trades and **−11.88 net after fees**.
The faster candidates also lost on their observed closed outcomes. Archived
legacy plans had only one holdout fill, too little for an old-versus-new strategy
conclusion. Full metrics, uncertainty, source citations and limitations are in
[the report](docs/overhaul-report.md) and [evidence](docs/evidence/quote-evaluation.json).

Run the complete gates described in [testing](docs/testing.md), including Node
and Python checks, PostgreSQL migration/integration tests, schema/fail-closed
checks, secret scanning and dependency audits. Repository delivery rules are in
[AGENTS.md](AGENTS.md) and bounded work is tracked in [plan.md](plan.md).
