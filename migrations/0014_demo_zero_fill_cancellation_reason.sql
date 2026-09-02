-- Preserve the exact terminal fact for demo OCO groups where both
-- strategy-owned broker orders were cancelled without any fill or position.
-- The broker callback does not provide a reliable cancellation cause, so this
-- reason deliberately describes evidence rather than inferring intent.
--
-- Forward data transition: backfill only unlabelled demo groups whose complete
-- durable evidence satisfies the same strict predicate used by the execution
-- store. Ambiguous, manual, filled, rejected, expired, or positioned groups are
-- unchanged.
--
-- Rollback: pause analysis and demo submission, review rows carrying
-- DEMO_BROKER_ZERO_FILL_CANCELLED against orders/fills/positions, then set
-- cancellation_reason back to NULL for the exact reviewed rows. The schema is
-- unchanged, so no destructive DDL rollback is required.

UPDATE order_groups og
SET cancellation_reason = 'DEMO_BROKER_ZERO_FILL_CANCELLED'
WHERE og.mode = 'demo'
  AND og.state = 'FAILED'
  AND og.cancellation_reason IS NULL
  AND (SELECT count(*) FROM orders o WHERE o.order_group_id = og.id) = 2
  AND NOT EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.order_group_id = og.id
      AND (o.strategy_owned = false OR o.state <> 'CANCELLED' OR o.filled_volume <> 0)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM fills f
    JOIN orders o ON o.id = f.order_id
    WHERE o.order_group_id = og.id
  )
  AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.order_group_id = og.id);
