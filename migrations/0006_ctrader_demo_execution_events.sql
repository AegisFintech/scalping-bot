-- Forward-only expand/backfill migration for durable cTrader demo execution events.
-- Rollback: stop execution services, verify no 0006 event rows are required for
-- reconciliation, restore the pre-0006 constraints/indexes, then remove only the
-- added objects under operator review. No automated rollback is provided because
-- discarding broker execution evidence is intentionally not automatic.

ALTER TABLE orders ADD COLUMN account_id uuid REFERENCES accounts(id);

UPDATE orders o
SET account_id = ar.account_id
FROM order_groups og
JOIN analysis_runs ar ON ar.id = og.analysis_id
WHERE o.order_group_id = og.id;

ALTER TABLE orders ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE orders DROP CONSTRAINT orders_client_order_id_key;
ALTER TABLE orders ADD CONSTRAINT orders_account_client_unique
  UNIQUE (account_id, client_order_id);

DROP INDEX unique_broker_order_id;
CREATE UNIQUE INDEX unique_account_broker_order_id
  ON orders (account_id, broker_order_id)
  WHERE broker_order_id IS NOT NULL;

DROP INDEX unique_broker_position_id;
CREATE UNIQUE INDEX unique_account_broker_position_id
  ON positions (account_id, broker_position_id)
  WHERE broker_position_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN broker_updated_at timestamptz;

ALTER TABLE fills ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE fills ADD COLUMN position_id uuid REFERENCES positions(id);
ALTER TABLE fills ADD CONSTRAINT fills_execution_owner_present
  CHECK (order_id IS NOT NULL OR position_id IS NOT NULL);

CREATE TABLE broker_execution_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  order_group_id uuid REFERENCES order_groups(id),
  order_id uuid REFERENCES orders(id),
  position_id uuid REFERENCES positions(id),
  broker_event_key text NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  execution_type integer NOT NULL,
  client_order_id text,
  broker_order_id text,
  broker_position_id text,
  broker_fill_id text,
  mapping_state text NOT NULL CHECK (mapping_state IN ('MAPPED', 'UNMATCHED', 'CONFLICT')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  normalized_payload jsonb NOT NULL CHECK (jsonb_typeof(normalized_payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution_event_key text,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((resolved_at IS NULL) = (resolution_event_key IS NULL)),
  UNIQUE (account_id, broker_event_key)
);

CREATE INDEX broker_execution_events_group_time
  ON broker_execution_events (order_group_id, occurred_at DESC);

CREATE INDEX broker_execution_events_unmatched
  ON broker_execution_events (account_id, symbol_id, occurred_at DESC)
  WHERE mapping_state <> 'MAPPED'
     OR (jsonb_array_length(reason_codes) > 0 AND resolved_at IS NULL);
