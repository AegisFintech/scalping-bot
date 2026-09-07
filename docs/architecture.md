# Architecture

Current source: `0.2.0-overhaul.1`, conservative policy v1. Previous release
observations are historical evidence in `plan.md`, not the current source contract.

The separate `packages/scenario-engine` research path captures typed market data,
uses existing Python analytics to render M15/M5/M1, and calls the bounded provider
with a strict scenario-only schema. A deterministic replay consumes subsequent
completed candles and bid/ask observations, reuses `sizePosition`/commission/spread
validation and simulates entry plus automatic exit. Model inference and replay are
independent promises. It has no broker gateway or SQL mutations. Replay recovery
rebuilds state from a checksummed event journal; this is not broker reconciliation.
See [its implementation boundary](scenario-automation-report.md).

## Services and authority

```mermaid
flowchart LR
  Broker[cTrader] --> Market[Market data service]
  Market --> Analytics[Python completed-candle analytics]
  Analytics --> Coordinator[Execution coordinator]
  Coordinator --> AI[AI orchestrator / EPRToken]
  AI --> Coordinator
  Coordinator --> Risk[Deterministic risk engine]
  Risk --> Gateway[Paper / demo / shadow / disabled live]
  Gateway --> Broker
  Maintenance[Independent protective maintenance] --> Gateway
  Coordinator --> DB[(PostgreSQL audit and state)]
  Broker --> Journal[Execution journal and recovery]
  Journal --> DB
  DB --> UI[Streamlit]
  UI --> Controls[Authenticated local controls]
```

Node owns broker connectivity, stateful coordination and risk. Python owns
analytics/replay and presentation. Communication with analytics is typed local
HTTP, not a shell pipeline. No service requires Docker; listeners default to
loopback and deployments support Debian/systemd.

## Data to order trace

1. `packages/ctrader-client` authenticates, renews tokens, discovers account and
   symbol metadata, and maintains quote/depth subscriptions. It validates weekly
   broker sessions. Unknown holiday gaps remain fail-closed.
2. `apps/market-data-service` exposes typed snapshots and quotes. Source,
   receipt and capture times are distinct. Recording is a bounded local cache
   sampler, not a complete tick feed. Freshness/order checks precede writes;
   gzip segments carry checksum/count manifests and bounded retention.
3. `python.analytics` validates completed M1/M5/M15 candles, alignment, depth
   and canonical decimal strings. Full 600/500/300 histories feed indicators;
   bounded numerical features/raw tails and a deterministic chart are produced.
4. `coordinator.ts` records input provenance, checks safety/spread/account and
   derives feasible tick-aligned price bounds before paying for inference.
   Production scheduler admission still uses a durable account/symbol/M1 claim.
5. `ai-orchestrator` sends exact model `gpt-6-astra/u64` through Responses,
   using prompt v16, strict schema 2.1 and structured numerical input. The
   adapter also supports chart experiments and mocked Chat Completions. It
   bounds request/response sizes, output tokens, concurrency, timeout and retries.
6. Local schema validation is repeated across the HTTP boundary. The coordinator
   independently checks identity, expiry, precision, technical levels, geometry,
   spread and the unchanged completed-candle context after inference.
7. The existing fee-buffered TP / double-SL transform is recorded separately from
   immutable model output. Bound arithmetic projects inward onto the pip grid;
   no broker price or untrusted model value is rounded into acceptance.
8. `risk-engine` sizes both race-exposed legs with cost reserves, current equity,
   remaining daily budget, durable capital risk, broker volume steps, currency
   conversion, exact margin estimates and notional limits. It never rounds up to
   minimum volume. Existing/unpriced account exposure blocks replacement.
9. Account and market data are refreshed again; changes invalidate the plan.
   Final risk-cap reductions also reject previously sized commands. Transactional
   idempotent intent precedes gateway calls. cTrader STOP_LIMIT entries and
   fill-relative protections handle the immediate broker event path.
10. Broker events are durably deduplicated/mapped. Unknown, partial, conflicting
    or incomplete outcomes remain reconciliation blockers. Existing recovery
    handles duplicate callbacks, peer-cancel retries and both OCO legs filling.

## Independent protective path

`IndependentMaintenance` serializes the two-second maintenance loop separately
from the analysis promise. It runs expiry, journal recovery, peer cancellation,
and authenticated/file/environment emergency checks while a model call is in
flight. Maintenance SQL is scoped to the exact account and symbol and selects
strategy-owned orders only. Shutdown drains the maintenance promise before
closing broker/database resources. Broker stops do not depend on this process.

This separation removes an avoidable inference/maintenance coupling. It does
not relax order admission, candle validity, expiry or reconciliation.

## Persistence and boundaries

PostgreSQL is authoritative for intervals, intents, groups, orders, fills,
positions, trades, daily accounting, runtime controls and audit events. Migration
0015 adds provider telemetry/failures and durable capital state. Models cannot
write those controls. Financial boundaries use decimal strings; prices and money
use Decimal arithmetic. Daily utilization rounds conservatively to eight decimal
places, matching storage instead of emitting unbounded recurring decimals.

Successful provider calls retain requested/returned identifiers and usage;
failed calls retain requested model, bounded reason and elapsed time. A failed
call has no trusted returned-model/usage record. Pricing is unverified and stays
unavailable. Prompts/charts and legacy evidence remain auditable even when the
new structured input profile omits the chart from the provider request.

The dashboard exposes a compact overview and mode/account/symbol-scoped history.
Diagnostics lazily render selected detailed views. Financial freshness is explicit;
missing capital-policy telemetry on an older deployment is not inferred. Pause
and emergency actions require a separate token and durable audit.

Overview/history snapshots are read by a cached worker per view, with one in-flight
read and ten-second admission intervals. Rendering polls completion without waiting
on network/database work. Two-second fragments emit stable keyed live sections;
the title, navigation and control form remain outside the timer. Observation age
starts before IO and values older than 30 seconds are withheld. Failed reads clear
the previous display value. The workers never call Streamlit, execute orders or
send controls. Diagnostics retain the user's selected snapshot during recovery.

## Modes and remaining limits

Paper uses its own account identity/ledger; demo requires explicit acknowledgement
and capital limits. Shadow has a non-submitting gateway. Live uses
`DisabledLiveGateway` and cannot place orders in this composition. Credentials
cannot select mode or authorize execution.

Current research does not justify directional/single-leg production contracts or
sub-M1 production scheduling. Schema 2.1 remains a two-leg proposal; uncertainty
is rejected deterministically when safety/validation fails. Full tick history,
prospective model ablation and broker-specific partial/multiple-close validation
remain readiness work. See `overhaul-report.md` and `risk-model.md`.
