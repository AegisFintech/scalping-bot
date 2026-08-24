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
