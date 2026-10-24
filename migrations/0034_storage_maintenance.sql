-- Non-destructive support for bounded completed-delivery retention.
-- Canonical audit/trading/learning rows and pending delivery authority stay intact.
-- Cleanup activation requires operator review; this migration deletes no rows.
-- Rollback: disable cleanup, reset these per-table settings and drop only the new
-- index in a separate reviewed forward migration. Retired delivered receipts are
-- redundant transport acknowledgements; canonical audit events remain unchanged.
SET LOCAL lock_timeout = '3s';
CREATE INDEX observability_outbox_delivered_retention
  ON observability_outbox (delivered_at,id)
  WHERE status='DELIVERED';
ALTER TABLE observability_outbox SET (
  autovacuum_vacuum_scale_factor=0.02,
  autovacuum_vacuum_threshold=500,
  autovacuum_analyze_scale_factor=0.02,
  autovacuum_analyze_threshold=500
);
