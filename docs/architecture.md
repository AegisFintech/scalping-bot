# Architecture

Current source: `0.2.3-equity-risk.9`, fixed risk policy v4. Previous release
observations are historical evidence in `plan.md`, not the current source contract.

Production uses a fresh five-minute scenario placement context, a durable request journal,
and deterministic protected OCO execution. Paid inference runs separately from
execution and independent maintenance. The original directional replay remains
research-only; its confirmation/structural-close rules are distinct from OCO price
triggers. See [the integration report](reusable-scenario-report.md).

## Services and authority

```mermaid
flowchart LR
  Broker[cTrader] --> Market[Market data service]
  Market --> Analytics[Python completed-candle analytics]
  Analytics --> Coordinator[Execution coordinator]
  Coordinator --> Claim[Durable context request claim]
  Claim --> AI[Asynchronous AI orchestrator / EPRToken]
  AI --> Context[Immutable five-minute map]
  Context --> Coordinator
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
   broker sessions. Validated broker holiday overrides use their declared date, recurrence and timezone. Unexplained gaps remain fail-closed.
2. `apps/market-data-service` exposes typed snapshots and quotes. Source,
   receipt and capture times are distinct. Recording is a bounded local cache
   sampler, not a complete tick feed. Freshness/order checks precede writes;
   gzip segments carry checksum/count manifests and bounded retention.
3. `python.analytics` validates completed M1/M5/M15 candles, alignment, depth
   and canonical decimal strings. Full 600/500/300 histories feed indicators;
   bounded numerical features/raw tails and a deterministic chart are produced.
4. `coordinator.ts` records completed-candle provenance and checks safety,
   spread, account, affordable stops and fee coverage before a refresh can start.
   Five-second broker-time claims admit local decisions; the final five seconds
   before M1 rollover are reserved. `DEFERRED` is terminal waiting with a separate
   deferral reason; actual validation failures remain `REJECTED`.
5. `scenario-context.ts` claims at most one potentially dispatched refresh per account/symbol/mode per
   five minutes using a transaction/advisory lock for failed/unknown or unconsumed contexts.
   A uniquely claimed post-close request can start earlier after complete terminal evidence; active groups prohibit requests. The source analysis links the
   archived chart and market inputs. A separate task calls `/v1/scenario`, using
   exact `gpt-6-astra/u64`, prompt `scenario-v2`, strict `scenario-1.0`, chart and
   bounded candle tails. Completion/failure and usage are durable. An interrupted
   request is not retried during its cooldown, because provider acceptance is unknown.
   Previous-model maps remain audited but cannot authorize new execution; the same
   account/symbol/mode cooldown survives a model change.
6. `ScenarioHttpPlanner` independently validates raw JSON, identity, prompt hash,
   timing, model request pin and telemetry. `scenarioOco` derives a schema-2.1 pair
   from an unconsumed map. Thresholds are not chased; distant entries, insufficient
   reward or short remaining validity defer. Each local decision still uses fresh
   quotes and unchanged completed-candle context checks across its own short path.
   `model_requests.decision_source` distinguishes local artifacts from paid calls;
   real refresh attempts live in `scenario_contexts`.
7. The existing fee-buffered TP / double-SL transform is recorded separately from
   immutable model output. Bound arithmetic projects inward onto the pip grid;
   no broker price or untrusted model value is rounded into acceptance.
8. `risk-engine` sizes both race-exposed legs with cost reserves, current equity,
   the fixed 1% setup ceiling, remaining 5% daily budget, durable capital risk, broker volume steps, currency
   conversion and exact margin estimates. Free margin reserves one modeled setup loss;
   there is no artificial notional or 1% collateral ceiling. It never rounds up to
   minimum volume. Existing/unpriced account exposure blocks replacement.
9. Account/capital safety and account state are refreshed before the final market
   snapshot; changes invalidate the plan. Cheap authorization controls are read
   again after semantic checks. Final admission preserves blockers from both
   safety and account observations; no newer exposure/uncertainty is overwritten.
   Final risk-cap reductions also reject previously sized commands. A unique
   `order_groups.context_plan_id` consumes each map at intent, even when broker
   submission later fails or becomes uncertain. Transactional
   idempotent intent precedes gateway calls. cTrader STOP_LIMIT entries and
   fill-relative protections handle the immediate broker event path.
10. Broker events are durably deduplicated/mapped. Unknown, partial, conflicting
    or incomplete outcomes remain reconciliation blockers. Existing recovery
    handles duplicate callbacks, peer-cancel retries and both OCO legs filling.

Account P/L matching requires exactly one row per open position. This broker also
reports zero P/L for the position identities reserved by pending orders. Such a
row is valid only when gross and net are both zero and its identity matches exactly
one accepted order with explicit zero executed volume. These orders remain counted
as pending exposure; other-symbol exposure still blocks. Unknown, duplicate,
nonzero unmatched, partial and missing open-position evidence reject. Known account
failure codes are retained in status/logs without raw exceptions. See
[the reconciliation report](pending-order-reconciliation-report.md).

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

The immutable strategy-definition hash excludes the operational scheduler-enabled
flag. Full safety/control audit hashes still include it; all economic parameters
remain in both hashes. Activation therefore does not redefine strategy economics,
while altered risk or notional parameters still require a new release identity.

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
and fixed equity-relative loss limits. No absolute equity floor is required. Shadow has a non-submitting gateway. Live uses
`DisabledLiveGateway` and cannot place orders in this composition. Credentials
cannot select mode or authorize execution.

Current research does not establish an economic benefit from the five-second
local cadence or justify directional/single-leg production contracts. Schema 2.1 remains a two-leg proposal; uncertainty
is rejected deterministically when safety/validation fails. Full tick history,
prospective model ablation and broker-specific partial/multiple-close validation
remain readiness work. See `overhaul-report.md` and `risk-model.md`.

## ISSUE-079 storage and operational recovery

The risk engine allocates half the available combined margin to each OCO leg before
sizing. Exact broker margin at the candidate volume may cause at most two additional
downward recalculations; only a confirmed affordable pair proceeds. Fresh account
fingerprints are checked again before placement. Costs, losses and volumes use Decimal.

Migration 0018 adds `storage_kind` to chart artifacts. Existing rows retain database
bytes; new rows refer to the exact PNG by SHA-256 in `.runtime/analysis-charts`.
The file is flushed and hash-verified before the database pointer commits. Dashboard
reads recheck dimensions/hash and reject missing, corrupt or redirected files.
Unchanged completed-candle inputs now produce the same chart despite a later capture
time; the exact analysis timestamp stays in the journal. An uncommitted file can be
an orphan, never a valid order or chart pointer. No financial rows are deleted.

A protected local operational-failure latch reports scheduler/storage errors across
restarts, returns HTTP 503 readiness and blocks manual cycle requests. Automatic
analysis retries at most once a minute; only a completed durable cycle clears it.
Spread writes respect the same backoff. Independent protective maintenance retains
its two-second schedule and all durable-write requirements.

## ISSUE-080 provider recovery

The scenario client now has a 90-second deadline with a 95-second HTTP envelope.
Original five-minute map expiry and the minimum remaining execution lifetime are
unchanged. Failed/unknown requests consume the full five-minute dispatch budget.
Only a known local circuit rejection can recheck after one minute; SQL admission
checks every earlier potentially dispatched request and separately enforces the
one-minute local floor under the existing scope lock. No journal rows are rewritten.
The sell constructor checks its fixed cost-buffered TP against the first actual
downside target, matching the buy constructor. It never treats the intermediate
extension trigger as a target or skips the first target to obtain more room.
Provider work remains detached from protective order maintenance. The AI readiness
endpoint checks the active scenario client, and dashboard entry availability is
distinct from process health, broker exposure, and local execution checks.

## ISSUE-082 pending validity

New local OCO proposals prefer 180 seconds and expire at the earlier of that
deadline and their immutable map deadline. The requested duration is validated
before capping; fewer than 60 seconds remaining causes a refresh wait. Schema 2.1
and the five-minute map schema/database constraint stay unchanged. An accepted
pending order keeps its original expiry through maintenance/reconciliation;
expiry never closes a filled position. Ten/fifteen-minute expiry comparisons
are isolated research cohorts with no broker authority.

## ISSUE-083 persistent order loop

The provider still returns immutable schema-1.0 levels and bounded placement validity.
Local execution artifact v2 and trusted `ORDER_LIFECYCLE` select GTC independently of
model output. Command `expiresAt` remains the submission deadline; optional
`timeInForce` defaults to historical GTD only for legacy callers. Production sets
GTC explicitly. `pending-order-lifetime-1.0.json` documents the durable projection:
GTC has null pending expiry plus a required `submission_valid_until`; GTD retains
its original dated expiry. Migration 0019 transitions history without changing it.

Maintenance only expires GTD. Normal shutdown preserves GTC; emergency/risk
cancellation and OCO fill cancellation retain authority. Account and journal
exposure gates suppress new analysis while either orders or a position remain.
After complete durable closure, `refresh_after_context_id` permits one immediate
fresh request under the same scope/advisory lock, across concurrent processes and
restarts. Failed/unknown requests retain bounded backoff. A close never reuses the
old map. Unfilled broker cancellation uses normal recovery/backoff.
