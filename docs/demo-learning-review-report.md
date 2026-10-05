# ISSUE-249: Demo learning review and entry-guidance candidate

Issue: <https://github.com/AegisFintech/scalping-bot/issues/249>.
Status: observational implementation; production strategy and prompt unchanged.

## Scope and authority

The October 2 operator approval starts with measurement and entry guidance,
testing one change at a time. This milestone adds a repeatable read-only review
of existing evidence and an isolated candidate, not automatic strategy promotion.
No service restart, database migration/write, provider call, order mutation,
loss reset, risk increase or populated environment edit is required or performed.
Continuous market-open analyse/place/manage/repeat and all existing safety checks
remain unchanged. SL remains 2.5 ATR, TP 2.0 ATR under the current release; both
legs still share the cost-inclusive 1% current-equity ceiling.

## Critical finding: prompt prices are not effective entries

`applyFadeLimitExitPolicy` currently sets BUY to bid minus one tick and SELL to
ask plus one tick whenever a quote exists, regardless of the selected model
support/resistance. The existing transform tests explicitly require this.
The v4 provider prompt selects breakout levels, while deterministic execution
maps them to a fade LIMIT pair and then replaces them with quote-adjacent prices.

Thus the earlier suggestion that prompt-only entry guidance would improve actual
entry locations was incomplete. Model outputs still pass admission/validity
checks, but their selected levels do not determine final placement in this path.
The fixed review cohort shows **80 of 83** effective entries displaced from their
corresponding original fade level (LONG uses model sell_stop/support, SHORT uses
model buy_stop/resistance). Equality in three cases does not imply a different
execution path. This finding does not prove the replacement causes losses.

Changing this transform is a separately versioned economic experiment. Do not
silently change it, reinterpret historical rows, or claim a prompt candidate is
economically validated while its prices are discarded. The candidate at
`prompts/research/entry-guidance-candidate-v1.md` remains unregistered; production
dispatch, hashes, identities and cooldowns continue to use `entry-pair-v4`.

## Reproducible observations

```sh
npm run demo:learning-review -- 0.3.0-fade-limit.3 \
  2026-09-25T01:23:01.040Z 2026-10-02T01:23:01.040Z
```

This is a closed-demo-trade cohort, start inclusive/end exclusive, not a backtest
or account return. The tool requires a known fade release, explicit UTC bounds,
one account/symbol scope, at most 10,000 rows, a 15-second statement timeout and
a repeatable-read/read-only transaction. It rolls back before emitting JSON.
No broker/account IDs, credentials or raw event payloads are exported. Output is
intended for local review, not public publication of individual trading data.

| Measurement                                             |  Observed |
| ------------------------------------------------------- | --------: |
| Closed trades / wins                                    |   83 / 45 |
| Gross P/L                                               |  1,410.08 |
| Signed swap + commission + conversion                   | -1,819.54 |
| Net P/L, costs already included                         |   -409.46 |
| Profit factor                                           |    0.9740 |
| Closed-trade cumulative P/L drawdown                    |  3,692.78 |
| Net excluding single largest winner                     | -3,360.02 |
| Matching terminal cost evidence                         |   83 / 83 |
| Available approved leg budgets / entry EMA observations |   83 / 83 |

Provider costs remain unknown, not zero. Drawdown is not mark-to-market equity
drawdown. Open positions, deposits/withdrawals, censored opportunities and rejected
setups are outside this closed-trade report. Do not compare dollar cohorts with
different equity/sizing as though they were risk-normalized returns.

### Exceptional winner

The SHORT opened September 25 at 20:51:52.126 UTC and closed September 27 at
22:02:00.391 UTC: 177,008.265 seconds (about 49.17 hours), across the weekend.
Recorded fill was 4285.77; closing fill 4268.17. The mapped native protective
closing event reports price P/L 2,921.60, swap +71.56, commission -42.60 and
conversion 0, totaling net +2,950.56. Positive signed costs are not an error:
the swap credit exceeds commission. Broker order type 4 identifies native SL/TP
protection, not which of SL or TP fired. The report deliberately does not infer
an exact exit reason from positive P/L or a final cleared protection snapshot.
Full trigger/gap attribution remains unproven. Retain the outcome; exclusion is
only a sensitivity calculation, never a history deletion or replacement.

### Conditions already exist, but were not in the trade label

The local two-price execution artifact sets `market_regime=UNCERTAIN`; it is not
a measured market classification. Entry-linked indicator snapshots already hold
EMA alignment. The review exposes it under **entryEmaAlignment**, separately from
the historical model regime. It does not pretend EMA alignment proves a trend.

| Direction | Entry M1 EMA alignment | Trades |   Net P/L |
| --------- | ---------------------- | -----: | --------: |
| LONG      | BULLISH                |     22 | -1,412.97 |
| LONG      | BEARISH                |     22 | -1,531.41 |
| SHORT     | BULLISH                |     16 |   -433.06 |
| SHORT     | BEARISH                |     23 | +2,967.98 |

Removing the exceptional winner leaves bearish-aligned shorts at +17.42. These
small, retrospectively selected groups do not justify a trend gate or short-only
strategy. Keep them descriptive, not training labels derived from future returns.

## Measurement contract

- `LearningRow` is an internal query input; `learningObservation` produces the
  versioned diagnostic projection documented in
  `schemas/demo-learning-observation-1.0.json`. No HTTP or SQL schema changes.
- Money stays decimal strings, calculated using the existing Decimal precision.
  Gross equals net minus signed costs; costs are never subtracted twice.
- Cost components are published only when one distinct mapped terminal evidence
  projection matches both the stored fees and net. Missing, partial, conflicting
  or mismatched evidence remains explicitly missing/ambiguous, with null detail.
- An approved `risk_decisions` allocation at or before fill supplies
  `netOverApprovedLegBudget`. It is **not actual filled-position stop risk or
  realized reward/risk**. The old null `risk_reward_realized` field stays null;
  actual-risk attribution needs a separate validated fill/protection/cost model.
- Conditions come from one acceptable, analysis-linked indicator snapshot
  generated no later than group creation. Missing/ambiguous evidence is UNKNOWN.
- Model levels come from the group's immutable entry context; effective entries
  come from the approved side's risk decision. Missing evidence stays null.
- Unknown exact SL/TP trigger reason is never manufactured. The only labels are
  native protection, market close, or unknown mechanism.
- This diagnostic module is not imported by trading admission. Its failure must
  not add a pause, provider call or order. Existing journals continue recording
  future trades, so rerunning the tool reviews new observations without new
  synchronous work in the execution loop. It is not a scheduled auto-tuner.

## Next experiment, not activated here

Freeze the candidate prompt and first review a model-level-preserving transform
as its own release. Compare against the unchanged quote-adjacent baseline using
prospective evidence, accounting for missing paths and nonfills. Keep both legs,
current sizing, SL/TP and lifecycle constant. Do not combine a TP change with the
entry experiment. Count unusable outputs, provider latency, fills, signed costs,
net expectancy, drawdown and exceptional-winner dependence; no win-rate promise.
Larger TP tests follow only as a separate candidate with unchanged stop/risk.

Rollback is to stop invoking the new read-only tool and remove the unused
candidate; there is no database rollback or trading-service restart to perform.

## Validation

Commands run on October 2. Final Node qualification uses Node 22.23.2; the host
default is Node 24.21.0. No shared `dist/` deployment artifact was overwritten.

| Check                                                                          | Result                                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit -p tsconfig.json` under Node 22                                  | Passed                                                                                                         |
| `eslint .` under Node 22                                                       | Passed after correcting new test mocks                                                                         |
| Focused learning/CLI/schema tests                                              | 17 passed                                                                                                      |
| Full non-integration Node suite                                                | 773 passed in 95 files under Node 22                                                                           |
| `npm run test:schemas`                                                         | 57 passed                                                                                                      |
| `npm run test:migrations`                                                      | 3 passed                                                                                                       |
| `npm run test:integration`                                                     | 1 passed, 69 skipped; no isolated test database supplied                                                       |
| `tsc -p tsconfig.build.json --outDir /tmp/issue249-build.CTJYg4` under Node 22 | Passed; isolated build only                                                                                    |
| Changed-file Prettier check / `git diff --check`                               | Passed                                                                                                         |
| Full `npm run format:check`                                                    | Five pre-existing failures: three fade/limit reports, model-validator.ts, paper-gateway.test.ts                |
| `.venv/bin/ruff format --check python apps/dashboard tests/python`             | Existing app.py formatting failure                                                                             |
| `.venv/bin/ruff check python apps/dashboard tests/python`                      | Passed                                                                                                         |
| `.venv/bin/mypy python apps/dashboard`                                         | Passed, 35 files                                                                                               |
| `.venv/bin/pytest -q`                                                          | 187 passed, 3 isolated-database tests skipped                                                                  |
| Python replay CLI on analytics fixture                                         | Exited 0 but emitted fail-closed `ANALYSIS_CHART_RENDER_FAILED`; not a successful chart replay                 |
| `config:check -- .env` and `-- .env --startup`                                 | Both passed; current model/policy retained                                                                     |
| Fixed-window review against current database, repeated under Node 22           | 83 outcomes reproduced; 83 matched costs; 80 displaced entries                                                 |
| `bash scripts/secret-scan.sh`                                                  | Existing scanner failure: nine matches, all references to the risk-budget report filename; no new secret match |
| `npm audit --audit-level=high`                                                 | Three high-severity dependency findings: brace-expansion, fast-uri, fastify                                    |
| `.venv/bin/pip-audit -r requirements.lock`                                     | Three urllib3 2.7.0 advisories; dependencies unchanged                                                         |
| `graphify update .`                                                            | AST-only update, no API cost; pyproject.toml has no extracted nodes; semantic doc graph not rebuilt            |

The initial new schema test hit the repository's known ajv-formats TypeScript
interop requirement; it now uses the same typed adapter as existing schema tests.
Early async-without-await test mocks were also corrected before final qualification.
Original financial data and broker events were only read. Full repository gates
are **not green**: keep delivery as a draft PR, with auto-merge disabled until
formatting, dependency security and isolated integration qualification are resolved.
Do not bypass branch protection or conflate passing local unit tests with a
validated trading strategy. Actual-risk attribution, exact SL-versus-TP trigger
attribution and prospective economic prompt/transform testing remain future work.
