CREATE TABLE model_call_telemetry (
  model_request_id uuid PRIMARY KEY REFERENCES model_requests(id),
  telemetry jsonb NOT NULL CHECK (jsonb_typeof(telemetry) = 'object'
    AND octet_length(telemetry::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_failures (
  analysis_id uuid PRIMARY KEY REFERENCES analysis_runs(id),
  requested_model text NOT NULL,
  reason text NOT NULL CHECK (reason ~ '^[A-Z0-9_:]{1,160}$'),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  telemetry jsonb CHECK (telemetry IS NULL OR (jsonb_typeof(telemetry) = 'object' AND octet_length(telemetry::text) <= 4096)),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Account-scoped, cash-flow-adjusted high water. No automatic risk reset on restart.
CREATE TABLE capital_risk_state (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  reference_equity numeric(30,10) NOT NULL CHECK (reference_equity > 0),
  high_water_equity numeric(30,10) NOT NULL CHECK (high_water_equity > 0),
  adjusted_equity numeric(30,10) NOT NULL CHECK (adjusted_equity >= 0),
  cumulative_net_flows numeric(30,10) NOT NULL,
  drawdown_percent numeric(12,8) NOT NULL CHECK (drawdown_percent >= 0),
  risk_multiplier numeric(12,8) NOT NULL CHECK (risk_multiplier IN (0, 0.25, 0.5, 1)),
  locked_out boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE capital_risk_state IS
  'Conservative-v1 flow-adjusted drawdown; 5 percent lockout is sticky and requires operator review.';
