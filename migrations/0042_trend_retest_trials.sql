-- Registered structural trend experiment. No activation or history reset.
-- Rollback retains additive evidence and requires terminal reconciliation.

DROP TRIGGER demo_catalogue_immutable ON demo_trial_catalogues;

DROP TRIGGER demo_profile_immutable ON demo_trial_profiles;

INSERT INTO demo_trial_catalogues VALUES('287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f',$catalogue${"batches":[{"id":"CONFIRMATION","profiles":["TREND_BREAKOUT","TREND_CONFIRMED"]},{"id":"ENTRY_TYPE","profiles":["TREND_CONFIRMED","TREND_RETEST"]}],"maximumCloses":20,"maximumMarketOpenSeconds":3600,"profiles":[{"baseExitReservePoints":65,"entryRangePoints":30,"entryStyle":"BREAKOUT","id":"TREND_BREAKOUT","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"},{"baseExitReservePoints":65,"entryRangePoints":30,"entryStyle":"CONFIRMED_BREAKOUT","id":"TREND_CONFIRMED","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"},{"baseExitReservePoints":65,"entryRangePoints":0,"entryStyle":"RETEST_LIMIT","id":"TREND_RETEST","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"}],"schemaVersion":"trend-retest-catalogue-1.0","setupRiskPercentCeiling":"5","singleLegRiskPercentCeiling":"2.5","status":"EXPERIMENTAL_NOT_CHAMPION"}$catalogue$);

INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f','TREND_BREAKOUT',$profile${"baseExitReservePoints":65,"entryRangePoints":30,"entryStyle":"BREAKOUT","id":"TREND_BREAKOUT","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"}$profile$::jsonb,$parameters${"baseExitReservePoints":65,"entryRangePoints":30,"entryStyle":"BREAKOUT","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"}$parameters$);

INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f','TREND_CONFIRMED',$profile${"baseExitReservePoints":65,"entryRangePoints":30,"entryStyle":"CONFIRMED_BREAKOUT","id":"TREND_CONFIRMED","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"}$profile$::jsonb,$parameters${"baseExitReservePoints":65,"entryRangePoints":30,"entryStyle":"CONFIRMED_BREAKOUT","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"}$parameters$);

INSERT INTO demo_trial_profiles(catalogue_sha256,profile_id,definition,parameters_text) VALUES('287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f','TREND_RETEST',$profile${"baseExitReservePoints":65,"entryRangePoints":0,"entryStyle":"RETEST_LIMIT","id":"TREND_RETEST","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"}$profile$::jsonb,$parameters${"baseExitReservePoints":65,"entryRangePoints":0,"entryStyle":"RETEST_LIMIT","minimumNetRewardRisk":"1","pendingSeconds":60,"proposalSource":"CODEX","rangeBars":5,"stopBufferTicks":0,"stressExitReservePoints":65,"targetDistance":"STRUCTURAL"}$parameters$);

CREATE TRIGGER demo_catalogue_immutable BEFORE INSERT OR UPDATE OR DELETE ON demo_trial_catalogues FOR EACH ROW EXECUTE FUNCTION immutable_demo_trial_definition();

CREATE TRIGGER demo_profile_immutable BEFORE INSERT OR UPDATE OR DELETE ON demo_trial_profiles FOR EACH ROW EXECUTE FUNCTION immutable_demo_trial_definition();

CREATE FUNCTION trend_trial_profile_for_slot(cycle integer,ordinal integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN cycle>=0 AND ordinal BETWEEN 0 AND 3 THEN
 (CASE WHEN cycle%2=0 THEN ARRAY['TREND_BREAKOUT','TREND_CONFIRMED','TREND_CONFIRMED','TREND_RETEST']
 ELSE ARRAY['TREND_CONFIRMED','TREND_BREAKOUT','TREND_RETEST','TREND_CONFIRMED'] END)[ordinal+1] ELSE NULL END
$$;

CREATE FUNCTION demo_trial_source_handover(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM demo_trials t JOIN strategy_versions v ON v.id=t.strategy_version_id JOIN demo_trial_events e ON e.trial_id=t.id
 WHERE t.id=target AND v.version='0.10.0-demo-trials.1-codex.1' AND t.source_sha256='39588e8734f9f0b3d952ffeec2f7f1906417bd8e7b66824cc220e73e8e21848b'
 AND e.kind='SOURCE_HANDOVER_REQUESTED' AND e.details->>'fromSourceSha256'=t.source_sha256
 AND e.details->>'toSourceSha256' ~ '^[a-f0-9]{64}$' AND e.details->>'toSourceSha256'<>t.source_sha256
 AND e.details->>'toStrategyVersion'='0.11.0-trend-retest.1-codex.1' AND e.details->>'toCatalogueSha256'='287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f')
$$;

CREATE OR REPLACE FUNCTION guard_demo_trial_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'DEMO_TRIAL_REGISTRATION_IMMUTABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM strategy_versions v WHERE v.id=NEW.strategy_version_id AND v.version IN ('0.10.0-demo-trials.1-codex.1','0.11.0-trend-retest.1-codex.1'))
    OR NOT EXISTS(SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.environment='demo' AND a.account_type='demo' AND a.active AND a.provider='ctrader')
    OR NOT EXISTS(SELECT 1 FROM symbols s WHERE s.id=NEW.symbol_id AND s.account_id=NEW.account_id AND s.name='XAUUSD')
    THEN RAISE EXCEPTION 'DEMO_TRIAL_SCOPE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM strategy_versions v WHERE v.id=NEW.strategy_version_id AND ((v.version='0.11.0-trend-retest.1-codex.1' AND NEW.catalogue_sha256='287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f') OR (v.version='0.10.0-demo-trials.1-codex.1' AND NEW.catalogue_sha256='0ff4268fcfe1c73e9c2dcc87ce461c9029e80bd4404194aabcfc2f9022da9e8f'))) THEN RAISE EXCEPTION 'DEMO_TRIAL_CATALOGUE_VERSION_INVALID'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'ACTIVE' OR NEW.market_open_ms<>0 OR NEW.starts_at<=clock_timestamp() OR NEW.profile_id IS DISTINCT FROM (CASE WHEN NEW.catalogue_sha256='287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f' THEN trend_trial_profile_for_slot(NEW.cycle,NEW.ordinal) ELSE demo_trial_profile_for_slot(NEW.cycle,NEW.ordinal) END)
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
 IF TG_OP='UPDATE' AND OLD.state='ACTIVE' AND NEW.state='DRAINING' AND NOT demo_trial_source_handover(NEW.id) AND NEW.market_open_ms<3600000 AND (SELECT count(DISTINCT p.id) FROM demo_trial_contexts dc JOIN order_groups g ON g.context_plan_id=dc.context_id JOIN positions p ON p.order_group_id=g.id JOIN trades tr ON tr.position_id=p.id WHERE dc.trial_id=NEW.id AND p.state='CLOSED')<20 THEN RAISE EXCEPTION 'DEMO_TRIAL_ALLOCATION_INCOMPLETE'; END IF;
 IF NEW.retirement_reason='SOURCE_HANDOVER' AND NOT demo_trial_source_handover(NEW.id) THEN RAISE EXCEPTION 'DEMO_TRIAL_HANDOVER_AUTHORITY_REQUIRED'; END IF;
 IF TG_OP='UPDATE' AND NEW.state='COMPLETED' AND (OLD.state<>'DRAINING' OR NOT demo_trial_can_complete(NEW.id)) THEN RAISE EXCEPTION 'DEMO_TRIAL_TERMINAL_PROOF_REQUIRED'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_demo_trial_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; t demo_trials%ROWTYPE; binding jsonb;
BEGIN
 SELECT * INTO t FROM demo_trials WHERE id=NEW.trial_id;
 SELECT definition INTO p FROM demo_trial_profiles WHERE catalogue_sha256=t.catalogue_sha256 AND profile_id=t.profile_id;
 SELECT split_part(pp.content,E'REGISTERED_DEMO_TRIAL\n',2)::jsonb INTO binding FROM context_provider_evidence ce JOIN provider_prompt_artifacts pp ON pp.content_sha256=ce.prompt_sha256 WHERE ce.context_id=NEW.context_id;
 IF binding IS NULL OR binding->>'trialId' IS DISTINCT FROM t.id::text OR binding->>'sourceSha256' IS DISTINCT FROM t.source_sha256 OR binding->>'catalogueSha256' IS DISTINCT FROM t.catalogue_sha256 OR binding->>'profileId' IS DISTINCT FROM t.profile_id OR binding->>'profileSha256' IS DISTINCT FROM t.profile_sha256 OR binding->'profile' IS DISTINCT FROM p OR binding->>'strategyVersion' IS DISTINCT FROM (SELECT version FROM strategy_versions WHERE id=t.strategy_version_id) OR (binding->>'registeredAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',t.registered_at) OR (binding->>'startsAt')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',t.starts_at)
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

CREATE OR REPLACE FUNCTION guard_demo_trial_context_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version text;
BEGIN
 SELECT v.version INTO version FROM analysis_runs a JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE a.id=NEW.source_analysis_id;
 IF (version IN ('0.10.0-demo-trials.1-codex.1','0.11.0-trend-retest.1-codex.1') AND NOT EXISTS(
      SELECT 1 FROM demo_trial_contexts dc JOIN demo_trials t ON t.id=dc.trial_id
      WHERE dc.context_id=NEW.id AND t.account_id=NEW.account_id AND t.symbol_id=NEW.symbol_id
        AND t.mode=NEW.mode AND t.strategy_version_id=(SELECT strategy_version_id FROM analysis_runs WHERE id=NEW.source_analysis_id)))
    OR (NEW.requested_model='local-range-v1' AND version IS DISTINCT FROM '0.10.0-demo-trials.1-codex.1')
    THEN RAISE EXCEPTION 'SCENARIO_DEMO_TRIAL_AUTHORITY_REQUIRED'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_demo_order_range() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version text;
BEGIN
 SELECT v.version INTO version FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE g.id=NEW.order_group_id;
 IF (TG_OP='UPDATE' AND NEW.entry_range_points IS DISTINCT FROM OLD.entry_range_points)
    OR (version='0.10.0-demo-trials.1-codex.1' AND NEW.entry_range_points IS NULL)
    OR (version='0.11.0-trend-retest.1-codex.1' AND ((NEW.execution_order_type='STOP_LIMIT' AND NEW.entry_range_points IS DISTINCT FROM 30) OR (NEW.execution_order_type='LIMIT' AND NEW.entry_range_points IS NOT NULL) OR NEW.execution_order_type NOT IN ('STOP_LIMIT','LIMIT')))
    OR (version NOT IN ('0.10.0-demo-trials.1-codex.1','0.11.0-trend-retest.1-codex.1') AND NEW.entry_range_points IS NOT NULL)
    THEN RAISE EXCEPTION 'DEMO_TRIAL_ENTRY_RANGE_INVALID'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION validate_trend_geometry(plan jsonb, context jsonb, style text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE frame jsonb; bars jsonb; bar jsonb; m1 jsonb; m5 jsonb; m15 jsonb;
 needed integer; n integer; i integer; period interval; captured timestamptz; previous_end timestamptz;
 tick numeric; high numeric; low numeric; sign numeric; side text; boundary numeric; entry numeric; stop numeric; target numeric; price numeric;
 a numeric; b numeric; c numeric;
BEGIN
 IF style IS NULL OR style NOT IN('BREAKOUT','CONFIRMED_BREAKOUT','RETEST_LIMIT') THEN RAISE EXCEPTION 'TREND_STYLE_INVALID'; END IF;
 tick:=(context->>'tick_size')::numeric; captured:=(context->>'captured_at')::timestamptz;
 IF tick IS NULL OR tick<=0 OR captured IS NULL THEN RAISE EXCEPTION 'TREND_METADATA_INVALID'; END IF;
 FOREACH side IN ARRAY ARRAY['M1','M5','M15'] LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(context->'candles') f WHERE f->>'timeframe'=side)<>1 THEN RAISE EXCEPTION 'TREND_HISTORY_INVALID'; END IF;
   SELECT f INTO frame FROM jsonb_array_elements(context->'candles') f WHERE f->>'timeframe'=side;
   bars:=frame->'rows'; n:=jsonb_array_length(bars); needed:=CASE WHEN side='M1' THEN 6 ELSE 12 END;
   period:=CASE side WHEN 'M1' THEN interval '1 minute' WHEN 'M5' THEN interval '5 minutes' ELSE interval '15 minutes' END;
   IF n IS NULL OR n<needed THEN RAISE EXCEPTION 'TREND_HISTORY_INVALID'; END IF;
   previous_end:=NULL;
   FOR i IN n-needed..n-1 LOOP
     bar:=bars->i;
     IF NOT COALESCE(bar->7='true'::jsonb AND bar->8='[]'::jsonb AND (bar->>1)::timestamptz-(bar->>0)::timestamptz=period
       AND (bar->>1)::timestamptz<=captured AND (previous_end IS NULL OR previous_end=(bar->>0)::timestamptz)
       AND (bar->>4)::numeric>0 AND (bar->>3)::numeric>=GREATEST((bar->>2)::numeric,(bar->>5)::numeric,(bar->>4)::numeric)
       AND (bar->>4)::numeric<=LEAST((bar->>2)::numeric,(bar->>5)::numeric)
       AND mod((bar->>2)::numeric,tick)=0 AND mod((bar->>3)::numeric,tick)=0 AND mod((bar->>4)::numeric,tick)=0 AND mod((bar->>5)::numeric,tick)=0,false)
       THEN RAISE EXCEPTION 'TREND_HISTORY_INVALID'; END IF;
     previous_end:=(bar->>1)::timestamptz;
   END LOOP;
   IF captured-previous_end>period THEN RAISE EXCEPTION 'TREND_HISTORY_STALE'; END IF;
   CASE side WHEN 'M1' THEN m1:=bars; WHEN 'M5' THEN m5:=bars; ELSE m15:=bars; END CASE;
 END LOOP;
 n:=jsonb_array_length(m5); a:=(m5->(n-3)->>5)::numeric; b:=(m5->(n-2)->>5)::numeric; c:=(m5->(n-1)->>5)::numeric;
 IF a<b AND b<c THEN side:='BUY'; sign:=1; ELSIF a>b AND b>c THEN side:='SELL'; sign:=-1; ELSE RAISE EXCEPTION 'TREND_DIRECTION_INVALID'; END IF;
 n:=jsonb_array_length(m1);
 SELECT min((v->>4)::numeric),max((v->>3)::numeric) INTO low,high FROM jsonb_array_elements(m1) WITH ORDINALITY x(v,ord)
 WHERE CASE WHEN style='BREAKOUT' THEN ord>n-5 ELSE ord>n-6 AND ord<=n-1 END;
 boundary:=CASE WHEN side='BUY' THEN high ELSE low END; bar:=m1->(n-1);
 IF style<>'BREAKOUT' AND ((bar->>5)::numeric-boundary)*sign<tick THEN RAISE EXCEPTION 'TREND_CONFIRMATION_REQUIRED'; END IF;
 entry:=CASE WHEN style='RETEST_LIMIT' THEN boundary WHEN style='CONFIRMED_BREAKOUT' THEN (bar->>CASE WHEN side='BUY' THEN 3 ELSE 4 END)::numeric+tick*sign ELSE boundary+tick*sign END;
 stop:=CASE WHEN side='BUY' THEN low ELSE high END;
 FOREACH bars IN ARRAY ARRAY[m5,m15] LOOP
   n:=jsonb_array_length(bars);
   FOR i IN n-11..n-2 LOOP
     price:=(bars->i->>CASE WHEN side='BUY' THEN 3 ELSE 4 END)::numeric;
     a:=(bars->(i-1)->>CASE WHEN side='BUY' THEN 3 ELSE 4 END)::numeric;
     c:=(bars->(i+1)->>CASE WHEN side='BUY' THEN 3 ELSE 4 END)::numeric;
     IF (price-a)*sign>0 AND (price-c)*sign>0 AND (price-entry)*sign>0 AND (target IS NULL OR abs(price-entry)<abs(target-entry)) THEN target:=price; END IF;
   END LOOP;
 END LOOP;
 IF target IS NULL OR (entry-stop)*sign<=0 OR abs(entry-stop)>7 OR abs(target-entry)>7 OR abs(target-entry)<abs(entry-stop)
   OR plan->>'entry_side' IS DISTINCT FROM side OR (plan->>CASE WHEN side='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric IS DISTINCT FROM entry
   OR (plan->>'stop_loss')::numeric IS DISTINCT FROM stop OR (plan->>'take_profit')::numeric IS DISTINCT FROM target
   THEN RAISE EXCEPTION 'TREND_GEOMETRY_MISMATCH'; END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_trend_trial_group(candidate order_groups, plan jsonb, operation text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t demo_trials%ROWTYPE; profile jsonb; low numeric; high numeric; tick numeric; context jsonb; selected text; reg_model text; expected_mode text;
BEGIN
 SELECT tr.* INTO t FROM demo_trial_contexts dc JOIN demo_trials tr ON tr.id=dc.trial_id WHERE dc.context_id=candidate.context_plan_id;
 SELECT definition INTO profile FROM demo_trial_profiles WHERE catalogue_sha256=t.catalogue_sha256 AND profile_id=t.profile_id;
 SELECT ce.request_text::jsonb,c.requested_model INTO context,reg_model FROM context_provider_evidence ce JOIN scenario_contexts c ON c.id=ce.context_id WHERE c.id=candidate.context_plan_id;
 selected:=plan->>'entry_side';tick:=(context->>'tick_size')::numeric;
 expected_mode:=CASE WHEN profile->>'entryStyle'='RETEST_LIMIT' THEN 'SINGLE_LIMIT' ELSE 'SINGLE_STOP_LIMIT' END;
 IF t.id IS NULL OR profile IS NULL OR t.catalogue_sha256 IS DISTINCT FROM '287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f' OR NOT EXISTS(SELECT 1 FROM strategy_versions WHERE id=t.strategy_version_id AND version='0.11.0-trend-retest.1-codex.1') OR candidate.mode<>'demo' OR candidate.execution_mode IS DISTINCT FROM expected_mode
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
    OR NOT EXISTS(SELECT 1 FROM context_provider_evidence ce JOIN provider_prompt_artifacts pp ON pp.content_sha256=ce.prompt_sha256 WHERE ce.context_id=candidate.context_plan_id AND pp.version='entry-scalp-v4')
    THEN RAISE EXCEPTION 'SCALP_GROUP_AUTHORITY_INVALID'; END IF;
 PERFORM validate_trend_geometry(plan,context,profile->>'entryStyle');
 IF operation='INSERT' THEN
   -- Lock mode before head, matching intent and controller lock order.
   PERFORM 1 FROM entry_mode_settings WHERE account_id=t.account_id AND symbol_id=t.symbol_id AND environment='demo' FOR UPDATE;
   PERFORM 1 FROM demo_trial_heads WHERE account_id=t.account_id AND symbol_id=t.symbol_id AND mode='demo' FOR UPDATE;
   SELECT tr.* INTO t FROM demo_trials tr WHERE tr.id=t.id;
   IF t.state<>'ACTIVE' OR t.market_open_ms>=3600000 OR candidate.expires_at<=clock_timestamp()
      OR NOT EXISTS(SELECT 1 FROM demo_trial_heads h WHERE h.trial_id=t.id AND h.account_id=t.account_id AND h.symbol_id=t.symbol_id AND h.mode='demo')
      OR NOT EXISTS(SELECT 1 FROM entry_mode_settings s WHERE s.account_id=t.account_id AND s.symbol_id=t.symbol_id AND s.environment='demo' AND s.entry_mode=expected_mode AND s.revision=t.mode_revision)
      OR (SELECT count(*) FROM trades tr JOIN order_groups g ON g.id=tr.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=t.id)>=20
      THEN RAISE EXCEPTION 'SCALP_TRIAL_REFRESH_REQUIRED'; END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_trend_trial_order(candidate orders, plan jsonb, selected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE profile jsonb; aid uuid;
BEGIN
 SELECT p.definition,t.account_id INTO profile,aid FROM order_groups g JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id JOIN demo_trials t ON t.id=dc.trial_id JOIN demo_trial_profiles p ON p.catalogue_sha256=t.catalogue_sha256 AND p.profile_id=t.profile_id WHERE g.id=candidate.order_group_id;
 IF profile IS NULL OR candidate.strategy_label IS DISTINCT FROM 'ctrader-ai-scalper:0.11.0-trend-retest.1-codex.1' OR candidate.side IS DISTINCT FROM selected OR NOT candidate.strategy_owned OR candidate.account_id IS DISTINCT FROM aid
   OR candidate.time_in_force IS DISTINCT FROM 'GTD' OR candidate.execution_order_type IS DISTINCT FROM (CASE WHEN profile->>'entryStyle'='RETEST_LIMIT' THEN 'LIMIT' ELSE 'STOP_LIMIT' END)
   OR candidate.entry_price IS DISTINCT FROM (plan->>CASE WHEN selected='BUY' THEN 'buy_stop' ELSE 'sell_stop' END)::numeric
   OR candidate.stop_loss IS DISTINCT FROM (plan->>'stop_loss')::numeric OR candidate.take_profit IS DISTINCT FROM (plan->>'take_profit')::numeric
   OR abs(candidate.take_profit-candidate.entry_price)>7 OR abs(candidate.take_profit-candidate.entry_price)<abs(candidate.stop_loss-candidate.entry_price)
   OR abs(candidate.stop_loss-candidate.entry_price)>7
   OR candidate.expires_at IS DISTINCT FROM (plan->>'valid_until')::timestamptz OR candidate.submission_valid_until IS DISTINCT FROM candidate.expires_at
   OR candidate.entry_range_points IS DISTINCT FROM NULLIF((profile->>'entryRangePoints')::integer,0)
   OR (CASE WHEN selected='BUY' THEN NOT(candidate.stop_loss<candidate.entry_price AND candidate.take_profit>candidate.entry_price) ELSE NOT(candidate.take_profit<candidate.entry_price AND candidate.stop_loss>candidate.entry_price) END)
   THEN RAISE EXCEPTION 'SCALP_ORDER_AUTHORITY_INVALID'; END IF;
END $$;

CREATE OR REPLACE FUNCTION guard_directional_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; aid uuid; sid uuid; current_mode text; current_revision uuid; single_mode boolean; limit_mode boolean;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.entry_side IS DISTINCT FROM OLD.entry_side OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode OR NEW.mode_revision IS DISTINCT FROM OLD.mode_revision OR (OLD.execution_mode IS NOT NULL AND (NEW.analysis_id IS DISTINCT FROM OLD.analysis_id OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.time_in_force IS DISTINCT FROM OLD.time_in_force)) OR ((OLD.entry_side IS NOT NULL OR OLD.execution_mode IS NOT NULL) AND NEW.context_plan_id IS DISTINCT FROM OLD.context_plan_id)) THEN RAISE EXCEPTION 'DIRECTIONAL_GROUP_AUTHORITY_IMMUTABLE'; END IF;
 SELECT account_id,symbol_id INTO aid,sid FROM analysis_runs WHERE id=NEW.analysis_id;
 SELECT plan INTO p FROM scenario_contexts WHERE id=NEW.context_plan_id AND state='READY' AND account_id=aid AND symbol_id=sid AND mode=NEW.mode;
 IF EXISTS(SELECT 1 FROM analysis_runs a JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE a.id=NEW.analysis_id AND v.version='0.11.0-trend-retest.1-codex.1') THEN PERFORM validate_trend_trial_group(NEW,p,TG_OP); RETURN NEW; END IF;
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
 IF EXISTS(SELECT 1 FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id JOIN strategy_versions v ON v.id=a.strategy_version_id WHERE g.id=NEW.order_group_id AND v.version='0.11.0-trend-retest.1-codex.1') THEN PERFORM validate_trend_trial_order(NEW,p,s); RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION demo_trial_review(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
 'closedPositions',count(DISTINCT tr.position_id)::integer,
 'observedNet',sum(tr.realized_pnl)::text,
 'interpretation',CASE WHEN count(tr.id)=0 THEN 'NO_CLOSED_SAMPLE' WHEN sum(tr.realized_pnl)>0 THEN 'POSITIVE_OBSERVED_NET_UNQUALIFIED' ELSE 'NONPOSITIVE_OBSERVED_NET_UNQUALIFIED' END,
 'waits',(SELECT count(*)::integer FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id WHERE dc.trial_id=target AND c.plan->>'schema_version'='entry-wait-1.0'),
 'failedProposals',(SELECT count(*)::integer FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id WHERE dc.trial_id=target AND c.state='FAILED'),
 'incompleteContexts',(SELECT count(*)::integer FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id WHERE dc.trial_id=target AND c.state='REQUESTING'),
 'nextProfileId',(SELECT CASE WHEN t.retirement_reason='SOURCE_HANDOVER' THEN trend_trial_profile_for_slot(t.cycle+1,0) WHEN t.catalogue_sha256='287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f' THEN trend_trial_profile_for_slot(t.cycle+CASE WHEN t.ordinal=3 THEN 1 ELSE 0 END,(t.ordinal+1)%4) ELSE demo_trial_profile_for_slot(t.cycle+CASE WHEN t.ordinal=12 THEN 1 ELSE 0 END,(t.ordinal+1)%13) END FROM demo_trials t WHERE t.id=target))
 FROM trades tr JOIN order_groups g ON g.id=tr.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=target;
$$;

CREATE OR REPLACE FUNCTION guard_demo_trial_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'DEMO_TRIAL_HEAD_IMMUTABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM demo_trials t WHERE t.id=NEW.trial_id AND t.account_id=NEW.account_id AND t.symbol_id=NEW.symbol_id AND t.mode=NEW.mode AND t.state='ACTIVE')
   THEN RAISE EXCEPTION 'DEMO_TRIAL_HEAD_SCOPE_INVALID'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.account_id,NEW.symbol_id,NEW.mode) IS DISTINCT FROM (OLD.account_id,OLD.symbol_id,OLD.mode)
   OR NOT EXISTS(SELECT 1 FROM demo_trials t WHERE t.id=OLD.trial_id AND t.state='COMPLETED'))
   THEN RAISE EXCEPTION 'DEMO_TRIAL_HEAD_TRANSITION_INVALID'; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM demo_trials o JOIN demo_trials n ON n.id=NEW.trial_id WHERE o.id=OLD.trial_id AND (o.source_sha256,o.catalogue_sha256,o.strategy_version_id) IS DISTINCT FROM (n.source_sha256,n.catalogue_sha256,n.strategy_version_id)) THEN
   IF NOT demo_trial_source_handover(OLD.trial_id) OR NOT EXISTS(
     SELECT 1 FROM demo_trials o JOIN demo_trials n ON n.id=NEW.trial_id
     JOIN strategy_versions v ON v.id=n.strategy_version_id
     JOIN demo_trial_events e ON e.trial_id=o.id AND e.kind='SOURCE_HANDOVER_REQUESTED'
     WHERE o.id=OLD.trial_id AND e.details->>'toSourceSha256'=n.source_sha256
       AND e.details->>'toCatalogueSha256'=n.catalogue_sha256 AND e.details->>'toStrategyVersion'=v.version
       AND n.cycle=o.cycle+1 AND n.ordinal=0 AND n.registered_at>=o.completed_at
       AND (SELECT count(*) FROM demo_trial_events x WHERE x.trial_id=o.id AND x.kind='SOURCE_HANDOVER_REQUESTED')=1
   ) THEN RAISE EXCEPTION 'DEMO_TRIAL_HANDOVER_TARGET_INVALID'; END IF;
 END IF;
 RETURN NEW;
END $$;
