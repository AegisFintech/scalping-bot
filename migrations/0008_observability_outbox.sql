-- Forward-only durable delivery queue for redacted audit-event summaries.
-- Existing audit history is deliberately not backfilled. PostgreSQL remains
-- authoritative; this queue only mirrors newly inserted audit events.
-- Rollback: stop execution/exporter services, verify all required rows are
-- delivered or retained elsewhere, drop the trigger/function, then drop the
-- table only under operator review. No automated destructive rollback exists.

CREATE TABLE observability_outbox (
  id uuid PRIMARY KEY,
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DELIVERING', 'RETRY', 'DELIVERED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'DELIVERED') = (delivered_at IS NOT NULL)),
  CHECK (status <> 'DELIVERED' OR lease_expires_at IS NULL)
);

CREATE INDEX observability_outbox_due
  ON observability_outbox (next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'RETRY', 'DELIVERING');

CREATE FUNCTION enqueue_audit_event_observability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO observability_outbox (id, audit_event_id)
  VALUES (NEW.id, NEW.id)
  ON CONFLICT (audit_event_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_event_observability_enqueue
AFTER INSERT ON audit_events
FOR EACH ROW
EXECUTE FUNCTION enqueue_audit_event_observability();
