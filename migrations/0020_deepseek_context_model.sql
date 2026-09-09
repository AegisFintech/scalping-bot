-- Add the operator-selected DeepSeek route without rewriting prior provider history.
-- Keep this additive constraint on rollback; old builds still require their own pin.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE scenario_contexts DROP CONSTRAINT scenario_contexts_requested_model_check;
ALTER TABLE scenario_contexts ADD CONSTRAINT scenario_contexts_requested_model_check
  CHECK (requested_model IN ('gpt-6-astra/u64', 'gpt-5.6-sol/u40', 'deepseek-v4-pro/u5W')) NOT VALID;
ALTER TABLE scenario_contexts VALIDATE CONSTRAINT scenario_contexts_requested_model_check;
