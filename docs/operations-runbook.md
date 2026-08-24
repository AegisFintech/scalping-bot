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
missing local intent, or closed-trade mapping pending requires emergency stop
plus operator reconciliation. Never delete journal rows to clear readiness.

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

Closing-deal commission, swap, and conversion-fee signs remain broker-specific
and unverified in this release. The first closing event is retained but blocks
new placement with `DEMO_TRADE_OUTCOME_MAPPING_PENDING` until its supervised,
redacted evidence is reviewed and the trade mapping is implemented/tested.

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
   `model_completed`, `risk_intent_persisted`, `oco_placement_completed`, and
   `reconciliation_completed`.
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
