-- Additive evidence only. Original journal rows and historical payloads remain.
-- Rollback: revert application readers/writers and retain this table. Dropping
-- evidence or undoing operational resolutions requires separate operator review.
CREATE TABLE broker_execution_event_variants (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES broker_execution_events(id),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  normalized_payload jsonb NOT NULL CHECK (jsonb_typeof(normalized_payload) = 'object'),
  evidence_source text NOT NULL CHECK (evidence_source IN (
    'ORIGINAL_JOURNAL', 'BROKER_CALLBACK', 'HISTORY_RECONSTRUCTION', 'UNSPECIFIED'
  )),
  original_mapping_state text NOT NULL CHECK (original_mapping_state IN ('MAPPED', 'UNMATCHED', 'CONFLICT')),
  original_reason_codes jsonb NOT NULL CHECK (jsonb_typeof(original_reason_codes) = 'array'),
  original_resolved_at timestamptz,
  original_resolution_event_key text,
  received_at timestamptz NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, payload_hash, evidence_source)
);
-- Deliberately no invented backfill: absence of a variant for old conflicts
-- means the conflicting payload is missing, not that it matched the original.
