-- Additive lifetime policy. Existing order/analysis history retains GTD semantics.
ALTER TABLE order_groups ADD COLUMN time_in_force text NOT NULL DEFAULT 'GTD'
  CHECK (time_in_force IN ('GTD','GTC'));
ALTER TABLE order_groups ADD COLUMN submission_valid_until timestamptz;
UPDATE order_groups SET submission_valid_until=expires_at;
ALTER TABLE order_groups ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE order_groups ADD CONSTRAINT group_lifetime_consistent CHECK
  ((time_in_force='GTD' AND expires_at IS NOT NULL) OR
   (time_in_force='GTC' AND expires_at IS NULL AND submission_valid_until IS NOT NULL));

ALTER TABLE orders ADD COLUMN time_in_force text NOT NULL DEFAULT 'GTD'
  CHECK (time_in_force IN ('GTD','GTC'));
ALTER TABLE orders ADD COLUMN submission_valid_until timestamptz;
UPDATE orders SET submission_valid_until=expires_at;
ALTER TABLE orders ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE orders ADD CONSTRAINT order_lifetime_consistent CHECK
  ((time_in_force='GTD' AND expires_at IS NOT NULL) OR
   (time_in_force='GTC' AND expires_at IS NULL AND submission_valid_until IS NOT NULL));

-- One post-close refresh per consumed context, including concurrent processes/restarts.
ALTER TABLE scenario_contexts ADD COLUMN refresh_after_context_id uuid UNIQUE REFERENCES scenario_contexts(id);
COMMENT ON COLUMN orders.submission_valid_until IS 'Deadline for new submission; not the lifetime of an accepted GTC order.';
COMMENT ON COLUMN orders.expires_at IS 'Broker pending expiry; NULL only for explicit GTC.';
