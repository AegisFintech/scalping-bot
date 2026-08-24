CREATE VIEW dashboard_latest_analysis AS
SELECT DISTINCT ON (a.account_id, a.symbol_id)
  a.id,
  a.account_id,
  a.symbol_id,
  s.name AS symbol,
  a.mode,
  a.state,
  a.analysis_time,
  a.valid_until,
  a.eligibility_reasons,
  a.rejection_reasons,
  a.updated_at
FROM analysis_runs a
JOIN symbols s ON s.id = a.symbol_id
ORDER BY a.account_id, a.symbol_id, a.analysis_time DESC;

CREATE VIEW dashboard_active_orders AS
SELECT
  o.id,
  og.id AS order_group_id,
  ar.account_id,
  s.name AS symbol,
  og.mode,
  og.state AS group_state,
  o.side,
  o.state,
  o.entry_price,
  o.stop_loss,
  o.take_profit,
  o.normalized_volume,
  o.filled_volume,
  o.expires_at,
  o.strategy_owned,
  o.updated_at
FROM orders o
JOIN order_groups og ON og.id = o.order_group_id
JOIN analysis_runs ar ON ar.id = og.analysis_id
JOIN symbols s ON s.id = ar.symbol_id
WHERE o.state IN ('INTENT', 'SUBMITTING', 'PENDING', 'PARTIALLY_FILLED', 'CANCEL_PENDING', 'UNKNOWN');

CREATE VIEW dashboard_daily_risk AS
SELECT
  drs.account_id,
  drs.trading_day,
  drs.timezone,
  drs.baseline_equity,
  drs.current_equity,
  drs.realized_pnl,
  drs.unrealized_pnl,
  drs.loss_percent,
  drs.locked_out,
  drs.lockout_reason,
  drs.reconciled_at
FROM daily_risk_state drs;
