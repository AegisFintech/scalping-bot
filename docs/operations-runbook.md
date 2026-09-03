# Operations Runbook

## Start of session

1. Confirm mode/account banner and that demo/live endpoints match the intended account type.
2. Verify emergency stop behavior before clearing it for paper/demo/shadow.
3. Check database, analytics, cTrader, AI, log transport, disk, clock, and metrics health.
4. Confirm symbol metadata and candle/depth freshness.
5. Reconcile broker positions/orders; investigate every unknown/partial/cancellation-pending state.
6. Confirm daily baseline/timezone and risk/spread/slippage settings.

## First demo preflight and baseline

1. Select a new stable `ACCOUNT_KEY` used only for this cTrader demo account.
2. Set `TRADING_MODE=demo`, `CTRADER_CONNECTION_MODE=demo`,
   `DEMO_TRADING_ENABLED=false`, `LIVE_TRADING_ENABLED=false`, and
   `EMERGENCY_STOP=true`; restart execution and verify the dashboard says demo,
   emergency stopped, and trading disabled.
3. Confirm account-wide broker reconciliation contains no position or pending
   order. If the daily baseline is absent after the opening grace, use the
   dashboard's one-time **Initialize reconciled demo daily-risk baseline**
   control with operator identity and reason.
4. Treat any `DEMO_BASELINE_*` or `DAILY_RISK_BASELINE_*` rejection as a stop.
   Do not edit the database baseline manually. A current-day deal, any broker
   state, uncertain history/control state, or an existing baseline requires
   investigation or waiting for the next trading day.
5. Recheck status and audit rows. This preflight does not authorize demo orders;
   demo submission remains a later supervised checklist step.

## Demo execution-event preflight

Before setting `DEMO_TRADING_ENABLED=true`, verify migration `0006` is applied
and the execution service reports successful startup recovery. Inspect
`broker_execution_events` for any `UNMATCHED`/`CONFLICT` row or non-empty
`reason_codes` with `resolved_at IS NULL`; any such evidence blocks the session.
A final fill retains and resolves earlier partial-fill evidence instead of
deleting it. An unresolved partial fill, unknown state, history pagination,
missing local intent, missing full-close detail, partial/multiple close, or
conflicting trade outcome requires emergency stop plus operator reconciliation.
Never delete journal rows to clear readiness.

During OCO submission, cTrader may deliver an acceptance callback before the
placement request returns and may omit the client order ID. The execution
service queues that callback, commits both returned broker order IDs with the
local intents, and only then drains the callback journal. Confirm the callback
maps by broker order ID and that readiness clears after terminal evidence. If
readiness stays uncertain, keep both stops active and investigate the retained
journal; do not restart merely to erase a reason or edit journal rows.

After either OCO leg fills, periodic maintenance searches durable state for its
strategy-owned `PENDING` or `CANCEL_PENDING` peer and retries cancellation on
every maintenance pass; it does not wait for setup expiry. Cancellation intent
is durable before the broker call, manual orders remain excluded, and any
failed/ambiguous cancel remains `RECONCILIATION_REQUIRED`. If the peer fills
before cancellation is confirmed, both exact broker positions must close and
each must have one matching entry fill, terminal fill, and immutable trade
outcome before the group can close. Never delete the second outcome or combine
it with the first position.

The observed demo server also attaches a position placeholder without `price`
to pending `ORDER_ACCEPTED` events. This is not a fill: it has no deal and must
not create a local position. The order acceptance is still journaled and mapped.
An unpriced position on `ORDER_FILLED` or `ORDER_PARTIAL_FILL` remains invalid
and blocking.

On a terminal `ORDER_FILLED` close, cTrader may report zero or omit the
contextual CLOSED position `price` even though the same callback has a complete
deal, positive close execution price, and `closePositionDetail.entryPrice`.
That exact terminal shape uses the close-detail entry price. It does not apply
to an OPEN position or incomplete deal. A late duplicate normalization failure
can clear only when PostgreSQL returns terminal proof carrying the same broker
fill identity; a different or missing fill identity remains fail-closed.

The running execution service rechecks unresolved local demo state against
bounded broker history every 15 seconds by default. This is the normal recovery
path when a terminal callback is missed; an exact closing order/deal can close
the durable position, trade, and group without a restart. Timer and reconnect
attempts serialize. `DEMO_EXECUTION_RECOVERY_RUN_FAILED` or any specific
`DEMO_RECOVERY_*` reason keeps new analysis locked and retries later; never edit
the journal or infer a terminal result. Configure
`DEMO_EXECUTION_RECOVERY_INTERVAL_SECONDS` only from 5 through 300 seconds.

cTrader may create a distinct `STOP_LOSS_TAKE_PROFIT` closing order after an
entry fills and retain the entry's client order ID. Confirm the journal records
`broker_order_type=4` and `closing_order=true` without replacing the entry's
broker order ID. The child acceptance may temporarily report
`DEMO_CLOSING_ORDER_AWAITING_DEAL`; only its exact single closing deal may
resolve that row and close the position/trade/group. If the broker no longer
returns the position, bounded recovery uses the durable local position plus
that exact order/deal. Missing, ambiguous, or multiple evidence requires both
controls to remain active; do not edit the journal or infer an outcome.

Search Better Stack for `event_name=demo_execution_callback_failed`. Its
`reason_code`, `stage`, execution/order enum values, and field-presence booleans
are deliberately sufficient to classify the adapter boundary but never include
the raw callback, label, client/broker IDs, account identity, or database error
text. An unrecognized exception is reduced to
`DEMO_EXECUTION_NORMALIZATION_FAILED` or
`DEMO_EXECUTION_PERSISTENCE_FAILED`. Keep both controls active until a bounded
tested adapter correction has reconciled the retained broker/local state.

For the first supervised session, keep `AUTOMATIC_ANALYSIS_ENABLED=false`, set
`MAX_ORDERS_PER_DAY=1`, and configure a broker-reviewed positive
`MAX_POSITION_NOTIONAL` that permits no more than the intended minimum-volume
position at the current XAUUSD price. The process refuses demo-enabled startup
when the exact demo acknowledgement or either hard cap is missing. Confirm the
dashboard reports automatic analysis `OFF`; trigger only one authenticated
loopback cycle. The cycle endpoint has no request body; omit
`content-type: application/json` when sending an empty POST, because Fastify
rejects an empty declared-JSON body before the coordinator runs. Immediately
reactivate emergency stop after the observation,
cancel strategy-owned pending orders through the protected control, reconcile,
and restore `DEMO_TRADING_ENABLED=false` plus an empty acknowledgement before
leaving the session unattended.

For PM2 deployment, do not export every development `.env` value into the
process manager. In particular, a local `APP_ENV=development` can replace the
checked production identity and correctly trigger strategy immutability
failure. Build from the merged commit, restart through `ecosystem.config.cjs`,
and pass only the explicit safe overrides needed for that restart: demo off,
empty demo acknowledgement, automatic analysis off, and environment emergency
stop on. Verify those values through the service status before any later
enablement.

For each fully closed single-deal demo position, persist the protocol-defined
signed `grossProfit + swap + commission + pnlConversionFee` as realized P/L and
persist the last three components as fees. Full-close detail and volume must
match the durable filled volume. Missing detail, partial/multiple closing deals,
or a second conflicting outcome for the same position stay unresolved and
block new placement. A distinct second position from an OCO double fill is
retained separately and the dashboard reports the combined setup result without
hiding either direction.

After every completed model call, the coordinator reacquires the full snapshot.
`DECISION_MARKET_REFRESH_FAILED`, `DECISION_MARKET_TIME_REGRESSION`,
`DECISION_SYMBOL_METADATA_CHANGED`, or `DECISION_CANDLE_CONTEXT_CHANGED` is a
hard rejection, not permission to reuse the pre-model quote. The final spread,
quote age, depth age, semantic checks, and risk sizing use only the refreshed
execution state. Investigate repeated context changes or refresh failures; do
not widen freshness thresholds to accommodate model latency.

## Automatic demo analysis loop

### PostgreSQL bulk-history capacity recovery

`DATABASE_STORAGE_LIMIT_EXCEEDED` means PostgreSQL could not durably record a
complete cycle. It is not an AI rejection and no order is sent. Stop the
execution service only after status and broker reconciliation show no active
strategy order or position. Export `candles` and `indicator_snapshots` to a
mode-`0600` local archive outside the repository, record exact source row
counts, SHA-256 checksums, byte sizes, and archive format, then independently
read every compressed line and compare counts before clearing either table.

The reviewed `DECISION_COMPACT_V1` transition may then truncate only
`candles` and `indicator_snapshots`. Do not clear `candle_snapshots`,
`analysis_runs`, `analysis_chart_artifacts`, `model_requests`,
`model_responses`, `validation_results`, `risk_decisions`, orders, fills,
positions, trades, audit events, or execution-event journal rows. These remain
the authoritative decision and broker trail. The exact model input and chart
remain queryable even when legacy duplicated raw series are local-only.

Rollback is to stop execution, verify no active broker lifecycle, verify the
manifest hashes again, require empty target bulk tables, stream the archived
NDJSON objects through PostgreSQL `jsonb_populate_record` in bounded
transactions, compare restored counts to the manifest, run `ANALYZE`, and only
then restart. Never restore over newer rows or disable primary/foreign/unique
constraints. Retain the protected archive until an isolated restore drill and
the 100-trade campaign review are complete.

Release `.32` stores only the configured completed-candle tails and removes
duplicated `full_candles`/`raw_tail` arrays from `indicator_snapshots.features`.
The exact compact payload sent to the endpoint remains in `model_requests`, and
the exact 1600x1200 chart remains in `analysis_chart_artifacts`. Startup also
closes only abandoned pre-placement analysis states; it does not infer or alter
broker outcomes.

Set `AUTOMATIC_ANALYSIS_ENABLED=true` only for an explicitly authorized demo
session. The scheduler continues maintenance every
`ANALYSIS_INTERVAL_SECONDS`, but it may claim a new analysis only during the
first `AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS` of a broker-server-time M1
interval. Keep that window between 1 and 30 seconds and use
`AI_MAX_RETRIES=0`: a failed provider attempt is retried on the next fresh
broker minute rather than against an expiring candle context.
The current default is 10 seconds. Release `.33` proved that the earlier
5-second window could be fully consumed by mandatory broker reconciliation,
causing otherwise-healthy ticks to miss repeated minutes. Ten seconds retains
a bounded completed-M1 opening window while allowing the preflight to finish;
later starts remain disproportionately likely to cross the completed M1
boundary before response.
The scheduler phase is aligned to the wall clock with
`ANALYSIS_SCHEDULER_LEAD_MS=1000`: maintenance begins one second before each
five-second boundary so the tick nearest an M1 close can finish reconciliation
as the new broker minute opens. This changes phase, not frequency, and the
broker timestamp plus durable minute claim remain authoritative.

Migration `0010` must exist before this scheduler is deployed. Each
account/symbol/minute claim is durable and unique; an incomplete claim after a
crash is not replayed. Manual authenticated `/v1/cycle` requests are unchanged.
The existing analysis, order-group, position, expiry, cancellation, and
reconciliation gates prevent the next automatic cycle while prior strategy
state is active or uncertain. A rejected analysis may retry on a later broker
minute. An accepted analysis becomes terminal only after its group closes,
expires, or fails; only then can a later broker minute start the next cycle.

For a terminal-evidence campaign, set `AUTOMATIC_DEMO_CLOSED_TRADE_LIMIT` to the
required number of durable closed demo trades and keep
`AUTOMATIC_ANALYSIS_COMPLETED_LIMIT` at a larger finite value as the inference-
cost backstop. A rejection or unfilled expiry increments neither the trade
target nor wins/losses; after terminal reconciliation it starts a fresh cycle.
The scheduler queries both strategy-scoped counts before each broker-minute
claim and again afterward. Unavailable, malformed, or complete progress blocks
new analysis. Reaching either boundary writes an audited `PAUSE_NEW_ANALYSES`
control while existing pending orders/positions remain under normal expiry,
callback, TP/SL, and reconciliation handling.

`AUTOMATIC_ANALYSIS_COMPLETED_BASELINE` defaults to zero. Use a non-zero value
only for an audited bug-fix release that must continue an existing campaign:
first pause analysis, query and record the prior release's durable completed
count, set that exact count as the baseline, register a new immutable release,
and verify Overview shows the baseline separately from the new release count.
The baseline cannot exceed the configured limit. It does not create model
responses or relax any independent order, risk, reconciliation, or safety gate.
`AUTOMATIC_DEMO_CLOSED_TRADE_BASELINE` follows the same rule and counts only
exact terminal demo trade rows joined to a `CLOSED` group.

After a finite sample is reviewed, continuous demo collection requires both
campaign limits and both baselines to be zero. This removes only the two
count-based automatic pauses; it does not relax any emergency stop, daily-loss,
broker reconciliation, ownership, freshness, spread, sizing, margin, precision,
or deterministic-risk check. Overview must say **CONTINUOUS MODE** and show
four database-derived counters: all-time completed external-AI analyses,
all-time closed demo trades, and the same two counts for the current immutable
release. Counter query failure, malformed values, or a current-release count
above its lifetime count blocks new scheduling rather than substituting zero.

cTrader can attach a rejected/internal-rejected/error/missed deal to a
non-fill order execution such as `ORDER_CANCELLED`. It is safe to persist that
terminal order transition without a fill only when the deal status is explicitly
non-filled, the execution is cancel/expire/reject, `filledVolume` is exactly
zero, and no close detail exists. Positive,
fractional, malformed, or fill-type contradictory evidence remains fail-closed.
The persisted event key distinguishes a non-fill deal attempt from a broker fill.

Before paying for inference, the coordinator verifies a second fresh snapshot
has unchanged completed candles/metadata and still passes spread protection.
It also requires enough broker-M1 time for the configured AI budget plus the
post-model reserve. `PRE_MODEL_*` or `MODEL_DEADLINE_INSUFFICIENT` therefore
means the endpoint was not called and the next eligible M1 window retries.

Overview obtains the current/latest managed setup from the execution service's
exact configured account and symbol scope without displaying account IDs. It
leads with a plain **RIGHT NOW** summary that distinguishes pending broker
orders, an open position, terminal history, idle state, and unknown exposure.
It shows order/position side, state, entry, SL, TP, volume, expiry, and update
time. A durably closed trade additionally shows direction, realized demo P/L,
fees, and close time. `UNAVAILABLE` or an inconsistent active/terminal
projection is not an empty state: inspect Orders & Positions and the execution
journal and do not assume there is no broker exposure.

When the strategy has one certainly reconciled open broker position, Overview's
**Live open trade** panel refreshes every two seconds. **Current close price** is
the executable side used to close now: bid for a BUY/long and ask for a
SELL/short. Gross and net unrealized P/L come directly from cTrader's
per-position response and are labelled in the durable account currency.
**Commission recorded so far** is the signed sum of durable fill commissions
already received for that position/order group; a negative value is a charge.
Do not subtract it from net P/L again. Closing commission or other terminal
charges may not exist yet, so the immutable `trades.realized_pnl` and `fees`
record after close remains the final authority.

The monitor 1.1 contract can also render an exact broker-confirmed `OPEN`
position while its order group is `RECONCILIATION_REQUIRED`. In that case the
panel shows a warning above the live values. This is telemetry only: readiness,
automatic analysis, and new placement remain fail-closed until normal terminal
reconciliation clears the group and any execution-journal reasons.

`NONE` means no strategy-owned active position was found in this exact scope.
`UNAVAILABLE` is deliberately different: ambiguous positions, an uncertain
position state, missing broker identity, cTrader P/L failure, market quote
failure, symbol mismatch, malformed decimals, or invalid timestamps produce no
estimated display value. Inspect Orders & Positions, execution logs, and the
broker before intervening. This monitor is telemetry only; its polling cannot
start, stop, resize, place, cancel, or close a trade.

If the execution API briefly restarts while Streamlit is rendering, the page
shows `Execution service is reconnecting` and explicitly says PostgreSQL
history is retained. The dashboard probes every two seconds and reruns the
whole app after a complete status response; no manual browser refresh should be
needed. If `Managed setup status is unavailable` remains after recovery, that
is a durable projection failure rather than a transport outage and must be
investigated.

The generic `RECONCILIATION_UNCERTAIN` gate remains visible together with any
bounded source reason reported by the account, gateway, terminal recovery,
event recorder, database group, or audit persistence. For example,
`DEMO_FILL_SLIPPAGE_EXCEEDED` means the broker fill exceeded the configured
point or basis-point ceiling; it does not mean the position was left unmanaged.
That event-specific in-memory latch can clear only when PostgreSQL supplies an
exact terminal proof for the same order group, the terminal recorder is
certain, and the group's tracked legs are terminal. A mismatched group,
uncertain recovery, active/unknown leg, unresolved journal row, open durable
position, or failed audit write continues to block the next cycle.

One fresh retry is permitted for a local market-data HTTP 503. The retry must
return a newly validated quote/depth/completed-candle snapshot and does not
reuse stale data; a second 503 retains the original fail-closed rejection. AI
provider retries remain zero because a repeated inference would normally cross
the completed M1 context boundary.

Streamlit renders operator-facing timestamps in Asia/Singapore as
`DD Mon YYYY, HH:MM:SS GMT+8`. This conversion applies only to captions,
selectors, and displayed table copies. PostgreSQL values, API contracts,
Plotly inputs, and hash-verified exact AI/audit JSON retain their original UTC
or offset-aware representation. A missing display time is `—`; a malformed
value is `Unavailable` rather than an inferred timestamp.

`MAX_ORDERS_PER_DAY` currently counts created OCO order groups, not individual
BUY/SELL legs. Size that independent daily ceiling for the campaign plus any
groups already created in the configured trading day. It remains a separate
lockout: increasing it does not override the trade target or inference ceiling,
daily-loss, exposure, notional, margin, spread, freshness, or reconciliation
gates.

Prompt `system-v14` tells the endpoint that execution selects the nearest whole
broker-pip TP whose expected net profit is greater than one full estimated
round-trip fee, then sets SL distance to exactly twice TP distance (reward:risk
`1:2`, numeric reward/risk `0.5`). `MIN_EXPECTED_NET_TO_FEES_RATIO` defaults to
and cannot be set below `1`; at `1`, gross TP must be strictly greater than
twice estimated fees. The request supplies the resulting minimum TP/SL
floor, exact tick-aligned BUY/SELL entry ranges, an inclusive stop-distance
range, and one exact preferred expiry. Those ranges combine current quote,
broker/configured minimum, M1 ATR caps, commission metadata, and the maximum
stop affordable at broker minimum volume. They contain no equity, budget,
volume, commission rate, or account identity. An unsupported fee schedule,
off-tick effective price, technical envelope mismatch, out-of-range entry, or
returned stop outside the current limit is rejected without correction. Final
sized commands receive a second fee-buffer check before broker submission, so
a later deterministic lot-size change uses the exact final volume.

Release `.42` sets the preferred and minimum expiry to 60 seconds from the
trusted pre-model capture and the hard maximum to 120 seconds. Inference and
placement consume that same clock; the service never extends a late response.
This intentionally keeps only the freshest pending signal and allows the next
broker-M1 cycle after a clean expiry. Run
`npm run demo:signal-decay -- <exact-strategy-version>` to review closed demo
trades by fill-age bucket, signed fees, and net P/L before changing the horizon.

Use Streamlit **AI Analysis → Prompt and response history** and **Automatic
broker-minute cycle history** for the exact hash-verified prompt, persisted
redacted user JSON, parsed schema-validated AI response, post-model refresh,
validation/risk results, scheduler outcome, order events, and terminal demo
trade outcome.
The outcome ledger displays gross P/L, signed fees, fee-inclusive net P/L, and
a plain fee-coverage label. `GROSS PROFIT ERASED BY FEES` is a closed loss.
For current demo orders, confirm broker order type `STOP_LIMIT`, configured
slippage points, and that the open position's TP/SL distances are measured from
its actual fill before treating the fee buffer as preserved.
The same selected analysis shows the exact hash-verified M15/M5/M1 image sent
beside the numeric JSON. Confirm its renderer version, completed-candle flag,
candle counts, latest candle times, and SHA-256 before comparing the schema 2.1
technical map to the effective OCO table.
For runs that pass sizing but reject near intent, inspect the two
`decision_market_refreshed` events: `POST_MODEL` is the first execution context
and `PRE_PLACEMENT` is the snapshot reacquired after margin work. A
`PLACEMENT_*` reason means account/candle/metadata/time changed or the final
refresh was unavailable; the service did not reuse stale evidence or submit an
order. `BUY_ENTRY_TOO_CLOSE`, `SELL_ENTRY_TOO_CLOSE`, spread, quote-age, and
depth-age reasons can also arise from this final revalidation.
PostgreSQL remains authoritative. Better Stack receives correlated bounded
events and the direct `automatic_analysis_interval_claimed` scheduler event;
the matching `automatic_analysis_interval_completed` event contains the cycle
outcome and correlation ID. Better Stack never receives the full prompt or
request payload.

The Overview reports separate states for automation `OFF`, operator `PAUSED` or
`STOPPED`, temporary `WAITING_FOR_AI`, an active cycle/setup, safety waiting,
and `READY`. `AI_CIRCUIT_OPEN` means the scheduler is still running but will not
start another model call until the displayed UTC/Singapore retry time. It
half-opens automatically; do not restart merely to clear the message. The last
cycle is shown separately because a terminal rejection explains why that cycle
placed no order but does not mean the scheduler stopped.

The status contract also reports automatic activity as `STARTING`, `RUNNING`,
`MANAGING_SETUP`, `WAITING_FOR_MARKET`, `PAUSED`, `DISABLED`, `STALLED`, or
`UNAVAILABLE`. `STALLED` requires recent spread observations, no managed setup,
automation enabled/unpaused, and no durable interval/lifecycle progress for
`AUTOMATIC_ANALYSIS_STALL_SECONDS` (default 180). It adds
`AUTOMATIC_ANALYSIS_STALLED` to Overview and writes one durable
`automatic_analysis_stalled` audit event; resumed progress writes one
`automatic_analysis_resumed` event only after a cycle/lifecycle becomes active
again. Pause, disable, startup, or market closure is not called recovery. Both enter the Better Stack outbox. This is
an alert and diagnosis aid, not an execution or safety bypass.

## Adaptive spread-history warm-up

1. Apply migration `0007` and restart the execution service with
   `DEMO_TRADING_ENABLED=false`, `AUTOMATIC_ANALYSIS_ENABLED=false`, and both
   environment/database emergency stops active.
2. Leave the market-data and execution services running. The execution process
   records at most one typed fresh quote per broker-source UTC minute through a
   read-only sampler; it cannot invoke analysis or an order gateway.
3. Count only recent distinct observations for the intended account and symbol:

   ```sql
   SELECT count(*)
   FROM spread_observations
   WHERE account_id = :account_id
     AND symbol_id = :symbol_id
     AND source_time >= now() - interval '24 hours';
   ```

4. Treat sampler warnings, malformed/crossed quotes, timestamp failures,
   duplicates, database errors, or fewer than 30 rows as insufficient history.
   Do not seed rows manually, copy decision snapshots, reduce the minimum, or
   disable percentile protection to pass preflight.
5. After 30 genuine observations exist, keep both stops active and repeat the
   complete stopped preflight. A new exact operator acknowledgement is still
   required for any later order-capable demo cycle.

## Emergency stop

Any one of these activates stop: `EMERGENCY_STOP=true`, presence of the sentinel file, or active database runtime control. Dashboard emergency stop writes the database control and audit event. Activation stops new analyses/orders and initiates safe cancellation of strategy-owned pending orders. It does not blindly close open positions or cancel manual orders.

To recover, investigate and reconcile first. Each stop source must be cleared by its owner; clearing only the dashboard row cannot override environment/file stop. Record operator/reason/ticket in the audit trail.

## Common alerts

- **cTrader disconnect:** stop scheduling; retain/mark stale data; reconnect with bounded jitter; refresh token if appropriate; reconcile before ready.
- **stale market/depth:** reject cycle; cancel context-dependent strategy pending orders if policy permits; verify subscription, clock, and reconnect flags.
- **invalid AI burst:** open circuit breaker; preserve redacted samples/hashes; verify model/prompt/schema/provider; do not loosen validation.
- **AI provider timeout:** `AI_PROVIDER_TIMEOUT` means the external endpoint was
  reached but did not return a locally validated answer before that candle's
  provider deadline. `AI_ORCHESTRATOR_TIMEOUT` means the loopback AI service
  itself did not answer. Both reject only their current cycle and send no order.
  Verify provider latency and configured `AI_TIMEOUT_MS`/`AI_MAX_RETRIES`; the
  automatic demo loop requires zero same-interval retries. The local caller
  must budget the single attempt and must not be shortened below the derived
  total. Each timeout, connection failure, or HTTP 503 rejects its own cycle.
  The execution caller opens only after
  `AI_CIRCUIT_BREAKER_FAILURES` consecutive transient failures; a fully
  validated response resets that count. Once open, it uses
  `AI_CIRCUIT_BREAKER_RESET_SECONDS`, blocks throughout that cooldown, and
  automatically half-opens for a later broker minute at the exact boundary.
  Do not restart just to clear the circuit; the Overview shows the automatic
  retry time. Investigate a breaker that repeatedly reopens.
- **reconciliation failure:** block account/symbol; query broker state; resolve labels/idempotency; never resubmit an uncertain command.
- **`CTRADER_FIELD_INVALID:price`:** a new fill/position callback omitted a
  required price. New cycles remain locked. Correlate the sanitized execution
  type and field-presence log with broker history; never invent the value. An
  OPEN position always requires its own positive price. A CLOSED position can
  use only the entry price from complete same-callback terminal close detail,
  while exact durable terminal fill proof can release only a matching late
  duplicate failure. Any other shape stays blocked.
- **daily loss lockout:** cancel pending strategy orders; monitor/document existing positions under approved policy; reset only next configured day after reconciliation.
- **database failure:** block new order commands; keep broker reconciliation attempts and buffered local critical logs; recover DB and reconcile.
- **resource pressure/low disk:** emergency stop if durability/freshness is threatened; rotate/preserve audit logs; restore capacity.

## Pending-order cancellation

Use the protected dashboard/control endpoint. It lists exact strategy-owned targets, records intent, calls cancel idempotently, then reconciles. Manual/unlabelled orders are excluded unless explicit configuration and operator confirmation say otherwise.

## Token renewal

The cTrader adapter tracks expiry, refreshes before expiry, stores renewed state
in the configured restrictive `CTRADER_TOKEN_STATE_FILE`, redacts responses, and
reconnects. In systemd this path belongs under `/var/lib/ctrader-ai-scalper`, not
the repository. Refresh failure changes readiness to false. Never write tokens
into repository files or logs.

## Streamlit AI decision inspection

1. Open **AI Analysis**. The selector defaults to the newest run labelled
   **AI REQUEST RECORDED**; runs without a completed durable request remain
   available and are labelled **NO DURABLE AI REQUEST**. Copy the selected
   `analysis_id` when correlating another system.
2. Inspect **Exact messages sent to the external AI** near the top. It shows the
   hash-verified system message and exact persisted redacted user JSON together.
   Private endpoint URLs, authorization headers, tokens, and credentials are
   intentionally neither stored nor displayed.
3. Read **Decision pipeline** from top to bottom. `NOT_REACHED` means no durable
   evidence exists for that stage; it must never be interpreted as approval.
4. In **AI output**, inspect the exact parsed and schema-validated model JSON.
   Schemas 2.0 and 2.1 always contain both conditional stops and have no `NO_TRADE` or
   leg-enabled switch. These are proposals only—not queued, submitted, accepted,
   or filled orders. The displayed local validation, deterministic risk, and
   broker stages remain separate execution authorities.
   The **AI proposal → effective OCO levels** table shows endpoint entry/SL/TP
   beside the audited effective SL/TP, both R:R values, broker pip count,
   estimated gross, round-trip fees, and expected net at the displayed basis
   volume. Absence of that table means the exit-policy stage was not reached.
   For schema 2.1, verify that stop entries equal technical-map confirmation
   prices, endpoint TPs equal first upside/downside targets, and effective
   exits remain inside those technical envelopes.
5. In **Input & analytics**, verify request/model/prompt/schema/strategy
   versions, payload mode/hash, the hash-verified exact system prompt,
   completed-candle coverage, indicator summary, execution constraints, and
   initial/refreshed quote/depth evidence. The exact redacted user JSON is also
   available in the prominent request section; PostgreSQL JSONB may normalize
   object-key order.
6. In **Risk & execution**, distinguish semantic rejection from deterministic
   sizing, recorded order intent, broker order state, and normalized callback
   mapping. An empty section explicitly says the stage was not reached.
7. In **Audit log**, follow chronological authoritative PostgreSQL events and
   their per-event Better Stack status. Search Live Tail using `event_id`,
   `analysis_id`, `request_id`, or `order_group_id`; investigate any missing or
   repeatedly retried mirror without modifying the PostgreSQL record.

The inspector deliberately excludes raw provider response text, credentials,
account IDs, and broker IDs. Exact prompt/input access remains bounded and
redacted. Use a reviewed read-only database role for deeper forensics; never
broaden the dashboard query to expose secret-bearing configuration.

## Streamlit campaign analysis history

Open **Analysis History** for the operator-level collection funnel. The
oldest retained campaign result is numbered 1 and the newest defaults in the
details selector. Read **Outcome ledger** for rejected/no-order, pending-stop,
expired/no-trade, open-trade, and terminal closed outcomes. Only `CLOSED WIN`,
`CLOSED LOSS`, and `CLOSED BREAK-EVEN` come from a durable broker trade; a
rejection or unfilled expiry does not count as a loss.
The closed-demo-trade progress bar is the collection target. Completed AI
responses are displayed separately against the inference safety limit.

Use **AI proposal versus effective/placed levels** for both BUY and SELL entry,
SL, and TP. `EFFECTIVE LEVELS — NOT PLACED` means the commission-aware exit policy was
audited but broker intent was never created. `PLACED ORDER LEVELS` means the
displayed values are the durable order intents. Select a row to open its exact
hash-verified prompt, persisted redacted user JSON, parsed AI response,
validation trail, and broker execution journal. `EVIDENCE UNAVAILABLE` is an
intentional fail-closed display result: inspect PostgreSQL/reconciliation and
do not infer a win, loss, or lifecycle from partial evidence.

## Better Stack decision-trail monitoring

1. Create a Logs source in Better Stack and place its HTTPS ingest URL and
   source token only in the protected environment as
   `BETTERSTACK_INGESTING_HOST` and `BETTERSTACK_SOURCE_TOKEN`. Set
   `BETTERSTACK_ENABLED=true`; never paste either value into commands, logs,
   issues, or the dashboard.
2. Apply migration `0008` before restarting the updated execution service.
   Audit events inserted after that migration enqueue atomically; older history
   remains available only in PostgreSQL unless exported through a separately
   reviewed process.
3. In Streamlit, open **Operations** and inspect **Better Stack decision-trail
   delivery**. `PENDING` is awaiting a claim, `DELIVERING` holds a short lease,
   `RETRY` records a rejected/failed delivery with bounded backoff, and
   `DELIVERED` records the local checkpoint after HTTP acceptance.
4. In Better Stack Live Tail, filter the configured source by `event_id` for an
   exact audit row, `analysis_id` for a whole cycle, or by `event_name`,
   `request_id`, `order_group_id`, `outcome`, and `reason_code`. Useful stage
   names include `market_snapshot_persisted`, `analytics_completed`,
   `model_completed`, `decision_market_refreshed`, `risk_intent_persisted`,
   `oco_placement_completed`, and `reconciliation_completed`.
5. Investigate any sustained backlog, repeated `RETRY`, expired `DELIVERING`
   lease, or gap between PostgreSQL and Live Tail. A process crash after remote
   acceptance but before the local checkpoint can produce a duplicate; dedupe
   investigations by stable `event_id`. Never delete or edit `audit_events` or
   outbox rows to make monitoring look healthy.

For complete SQL inspection, start from the authoritative event and follow its
correlation IDs:

```sql
SELECT occurred_at, id AS event_id, analysis_id, request_id, order_group_id,
       event_name, outcome, reason_code, details
FROM audit_events
WHERE analysis_id = :analysis_id
ORDER BY occurred_at, id;

SELECT e.occurred_at, e.id AS event_id, e.event_name, o.status,
       o.attempt_count, o.next_attempt_at, o.delivered_at, o.last_error_code
FROM audit_events e
JOIN observability_outbox o ON o.audit_event_id = e.id
WHERE e.analysis_id = :analysis_id
ORDER BY e.occurred_at, e.id;
```

Use a read-only database role for ad hoc monitoring. Better Stack delivery is
non-critical and cannot permit or veto trading; a failure to persist the
underlying PostgreSQL audit transaction remains fail-closed.

## Incident evidence

Capture UTC interval, instance/service/mode, trace/request/analysis/order group IDs, reason codes, redacted logs, broker state, database audit rows, configuration hashes, prompt/model/schema/strategy versions, and remediation. Do not collect raw secrets or authorization headers.

## End of session

Pause new analyses, reconcile, safely cancel policy-required strategy pending orders, inspect positions, ensure audit persistence and backup health, then stop services gracefully. Leave emergency stop active for unattended development systems unless intentionally operating paper/shadow monitoring.
