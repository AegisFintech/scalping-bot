-- Exact-source clock repair only. Preserve prior registrations and terminal-proof gates.
CREATE OR REPLACE FUNCTION demo_trial_source_handover(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM demo_trials t JOIN strategy_versions v ON v.id=t.strategy_version_id JOIN demo_trial_events e ON e.trial_id=t.id
 WHERE t.id=target AND (
   (v.version='0.10.0-demo-trials.1-codex.1' AND t.source_sha256='39588e8734f9f0b3d952ffeec2f7f1906417bd8e7b66824cc220e73e8e21848b')
   OR (v.version='0.11.0-trend-retest.1-codex.1' AND t.source_sha256='de2eead48727bcd55815648f0952c7353ef58380b3083f569add66a0ebeda143'
       AND t.catalogue_sha256='287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f'))
 AND e.kind='SOURCE_HANDOVER_REQUESTED' AND e.details->>'fromSourceSha256'=t.source_sha256
 AND e.details->>'toSourceSha256' ~ '^[a-f0-9]{64}$' AND e.details->>'toSourceSha256'<>t.source_sha256
 AND e.details->>'toStrategyVersion'='0.11.0-trend-retest.1-codex.1' AND e.details->>'toCatalogueSha256'='287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f')
$$;
