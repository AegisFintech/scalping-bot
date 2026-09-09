-- Current protection observations and durable command claims. No history backfill.
CREATE TABLE position_protection (
  position_id uuid PRIMARY KEY REFERENCES positions(id),
  status text NOT NULL CHECK (status IN ('VERIFIED','REPAIR_REQUIRED','REPAIR_SENT','CLOSE_REQUIRED','CLOSE_SENT','UNCERTAIN')),
  stop_loss numeric(30,10) CHECK (stop_loss > 0),
  take_profit numeric(30,10) CHECK (take_profit > 0),
  expected_stop_loss numeric(30,10) CHECK (expected_stop_loss > 0),
  expected_take_profit numeric(30,10) CHECK (expected_take_profit > 0),
  observed_at timestamptz,
  reason_code text NOT NULL,
  repair_attempts integer NOT NULL DEFAULT 0 CHECK (repair_attempts BETWEEN 0 AND 2),
  command_at timestamptz,
  close_requested_at timestamptz,
  close_volume numeric(30,10) CHECK (close_volume > 0),
  broker_close_order_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((close_requested_at IS NULL) = (close_volume IS NULL))
);
CREATE UNIQUE INDEX unique_protective_close_order ON position_protection(broker_close_order_id)
  WHERE broker_close_order_id IS NOT NULL;
CREATE TABLE position_protection_events (
  id uuid PRIMARY KEY,
  position_id uuid NOT NULL REFERENCES positions(id),
  kind text NOT NULL CHECK (kind IN ('OBSERVATION','REPAIR_CLAIM','CLOSE_CLAIM','CLOSE_ACK')),
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Rollback: pause entries and restore prior application only when all owned
-- positions are closed and command outcomes reconciled. Retain these additive
-- tables and all evidence. Never retry an unknown close by deleting its claim.
