-- Additive storage release: legacy evidence and migration checksums stay intact.
ALTER TABLE analysis_runs ADD COLUMN artifact_policy text NOT NULL DEFAULT 'chart-v1'
  CHECK(artifact_policy IN ('chart-v1','numeric-v1'));
CREATE FUNCTION storage_text_sha256(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT encode(sha256(convert_to($1,'UTF8')),'hex')
$$;
CREATE FUNCTION candle_value_hash(
  uuid, text, timestamptz, timestamptz, numeric, numeric, numeric, numeric,
  numeric, boolean, jsonb
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    $1, $2, extract(epoch FROM $3), extract(epoch FROM $4),
    $5::numeric(30,10), $6::numeric(30,10), $7::numeric(30,10),
    $8::numeric(30,10), $9::numeric(30,10), $10, $11
  )::text, 'UTF8')), 'hex')
$$;

CREATE TABLE candle_values (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  timeframe text NOT NULL CHECK (timeframe IN ('M1','M5','M15')),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL CHECK (end_time > start_time),
  open numeric(30,10) NOT NULL CHECK (open > 0),
  high numeric(30,10) NOT NULL CHECK (high > 0),
  low numeric(30,10) NOT NULL CHECK (low > 0),
  close numeric(30,10) NOT NULL CHECK (close > 0),
  volume numeric(30,10) CHECK (volume >= 0),
  complete boolean NOT NULL,
  quality_flags jsonb NOT NULL CHECK (jsonb_typeof(quality_flags) = 'array'),
  content_sha256 text GENERATED ALWAYS AS (candle_value_hash(
    symbol_id,timeframe,start_time,end_time,open,high,low,close,volume,complete,quality_flags
  )) STORED UNIQUE,
  CHECK (high >= open AND high >= close AND high >= low),
  CHECK (low <= open AND low <= close),
  UNIQUE (id,symbol_id,timeframe,start_time)
);

CREATE UNIQUE INDEX candle_snapshot_symbol_identity ON candle_snapshots(id,symbol_id);
CREATE TABLE candle_references (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL,
  symbol_id uuid NOT NULL,
  timeframe text NOT NULL,
  start_time timestamptz NOT NULL,
  candle_value_id bigint NOT NULL,
  FOREIGN KEY (snapshot_id,symbol_id) REFERENCES candle_snapshots(id,symbol_id),
  FOREIGN KEY (candle_value_id,symbol_id,timeframe,start_time)
    REFERENCES candle_values(id,symbol_id,timeframe,start_time),
  UNIQUE (snapshot_id,timeframe,start_time)
);

CREATE VIEW decision_candles AS
SELECT c.* FROM candles c WHERE NOT EXISTS(SELECT 1 FROM candle_references r WHERE r.id=c.id)
UNION ALL
SELECT r.id,r.snapshot_id,v.timeframe,v.start_time,v.end_time,
       v.open,v.high,v.low,v.close,v.volume,v.complete,v.quality_flags
FROM candle_references r JOIN candle_values v ON v.id=r.candle_value_id;

CREATE TABLE market_evidence_segments (
  content_sha256 text PRIMARY KEY CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  archive_file text NOT NULL UNIQUE CHECK(archive_file ~ '^market-[a-z0-9._-]+-[0-9]{8}T[0-9]{6}Z-[a-f0-9-]+[.]jsonl[.]gz$'),
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9._-]{1,32}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK (completed_at >= started_at),
  sample_count integer NOT NULL CHECK (sample_count > 0),
  compressed_bytes bigint NOT NULL CHECK (compressed_bytes > 0),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'),
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE context_market_evidence (
  context_id uuid NOT NULL REFERENCES scenario_contexts(id),
  content_sha256 text NOT NULL REFERENCES market_evidence_segments(content_sha256),
  PRIMARY KEY(context_id,content_sha256)
);
CREATE TABLE server_metrics_hourly (
  instance_id text NOT NULL,
  hour timestamptz NOT NULL,
  sample_count bigint NOT NULL CHECK(sample_count > 0),
  max_memory_used_bytes bigint,
  min_disk_available_bytes bigint,
  max_process_cpu_percent numeric(8,4),
  PRIMARY KEY(instance_id,hour)
);

CREATE TABLE provider_prompt_artifacts (
  content text NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 65536),
  content_sha256 text GENERATED ALWAYS AS (storage_text_sha256(content)) STORED PRIMARY KEY,
  version text NOT NULL
);
CREATE TABLE context_provider_evidence (
  context_id uuid PRIMARY KEY REFERENCES scenario_contexts(id),
  prompt_sha256 text NOT NULL REFERENCES provider_prompt_artifacts(content_sha256),
  request_text text NOT NULL CHECK (octet_length(request_text) BETWEEN 2 AND 4000000),
  request_sha256 text GENERATED ALWAYS AS (storage_text_sha256(request_text)) STORED,
  response_text text CHECK (octet_length(response_text) <= 4000000),
  response_sha256 text GENERATED ALWAYS AS (storage_text_sha256(response_text)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON VIEW decision_candles IS
  'Historical and content-deduplicated candles with original snapshot provenance; no synthetic candle corrections.';
COMMENT ON TABLE market_evidence_segments IS
  'Immutable hash-verified sampled quotes, not a complete tick tape. Backup .runtime/market-evidence with the database.';
