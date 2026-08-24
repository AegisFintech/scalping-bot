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
loopback cycle. Immediately reactivate emergency stop after the observation,
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

## Incident evidence

Capture UTC interval, instance/service/mode, trace/request/analysis/order group IDs, reason codes, redacted logs, broker state, database audit rows, configuration hashes, prompt/model/schema/strategy versions, and remediation. Do not collect raw secrets or authorization headers.

## End of session

Pause new analyses, reconcile, safely cancel policy-required strategy pending orders, inspect positions, ensure audit persistence and backup health, then stop services gracefully. Leave emergency stop active for unattended development systems unless intentionally operating paper/shadow monitoring.
