-- Forward-only migration for genuine, read-only spread observations.
-- Rollback: stop execution services, confirm percentile protection is disabled
-- or has another reviewed history source, archive the observations for audit,
-- then remove the table and indexes under operator review. No automatic
-- rollback is provided because deleting risk evidence must not be implicit.

CREATE TABLE spread_observations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  source_minute bigint NOT NULL CHECK (source_minute >= 0),
  source_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  server_time timestamptz NOT NULL,
  bid numeric(30,10) NOT NULL CHECK (bid > 0),
  ask numeric(30,10) NOT NULL CHECK (ask > 0),
  spread numeric(30,10) NOT NULL CHECK (spread >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ask >= bid),
  CHECK (spread = ask - bid),
  CHECK (source_time <= server_time),
  CHECK (received_at <= created_at),
  CHECK (source_minute = floor(extract(epoch FROM source_time) / 60)::bigint),
  UNIQUE (account_id, symbol_id, source_minute)
);

CREATE INDEX spread_observations_recent
  ON spread_observations (account_id, symbol_id, source_time DESC);
