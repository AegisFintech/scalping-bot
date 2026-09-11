-- Keep provider completion/history immutable; retirement is separate execution evidence.
CREATE TABLE context_entry_retirements (
  context_id uuid PRIMARY KEY REFERENCES scenario_contexts(id),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'
    AND evidence->>'schemaVersion' = '1.0'
    AND jsonb_typeof(evidence->'reasonCodes') = 'array'
    AND jsonb_array_length(evidence->'reasonCodes') BETWEEN 1 AND 2),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (octet_length(evidence::text) <= 4096)
);
ALTER TABLE scenario_contexts ADD COLUMN refresh_after_entry_context_id uuid UNIQUE
  REFERENCES scenario_contexts(id);
ALTER TABLE scenario_contexts ADD CONSTRAINT context_refresh_parent_exclusive
  CHECK (refresh_after_context_id IS NULL OR refresh_after_entry_context_id IS NULL);

-- Serialize retirement against intent even with an older worker during rollback.
CREATE FUNCTION guard_entry_context_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE context_key uuid;
BEGIN
  IF TG_TABLE_NAME = 'context_entry_retirements' THEN
    context_key := NEW.context_id;
  ELSE
    context_key := NEW.context_plan_id;
  END IF;
  IF context_key IS NULL THEN RETURN NEW; END IF;
  PERFORM id FROM scenario_contexts WHERE id=context_key FOR UPDATE;
  IF TG_TABLE_NAME = 'context_entry_retirements' THEN
    IF EXISTS (SELECT 1 FROM order_groups WHERE context_plan_id=context_key) THEN
      RAISE EXCEPTION 'SCENARIO_ENTRY_CONTEXT_CONSUMED';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM context_entry_retirements WHERE context_id=context_key) THEN
    RAISE EXCEPTION 'SCENARIO_ENTRY_CONTEXT_RETIRED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_retirement_before_intent BEFORE INSERT ON context_entry_retirements
  FOR EACH ROW EXECUTE FUNCTION guard_entry_context_transition();
CREATE TRIGGER entry_intent_after_retirement BEFORE INSERT OR UPDATE OF context_plan_id ON order_groups
  FOR EACH ROW EXECUTE FUNCTION guard_entry_context_transition();
