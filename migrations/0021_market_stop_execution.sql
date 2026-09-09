-- Add explicit execution intent without reclassifying historical generic STOP rows.
ALTER TABLE orders ADD COLUMN execution_order_type text
  CHECK (execution_order_type IN ('STOP', 'STOP_LIMIT'));
COMMENT ON COLUMN orders.execution_order_type IS
  'Trusted execution intent. NULL is historical unspecified; order_type remains the generic STOP strategy family.';
COMMENT ON COLUMN scenario_contexts.refresh_after_context_id IS
  'One fresh request after a fully reconciled closed trade or broker-confirmed zero-fill cancellation. Unknown dispatch retains cooldown.';
-- Rollback: pause new analysis and restore the prior application; retain additive
-- columns and all audit rows. Normal maintenance supports existing STOP/GTC orders.
-- No automated data rollback, deletion, or historical type backfill is permitted.
