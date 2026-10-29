-- Additive audit evidence only. No existing trade or order is changed here.
-- Rollback: disable the recovery tool and retain the evidence table and rows.
CREATE TABLE predispatch_recovery_evidence (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  order_group_id uuid NOT NULL UNIQUE REFERENCES order_groups(id),
  analysis_id uuid NOT NULL REFERENCES analysis_runs(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  rejection_audit_id uuid NOT NULL UNIQUE REFERENCES audit_events(id),
  intent_audit_id uuid NOT NULL UNIQUE REFERENCES audit_events(id),
  anchor_event_id uuid NOT NULL REFERENCES broker_execution_events(id),
  source_receipt_sha256 char(64) NOT NULL CHECK (source_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  activation_receipt_sha256 char(64) NOT NULL CHECK (activation_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  broker_evidence_sha256 char(64) NOT NULL CHECK (broker_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  broker_anchor_sha256 char(64) NOT NULL CHECK (broker_anchor_sha256 ~ '^[0-9a-f]{64}$'),
  broker_evidence jsonb NOT NULL CHECK (jsonb_typeof(broker_evidence) = 'object'),
  broker_from timestamptz NOT NULL,
  broker_until timestamptz NOT NULL CHECK (broker_until > broker_from),
  prior_order_state text NOT NULL CHECK (prior_order_state = 'CANCEL_PENDING'),
  prior_group_state text NOT NULL CHECK (prior_group_state = 'RECONCILIATION_REQUIRED'),
  prior_cancellation_reason text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION reject_predispatch_recovery_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PREDISPATCH_RECOVERY_EVIDENCE_IMMUTABLE';
END;
$$;
CREATE TRIGGER predispatch_recovery_evidence_immutable BEFORE UPDATE OR DELETE ON predispatch_recovery_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_predispatch_recovery_evidence_mutation();
CREATE TRIGGER predispatch_recovery_evidence_no_truncate BEFORE TRUNCATE ON predispatch_recovery_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION reject_predispatch_recovery_evidence_mutation();
