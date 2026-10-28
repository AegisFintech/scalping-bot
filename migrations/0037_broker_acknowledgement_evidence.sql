-- Additive prospective callback evidence; no historical backfill or journal changes.
-- Rollback: disable the writer and retain this table; deleting evidence needs review.
CREATE TABLE broker_acknowledgement_evidence (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES broker_execution_events(id),
  event_payload_hash char(64) NOT NULL CHECK (event_payload_hash ~ '^[0-9a-f]{64}$'),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  received_at timestamptz NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (event_id, evidence_hash)
);
