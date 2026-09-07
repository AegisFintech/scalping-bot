-- Additive context journal; legacy model responses and broker lifecycles remain intact.
CREATE TABLE scenario_contexts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  source_analysis_id uuid NOT NULL REFERENCES analysis_runs(id),
  mode text NOT NULL CHECK (mode IN ('paper','demo','shadow')),
  requested_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  available_at timestamptz,
  completed_at timestamptz,
  duration_ms integer CHECK (duration_ms >= 0),
  state text NOT NULL CHECK (state IN ('REQUESTING','READY','FAILED')),
  requested_model text NOT NULL CHECK (requested_model = 'gpt-6-astra/u64'),
  tick_size text NOT NULL,
  plan jsonb,
  telemetry jsonb,
  reason text,
  CHECK (valid_until = captured_at + interval '5 minutes'),
  CHECK ((state = 'READY') = (plan IS NOT NULL AND available_at IS NOT NULL))
);
CREATE INDEX scenario_context_latest ON scenario_contexts(account_id,symbol_id,mode,requested_at DESC);
ALTER TABLE model_requests ADD COLUMN context_plan_id uuid REFERENCES scenario_contexts(id);
ALTER TABLE model_requests ADD COLUMN decision_source text NOT NULL DEFAULT 'PROVIDER'
  CHECK (decision_source IN ('PROVIDER','DETERMINISTIC_PLAN'));
ALTER TABLE model_requests ADD CONSTRAINT model_context_source_consistent
  CHECK ((decision_source = 'DETERMINISTIC_PLAN') = (context_plan_id IS NOT NULL));
ALTER TABLE order_groups ADD COLUMN context_plan_id uuid UNIQUE REFERENCES scenario_contexts(id);
ALTER TABLE analysis_runs DROP CONSTRAINT analysis_runs_state_check;
ALTER TABLE analysis_runs ADD CONSTRAINT analysis_runs_state_check CHECK
  (state IN ('PENDING','COLLECTING','FEATURED','MODEL_PENDING','VALIDATING','ACCEPTED','REJECTED','EXPIRED','DEFERRED'));
ALTER TABLE analysis_runs ADD COLUMN deferral_reason text CHECK (deferral_reason ~ '^SCENARIO_[A-Z_]{1,120}$');
CREATE TABLE scenario_decision_intervals (
  account_id uuid NOT NULL REFERENCES accounts(id), symbol_id uuid NOT NULL REFERENCES symbols(id),
  interval_start timestamptz NOT NULL, broker_server_time timestamptz NOT NULL,
  cycle_id uuid, analysis_id uuid REFERENCES analysis_runs(id),
  outcome text CHECK (outcome IN ('PLACED','REJECTED','DEFERRED')),
  claimed_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  PRIMARY KEY(account_id,symbol_id,interval_start),
  CHECK (mod(extract(epoch FROM interval_start)::numeric,5)=0),
  CHECK (broker_server_time >= interval_start AND broker_server_time < interval_start+interval '5 seconds'),
  CHECK ((cycle_id IS NULL)=(outcome IS NULL)),
  CHECK ((completed_at IS NULL)=(outcome IS NULL)),
  CHECK (analysis_id IS NULL OR analysis_id=cycle_id),
  CHECK (completed_at IS NULL OR completed_at >= claimed_at)
);
