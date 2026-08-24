ALTER TABLE daily_risk_state
  ADD COLUMN net_flows numeric(30,10) NOT NULL DEFAULT 0;

CREATE OR REPLACE VIEW dashboard_daily_risk AS
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
  drs.reconciled_at,
  drs.net_flows
FROM daily_risk_state drs;
