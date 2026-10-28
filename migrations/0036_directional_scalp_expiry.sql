-- Additive single model-defined scalp authority. Historical group/order branches stay intact.
-- No backfill, accounting change or modification of an accepted group.
-- Narrow only the new plan's context lifetime; all historical contexts retain five minutes.
DO $$ DECLARE names text[]; BEGIN
 SELECT array_agg(conname) INTO names FROM pg_constraint
 WHERE conrelid='scenario_contexts'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%valid_until%'
   AND pg_get_constraintdef(oid) LIKE '%captured_at%';
 IF cardinality(names) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'SCALP_LIFETIME_CONSTRAINT_AMBIGUOUS'; END IF;
 EXECUTE format('ALTER TABLE scenario_contexts DROP CONSTRAINT %I',names[1]);
END $$;
ALTER TABLE scenario_contexts ADD CONSTRAINT scenario_context_lifetime_v2 CHECK (COALESCE((
 (COALESCE(plan->>'schema_version','')<>'entry-scalp-1.0' AND valid_until=captured_at+interval '5 minutes')
 OR (plan->>'schema_version'='entry-scalp-1.0' AND mode='demo' AND requested_model='gpt-6.1-sol'
   AND state='READY' AND (plan->>'analysis_id')::uuid=id
   AND (plan->>'captured_at')::timestamptz=captured_at
   AND (plan->>'pending_seconds')::integer BETWEEN 60 AND 300
   AND valid_until=captured_at+(plan->>'pending_seconds')::integer*interval '1 second'
   AND valid_until=(plan->>'valid_until')::timestamptz)
),false));

CREATE OR REPLACE FUNCTION guard_directional_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; aid uuid; sid uuid; current_mode text; current_revision uuid; single_mode boolean; limit_mode boolean;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.entry_side IS DISTINCT FROM OLD.entry_side OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode OR NEW.mode_revision IS DISTINCT FROM OLD.mode_revision OR (OLD.execution_mode IS NOT NULL AND (NEW.analysis_id IS DISTINCT FROM OLD.analysis_id OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.time_in_force IS DISTINCT FROM OLD.time_in_force)) OR ((OLD.entry_side IS NOT NULL OR OLD.execution_mode IS NOT NULL) AND NEW.context_plan_id IS DISTINCT FROM OLD.context_plan_id)) THEN RAISE EXCEPTION 'DIRECTIONAL_GROUP_AUTHORITY_IMMUTABLE'; END IF;
 SELECT account_id,symbol_id INTO aid,sid FROM analysis_runs WHERE id=NEW.analysis_id;
 SELECT plan INTO p FROM scenario_contexts WHERE id=NEW.context_plan_id AND state='READY' AND account_id=aid AND symbol_id=sid AND mode=NEW.mode;
 IF EXISTS (SELECT 1 FROM analysis_runs a JOIN strategy_versions v ON v.id=a.strategy_version_id
   WHERE a.id=NEW.analysis_id AND v.version='0.8.0-model-scalp.1-codex.1')
   AND p->>'schema_version' IS DISTINCT FROM 'entry-scalp-1.0'
   THEN RAISE EXCEPTION 'SCALP_CONTEXT_REQUIRED'; END IF;
 IF p->>'schema_version'='entry-scalp-1.0' THEN
   IF NEW.mode<>'demo' OR NEW.execution_mode IS DISTINCT FROM 'SINGLE_STOP_LIMIT'
     OR NEW.time_in_force IS DISTINCT FROM 'GTD' OR NEW.mode_revision IS NULL
     OR NEW.entry_side IS DISTINCT FROM p->>'entry_side'
     OR NEW.entry_side IS NULL OR NEW.entry_side NOT IN ('BUY','SELL')
     OR NEW.expires_at IS DISTINCT FROM (p->>'valid_until')::timestamptz
     OR NEW.submission_valid_until IS DISTINCT FROM NEW.expires_at
     OR (p->>'pending_seconds')::integer NOT BETWEEN 60 AND 300
     OR (p->>'valid_until')::timestamptz IS DISTINCT FROM
       (p->>'captured_at')::timestamptz + (p->>'pending_seconds')::integer * interval '1 second'
     OR NOT EXISTS (SELECT 1 FROM analysis_runs a JOIN strategy_versions v ON v.id=a.strategy_version_id
       WHERE a.id=NEW.analysis_id AND v.version='0.8.0-model-scalp.1-codex.1')
     THEN RAISE EXCEPTION 'SCALP_GROUP_AUTHORITY_INVALID'; END IF;
   IF TG_OP='INSERT' THEN
     SELECT entry_mode,revision INTO current_mode,current_revision FROM entry_mode_settings
       WHERE account_id=aid AND symbol_id=sid AND environment=NEW.mode FOR UPDATE;
     IF current_mode IS DISTINCT FROM NEW.execution_mode OR current_revision IS DISTINCT FROM NEW.mode_revision
       OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'SCALP_GROUP_REFRESH_REQUIRED'; END IF;
   END IF;
   RETURN NEW;
 END IF;
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
 IF p->>'schema_version'='entry-scalp-1.0' THEN
   expected_price:=(p->>CASE WHEN s='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric;
   IF em IS DISTINCT FROM 'SINGLE_STOP_LIMIT' OR s IS NULL OR NEW.side IS DISTINCT FROM s
     OR NOT NEW.strategy_owned OR NEW.account_id IS DISTINCT FROM aid
     OR NEW.time_in_force IS DISTINCT FROM 'GTD' OR NEW.execution_order_type IS DISTINCT FROM 'STOP_LIMIT'
     OR NEW.entry_price IS DISTINCT FROM expected_price
     OR NEW.stop_loss IS DISTINCT FROM (p->>'stop_loss')::numeric
     OR NEW.take_profit IS DISTINCT FROM (p->>'take_profit')::numeric
     OR NEW.expires_at IS DISTINCT FROM (p->>'valid_until')::timestamptz
     OR NEW.submission_valid_until IS DISTINCT FROM NEW.expires_at
     OR abs(NEW.take_profit-NEW.entry_price)>0.4 OR abs(NEW.stop_loss-NEW.entry_price)>7
     OR (CASE WHEN s='BUY' THEN NOT (NEW.stop_loss<NEW.entry_price AND NEW.take_profit>NEW.entry_price)
       ELSE NOT (NEW.take_profit<NEW.entry_price AND NEW.stop_loss>NEW.entry_price) END)
     THEN RAISE EXCEPTION 'SCALP_ORDER_AUTHORITY_INVALID'; END IF;
   RETURN NEW;
 END IF;
 IF em IS NOT NULL THEN
   limit_mode:=em IN ('OCO_LIMIT','SINGLE_LIMIT');
   expected_price:=(p->>CASE WHEN (NEW.side='BUY')<>limit_mode THEN 'buy_stop' ELSE 'sell_stop' END)::numeric;
   IF (s IS NOT NULL AND NEW.side<>s) OR NOT NEW.strategy_owned OR NEW.account_id<>aid OR NEW.time_in_force IS DISTINCT FROM 'GTC' OR NEW.execution_order_type IS DISTINCT FROM (CASE WHEN limit_mode THEN 'LIMIT' ELSE 'STOP_LIMIT' END) OR NEW.entry_price IS DISTINCT FROM expected_price THEN RAISE EXCEPTION 'ENTRY_MODE_ORDER_INVALID'; END IF;
 ELSIF s IS NOT NULL AND (NEW.side<>s OR NOT NEW.strategy_owned OR NEW.account_id<>aid OR NEW.execution_order_type<>'STOP_LIMIT' OR NEW.time_in_force IS DISTINCT FROM 'GTC' OR NEW.entry_price IS DISTINCT FROM (p->>CASE WHEN s='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric) THEN RAISE EXCEPTION 'DIRECTIONAL_ORDER_SIDE_OR_LEVEL_INVALID'; END IF;
 RETURN NEW;
END $$;
-- Rollback: retain this migration and its journal. Redeploy old source only after every
-- newer group and command is terminal with exact broker proof. Restore the previous
-- scoped selection through audited CAS, never rewrite group authority or downgrade DB.
