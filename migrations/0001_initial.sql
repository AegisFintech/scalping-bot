CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'ctrader' CHECK (provider = 'ctrader'),
  provider_account_key_hash text NOT NULL CHECK (length(provider_account_key_hash) BETWEEN 32 AND 128),
  environment text NOT NULL CHECK (environment IN ('demo', 'live')),
  account_type text NOT NULL CHECK (account_type IN ('demo', 'live')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3,8}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_key_hash, environment)
);

CREATE TABLE symbols (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  provider_symbol_id text NOT NULL,
  name text NOT NULL CHECK (name ~ '^[A-Z0-9._-]{1,32}$'),
  digits smallint NOT NULL CHECK (digits BETWEEN 0 AND 10),
  tick_size numeric(30,10) NOT NULL CHECK (tick_size > 0),
  tick_value numeric(30,10) CHECK (tick_value > 0),
  contract_size numeric(30,10) CHECK (contract_size > 0),
  min_volume numeric(30,10) CHECK (min_volume > 0),
  max_volume numeric(30,10) CHECK (max_volume >= min_volume),
  volume_step numeric(30,10) CHECK (volume_step > 0),
  min_stop_distance numeric(30,10) CHECK (min_stop_distance >= 0),
  metadata_revision text NOT NULL,
  metadata_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider_symbol_id)
);

CREATE TABLE strategy_versions (
  id uuid PRIMARY KEY,
  version text NOT NULL UNIQUE,
  code_hash text NOT NULL,
  config_hash text NOT NULL,
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  feature_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text CHECK (length(notes) <= 2000)
);

CREATE TABLE candle_snapshots (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  analysis_time timestamptz NOT NULL,
  server_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  max_skew_ms integer NOT NULL CHECK (max_skew_ms >= 0),
  complete boolean NOT NULL,
  quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quality_flags) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, symbol_id, analysis_time)
);

CREATE TABLE candles (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES candle_snapshots(id) ON DELETE CASCADE,
  timeframe text NOT NULL CHECK (timeframe IN ('M1', 'M5', 'M15')),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL CHECK (end_time > start_time),
  open numeric(30,10) NOT NULL CHECK (open > 0),
  high numeric(30,10) NOT NULL CHECK (high > 0),
  low numeric(30,10) NOT NULL CHECK (low > 0),
  close numeric(30,10) NOT NULL CHECK (close > 0),
  volume numeric(30,10) CHECK (volume >= 0),
  complete boolean NOT NULL,
  quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quality_flags) = 'array'),
  CHECK (high >= open AND high >= close AND high >= low),
  CHECK (low <= open AND low <= close),
  UNIQUE (snapshot_id, timeframe, start_time)
);

CREATE TABLE indicator_snapshots (
  id uuid PRIMARY KEY,
  candle_snapshot_id uuid NOT NULL REFERENCES candle_snapshots(id) ON DELETE CASCADE,
  feature_version text NOT NULL,
  generated_at timestamptz NOT NULL,
  atr numeric(30,10),
  ema_fast numeric(30,10),
  ema_slow numeric(30,10),
  features jsonb NOT NULL CHECK (jsonb_typeof(features) = 'object'),
  acceptable boolean NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rejection_reasons) = 'array'),
  UNIQUE (candle_snapshot_id, feature_version)
);

CREATE TABLE order_book_snapshots (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  candle_snapshot_id uuid REFERENCES candle_snapshots(id),
  source_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  age_ms integer NOT NULL CHECK (age_ms >= 0),
  bid numeric(30,10) CHECK (bid > 0),
  ask numeric(30,10) CHECK (ask > 0),
  spread numeric(30,10) CHECK (spread >= 0),
  weighted_mid numeric(30,10),
  microprice numeric(30,10),
  imbalance_top5 numeric(12,8) CHECK (imbalance_top5 BETWEEN -1 AND 1),
  imbalance_top10 numeric(12,8) CHECK (imbalance_top10 BETWEEN -1 AND 1),
  imbalance_top20 numeric(12,8) CHECK (imbalance_top20 BETWEEN -1 AND 1),
  complete boolean NOT NULL,
  discontinuity boolean NOT NULL DEFAULT false,
  reconnect_sequence integer NOT NULL DEFAULT 0 CHECK (reconnect_sequence >= 0),
  aggregates jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(aggregates) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ask IS NULL OR bid IS NULL OR ask >= bid)
);

CREATE TABLE order_book_levels (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES order_book_snapshots(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('BID', 'ASK')),
  level_index smallint NOT NULL CHECK (level_index BETWEEN 1 AND 100),
  price numeric(30,10) NOT NULL CHECK (price > 0),
  size numeric(30,10) NOT NULL CHECK (size >= 0),
  quote_id text,
  UNIQUE (snapshot_id, side, level_index)
);

CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  candle_snapshot_id uuid REFERENCES candle_snapshots(id),
  order_book_snapshot_id uuid REFERENCES order_book_snapshots(id),
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  mode text NOT NULL CHECK (mode IN ('replay', 'backtest', 'paper', 'demo', 'shadow', 'live')),
  state text NOT NULL CHECK (state IN ('PENDING', 'COLLECTING', 'FEATURED', 'MODEL_PENDING', 'VALIDATING', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  analysis_time timestamptz NOT NULL,
  valid_until timestamptz,
  eligibility_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(eligibility_reasons) = 'array'),
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rejection_reasons) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_analysis_per_symbol
  ON analysis_runs (account_id, symbol_id)
  WHERE state IN ('PENDING', 'COLLECTING', 'FEATURED', 'MODEL_PENDING', 'VALIDATING', 'ACCEPTED');

CREATE TABLE model_requests (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  request_id text NOT NULL UNIQUE,
  api_style text NOT NULL CHECK (api_style IN ('responses', 'chat_completions')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  payload_mode text NOT NULL CHECK (payload_mode IN ('full', 'compact')),
  payload_redacted jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CIRCUIT_OPEN')),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms integer CHECK (duration_ms >= 0),
  CHECK (octet_length(payload_redacted::text) <= 4194304)
);

CREATE TABLE model_responses (
  id uuid PRIMARY KEY,
  model_request_id uuid NOT NULL UNIQUE REFERENCES model_requests(id) ON DELETE CASCADE,
  provider_response_id text,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'REFUSED', 'INCOMPLETE', 'FAILED', 'OVERSIZED')),
  raw_redacted text CHECK (octet_length(raw_redacted) <= 1048576),
  parsed_payload jsonb,
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  received_at timestamptz NOT NULL,
  CHECK (parsed_payload IS NULL OR jsonb_typeof(parsed_payload) = 'object')
);

CREATE TABLE validation_results (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  model_response_id uuid REFERENCES model_responses(id),
  stage text NOT NULL CHECK (stage IN ('SCHEMA', 'SEMANTIC', 'RISK', 'LIVE_GATE')),
  accepted boolean NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  validated_at timestamptz NOT NULL,
  CHECK (octet_length(details::text) <= 65536)
);

CREATE TABLE risk_decisions (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  approved boolean NOT NULL,
  equity numeric(30,10),
  risk_percent numeric(8,5) CHECK (risk_percent BETWEEN 0 AND 5),
  risk_budget numeric(30,10) CHECK (risk_budget >= 0),
  entry_price numeric(30,10),
  stop_loss numeric(30,10),
  stop_distance numeric(30,10),
  raw_volume numeric(30,10),
  normalized_volume numeric(30,10),
  estimated_margin numeric(30,10),
  spread_points numeric(30,10),
  spread_atr_ratio numeric(20,10),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  decided_at timestamptz NOT NULL,
  UNIQUE (analysis_id, side),
  CHECK (raw_volume IS NULL OR normalized_volume IS NULL OR normalized_volume <= raw_volume)
);

CREATE TABLE order_groups (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL UNIQUE REFERENCES analysis_runs(id),
  idempotency_key text NOT NULL UNIQUE,
  mode text NOT NULL CHECK (mode IN ('backtest', 'paper', 'demo', 'shadow', 'live')),
  state text NOT NULL CHECK (state IN ('INTENT_RECORDED', 'SUBMITTING', 'ACTIVE', 'ONE_FILLED', 'CANCELLING_PEER', 'POSITION_OPEN', 'RECONCILIATION_REQUIRED', 'CLOSED', 'EXPIRED', 'FAILED')),
  expires_at timestamptz NOT NULL,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  order_group_id uuid NOT NULL REFERENCES order_groups(id),
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type text NOT NULL CHECK (order_type = 'STOP'),
  state text NOT NULL CHECK (state IN ('INTENT', 'SUBMITTING', 'PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'EXPIRED', 'REJECTED', 'UNKNOWN')),
  client_order_id text NOT NULL UNIQUE,
  broker_order_id text,
  strategy_owned boolean NOT NULL DEFAULT true,
  strategy_label text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  entry_price numeric(30,10) NOT NULL CHECK (entry_price > 0),
  stop_loss numeric(30,10) NOT NULL CHECK (stop_loss > 0),
  take_profit numeric(30,10) NOT NULL CHECK (take_profit > 0),
  requested_volume numeric(30,10) NOT NULL CHECK (requested_volume > 0),
  normalized_volume numeric(30,10) NOT NULL CHECK (normalized_volume > 0 AND normalized_volume <= requested_volume),
  filled_volume numeric(30,10) NOT NULL DEFAULT 0 CHECK (filled_volume >= 0 AND filled_volume <= normalized_volume),
  expires_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_group_id, side)
);

CREATE UNIQUE INDEX unique_broker_order_id ON orders (broker_order_id) WHERE broker_order_id IS NOT NULL;

CREATE TABLE fills (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  broker_event_key text NOT NULL UNIQUE,
  broker_fill_id text,
  price numeric(30,10) NOT NULL CHECK (price > 0),
  volume numeric(30,10) NOT NULL CHECK (volume > 0),
  commission numeric(30,10) NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL
);

CREATE TABLE positions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  order_group_id uuid REFERENCES order_groups(id),
  broker_position_id text,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  state text NOT NULL CHECK (state IN ('OPEN', 'CLOSING', 'CLOSED', 'UNKNOWN', 'RECONCILIATION_PENDING')),
  strategy_owned boolean NOT NULL DEFAULT false,
  volume numeric(30,10) NOT NULL CHECK (volume >= 0),
  entry_price numeric(30,10) CHECK (entry_price > 0),
  stop_loss numeric(30,10),
  take_profit numeric(30,10),
  unrealized_pnl numeric(30,10),
  reconciliation_version integer NOT NULL DEFAULT 0 CHECK (reconciliation_version >= 0),
  opened_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX unique_broker_position_id ON positions (broker_position_id) WHERE broker_position_id IS NOT NULL;

CREATE TABLE trades (
  id uuid PRIMARY KEY,
  order_group_id uuid NOT NULL UNIQUE REFERENCES order_groups(id),
  position_id uuid REFERENCES positions(id),
  mode text NOT NULL CHECK (mode IN ('backtest', 'paper', 'demo', 'shadow', 'live')),
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  setup_tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(setup_tags) = 'array'),
  market_regime text NOT NULL,
  confidence_bucket text NOT NULL,
  realized_pnl numeric(30,10) NOT NULL,
  fees numeric(30,10) NOT NULL DEFAULT 0,
  risk_reward_realized numeric(20,10),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL CHECK (closed_at >= opened_at),
  model_version text NOT NULL,
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  strategy_version text NOT NULL
);

CREATE TABLE session_statistics (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  mode text NOT NULL,
  session_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL CHECK (window_end > window_start),
  trade_count integer NOT NULL CHECK (trade_count >= 0),
  realized_pnl numeric(30,10) NOT NULL,
  unrealized_pnl numeric(30,10) NOT NULL,
  win_rate numeric(12,8),
  profit_factor numeric(20,10),
  expectancy numeric(30,10),
  average_win numeric(30,10),
  average_loss numeric(30,10),
  drawdown numeric(30,10),
  consecutive_wins integer NOT NULL DEFAULT 0,
  consecutive_losses integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL,
  UNIQUE (account_id, symbol_id, mode, session_key, window_start)
);

CREATE TABLE setup_statistics (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  mode text NOT NULL,
  setup_key text NOT NULL,
  dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
  sample_size integer NOT NULL CHECK (sample_size >= 0),
  effective_sample_size numeric(20,10) NOT NULL CHECK (effective_sample_size >= 0),
  win_rate numeric(12,8),
  profit_factor numeric(20,10),
  expectancy numeric(30,10),
  confidence_adjustment integer NOT NULL DEFAULT 0 CHECK (confidence_adjustment BETWEEN -100 AND 0),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  computed_at timestamptz NOT NULL,
  UNIQUE (account_id, symbol_id, mode, setup_key, window_end)
);

CREATE TABLE daily_risk_state (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  trading_day date NOT NULL,
  timezone text NOT NULL,
  baseline_equity numeric(30,10) NOT NULL CHECK (baseline_equity > 0),
  current_equity numeric(30,10) NOT NULL CHECK (current_equity >= 0),
  realized_pnl numeric(30,10) NOT NULL DEFAULT 0,
  unrealized_pnl numeric(30,10) NOT NULL DEFAULT 0,
  loss_percent numeric(12,8) NOT NULL DEFAULT 0 CHECK (loss_percent >= 0),
  locked_out boolean NOT NULL DEFAULT false,
  lockout_reason text,
  locked_at timestamptz,
  reconciled_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, trading_day, timezone)
);

CREATE TABLE service_health (
  id uuid PRIMARY KEY,
  service text NOT NULL,
  instance_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('STARTING', 'READY', 'DEGRADED', 'NOT_READY', 'STOPPING')),
  dependency_status jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dependency_status) = 'object'),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  heartbeat_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  UNIQUE (service, instance_id)
);

CREATE TABLE server_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  cpu_percent numeric(8,4),
  load_1 numeric(12,4),
  load_5 numeric(12,4),
  load_15 numeric(12,4),
  memory_used_bytes bigint CHECK (memory_used_bytes >= 0),
  memory_available_bytes bigint CHECK (memory_available_bytes >= 0),
  swap_used_bytes bigint CHECK (swap_used_bytes >= 0),
  disk_used_bytes bigint CHECK (disk_used_bytes >= 0),
  disk_available_bytes bigint CHECK (disk_available_bytes >= 0),
  network_in_bytes bigint CHECK (network_in_bytes >= 0),
  network_out_bytes bigint CHECK (network_out_bytes >= 0),
  process_cpu_percent numeric(8,4),
  process_memory_bytes bigint CHECK (process_memory_bytes >= 0)
);

CREATE INDEX server_metrics_instance_time ON server_metrics (instance_id, captured_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  severity text NOT NULL CHECK (severity IN ('debug', 'info', 'warn', 'error', 'fatal')),
  service text NOT NULL,
  instance_id text NOT NULL,
  environment text NOT NULL,
  trading_mode text NOT NULL,
  trace_id text,
  request_id text,
  analysis_id uuid REFERENCES analysis_runs(id),
  order_group_id uuid REFERENCES order_groups(id),
  client_order_id text,
  broker_order_id text,
  symbol text,
  account_key text,
  event_name text NOT NULL,
  outcome text NOT NULL,
  reason_code text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  schema_version text,
  model_version text,
  duration_ms integer CHECK (duration_ms >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  CHECK (octet_length(details::text) <= 65536)
);

CREATE INDEX audit_events_occurred_at ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_analysis ON audit_events (analysis_id) WHERE analysis_id IS NOT NULL;

CREATE TABLE runtime_controls (
  id uuid PRIMARY KEY,
  control_key text NOT NULL,
  scope text NOT NULL,
  enabled boolean NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(value) = 'object'),
  actor text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX one_active_runtime_control
  ON runtime_controls (control_key, scope)
  WHERE revoked_at IS NULL;
