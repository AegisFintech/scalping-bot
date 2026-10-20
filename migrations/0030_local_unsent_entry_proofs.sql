-- New evidence only; never infer past non-dispatch from a flat broker snapshot.
CREATE TABLE local_unsent_entry_proofs (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  order_group_id uuid NOT NULL REFERENCES order_groups(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  client_order_id text NOT NULL UNIQUE,
  reason_code text NOT NULL CHECK (reason_code IN (
    'MARKET_SESSION_CLOSED','MARKET_SESSION_UNAVAILABLE',
    'DEMO_PEER_WITHHELD_BEFORE_DISPATCH','DEMO_PREFLIGHT_RECONCILIATION_WITHHELD')),
  source_updated_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (source_updated_at <= recorded_at)
);
CREATE FUNCTION reject_local_unsent_proof_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LOCAL_UNSENT_PROOF_IMMUTABLE';
END;
$$;
CREATE TRIGGER local_unsent_proofs_immutable BEFORE UPDATE OR DELETE ON local_unsent_entry_proofs
  FOR EACH ROW EXECUTE FUNCTION reject_local_unsent_proof_mutation();
