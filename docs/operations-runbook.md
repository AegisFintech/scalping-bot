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

The observed demo server also attaches a position placeholder without `price`
to pending `ORDER_ACCEPTED` events. This is not a fill: it has no deal and must
not create a local position. The order acceptance is still journaled and mapped.
An unpriced position on `ORDER_FILLED` or `ORDER_PARTIAL_FILL` remains invalid
and blocking.

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

For a fully closed single-deal demo position, persist the protocol-defined
signed `grossProfit + swap + commission + pnlConversionFee` as realized P/L and
persist the last three components as fees. Full-close detail and volume must
match the durable filled volume. Missing detail, partial/multiple closing deals,
or a second conflicting outcome stay unresolved and block new placement.

After every completed model call, the coordinator reacquires the full snapshot.
`DECISION_MARKET_REFRESH_FAILED`, `DECISION_MARKET_TIME_REGRESSION`,
`DECISION_SYMBOL_METADATA_CHANGED`, or `DECISION_CANDLE_CONTEXT_CHANGED` is a
hard rejection, not permission to reuse the pre-model quote. The final spread,
quote age, depth age, semantic checks, and risk sizing use only the refreshed
execution state. Investigate repeated context changes or refresh failures; do
not widen freshness thresholds to accommodate model latency.

## Automatic demo analysis loop

Set `AUTOMATIC_ANALYSIS_ENABLED=true` only for an explicitly authorized demo
session. The scheduler continues maintenance every
`ANALYSIS_INTERVAL_SECONDS`, but it may claim a new analysis only during the
first `AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS` of a broker-server-time M1
interval. Keep that window between 1 and 30 seconds and use
`AI_MAX_RETRIES=0`: a failed provider attempt is retried on the next fresh
broker minute rather than against an expiring candle context.

Migration `0010` must exist before this scheduler is deployed. Each
account/symbol/minute claim is durable and unique; an incomplete claim after a
crash is not replayed. Manual authenticated `/v1/cycle` requests are unchanged.
The existing analysis, order-group, position, expiry, cancellation, and
reconciliation gates prevent the next automatic cycle while prior strategy
state is active or uncertain. A rejected analysis may retry on a later broker
minute. An accepted analysis becomes terminal only after its group closes,
expires, or fails; only then can a later broker minute start the next cycle.

Use Streamlit **AI Analysis → Prompt and response history** and **Automatic
broker-minute cycle history** for the exact hash-verified prompt, persisted
redacted user JSON, parsed schema-validated AI response, post-model refresh,
validation/risk results, scheduler outcome, order events, and terminal demo
trade outcome.
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
- **AI orchestrator timeout:** treat `AI_ORCHESTRATOR_TIMEOUT` as a hard stop.
  Verify provider latency and configured `AI_TIMEOUT_MS`/`AI_MAX_RETRIES`; the
  automatic demo loop requires zero same-interval retries. The local caller
  must budget the single attempt and must not be shortened below the derived
  total. The execution caller circuit uses the configured
  `AI_CIRCUIT_BREAKER_RESET_SECONDS`, blocks throughout that cooldown, and
  automatically half-opens for a later broker minute at the exact boundary.
  A repeated timeout, connection failure, or 503 reopens it. Do not restart just
  to clear the circuit; the Overview shows the automatic retry time. Investigate
  a breaker that repeatedly reopens.
- **reconciliation failure:** block account/symbol; query broker state; resolve labels/idempotency; never resubmit an uncertain command.
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
   Schema 2.0 always contains both conditional stops and has no `NO_TRADE` or
   leg-enabled switch. These are proposals only—not queued, submitted, accepted,
   or filled orders. The displayed local validation, deterministic risk, and
   broker stages remain separate execution authorities.
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
