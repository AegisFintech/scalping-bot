# Testing

## Layers

Unit tests cover ATR Wilder(15), EMA(5/19), optional indicators, Decimal canonicalization, compact features, schema/semantic validation, risk/volume/reward, daily boundaries, freshness, OCO/expiry, confidence adjustment, and redaction.

Integration tests cover Node/Python HTTP contracts, PostgreSQL migrations/constraints/transactions, AI mock variants, cTrader mock auth/events/reconciliation, paper lifecycle, reconnect/restart, and Better Stack transport failure.
Daily-risk coverage includes paper/demo identity isolation, empty deal-history
evidence, authenticated baseline controls, serializable one-time baseline/audit
persistence, and rejection of activity or duplicate initialization.

Replay tests align 1m/5m/15m by completed end time, forbid future data, label/deny missing historical depth, inject latency/spread/slippage, and choose the adverse outcome when candle OHLC permits both TP and SL with unknown path.

Failure tests include malformed/extra JSON, wrong IDs/symbol, stale/future response, impossible/inverted prices, bad R:R/precision/metadata/depth, expired token, DB/AI/network failure, partial fill/cancel race, duplicate events, restart, and partitions.

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

On 2026-08-24, formatting, ESLint, TypeScript typecheck/build, 79 Node unit
tests across 25 files, 10 schema tests, 2 static migration tests, Ruff, strict mypy across the
analytics and dashboard code, 13 Python tests,
npm audit, pip-audit, shell syntax, and secret scanning passed. The typed
Node/Python integration plus fresh-schema and `0005`-to-`0006` upgrade tests
passed. TLS connectivity and all six migrations passed inside isolated Neon
schemas, which the tests dropped afterward; migrations `0001` through `0005`
remain applied to the configured Neon schema. The host used Node 24.18.0; the supported Node 22
deployment baseline and installed systemd paths still require a Debian release
validation. Offline systemd security parsing passed for all five units with a
2.8 (`OK`) common sandbox score on systemd 257. Credentialed cTrader demo auth,
token renewal, market data, empty-state reconciliation, and audited daily-risk
baseline initialization with empty deal history passed; no demo order
or live-data shadow session was run. Versioned cTrader demo execution fixtures
cover accepted, partial-fill, full-fill, rejection, deduplication, peer cancel,
and restart recovery paths; supervised broker-field validation remains pending.
A configured-endpoint strict schema probe
returned a locally validated `NO_TRADE`. The checked-in replay and backtest CLI
smoke fixtures also completed; the replay fixture intentionally has too little
history for long-window indicators and is not a trading-quality dataset.
