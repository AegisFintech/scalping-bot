-- Add explicit single-entry authority without relabelling any historical OCO group.
ALTER TABLE order_groups ADD COLUMN entry_side text CHECK(entry_side IN ('BUY','SELL'));
CREATE FUNCTION guard_directional_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.entry_side IS DISTINCT FROM OLD.entry_side OR
    (OLD.entry_side IS NOT NULL AND NEW.context_plan_id IS DISTINCT FROM OLD.context_plan_id)) THEN
   RAISE EXCEPTION 'DIRECTIONAL_GROUP_AUTHORITY_IMMUTABLE';
 END IF;
 IF NEW.entry_side IS NOT NULL THEN
   SELECT plan INTO p FROM scenario_contexts WHERE id=NEW.context_plan_id
     AND state='READY' AND account_id=(SELECT account_id FROM analysis_runs WHERE id=NEW.analysis_id)
     AND symbol_id=(SELECT symbol_id FROM analysis_runs WHERE id=NEW.analysis_id) AND mode=NEW.mode;
   IF NEW.mode<>'demo' OR p IS NULL OR p->>'schema_version' IS DISTINCT FROM 'entry-direction-1.0'
     OR p->>'entry_side' IS DISTINCT FROM NEW.entry_side OR NEW.time_in_force IS DISTINCT FROM 'GTC' THEN
     RAISE EXCEPTION 'DIRECTIONAL_GROUP_CONTEXT_REQUIRED';
   END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM scenario_contexts WHERE id=NEW.context_plan_id AND plan->>'schema_version'='entry-direction-1.0') THEN
     RAISE EXCEPTION 'DIRECTIONAL_GROUP_SIDE_REQUIRED';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER directional_group_guard BEFORE INSERT OR UPDATE ON order_groups
FOR EACH ROW EXECUTE FUNCTION guard_directional_group();

CREATE FUNCTION guard_directional_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text; p jsonb; n integer; aid uuid;
BEGIN
 SELECT og.entry_side,sc.plan,ar.account_id INTO s,p,aid FROM order_groups og
 JOIN analysis_runs ar ON ar.id=og.analysis_id LEFT JOIN scenario_contexts sc ON sc.id=og.context_plan_id
 WHERE og.id=NEW.order_group_id FOR UPDATE OF og;
 IF TG_OP='UPDATE' AND NEW.order_group_id IS DISTINCT FROM OLD.order_group_id AND
    (s IS NOT NULL OR EXISTS(SELECT 1 FROM order_groups WHERE id=OLD.order_group_id AND entry_side IS NOT NULL)) THEN
    RAISE EXCEPTION 'DIRECTIONAL_ORDER_GROUP_IMMUTABLE';
 END IF;
 IF s IS NOT NULL AND (NEW.side<>s OR NOT NEW.strategy_owned OR NEW.account_id<>aid
     OR NEW.execution_order_type<>'STOP_LIMIT' OR NEW.time_in_force IS DISTINCT FROM 'GTC'
     OR NEW.entry_price IS DISTINCT FROM (p->>CASE WHEN s='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric) THEN
   RAISE EXCEPTION 'DIRECTIONAL_ORDER_SIDE_OR_LEVEL_INVALID';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER directional_order_guard BEFORE INSERT OR UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION guard_directional_order();

CREATE FUNCTION check_directional_cardinality() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid uuid; s text; n integer;
BEGIN
 IF TG_TABLE_NAME='order_groups' THEN gid:=NEW.id;
 ELSIF TG_OP='DELETE' THEN gid:=OLD.order_group_id;
 ELSE gid:=NEW.order_group_id; END IF;
 SELECT entry_side INTO s FROM order_groups WHERE id=gid;
 IF s IS NOT NULL THEN
   SELECT count(*) INTO n FROM orders WHERE order_group_id=gid;
   IF n<>1 THEN RAISE EXCEPTION 'DIRECTIONAL_EXACTLY_ONE_ORDER_REQUIRED'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER directional_group_count AFTER INSERT OR UPDATE ON order_groups
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_directional_cardinality();
CREATE CONSTRAINT TRIGGER directional_order_count AFTER INSERT OR UPDATE OR DELETE ON orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_directional_cardinality();
