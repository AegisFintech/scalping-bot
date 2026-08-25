-- Forward-only contract change for a genuine cTrader OCO cancellation race.
-- One OCO group can produce two broker positions when both stop legs fill
-- before the peer cancellation is confirmed. Each exact position owns at most
-- one immutable outcome; the group remains the setup-level correlation key.
--
-- Rollback: pause analysis and demo submission, prove every order group has at
-- most one trade, drop unique_trade_position_id, and restore the
-- trades_order_group_id_key constraint. A group with two retained outcomes
-- cannot be rolled back without losing evidence and therefore requires an
-- operator-reviewed application/data rollback instead.

ALTER TABLE trades DROP CONSTRAINT trades_order_group_id_key;

CREATE UNIQUE INDEX unique_trade_position_id
  ON trades (position_id)
  WHERE position_id IS NOT NULL;
