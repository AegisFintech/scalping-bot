-- Four operator-authorized profiles on one scoped demo deployment; append-only changes.
CREATE TABLE entry_mode_settings (
 account_id uuid NOT NULL REFERENCES accounts(id), symbol_id uuid NOT NULL REFERENCES symbols(id),
 environment text NOT NULL CHECK(environment='demo'),
 entry_mode text NOT NULL CHECK(entry_mode IN ('OCO_STOP_LIMIT','OCO_LIMIT','SINGLE_STOP_LIMIT','SINGLE_LIMIT')),
 revision uuid NOT NULL UNIQUE, actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 120),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1200), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,symbol_id,environment)
);
CREATE TABLE entry_mode_changes (
 revision uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), symbol_id uuid NOT NULL REFERENCES symbols(id),
 environment text NOT NULL, entry_mode text NOT NULL, previous_revision uuid REFERENCES entry_mode_changes(revision),
 actor text NOT NULL, reason text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION record_entry_mode_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ENTRY_MODE_DELETE_FORBIDDEN'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.account_id,NEW.symbol_id,NEW.environment) IS DISTINCT FROM (OLD.account_id,OLD.symbol_id,OLD.environment) OR NEW.revision=OLD.revision) THEN RAISE EXCEPTION 'ENTRY_MODE_NEW_REVISION_REQUIRED'; END IF;
 INSERT INTO entry_mode_changes(revision,account_id,symbol_id,environment,entry_mode,previous_revision,actor,reason)
 VALUES(NEW.revision,NEW.account_id,NEW.symbol_id,NEW.environment,NEW.entry_mode,CASE WHEN TG_OP='UPDATE' THEN OLD.revision ELSE NULL END,NEW.actor,NEW.reason);
 RETURN NEW;
END $$;
CREATE TRIGGER entry_mode_audit AFTER INSERT OR UPDATE OR DELETE ON entry_mode_settings FOR EACH ROW EXECUTE FUNCTION record_entry_mode_change();
CREATE FUNCTION immutable_entry_mode_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ENTRY_MODE_HISTORY_IMMUTABLE'; END $$;
CREATE TRIGGER entry_mode_history_guard BEFORE UPDATE OR DELETE ON entry_mode_changes FOR EACH ROW EXECUTE FUNCTION immutable_entry_mode_history();
ALTER TABLE order_groups ADD COLUMN execution_mode text CHECK(execution_mode IN ('OCO_STOP_LIMIT','OCO_LIMIT','SINGLE_STOP_LIMIT','SINGLE_LIMIT'));
ALTER TABLE order_groups ADD COLUMN mode_revision uuid REFERENCES entry_mode_changes(revision);

CREATE OR REPLACE FUNCTION guard_directional_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; aid uuid; sid uuid; current_mode text; current_revision uuid; single_mode boolean; limit_mode boolean;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.entry_side IS DISTINCT FROM OLD.entry_side OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode OR NEW.mode_revision IS DISTINCT FROM OLD.mode_revision OR (OLD.execution_mode IS NOT NULL AND (NEW.analysis_id IS DISTINCT FROM OLD.analysis_id OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.time_in_force IS DISTINCT FROM OLD.time_in_force)) OR ((OLD.entry_side IS NOT NULL OR OLD.execution_mode IS NOT NULL) AND NEW.context_plan_id IS DISTINCT FROM OLD.context_plan_id)) THEN RAISE EXCEPTION 'DIRECTIONAL_GROUP_AUTHORITY_IMMUTABLE'; END IF;
 SELECT account_id,symbol_id INTO aid,sid FROM analysis_runs WHERE id=NEW.analysis_id;
 SELECT plan INTO p FROM scenario_contexts WHERE id=NEW.context_plan_id AND state='READY' AND account_id=aid AND symbol_id=sid AND mode=NEW.mode;
 IF NEW.execution_mode IS NOT NULL THEN
   single_mode:=NEW.execution_mode LIKE 'SINGLE_%'; limit_mode:=NEW.execution_mode IN ('OCO_LIMIT','SINGLE_LIMIT');
   IF NEW.mode<>'demo' OR NEW.time_in_force IS DISTINCT FROM 'GTC' OR NEW.mode_revision IS NULL OR p IS NULL OR p->>'schema_version' IS DISTINCT FROM 'entry-modes-1.0' OR p->>'entry_side' NOT IN ('BUY','SELL') THEN RAISE EXCEPTION 'ENTRY_MODE_CONTEXT_REQUIRED'; END IF;
   IF single_mode THEN
     IF NEW.entry_side IS DISTINCT FROM (CASE WHEN limit_mode THEN CASE WHEN p->>'entry_side'='BUY' THEN 'SELL' ELSE 'BUY' END ELSE p->>'entry_side' END) THEN RAISE EXCEPTION 'ENTRY_MODE_SELECTED_SIDE_INVALID'; END IF;
   ELSIF NEW.entry_side IS NOT NULL THEN RAISE EXCEPTION 'ENTRY_MODE_PAIR_SIDE_INVALID'; END IF;
   IF TG_OP='INSERT' THEN
     SELECT entry_mode,revision INTO current_mode,current_revision FROM entry_mode_settings WHERE account_id=aid AND symbol_id=sid AND environment=NEW.mode FOR UPDATE;
     IF current_mode IS DISTINCT FROM NEW.execution_mode OR current_revision IS DISTINCT FROM NEW.mode_revision THEN RAISE EXCEPTION 'ENTRY_MODE_CHANGED_REFRESH'; END IF;
   END IF;
 ELSE
   IF NEW.mode_revision IS NOT NULL OR p->>'schema_version'='entry-modes-1.0' THEN RAISE EXCEPTION 'ENTRY_MODE_AUTHORITY_REQUIRED'; END IF;
   -- Original 0032 authority remains unchanged for historical directional groups.
   IF NEW.entry_side IS NOT NULL THEN
     IF NEW.mode<>'demo' OR p IS NULL OR p->>'schema_version' IS DISTINCT FROM 'entry-direction-1.0' OR p->>'entry_side' IS DISTINCT FROM NEW.entry_side OR NEW.time_in_force IS DISTINCT FROM 'GTC' THEN RAISE EXCEPTION 'DIRECTIONAL_GROUP_CONTEXT_REQUIRED'; END IF;
   ELSIF p->>'schema_version'='entry-direction-1.0' THEN RAISE EXCEPTION 'DIRECTIONAL_GROUP_SIDE_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_directional_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text; p jsonb; aid uuid; em text; limit_mode boolean; expected_price numeric;
BEGIN
 SELECT og.entry_side,sc.plan,ar.account_id,og.execution_mode INTO s,p,aid,em FROM order_groups og JOIN analysis_runs ar ON ar.id=og.analysis_id LEFT JOIN scenario_contexts sc ON sc.id=og.context_plan_id WHERE og.id=NEW.order_group_id FOR UPDATE OF og;
 IF TG_OP='UPDATE' AND NEW.order_group_id IS DISTINCT FROM OLD.order_group_id AND (s IS NOT NULL OR em IS NOT NULL OR EXISTS(SELECT 1 FROM order_groups WHERE id=OLD.order_group_id AND (entry_side IS NOT NULL OR execution_mode IS NOT NULL))) THEN RAISE EXCEPTION 'DIRECTIONAL_ORDER_GROUP_IMMUTABLE'; END IF;
 IF em IS NOT NULL THEN
   limit_mode:=em IN ('OCO_LIMIT','SINGLE_LIMIT');
   expected_price:=(p->>CASE WHEN (NEW.side='BUY')<>limit_mode THEN 'buy_stop' ELSE 'sell_stop' END)::numeric;
   IF (s IS NOT NULL AND NEW.side<>s) OR NOT NEW.strategy_owned OR NEW.account_id<>aid OR NEW.time_in_force IS DISTINCT FROM 'GTC' OR NEW.execution_order_type IS DISTINCT FROM (CASE WHEN limit_mode THEN 'LIMIT' ELSE 'STOP_LIMIT' END) OR NEW.entry_price IS DISTINCT FROM expected_price THEN RAISE EXCEPTION 'ENTRY_MODE_ORDER_INVALID'; END IF;
 ELSIF s IS NOT NULL AND (NEW.side<>s OR NOT NEW.strategy_owned OR NEW.account_id<>aid OR NEW.execution_order_type<>'STOP_LIMIT' OR NEW.time_in_force IS DISTINCT FROM 'GTC' OR NEW.entry_price IS DISTINCT FROM (p->>CASE WHEN s='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric) THEN RAISE EXCEPTION 'DIRECTIONAL_ORDER_SIDE_OR_LEVEL_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION check_directional_cardinality() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid uuid; s text; em text; n integer; sides integer; expected integer;
BEGIN
 IF TG_TABLE_NAME='order_groups' THEN gid:=NEW.id; ELSIF TG_OP='DELETE' THEN gid:=OLD.order_group_id; ELSE gid:=NEW.order_group_id; END IF;
 SELECT entry_side,execution_mode INTO s,em FROM order_groups WHERE id=gid;
 IF s IS NOT NULL OR em IS NOT NULL THEN
   expected:=CASE WHEN s IS NULL THEN 2 ELSE 1 END;
   SELECT count(*),count(DISTINCT side) INTO n,sides FROM orders WHERE order_group_id=gid;
   IF n<>expected OR sides<>expected THEN
     IF em IS NULL THEN RAISE EXCEPTION 'DIRECTIONAL_EXACTLY_ONE_ORDER_REQUIRED'; ELSE RAISE EXCEPTION 'ENTRY_MODE_CARDINALITY_INVALID'; END IF;
   END IF;
 END IF;
 RETURN NULL;
END $$;
