-- ISSUE-303: admit the subscription transport without rewriting historical identities.
ALTER TABLE scenario_contexts DROP CONSTRAINT scenario_contexts_requested_model_check;
ALTER TABLE scenario_contexts ADD CONSTRAINT scenario_contexts_requested_model_check
  CHECK (requested_model IN (
    'gpt-6-astra/u64', 'gpt-5.6-sol/u40', 'deepseek-v4-pro/u5W', 'grok-4.5', 'gpt-6.1-sol'
  )) NOT VALID;
ALTER TABLE scenario_contexts VALIDATE CONSTRAINT scenario_contexts_requested_model_check;
