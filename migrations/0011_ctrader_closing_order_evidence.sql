-- Forward-only evidence expansion for broker-generated closing orders.
-- Existing 1.0 journal rows remain unchanged. New 1.1 rows retain the cTrader
-- order type and closing-order flag needed to distinguish a broker-created
-- SL/TP child from its parent strategy intent.
-- Rollback: stop execution, reconcile every account/symbol, retain/archive all
-- 1.1 rows, deploy code that writes only 1.0, then remove the added columns and
-- restore the 1.0-only constraint under operator review. No data is deleted by
-- this migration or by an automatic rollback.

ALTER TABLE broker_execution_events
  DROP CONSTRAINT broker_execution_events_schema_version_check;

ALTER TABLE broker_execution_events
  ADD CONSTRAINT broker_execution_events_schema_version_check
  CHECK (schema_version IN ('1.0', '1.1'));

ALTER TABLE broker_execution_events
  ADD COLUMN broker_order_type integer
    CHECK (broker_order_type BETWEEN 1 AND 6),
  ADD COLUMN closing_order boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT broker_execution_events_closing_order_type
    CHECK (NOT closing_order OR broker_order_type IS NOT NULL);

-- Repair only a filled strategy entry whose current broker ID disagrees with
-- its already-mapped fill. This is authoritative deal evidence and avoids
-- carrying forward an SL/TP child ID inherited through clientOrderId matching.
WITH authoritative_fill AS (
  SELECT DISTINCT ON (order_id)
    order_id,
    account_id,
    broker_order_id
  FROM broker_execution_events
  WHERE order_id IS NOT NULL
    AND mapping_state = 'MAPPED'
    AND execution_type IN (3, 11)
    AND broker_fill_id IS NOT NULL
    AND broker_order_id IS NOT NULL
  ORDER BY order_id, occurred_at DESC, id DESC
)
UPDATE orders o
SET broker_order_id = f.broker_order_id
FROM authoritative_fill f
WHERE o.id = f.order_id
  AND o.account_id = f.account_id
  AND o.state = 'FILLED'
  AND o.broker_order_id IS DISTINCT FROM f.broker_order_id
  AND NOT EXISTS (
    SELECT 1
    FROM orders other
    WHERE other.account_id = o.account_id
      AND other.id <> o.id
      AND other.broker_order_id = f.broker_order_id
  );
