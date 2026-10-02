# ISSUE-251 — Research recommendation qualification

## Result and scope

The legacy walk-forward screen must not recommend an entry/TP candidate yet.
It now returns `AUTO_IMPROVEMENT_WALK_FORWARD_V2`, `decision: HOLD`, null
candidate and an explicit evidence gate. Exploratory fold metrics are retained
and labelled as neither realized P/L nor production-equivalent results.
There is no override flag and no broker, database, prompt, release, risk or
running-service change. This does not add a production trading gate.

Dependency: [ISSUE-249](demo-learning-review-report.md).
Issue: https://github.com/AegisFintech/scalping-bot/issues/251.

## Reproduced defects and limitations

- `variants.aggregate` includes `OPEN` mark-to-window net values in totals and
  filled counts. A synthetic unfinished +1000 outcome passes the old statistical
  screen across repeated folds; the regression now proves it cannot recommend.
  This test deliberately mocks outcomes to isolate admission; it is not a
  strategy performance test. Legacy aggregate semantics are not silently changed.
- `screen.parse_setups` and `run_variant` start from capture time rather than
  verified provider availability. Inference cannot authorize earlier entries.
- Pending expiration, finite observation windows, serial reopening and loss-streak
  pauses differ from the current GTC demo lifecycle. OHLC cannot resolve actual
  two-leg races or bid/ask intrabar order.
- The simulator does not censor missing price paths. Missing data is not evidence
  that a target or stop did not trigger.
- Cost calibration is supplied globally, not derived strictly from each training
  interval. Historical test periods can influence their own cost assumptions.
- Constant dollar-per-point economics do not reproduce shared 1% dynamic sizing,
  broker volume steps, margin or swap. No exact-fee/pricing claim is justified.

These are limitations of the research implementation, not proof of a current
broker failure or evidence for pausing trading. The V2 report leaves the old
statistical screen visible but explicitly separates it from qualification.
No consumers of the V1 label were found in repository schemas or runtime code.

## Remaining comparison work

October 2 follow-up: ISSUE-253 implements and runs a separate conditional
sampled-path comparison. See [the completed comparison scope and evidence](paired-replay-report.md).
The historical limitations below still prevent a production-equivalent portfolio
backtest or automatic promotion; the legacy guard remains in place.

Production-equivalent entry/TP validation remains **unqualified**. ISSUE-253's
conditional comparison does not establish that qualification. Before using such
results to select a strategy, require a separately qualified path with actual
provider availability, paired baseline/candidate evidence, sampled bid/ask
gap censoring, GTC/OCO lifecycle, causal costs and explicit unresolved outcomes.
Keep entry-only comparison separate from TP-only comparison, preserve SL and
shared 1% sizing, and do not sweep hundreds of variants looking for a winner.
Historical model requests are conditioned on the original trading path; changed
holding times also change later request opportunities. A replay using the same
requests is conditional evidence, not a complete counterfactual live strategy.

For now, use the read-only demo learning report for actual closed trade results.
The archived September 14 variant input is an old research fixture, not evidence
about the current October demo cohort. A CLI run against it is a compatibility
check only, not a current strategy backtest.

## Validation and delivery

Commands run on October 2, 2026:

- `.venv/bin/pytest tests/python -q`: 189 passed, 3 skipped (isolated database
  unavailable). The focused auto-improvement suite passed all 4 tests.
- Node 22 `vitest run --exclude '**/*.integration.test.ts'`: 773 passed in 95
  files, including schema, migration and fail-closed unit suites.
- Node 22 `vitest run tests/integration --passWithNoTests`: 1 passed, 69 skipped;
  no isolated database qualification is claimed.
- `.venv/bin/ruff check python apps/dashboard tests/python`: passed.
- `.venv/bin/mypy python apps/dashboard`: passed, 35 files.
- Node 22 `tsc --noEmit -p tsconfig.json` and `eslint .`: passed.
- Changed-file Ruff formatting and Prettier checks passed. Full formatting still
  fails on the same five JS/Markdown paths and dashboard file recorded in
  ISSUE-249; none are changed here.
- `.venv/bin/python -m python.backtest.auto_improve --input
artifacts/variant-inputs-full.json --output /tmp/issue251-legacy-screen.json`:
  HOLD, zero eligible folds, 428 configured variants. With zero folds, those
  variants were not actually simulated. This is only a legacy-input smoke test.
- `.venv/bin/python -m python.replay.cli --input
tests/fixtures/replay/analytics-requests.jsonl`: exit 0 but fail-closed
  `ANALYSIS_CHART_RENDER_FAILED`, not a successful chart replay.
- `graphify update .`: AST-only update, 4402 nodes / 8905 edges. Known
  `pyproject.toml` empty-extraction warning; no semantic-document refresh claim.
- `bash scripts/secret-scan.sh`: baseline failure, nine credential-pattern
  false positives from the existing risk report filename. Scanner not weakened.
- `npm audit`: 3 high findings; production-only audit: 2 high findings.
  `.venv/bin/pip-audit`: 3 urllib3 2.7.0 advisories, fixed in 2.8.0.
  Dependencies are unchanged; no forced upgrade performed.

No runtime deployment or automatic merge is authorized by passing isolated
research tests. Existing repository-wide blockers keep delivery in draft.

Rollback: revert this research-only commit; do not alter broker or accounting
state. Restoring the old recommendation behavior would also restore its known
qualification defect and is not recommended.
