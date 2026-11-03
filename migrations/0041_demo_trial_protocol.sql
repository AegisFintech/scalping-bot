-- Finite reviewed DEMO experiment authority; all historical branches remain intact.
-- Rollback retains these rows/columns and waits for exact terminal broker evidence.
CREATE TABLE demo_trial_catalogues (
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 definition_text text NOT NULL CHECK(length(definition_text)<=65536),
 CHECK(sha256=storage_text_sha256(definition_text))
);
CREATE TABLE demo_trial_profiles (
 catalogue_sha256 text NOT NULL REFERENCES demo_trial_catalogues(sha256),
 profile_id text NOT NULL, definition jsonb NOT NULL, parameters_text text NOT NULL,
 profile_sha256 text GENERATED ALWAYS AS (storage_text_sha256(parameters_text)) STORED,
 PRIMARY KEY(catalogue_sha256,profile_id), UNIQUE(catalogue_sha256,profile_id,profile_sha256),
 CHECK(definition->>'id'=profile_id AND definition-'id'=parameters_text::jsonb)
);
INSERT INTO demo_trial_catalogues VALUES ('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f',$catalogue${"batches":[{"id":"ENTRY","profiles":["ENTRY_CODEX","ENTRY_RANGE_3","ENTRY_RANGE_5"]},{"id":"TP","profiles":["ENTRY_RANGE_5","TP_040","TP_060"]},{"id":"SL","profiles":["ENTRY_RANGE_5","SL_005","SL_010"]},{"id":"TTL","profiles":["ENTRY_RANGE_5","TTL_060"]},{"id":"RANGE","profiles":["ENTRY_RANGE_5","RANGE_010"]}],"entryBufferTicks":1,"m5TrendCloses":3,"maximumCloses":20,"maximumMarketOpenSeconds":3600,"maximumStopDistance":"7","profiles":[{"baseExitReservePoints":5,"entryRangePoints":30,"id":"ENTRY_CODEX","pendingSeconds":180,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"},{"baseExitReservePoints":5,"entryRangePoints":30,"id":"ENTRY_RANGE_3","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":3,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"},{"baseExitReservePoints":5,"entryRangePoints":30,"id":"ENTRY_RANGE_5","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"},{"baseExitReservePoints":5,"entryRangePoints":30,"id":"TP_040","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"0.4"},{"baseExitReservePoints":5,"entryRangePoints":30,"id":"TP_060","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"0.6"},{"baseExitReservePoints":5,"entryRangePoints":30,"id":"SL_005","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":5,"stressExitReservePoints":65,"targetDistance":"1"},{"baseExitReservePoints":5,"entryRangePoints":30,"id":"SL_010","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":10,"stressExitReservePoints":65,"targetDistance":"1"},{"baseExitReservePoints":5,"entryRangePoints":30,"id":"TTL_060","pendingSeconds":60,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"},{"baseExitReservePoints":5,"entryRangePoints":10,"id":"RANGE_010","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}],"schemaVersion":"demo-trial-catalogue-1.0","setupRiskPercentCeiling":"5","singleLegRiskPercentCeiling":"2.5","status":"EXPERIMENTAL_NOT_CHAMPION","stopAnchorBars":5}$catalogue$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','ENTRY_CODEX',$profile${"baseExitReservePoints":5,"entryRangePoints":30,"id":"ENTRY_CODEX","pendingSeconds":180,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":30,"pendingSeconds":180,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$parameters$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','ENTRY_RANGE_3',$profile${"baseExitReservePoints":5,"entryRangePoints":30,"id":"ENTRY_RANGE_3","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":3,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":30,"pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":3,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$parameters$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','ENTRY_RANGE_5',$profile${"baseExitReservePoints":5,"entryRangePoints":30,"id":"ENTRY_RANGE_5","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":30,"pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$parameters$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','TP_040',$profile${"baseExitReservePoints":5,"entryRangePoints":30,"id":"TP_040","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"0.4"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":30,"pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"0.4"}$parameters$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','TP_060',$profile${"baseExitReservePoints":5,"entryRangePoints":30,"id":"TP_060","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"0.6"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":30,"pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"0.6"}$parameters$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','SL_005',$profile${"baseExitReservePoints":5,"entryRangePoints":30,"id":"SL_005","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":5,"stressExitReservePoints":65,"targetDistance":"1"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":30,"pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":5,"stressExitReservePoints":65,"targetDistance":"1"}$parameters$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','SL_010',$profile${"baseExitReservePoints":5,"entryRangePoints":30,"id":"SL_010","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":10,"stressExitReservePoints":65,"targetDistance":"1"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":30,"pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":10,"stressExitReservePoints":65,"targetDistance":"1"}$parameters$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','TTL_060',$profile${"baseExitReservePoints":5,"entryRangePoints":30,"id":"TTL_060","pendingSeconds":60,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":30,"pendingSeconds":60,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$parameters$);
INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f','RANGE_010',$profile${"baseExitReservePoints":5,"entryRangePoints":10,"id":"RANGE_010","pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$profile$::jsonb,$parameters${"baseExitReservePoints":5,"entryRangePoints":10,"pendingSeconds":180,"proposalSource":"LOCAL_RANGE","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"1"}$parameters$);
CREATE FUNCTION immutable_demo_trial_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DEMO_TRIAL_DEFINITION_IMMUTABLE'; END $$;
CREATE TRIGGER demo_catalogue_immutable BEFORE INSERT OR UPDATE OR DELETE ON demo_trial_catalogues FOR EACH ROW EXECUTE FUNCTION immutable_demo_trial_definition();
CREATE TRIGGER demo_catalogue_no_truncate BEFORE TRUNCATE ON demo_trial_catalogues FOR EACH STATEMENT EXECUTE FUNCTION immutable_demo_trial_definition();
CREATE TRIGGER demo_profile_immutable BEFORE INSERT OR UPDATE OR DELETE ON demo_trial_profiles FOR EACH ROW EXECUTE FUNCTION immutable_demo_trial_definition();
CREATE TRIGGER demo_profile_no_truncate BEFORE TRUNCATE ON demo_trial_profiles FOR EACH STATEMENT EXECUTE FUNCTION immutable_demo_trial_definition();

CREATE TABLE demo_trials (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), symbol_id uuid NOT NULL REFERENCES symbols(id),
 mode text NOT NULL CHECK(mode='demo'), strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 catalogue_sha256 text NOT NULL, profile_id text NOT NULL, profile_sha256 text NOT NULL,
 FOREIGN KEY(catalogue_sha256,profile_id,profile_sha256) REFERENCES demo_trial_profiles(catalogue_sha256,profile_id,profile_sha256),
 cycle integer NOT NULL CHECK(cycle>=0), ordinal integer NOT NULL CHECK(ordinal>=0 AND ordinal<13),
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(), starts_at timestamptz NOT NULL,
 mode_revision uuid NOT NULL, state text NOT NULL CHECK(state IN ('ACTIVE','DRAINING','COMPLETED')),
 market_open_ms bigint NOT NULL DEFAULT 0 CHECK(market_open_ms BETWEEN 0 AND 3630000),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_session_state text NOT NULL DEFAULT 'UNAVAILABLE' CHECK(last_session_state IN('OPEN','CLOSED','UNAVAILABLE')),
 unavailable_since timestamptz DEFAULT clock_timestamp(),
 CHECK((last_session_state='UNAVAILABLE')=(unavailable_since IS NOT NULL)),
 completed_at timestamptz, retirement_reason text,
 UNIQUE(account_id,symbol_id,mode,cycle,ordinal), CHECK(starts_at>registered_at),
 CHECK((state='COMPLETED')=(completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX demo_trial_one_active ON demo_trials(account_id,symbol_id,mode) WHERE state<>'COMPLETED';
CREATE TABLE demo_trial_heads (
 account_id uuid NOT NULL REFERENCES accounts(id), symbol_id uuid NOT NULL REFERENCES symbols(id),
 mode text NOT NULL CHECK(mode='demo'), trial_id uuid NOT NULL REFERENCES demo_trials(id),
 PRIMARY KEY(account_id,symbol_id,mode)
);
CREATE TABLE demo_trial_contexts (
 context_id uuid PRIMARY KEY REFERENCES scenario_contexts(id), trial_id uuid NOT NULL REFERENCES demo_trials(id),
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX demo_trial_context_trial ON demo_trial_contexts(trial_id);
CREATE TABLE demo_trial_events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 trial_id uuid NOT NULL REFERENCES demo_trials(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 kind text NOT NULL, details jsonb NOT NULL
);
CREATE INDEX demo_trial_events_trial_sequence ON demo_trial_events(trial_id,sequence DESC);
CREATE FUNCTION immutable_demo_trial_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'DEMO_TRIAL_EVIDENCE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_trial_event_immutable BEFORE INSERT OR UPDATE OR DELETE ON demo_trial_events FOR EACH ROW EXECUTE FUNCTION immutable_demo_trial_evidence();
CREATE TRIGGER demo_trial_event_no_truncate BEFORE TRUNCATE ON demo_trial_events FOR EACH STATEMENT EXECUTE FUNCTION immutable_demo_trial_evidence();
CREATE TRIGGER demo_trial_context_immutable BEFORE UPDATE OR DELETE ON demo_trial_contexts FOR EACH ROW EXECUTE FUNCTION immutable_demo_trial_evidence();
CREATE TRIGGER demo_trial_context_no_truncate BEFORE TRUNCATE ON demo_trial_contexts FOR EACH STATEMENT EXECUTE FUNCTION immutable_demo_trial_evidence();

CREATE FUNCTION demo_trial_profile_for_slot(cycle integer,ordinal integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN ordinal BETWEEN 0 AND 2 THEN (ARRAY['ENTRY_CODEX','ENTRY_RANGE_3','ENTRY_RANGE_5'])[((ordinal+1-(cycle%2))%3)+1]
 WHEN ordinal BETWEEN 3 AND 12 THEN (ARRAY['TP_040','TP_060','ENTRY_RANGE_5','SL_005','SL_010','ENTRY_RANGE_5','TTL_060','ENTRY_RANGE_5','RANGE_010','ENTRY_RANGE_5'])[ordinal-2] ELSE NULL END
$$;
CREATE FUNCTION guard_demo_trial_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'DEMO_TRIAL_REGISTRATION_IMMUTABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM strategy_versions v WHERE v.id=NEW.strategy_version_id AND v.version='0.10.0-demo-trials.1-codex.1')
    OR NOT EXISTS(SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.environment='demo' AND a.account_type='demo' AND a.active AND a.provider='ctrader')
    OR NOT EXISTS(SELECT 1 FROM symbols s WHERE s.id=NEW.symbol_id AND s.account_id=NEW.account_id AND s.name='XAUUSD')
    THEN RAISE EXCEPTION 'DEMO_TRIAL_SCOPE_INVALID'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'ACTIVE' OR NEW.market_open_ms<>0 OR NEW.starts_at<=clock_timestamp() OR NEW.profile_id IS DISTINCT FROM demo_trial_profile_for_slot(NEW.cycle,NEW.ordinal)
      THEN RAISE EXCEPTION 'DEMO_TRIAL_FUTURE_REGISTRATION_REQUIRED'; END IF;
 ELSE
   IF (NEW.id,NEW.account_id,NEW.symbol_id,NEW.mode,NEW.strategy_version_id,NEW.source_sha256,NEW.catalogue_sha256,NEW.profile_id,NEW.profile_sha256,NEW.cycle,NEW.ordinal,NEW.registered_at,NEW.starts_at,NEW.mode_revision)
     IS DISTINCT FROM (OLD.id,OLD.account_id,OLD.symbol_id,OLD.mode,OLD.strategy_version_id,OLD.source_sha256,OLD.catalogue_sha256,OLD.profile_id,OLD.profile_sha256,OLD.cycle,OLD.ordinal,OLD.registered_at,OLD.starts_at,OLD.mode_revision)
     OR OLD.state='COMPLETED' OR NEW.observed_at<OLD.observed_at OR NEW.observed_at>clock_timestamp()
     OR (NEW.market_open_ms>OLD.market_open_ms AND (NEW.last_session_state<>'OPEN' OR OLD.last_session_state<>'OPEN' OR NEW.observed_at-OLD.observed_at>interval '30 seconds' OR OLD.state<>'ACTIVE'))
     OR NEW.market_open_ms<OLD.market_open_ms
     OR NEW.market_open_ms-OLD.market_open_ms>LEAST(30000,GREATEST(0,ceil(extract(epoch FROM (NEW.observed_at-OLD.observed_at))*1000))+1)
     OR (OLD.state='DRAINING' AND NEW.state NOT IN ('DRAINING','COMPLETED'))
     THEN RAISE EXCEPTION 'DEMO_TRIAL_PROGRESS_INVALID'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.state='ACTIVE' AND NEW.state='DRAINING' AND NEW.market_open_ms<3600000 AND (SELECT count(DISTINCT p.id) FROM demo_trial_contexts dc JOIN order_groups g ON g.context_plan_id=dc.context_id JOIN positions p ON p.order_group_id=g.id JOIN trades tr ON tr.position_id=p.id WHERE dc.trial_id=NEW.id AND p.state='CLOSED')<20 THEN RAISE EXCEPTION 'DEMO_TRIAL_ALLOCATION_INCOMPLETE'; END IF;
 IF TG_OP='UPDATE' AND NEW.state='COMPLETED' AND (OLD.state<>'DRAINING' OR NOT demo_trial_can_complete(NEW.id)) THEN RAISE EXCEPTION 'DEMO_TRIAL_TERMINAL_PROOF_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_trial_progress_guard BEFORE INSERT OR UPDATE OR DELETE ON demo_trials FOR EACH ROW EXECUTE FUNCTION guard_demo_trial_progress();
CREATE TRIGGER demo_trial_no_truncate BEFORE TRUNCATE ON demo_trials FOR EACH STATEMENT EXECUTE FUNCTION guard_demo_trial_progress();
CREATE FUNCTION audit_demo_trial_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
   INSERT INTO demo_trial_events(trial_id,kind,details) VALUES(NEW.id,
     CASE WHEN TG_OP='INSERT' THEN 'REGISTERED' ELSE NEW.state END,
     jsonb_build_object('profileId',NEW.profile_id,'profileSha256',NEW.profile_sha256,'sourceSha256',NEW.source_sha256,'marketOpenMilliseconds',NEW.market_open_ms,'reason',NEW.retirement_reason,'review',CASE WHEN NEW.state='COMPLETED' THEN demo_trial_review(NEW.id) ELSE NULL END));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_trial_state_audit AFTER INSERT OR UPDATE ON demo_trials FOR EACH ROW EXECUTE FUNCTION audit_demo_trial_state();
CREATE FUNCTION guard_demo_trial_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'DEMO_TRIAL_HEAD_IMMUTABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM demo_trials t WHERE t.id=NEW.trial_id AND t.account_id=NEW.account_id AND t.symbol_id=NEW.symbol_id AND t.mode=NEW.mode AND t.state='ACTIVE')
   THEN RAISE EXCEPTION 'DEMO_TRIAL_HEAD_SCOPE_INVALID'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.account_id,NEW.symbol_id,NEW.mode) IS DISTINCT FROM (OLD.account_id,OLD.symbol_id,OLD.mode)
   OR NOT EXISTS(SELECT 1 FROM demo_trials t WHERE t.id=OLD.trial_id AND t.state='COMPLETED'))
   THEN RAISE EXCEPTION 'DEMO_TRIAL_HEAD_TRANSITION_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_trial_head_guard BEFORE INSERT OR UPDATE OR DELETE ON demo_trial_heads FOR EACH ROW EXECUTE FUNCTION guard_demo_trial_head();
CREATE TRIGGER demo_trial_head_no_truncate BEFORE TRUNCATE ON demo_trial_heads FOR EACH STATEMENT EXECUTE FUNCTION guard_demo_trial_head();

CREATE FUNCTION guard_demo_trial_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; t demo_trials%ROWTYPE; binding jsonb;
BEGIN
 SELECT * INTO t FROM demo_trials WHERE id=NEW.trial_id;
 SELECT definition INTO p FROM demo_trial_profiles WHERE catalogue_sha256=t.catalogue_sha256 AND profile_id=t.profile_id;
 SELECT split_part(pp.content,E'REGISTERED_DEMO_TRIAL\n',2)::jsonb INTO binding FROM context_provider_evidence ce JOIN provider_prompt_artifacts pp ON pp.content_sha256=ce.prompt_sha256 WHERE ce.context_id=NEW.context_id;
 IF binding IS NULL OR binding->>'trialId' IS DISTINCT FROM t.id::text OR binding->>'sourceSha256' IS DISTINCT FROM t.source_sha256 OR binding->>'catalogueSha256' IS DISTINCT FROM t.catalogue_sha256 OR binding->>'profileId' IS DISTINCT FROM t.profile_id OR binding->>'profileSha256' IS DISTINCT FROM t.profile_sha256 OR binding->'profile' IS DISTINCT FROM p OR binding->>'strategyVersion' IS DISTINCT FROM '0.10.0-demo-trials.1-codex.1' OR (binding->>'registeredAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',t.registered_at) OR (binding->>'startsAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',t.starts_at)
   OR t.state<>'ACTIVE' OR t.market_open_ms>=3600000 OR t.starts_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM demo_trial_heads h WHERE h.trial_id=t.id AND h.account_id=t.account_id AND h.symbol_id=t.symbol_id AND h.mode=t.mode)
   OR NOT EXISTS(SELECT 1 FROM scenario_contexts c JOIN analysis_runs a ON a.id=c.source_analysis_id
     WHERE c.id=NEW.context_id AND c.account_id=t.account_id AND c.symbol_id=t.symbol_id AND c.mode='demo'
     AND a.strategy_version_id=t.strategy_version_id AND c.captured_at>=t.starts_at
     AND c.requested_model=CASE WHEN p->>'proposalSource'='CODEX' THEN 'gpt-6.1-sol' ELSE 'local-range-v1' END)
   OR (SELECT count(*) FROM trades tr JOIN order_groups g ON g.id=tr.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=t.id)>=20
   THEN RAISE EXCEPTION 'SCENARIO_DEMO_TRIAL_LINK_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_trial_link_guard BEFORE INSERT ON demo_trial_contexts FOR EACH ROW EXECUTE FUNCTION guard_demo_trial_link();

ALTER TABLE scenario_contexts DROP CONSTRAINT scenario_contexts_requested_model_check;
ALTER TABLE scenario_contexts ADD CONSTRAINT scenario_contexts_requested_model_check CHECK(requested_model IN(
 'gpt-6-astra/u64','gpt-5.6-sol/u40','deepseek-v4-pro/u5W','grok-4.5','gpt-6.1-sol','local-range-v1')) NOT VALID;
ALTER TABLE scenario_contexts VALIDATE CONSTRAINT scenario_contexts_requested_model_check;
ALTER TABLE scenario_contexts DROP CONSTRAINT scenario_context_lifetime_v2;
ALTER TABLE scenario_contexts ADD CONSTRAINT scenario_context_lifetime_v3 CHECK(COALESCE((
 (COALESCE(plan->>'schema_version','')<>'entry-scalp-1.0' AND valid_until=captured_at+interval '5 minutes')
 OR (plan->>'schema_version'='entry-scalp-1.0' AND mode='demo' AND requested_model IN ('gpt-6.1-sol','local-range-v1')
   AND state='READY' AND (plan->>'analysis_id')::uuid=id AND (plan->>'captured_at')::timestamptz=captured_at
   AND (plan->>'pending_seconds')::integer BETWEEN 60 AND 300
   AND valid_until=captured_at+(plan->>'pending_seconds')::integer*interval '1 second'
   AND valid_until=(plan->>'valid_until')::timestamptz)
),false));
CREATE FUNCTION guard_demo_trial_context_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version text;
BEGIN
 SELECT v.version INTO version FROM analysis_runs a JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE a.id=NEW.source_analysis_id;
 IF (version='0.10.0-demo-trials.1-codex.1' AND NOT EXISTS(
      SELECT 1 FROM demo_trial_contexts dc JOIN demo_trials t ON t.id=dc.trial_id
      WHERE dc.context_id=NEW.id AND t.account_id=NEW.account_id AND t.symbol_id=NEW.symbol_id
        AND t.mode=NEW.mode AND t.strategy_version_id=(SELECT strategy_version_id FROM analysis_runs WHERE id=NEW.source_analysis_id)))
    OR (NEW.requested_model='local-range-v1' AND version IS DISTINCT FROM '0.10.0-demo-trials.1-codex.1')
    THEN RAISE EXCEPTION 'SCENARIO_DEMO_TRIAL_AUTHORITY_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER demo_trial_context_authority AFTER INSERT OR UPDATE ON scenario_contexts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_demo_trial_context_authority();
ALTER TABLE orders ADD COLUMN entry_range_points integer CHECK(entry_range_points IN(10,30));
CREATE FUNCTION guard_demo_order_range() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version text;
BEGIN
 SELECT v.version INTO version FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE g.id=NEW.order_group_id;
 IF (TG_OP='UPDATE' AND NEW.entry_range_points IS DISTINCT FROM OLD.entry_range_points)
    OR (version='0.10.0-demo-trials.1-codex.1' AND NEW.entry_range_points IS NULL)
    OR (version IS DISTINCT FROM '0.10.0-demo-trials.1-codex.1' AND NEW.entry_range_points IS NOT NULL)
    THEN RAISE EXCEPTION 'DEMO_TRIAL_ENTRY_RANGE_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_order_range_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_demo_order_range();

CREATE FUNCTION validate_demo_trial_group(candidate order_groups, plan jsonb, operation text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t demo_trials%ROWTYPE; profile jsonb; low numeric; high numeric; tick numeric; context jsonb; selected text; reg_model text;
BEGIN
 SELECT tr.* INTO t FROM demo_trial_contexts dc JOIN demo_trials tr ON tr.id=dc.trial_id WHERE dc.context_id=candidate.context_plan_id;
 SELECT definition INTO profile FROM demo_trial_profiles WHERE catalogue_sha256=t.catalogue_sha256 AND profile_id=t.profile_id;
 SELECT ce.request_text::jsonb,c.requested_model INTO context,reg_model FROM context_provider_evidence ce JOIN scenario_contexts c ON c.id=ce.context_id WHERE c.id=candidate.context_plan_id;
 selected:=plan->>'entry_side';tick:=(context->>'tick_size')::numeric;
 IF t.id IS NULL OR profile IS NULL OR candidate.mode<>'demo' OR candidate.execution_mode IS DISTINCT FROM 'SINGLE_STOP_LIMIT'
    OR candidate.time_in_force IS DISTINCT FROM 'GTD' OR candidate.mode_revision IS DISTINCT FROM t.mode_revision
    OR candidate.entry_side IS DISTINCT FROM selected OR selected IS NULL OR selected NOT IN('BUY','SELL')
    OR plan->>'schema_version' IS DISTINCT FROM 'entry-scalp-1.0'
    OR candidate.expires_at IS DISTINCT FROM (plan->>'valid_until')::timestamptz
    OR candidate.submission_valid_until IS DISTINCT FROM candidate.expires_at
    OR (plan->>'pending_seconds')::integer IS DISTINCT FROM (profile->>'pendingSeconds')::integer
    OR (plan->>'captured_at')::timestamptz<t.starts_at
    OR candidate.expires_at IS DISTINCT FROM (plan->>'captured_at')::timestamptz+(profile->>'pendingSeconds')::integer*interval '1 second'
    OR NOT EXISTS(SELECT 1 FROM analysis_runs a WHERE a.id=candidate.analysis_id AND a.account_id=t.account_id AND a.symbol_id=t.symbol_id AND a.strategy_version_id=t.strategy_version_id)
    OR reg_model IS DISTINCT FROM (CASE WHEN profile->>'proposalSource'='CODEX' THEN 'gpt-6.1-sol' ELSE 'local-range-v1' END)
    OR NOT EXISTS(SELECT 1 FROM context_provider_evidence ce JOIN provider_prompt_artifacts pp ON pp.content_sha256=ce.prompt_sha256 WHERE ce.context_id=candidate.context_plan_id AND pp.version=CASE WHEN profile->>'proposalSource'='CODEX' THEN 'entry-scalp-v3' ELSE 'demo-local-range-v1' END)
    THEN RAISE EXCEPTION 'SCALP_GROUP_AUTHORITY_INVALID'; END IF;
 SELECT min((bar->>4)::numeric),max((bar->>3)::numeric) INTO low,high
 FROM jsonb_array_elements(context->'candles') frame,
 LATERAL jsonb_array_elements(frame->'rows') WITH ORDINALITY bars(bar,number)
 WHERE frame->>'timeframe'='M1' AND number>jsonb_array_length(frame->'rows')-5;
 IF low IS NULL OR high IS NULL OR tick IS NULL OR tick<=0 OR (plan->>'stop_loss')::numeric IS DISTINCT FROM
    (CASE WHEN selected='BUY' THEN low-(profile->>'stopBufferTicks')::numeric*tick ELSE high+(profile->>'stopBufferTicks')::numeric*tick END)
    OR abs((plan->>'take_profit')::numeric-(plan->>CASE WHEN selected='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric) IS DISTINCT FROM (profile->>'targetDistance')::numeric
    THEN RAISE EXCEPTION 'SCALP_TRIAL_GEOMETRY_INVALID'; END IF;
 IF operation='INSERT' THEN
   -- Lock mode before head, matching intent and controller lock order.
   PERFORM 1 FROM entry_mode_settings WHERE account_id=t.account_id AND symbol_id=t.symbol_id AND environment='demo' FOR UPDATE;
   PERFORM 1 FROM demo_trial_heads WHERE account_id=t.account_id AND symbol_id=t.symbol_id AND mode='demo' FOR UPDATE;
   SELECT tr.* INTO t FROM demo_trials tr WHERE tr.id=t.id;
   IF t.state<>'ACTIVE' OR t.market_open_ms>=3600000 OR candidate.expires_at<=clock_timestamp()
      OR NOT EXISTS(SELECT 1 FROM demo_trial_heads h WHERE h.trial_id=t.id AND h.account_id=t.account_id AND h.symbol_id=t.symbol_id AND h.mode='demo')
      OR NOT EXISTS(SELECT 1 FROM entry_mode_settings s WHERE s.account_id=t.account_id AND s.symbol_id=t.symbol_id AND s.environment='demo' AND s.entry_mode='SINGLE_STOP_LIMIT' AND s.revision=t.mode_revision)
      OR (SELECT count(*) FROM trades tr JOIN order_groups g ON g.id=tr.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=t.id)>=20
      THEN RAISE EXCEPTION 'SCALP_TRIAL_REFRESH_REQUIRED'; END IF;
 END IF;
END $$;
CREATE FUNCTION validate_demo_trial_order(candidate orders, plan jsonb, selected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE profile jsonb; aid uuid;
BEGIN
 SELECT p.definition,t.account_id INTO profile,aid FROM order_groups g JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id JOIN demo_trials t ON t.id=dc.trial_id JOIN demo_trial_profiles p ON p.catalogue_sha256=t.catalogue_sha256 AND p.profile_id=t.profile_id WHERE g.id=candidate.order_group_id;
 IF profile IS NULL OR candidate.strategy_label IS DISTINCT FROM 'ctrader-ai-scalper:0.10.0-demo-trials.1-codex.1' OR candidate.side IS DISTINCT FROM selected OR NOT candidate.strategy_owned OR candidate.account_id IS DISTINCT FROM aid
   OR candidate.time_in_force IS DISTINCT FROM 'GTD' OR candidate.execution_order_type IS DISTINCT FROM 'STOP_LIMIT'
   OR candidate.entry_price IS DISTINCT FROM (plan->>CASE WHEN selected='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric
   OR candidate.stop_loss IS DISTINCT FROM (plan->>'stop_loss')::numeric OR candidate.take_profit IS DISTINCT FROM (plan->>'take_profit')::numeric
   OR abs(candidate.take_profit-candidate.entry_price) IS DISTINCT FROM (profile->>'targetDistance')::numeric
   OR abs(candidate.stop_loss-candidate.entry_price)>7
   OR candidate.expires_at IS DISTINCT FROM (plan->>'valid_until')::timestamptz OR candidate.submission_valid_until IS DISTINCT FROM candidate.expires_at
   OR candidate.entry_range_points IS DISTINCT FROM (profile->>'entryRangePoints')::integer
   OR (CASE WHEN selected='BUY' THEN NOT(candidate.stop_loss<candidate.entry_price AND candidate.take_profit>candidate.entry_price) ELSE NOT(candidate.take_profit<candidate.entry_price AND candidate.stop_loss>candidate.entry_price) END)
   THEN RAISE EXCEPTION 'SCALP_ORDER_AUTHORITY_INVALID'; END IF;
END $$;

-- Historical authority branches below are unchanged.
CREATE OR REPLACE FUNCTION guard_directional_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; aid uuid; sid uuid; current_mode text; current_revision uuid; single_mode boolean; limit_mode boolean;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.entry_side IS DISTINCT FROM OLD.entry_side OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode OR NEW.mode_revision IS DISTINCT FROM OLD.mode_revision OR (OLD.execution_mode IS NOT NULL AND (NEW.analysis_id IS DISTINCT FROM OLD.analysis_id OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.time_in_force IS DISTINCT FROM OLD.time_in_force)) OR ((OLD.entry_side IS NOT NULL OR OLD.execution_mode IS NOT NULL) AND NEW.context_plan_id IS DISTINCT FROM OLD.context_plan_id)) THEN RAISE EXCEPTION 'DIRECTIONAL_GROUP_AUTHORITY_IMMUTABLE'; END IF;
 SELECT account_id,symbol_id INTO aid,sid FROM analysis_runs WHERE id=NEW.analysis_id;
 SELECT plan INTO p FROM scenario_contexts WHERE id=NEW.context_plan_id AND state='READY' AND account_id=aid AND symbol_id=sid AND mode=NEW.mode;
 IF EXISTS(SELECT 1 FROM analysis_runs a JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE a.id=NEW.analysis_id AND v.version='0.10.0-demo-trials.1-codex.1') THEN PERFORM validate_demo_trial_group(NEW,p,TG_OP); RETURN NEW; END IF;
 IF EXISTS (SELECT 1 FROM analysis_runs a JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE a.id=NEW.analysis_id AND v.version IN ('0.9.0-cost-balanced.1-codex.1','0.9.0-cost-balanced.1-codex.2')) THEN
   IF p->>'schema_version' IS DISTINCT FROM 'entry-scalp-1.0'
     OR NOT EXISTS (SELECT 1 FROM scenario_contexts c JOIN analysis_runs a ON a.id=c.source_analysis_id JOIN strategy_versions v ON v.id=a.strategy_version_id JOIN context_provider_evidence ce ON ce.context_id=c.id JOIN provider_prompt_artifacts pp ON pp.content_sha256=ce.prompt_sha256 WHERE c.id=NEW.context_plan_id AND v.version IN ('0.9.0-cost-balanced.1-codex.1','0.9.0-cost-balanced.1-codex.2') AND v.id=(SELECT strategy_version_id FROM analysis_runs WHERE id=NEW.analysis_id) AND pp.version='entry-scalp-v2')
     OR NEW.mode<>'demo' OR NEW.execution_mode IS DISTINCT FROM 'SINGLE_STOP_LIMIT'
     OR NEW.time_in_force IS DISTINCT FROM 'GTD' OR NEW.mode_revision IS NULL
     OR NEW.entry_side IS DISTINCT FROM p->>'entry_side'
     OR NEW.entry_side IS NULL OR NEW.entry_side NOT IN ('BUY','SELL')
     OR NEW.expires_at IS DISTINCT FROM (p->>'valid_until')::timestamptz
     OR NEW.submission_valid_until IS DISTINCT FROM NEW.expires_at
     OR (p->>'pending_seconds')::integer NOT BETWEEN 60 AND 300
     OR (p->>'valid_until')::timestamptz IS DISTINCT FROM
       (p->>'captured_at')::timestamptz + (p->>'pending_seconds')::integer * interval '1 second'
     OR NOT EXISTS (SELECT 1 FROM analysis_runs a JOIN strategy_versions v ON v.id=a.strategy_version_id
       WHERE a.id=NEW.analysis_id AND v.version IN ('0.9.0-cost-balanced.1-codex.1','0.9.0-cost-balanced.1-codex.2'))
     THEN RAISE EXCEPTION 'SCALP_GROUP_AUTHORITY_INVALID'; END IF;
   IF TG_OP='INSERT' THEN
     SELECT entry_mode,revision INTO current_mode,current_revision FROM entry_mode_settings
       WHERE account_id=aid AND symbol_id=sid AND environment=NEW.mode FOR UPDATE;
     IF current_mode IS DISTINCT FROM NEW.execution_mode OR current_revision IS DISTINCT FROM NEW.mode_revision
       OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'SCALP_GROUP_REFRESH_REQUIRED'; END IF;
   END IF;
   RETURN NEW;
 END IF;
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
 IF EXISTS(SELECT 1 FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE g.id=NEW.order_group_id AND v.version='0.10.0-demo-trials.1-codex.1') THEN PERFORM validate_demo_trial_order(NEW,p,s); RETURN NEW; END IF;
 IF p->>'schema_version'='entry-scalp-1.0' AND EXISTS (SELECT 1 FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE g.id=NEW.order_group_id AND v.version IN ('0.9.0-cost-balanced.1-codex.1','0.9.0-cost-balanced.1-codex.2')) THEN
   expected_price:=(p->>CASE WHEN s='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric;
   IF em IS DISTINCT FROM 'SINGLE_STOP_LIMIT' OR s IS NULL OR NEW.side IS DISTINCT FROM s
     OR NOT NEW.strategy_owned OR NEW.account_id IS DISTINCT FROM aid
     OR NEW.time_in_force IS DISTINCT FROM 'GTD' OR NEW.execution_order_type IS DISTINCT FROM 'STOP_LIMIT'
     OR NEW.entry_price IS DISTINCT FROM expected_price
     OR NEW.stop_loss IS DISTINCT FROM (p->>'stop_loss')::numeric
     OR NEW.take_profit IS DISTINCT FROM (p->>'take_profit')::numeric
     OR NEW.expires_at IS DISTINCT FROM (p->>'valid_until')::timestamptz
     OR NEW.submission_valid_until IS DISTINCT FROM NEW.expires_at
     OR abs(NEW.take_profit-NEW.entry_price)>7 OR abs(NEW.take_profit-NEW.entry_price)<abs(NEW.stop_loss-NEW.entry_price) OR abs(NEW.stop_loss-NEW.entry_price)>7
     OR (CASE WHEN s='BUY' THEN NOT (NEW.stop_loss<NEW.entry_price AND NEW.take_profit>NEW.entry_price)
       ELSE NOT (NEW.take_profit<NEW.entry_price AND NEW.stop_loss>NEW.entry_price) END)
     THEN RAISE EXCEPTION 'SCALP_ORDER_AUTHORITY_INVALID'; END IF;
   RETURN NEW;
 END IF;
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
-- Rollback keeps this forward migration. Wait for every new group/command to be
-- terminal with exact broker proof before restoring older execution/worker source.
-- Restore the prior scoped selection through audited CAS; never downgrade/reset DB.

CREATE FUNCTION demo_trial_closed_group(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(g.state='CLOSED' AND g.mode='demo'
 AND (SELECT count(*) FROM orders o WHERE o.order_group_id=g.id)=1
 AND EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.order_group_id=g.id AND
   (NOT o.strategy_owned OR o.broker_order_id IS NULL OR o.state NOT IN('FILLED','CANCELLED','EXPIRED','REJECTED')
    OR o.filled_volume IS DISTINCT FROM COALESCE((SELECT sum(f.volume) FROM fills f WHERE f.order_id=o.id),0)
    OR EXISTS(SELECT 1 FROM fills f WHERE f.order_id=o.id AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.id=f.position_id AND p.order_group_id=g.id AND p.side=o.side))))
 AND NOT EXISTS(SELECT 1 FROM positions p JOIN analysis_runs a ON a.id=g.analysis_id WHERE p.order_group_id=g.id AND
   (p.account_id<>a.account_id OR p.symbol_id<>a.symbol_id OR NOT p.strategy_owned OR p.state<>'CLOSED' OR p.volume<>0 OR p.opened_at IS NULL OR p.closed_at IS NULL OR p.closed_at>clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM fills f WHERE f.position_id=p.id AND f.order_id IS NOT NULL)
    OR (SELECT sum(d.closed_volume) FROM position_close_deals d WHERE d.position_id=p.id) IS DISTINCT FROM (SELECT sum(f.volume) FROM fills f WHERE f.position_id=p.id AND f.order_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM position_close_deals d WHERE d.position_id=p.id AND (d.account_id<>p.account_id OR d.symbol_id<>p.symbol_id OR d.entry_price<>p.entry_price OR d.occurred_at<p.opened_at OR d.occurred_at>p.closed_at OR NOT EXISTS(SELECT 1 FROM fills f WHERE f.position_id=p.id AND f.order_id IS NULL AND f.broker_fill_id=d.broker_deal_id AND f.volume=d.closed_volume AND f.occurred_at=d.occurred_at)))
    OR NOT EXISTS(SELECT 1 FROM trades tr WHERE tr.position_id=p.id AND tr.order_group_id=g.id AND tr.mode='demo' AND tr.direction=CASE WHEN p.side='BUY' THEN 'LONG' ELSE 'SHORT' END AND tr.opened_at=p.opened_at AND tr.closed_at=p.closed_at
      AND tr.realized_pnl=(SELECT sum(d.gross_profit+d.commission+d.swap+d.conversion_fee) FROM position_close_deals d WHERE d.position_id=p.id)
      AND tr.fees=(SELECT sum(d.commission+d.swap+d.conversion_fee) FROM position_close_deals d WHERE d.position_id=p.id))
    OR NOT EXISTS(SELECT 1 FROM broker_execution_events e WHERE e.position_id=p.id AND e.account_id=p.account_id AND e.symbol_id=p.symbol_id AND e.order_group_id=g.id AND e.mapping_state='MAPPED' AND jsonb_array_length(e.reason_codes)=0 AND e.closing_order AND e.execution_type=3 AND e.occurred_at=p.closed_at AND e.normalized_payload->'position'->>'state'='CLOSED' AND e.normalized_payload->'order'->>'state'='FILLED'))),false)
 FROM order_groups g WHERE g.id=target
$$;
CREATE FUNCTION demo_trial_zero_fill_group(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $zero$
 SELECT COALESCE((
  ((g.state='FAILED' AND g.cancellation_reason IN ('OCO_PEER_UNFILLED_TERMINAL','DEMO_BROKER_ZERO_FILL_CANCELLED'))
   OR (c.plan->>'schema_version'='entry-scalp-1.0' AND g.state='EXPIRED'
     AND (g.cancellation_reason='ANALYSIS_EXPIRED' OR (g.cancellation_reason IS NULL
       AND EXISTS(SELECT 1 FROM orders o JOIN broker_execution_events e ON e.order_id=o.id
         WHERE o.order_group_id=g.id AND o.state='EXPIRED' AND e.order_group_id=g.id
           AND e.account_id=c.account_id AND e.symbol_id=c.symbol_id AND e.mapping_state='MAPPED'
           AND e.execution_type=6 AND e.broker_order_id=o.broker_order_id)))))
  AND g.updated_at<=clock_timestamp() AND g.mode=c.mode
  AND EXISTS(SELECT 1 FROM analysis_runs a WHERE a.id=g.analysis_id AND a.account_id=c.account_id AND a.symbol_id=c.symbol_id)
  AND (SELECT count(*) FROM orders o WHERE o.order_group_id=g.id)=CASE WHEN g.entry_side IS NULL THEN 2 ELSE 1 END
  AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.order_group_id=g.id AND (
    o.account_id<>c.account_id OR NOT o.strategy_owned OR o.broker_order_id IS NULL
    OR o.state NOT IN ('CANCELLED','EXPIRED','REJECTED') OR o.filled_volume<>0
    OR NOT EXISTS(SELECT 1 FROM broker_execution_events e
      WHERE e.order_id=o.id AND e.account_id=c.account_id AND e.symbol_id=c.symbol_id
        AND e.broker_order_id=o.broker_order_id AND e.mapping_state='MAPPED'
        AND e.execution_type IN (5,6,7) AND jsonb_array_length(e.reason_codes)=0
        AND e.normalized_payload->'order'->>'state'=o.state
        AND e.normalized_payload->'order'->>'filledVolume'='0')))
  AND NOT EXISTS(SELECT 1 FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.order_group_id=g.id)
  AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id)
  AND NOT EXISTS(SELECT 1 FROM trades t WHERE t.order_group_id=g.id)
  AND NOT EXISTS(SELECT 1 FROM broker_execution_events e WHERE e.account_id=c.account_id AND e.symbol_id=c.symbol_id
    AND e.resolved_at IS NULL AND (e.mapping_state<>'MAPPED' OR jsonb_array_length(e.reason_codes)>0))),false)
 FROM order_groups g JOIN scenario_contexts c ON c.id=g.context_plan_id WHERE g.id=target;
$zero$;
CREATE FUNCTION demo_trial_unsent_group(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(g.state='FAILED' AND g.mode='demo' AND g.entry_side IS NOT NULL
 AND (SELECT count(*) FROM orders o WHERE o.order_group_id=g.id)=1
 AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.order_group_id=g.id AND
   (NOT o.strategy_owned OR o.state<>'REJECTED' OR o.filled_volume<>0 OR o.broker_order_id IS NOT NULL OR o.submitted_at IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM local_unsent_entry_proofs u JOIN analysis_runs a ON a.id=g.analysis_id WHERE u.order_id=o.id AND u.order_group_id=g.id AND u.account_id=o.account_id AND u.account_id=a.account_id AND u.symbol_id=a.symbol_id AND u.client_order_id=o.client_order_id AND u.source_updated_at=o.updated_at)
    OR EXISTS(SELECT 1 FROM fills f WHERE f.order_id=o.id)
    OR EXISTS(SELECT 1 FROM broker_execution_events e WHERE e.order_id=o.id OR e.client_order_id=o.client_order_id)))
 AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM trades tr WHERE tr.order_group_id=g.id),false)
 FROM order_groups g WHERE g.id=target
$$;
CREATE FUNCTION demo_trial_can_complete(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM demo_trials WHERE id=target) AND NOT EXISTS(
 SELECT 1 FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id LEFT JOIN order_groups g ON g.context_plan_id=c.id
 WHERE dc.trial_id=target AND
 ((c.state='REQUESTING' AND c.requested_at>clock_timestamp()-interval '5 minutes')
 OR (g.id IS NOT NULL AND NOT COALESCE(demo_trial_closed_group(g.id) OR demo_trial_zero_fill_group(g.id) OR demo_trial_unsent_group(g.id),false))))
 AND NOT EXISTS(SELECT 1 FROM demo_trials t JOIN broker_execution_events e ON e.account_id=t.account_id AND e.symbol_id=t.symbol_id
   WHERE t.id=target AND e.resolved_at IS NULL AND (e.mapping_state<>'MAPPED' OR jsonb_array_length(e.reason_codes)>0));
$$;

ALTER TABLE analysis_context_consultations DROP CONSTRAINT analysis_context_consultations_reason_check;
ALTER TABLE analysis_context_consultations ADD CONSTRAINT analysis_context_consultations_reason_check CHECK(reason IN('SCENARIO_CODEX_WAIT','SCENARIO_LOCAL_WAIT'));
CREATE FUNCTION guard_demo_consultation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM scenario_contexts c WHERE c.id=NEW.context_id
   AND (NEW.reason='SCENARIO_LOCAL_WAIT')=(c.requested_model='local-range-v1'))
   THEN RAISE EXCEPTION 'CONTEXT_CONSULTATION_SOURCE_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_consultation_source BEFORE INSERT ON analysis_context_consultations FOR EACH ROW EXECUTE FUNCTION guard_demo_consultation_source();


-- Freeze the interpretation at completion; late provider receipts do not rewrite it.
CREATE FUNCTION demo_trial_review(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
 'closedPositions',count(DISTINCT tr.position_id)::integer,
 'observedNet',sum(tr.realized_pnl)::text,
 'interpretation',CASE WHEN count(tr.id)=0 THEN 'NO_CLOSED_SAMPLE' WHEN sum(tr.realized_pnl)>0 THEN 'POSITIVE_OBSERVED_NET_UNQUALIFIED' ELSE 'NONPOSITIVE_OBSERVED_NET_UNQUALIFIED' END,
 'waits',(SELECT count(*)::integer FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id WHERE dc.trial_id=target AND c.plan->>'schema_version'='entry-wait-1.0'),
 'failedProposals',(SELECT count(*)::integer FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id WHERE dc.trial_id=target AND c.state='FAILED'),
 'incompleteContexts',(SELECT count(*)::integer FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id WHERE dc.trial_id=target AND c.state='REQUESTING'),
 'nextProfileId',(SELECT demo_trial_profile_for_slot(t.cycle+CASE WHEN t.ordinal=12 THEN 1 ELSE 0 END,(t.ordinal+1)%13) FROM demo_trials t WHERE t.id=target))
 FROM trades tr JOIN order_groups g ON g.id=tr.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=target;
$$;
