-- ISSUE-101: admit LIMIT pending entries alongside STOP/STOP_LIMIT intents.
-- Additive constraint widening; historical rows and audit values are untouched.
ALTER TABLE orders DROP CONSTRAINT orders_execution_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_execution_order_type_check
  CHECK (execution_order_type IN ('STOP', 'STOP_LIMIT', 'LIMIT'));
ALTER TABLE orders DROP CONSTRAINT orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('STOP', 'LIMIT'));
COMMENT ON COLUMN orders.execution_order_type IS
  'Trusted execution intent. NULL is historical unspecified; order_type is the pending strategy family (STOP for trigger entries, LIMIT for maker entries).';
-- Rollback: restore the prior application and the pre-0025 constraint text
-- (order_type = 'STOP'; execution_order_type IN ('STOP','STOP_LIMIT')). Rows
-- written as LIMIT must be reconciled or cancelled before rollback; no data
-- deletion or historical rewrite is permitted.
