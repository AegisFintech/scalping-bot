-- Additive compatibility migration. Does not move or remove existing bytes.
-- Existing-blob relocation is a separate verified, operator-reviewed transition.
ALTER TABLE analysis_chart_artifacts
  ADD COLUMN storage_kind text NOT NULL DEFAULT 'database'
    CHECK (storage_kind IN ('database', 'local_sha256'));
ALTER TABLE analysis_chart_artifacts ALTER COLUMN image_bytes DROP NOT NULL;
ALTER TABLE analysis_chart_artifacts ADD CONSTRAINT chart_storage_complete CHECK (
  (storage_kind = 'database' AND image_bytes IS NOT NULL)
  OR (storage_kind = 'local_sha256' AND image_bytes IS NULL)
);
COMMENT ON COLUMN analysis_chart_artifacts.storage_kind IS
  'local_sha256: exact PNG at protected .runtime/analysis-charts/<image_sha256>.png; backup with database. Application verifies hash on every read.';
