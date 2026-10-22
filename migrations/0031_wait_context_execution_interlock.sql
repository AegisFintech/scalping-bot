-- WAIT is a successful observation, never entry authority. Historical rows unchanged.
CREATE FUNCTION forbid_wait_context_orders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.context_plan_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM scenario_contexts c WHERE c.id=NEW.context_plan_id
    AND c.plan->>'schema_version'='entry-wait-1.0'
  ) THEN
    RAISE EXCEPTION 'WAIT_CONTEXT_HAS_NO_EXECUTION_AUTHORITY';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_group_wait_context_interlock
BEFORE INSERT OR UPDATE OF context_plan_id ON order_groups
FOR EACH ROW EXECUTE FUNCTION forbid_wait_context_orders();

-- One durable successor per successful WAIT; no history rewrite or execution authority.
ALTER TABLE scenario_contexts ADD COLUMN refresh_after_wait_context_id uuid UNIQUE
  REFERENCES scenario_contexts(id);
ALTER TABLE scenario_contexts ADD CONSTRAINT context_all_refresh_parents_exclusive
  CHECK (num_nonnulls(refresh_after_context_id,refresh_after_entry_context_id,
                     refresh_after_wait_context_id)<=1);
