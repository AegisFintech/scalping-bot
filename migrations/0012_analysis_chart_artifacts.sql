CREATE TABLE analysis_chart_artifacts (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE CASCADE,
  renderer_version text NOT NULL
    CHECK (renderer_version = 'completed-candles-ema-atr-v1'),
  mime_type text NOT NULL CHECK (mime_type = 'image/png'),
  width integer NOT NULL CHECK (width = 1600),
  height integer NOT NULL CHECK (height = 1200),
  image_sha256 char(64) NOT NULL CHECK (image_sha256 ~ '^[0-9a-f]{64}$'),
  image_bytes bytea NOT NULL CHECK (
    octet_length(image_bytes) BETWEEN 8 AND 1048576
    AND substring(image_bytes FROM 1 FOR 8) = decode('89504e470d0a1a0a', 'hex')
  ),
  source_metadata jsonb NOT NULL CHECK (
    jsonb_typeof(source_metadata) = 'object'
    AND octet_length(source_metadata::text) <= 16384
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE analysis_chart_artifacts IS
  'Bounded exact completed-candle PNG supplied alongside numeric model input.';
COMMENT ON COLUMN analysis_chart_artifacts.image_sha256 IS
  'Application-verified SHA-256 of image_bytes; Streamlit verifies again before display.';
