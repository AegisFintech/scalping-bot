-- Additive historical proof, never a fabricated broker execution event.
-- Rollback: revert the reader and retain this table and all original evidence.
-- No automatic evidence deletion or legacy missing-variant approval is provided.
CREATE TABLE broker_terminal_history_attempts (
  id uuid PRIMARY KEY,
  order_group_id uuid NOT NULL REFERENCES order_groups(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  local_snapshot jsonb NOT NULL CHECK (jsonb_typeof(local_snapshot)='object'),
  verifier_version text NOT NULL DEFAULT 'full-group-v1' CHECK (verifier_version ~ '^[a-z0-9-]{1,64}$'),
  status text NOT NULL CHECK (status IN ('CLAIMED','VERIFIED','REJECTED','FAILED')),
  reason_code text,
  history_evidence jsonb CHECK (jsonb_typeof(history_evidence)='object'),
  evidence_hash char(64) CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  event_hashes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(event_hashes)='object'),
  variant_ids uuid[] NOT NULL DEFAULT '{}',
  claimed_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK ((status='CLAIMED') = (completed_at IS NULL)),
  CHECK (status<>'VERIFIED' OR (reason_code IS NULL AND evidence_hash IS NOT NULL AND history_evidence IS NOT NULL AND event_hashes<>'{}'::jsonb))
);
CREATE INDEX broker_terminal_history_group_time ON broker_terminal_history_attempts (order_group_id,claimed_at DESC);
