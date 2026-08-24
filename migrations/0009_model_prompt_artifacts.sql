ALTER TABLE model_requests
  ADD COLUMN system_prompt text,
  ADD COLUMN system_prompt_sha256 text,
  ADD CONSTRAINT model_requests_system_prompt_pair_check CHECK (
    (
      system_prompt IS NULL
      AND system_prompt_sha256 IS NULL
      AND prompt_version = 'system-v1'
      AND schema_version = '1.0'
    )
    OR
    (
      system_prompt IS NOT NULL
      AND system_prompt_sha256 IS NOT NULL
      AND octet_length(system_prompt) BETWEEN 1 AND 65536
      AND system_prompt_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

COMMENT ON COLUMN model_requests.system_prompt IS
  'Exact non-secret versioned system prompt sent for this request; legacy schema 1.0 rows may be null.';
COMMENT ON COLUMN model_requests.system_prompt_sha256 IS
  'SHA-256 of the exact UTF-8 system_prompt bytes; legacy schema 1.0 rows may be null.';
