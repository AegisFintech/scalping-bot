-- Forward-only durable M1 scheduler claims. A claim is written before an
-- automatic cycle starts, so a process restart cannot call the model twice for
-- the same account/symbol broker minute. An incomplete claim is deliberately
-- not retried; the next broker minute is the safe recovery boundary.
-- Rollback: pause automatic analysis, retain/archive this audit evidence, then
-- drop the table only after reverting all scheduler code under operator review.

CREATE TABLE automatic_analysis_intervals (
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol_id uuid NOT NULL REFERENCES symbols(id),
  interval_start timestamptz NOT NULL,
  broker_server_time timestamptz NOT NULL,
  cycle_id uuid,
  analysis_id uuid REFERENCES analysis_runs(id),
  outcome text CHECK (outcome IN ('PLACED', 'REJECTED')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (account_id, symbol_id, interval_start),
  CHECK (interval_start = date_trunc('minute', interval_start)),
  CHECK (broker_server_time >= interval_start),
  CHECK (broker_server_time < interval_start + interval '1 minute'),
  CHECK ((cycle_id IS NULL) = (outcome IS NULL)),
  CHECK ((completed_at IS NULL) = (outcome IS NULL)),
  CHECK (analysis_id IS NULL OR analysis_id = cycle_id),
  CHECK (completed_at IS NULL OR completed_at >= claimed_at)
);

CREATE INDEX automatic_analysis_intervals_recent
  ON automatic_analysis_intervals (account_id, symbol_id, interval_start DESC);
