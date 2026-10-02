# ISSUE-253 — Conditional entry and TP comparison

## Scope and decision

This completes the bounded research implementation and retained-cohort comparison,
not a production rollout or proof of a profitable strategy. The current demo
cycle, Grok prompt, quote-adjacent entry transform, shared 1% sizing, broker
protection, accounting and running services remain unchanged.

Issue: https://github.com/AegisFintech/scalping-bot/issues/253.
Dependencies: ISSUE-249 / ISSUE-251. The legacy OHLC optimizer remains unqualified
and its recommendation guard is not removed.

The fixed comparison set is selected before the run, not ranked over a grid:

- Entry only: original approved entry prices versus unchanged model support and
  resistance, preserving each leg's original SL/TP distance and approved quantity.
- TP only: original target versus 0.75 and 1.25 times that target, anchored at the
  same independently recorded full entry fill, with unchanged SL and quantity.
- Both comparisons run with base and stress execution assumptions. Lower TP is
  research-only: 1.5 ATR / 2.5 ATR is below the current release's 0.75 minimum
  reward/risk. Any promotion would require an explicitly reviewed economic release.

## Retained-cohort result

Fixed window: September 21, 2026 00:00 UTC through October 2 02:00 UTC
(exclusive), release `0.3.0-fade-limit.3`. All **145** exported intents pass
provenance checks. **2,552,341** valid sampled quotes from **2,240** sealed segments
were inspected. The 140 single-full-fill intents form the separate TP comparison;
five intents without exactly one full entry fill are not silently treated as trades.
This is the available demo cohort, not a three-year backtest or sufficient
out-of-sample strategy validation.

| Comparison                  | Base complete pairs / eligible | Base paired gross delta | Stress complete pairs / eligible | Stress paired gross delta |
| --------------------------- | ------------------------------ | ----------------------- | -------------------------------- | ------------------------- |
| Preserve model entry levels | 11 / 145                       | +2.15957                | 17 / 145                         | +0.04199                  |
| TP at 0.75 of original      | 64 / 140                       | -0.18789                | 65 / 140                         | +0.56257                  |
| TP at 1.25 of original      | 57 / 140                       | +1.64185                | 58 / 140                         | -0.84963                  |

Deltas are sums of **gross price move / original SL distance**, candidate minus
baseline, only on pairs where both paths close before any censor. They are not
dollars, percentages, after-fee results or full-cohort expectancy. Complete subsets
also differ between base and stress; do not treat this table as a matched
cross-scenario statistical significance test.

**Decision: no candidate qualifies for promotion.** Entry evidence is sparse and
the observed subset advantage nearly disappears under stress. Both TP choices
change sign between scenarios. More winning exits alone do not establish better
net results. Most TP paths encounter a gap before both alternatives close, and
the baseline entry is often already crossed on the sampled acceptance quote.
Those are research limitations, not newly diagnosed broker rejections.

The distinct actual closed-trade review over the same dates contains 146 trades:
80 wins, gross **+1,524.88**, signed costs **-3,171.14**, net **-1,646.26**, profit
factor **0.94004**. All 146 close-cost records reconcile. Removing the exceptional
2,950.56 winner leaves **-4,596.82**. The trade cohort is selected by close time,
whereas replay intents are selected by creation time; the counts are not expected
to match. These observations establish the current cost drag, not which new
strategy will fix it.

The final replay took **244.082 seconds** with **1,287,648 KiB peak RSS** (about
1.23 GiB), while other qualification jobs ran. The machine has about 7.64 GiB RAM:
it is sufficient for this bounded workflow. This is not a capacity claim for
multi-year tick simulations. Run one review at a time and retain the row/size caps.

Sanitized aggregate evidence: [paired-replay-20261002.json](evidence/paired-replay-20261002.json).
Full local case report: `/tmp/issue253-paired-final.json`; private frozen input:
`/tmp/issue253-input-accepted.json`. Digests are included in the committed evidence.

## Why this replaces, rather than blesses, the old simulator

`scripts/export-paired-replay.ts` uses one repeatable-read, read-only PostgreSQL
transaction with a 15-second statement timeout, a maximum 31-day window and
1,000 intents. Multiple account/symbol scopes reject. Only allowlisted fields
are exported; no account IDs, order IDs, raw broker payloads or secrets.
Shared TypeScript types and JSON Schema describe the offline file contract;
missing fields remain null and are excluded with explicit reasons.

The model must have been available before the intent. Both broker acceptance
events must follow the intent and precede its fresh-placement deadline. Risk
evidence must precede the intent; both leg budgets share at most 1% of the same
reconciled equity. The acceptance SQL requires exact order/group/account/symbol
ownership and mapped non-closing execution type 2.

An important timestamp correction: `orders.submitted_at` is populated from
`GatewayOrder.updatedAt` when persisting the placement result
(`postgres-trail.ts`, `placement`). It is not an exact dispatch timestamp.
Using it as dispatch incorrectly excluded 69 intents because a broker fill
preceded the locally persisted result time. The final exporter uses mapped
broker acceptance events instead; it does not backdate provider availability or
invent an earlier dispatch. No production timestamps were rewritten.

The new engine uses sampled executable bid/ask, Decimal prices and original
tick sizes. It keeps GTC pending orders after submission expiry, has no forced
time exits, no loss-streak pause and no serial reopening of unresolved positions.
Each intent is a separate paired experiment; overlapping experiments are never
presented as one executable portfolio or added up as dollar profit.

Only checksum-verified sealed segments are used, including the pinned
`.runtime/market-evidence` archive. Identical segment copies deduplicate by digest;
conflicting identities fail. Duplicate timestamps and invalid observations create
explicit discontinuities. Fresh unchanged quotes remain observations rather than
being dropped and turned into artificial gaps. Files are read segment by segment;
limits bound compressed size, decompressed rows/line size and total quote count.

## Execution assumptions and unknowns

Base adds 500 ms activation delay after observed broker acceptance and 500 ms
peer-cancel delay. Stress uses 1,000 ms for both. These are deliberately explicit
counterfactual delays, **not measurements of broker dispatch latency**. A pending
LIMIT needs one tick of executable-side penetration and receives its limit price,
without favorable fill improvement. A target receives its target price; a stop
receives the worse observed executable price minus an adverse price reserve:
0.65 base, 1.30 stress. The base reserve follows the current policy's 65 points
at this cohort's 0.01 tick; it is not fitted to future test outcomes. Stress also
doubles observed spread around the midpoint; spread is not charged twice.

A quote already crossing the proposed limit at observed acceptance is labelled
`CENSORED_ENTRY_QUOTE_MISMATCH`, not asserted to be a real broker rejection.
The sampled quote cannot reconstruct the original dispatch exactly. A possible
peer fill during cancellation or a fill before both legs activate censors the
experiment. No uncertain command is replayed or new request manufactured.

Gaps over three seconds or rejected observations censor before evaluating the
next price, including across closures. No interpolation bridges weekends.
Pending and open outcomes at cutoff have no realized P/L. The cutoff never
generates a close. Source-time and receive/capture provenance are checked; rows
at or after the cutoff do not influence paths.

The research reports gross price movement divided by original SL distance for
closed, uncensored sampled paths. This is **not** net money, realized risk-budget
R, portfolio expectancy or a full-cohort win rate. Counterfactual commission,
swap, currency conversion and margin are not fully journaled at every hypothetical
entry/exit; these economics remain null rather than reusing future calibration
or assigning zero. Frozen observed quantities cannot represent equity-dependent
resizing after a different history. A different holding time also changes when
the bot requests the next model context; historical requests cannot reconstruct
that unobserved stream.

Consequently, the output is always `HOLD`, with no candidate authority. Current
actual closed-trade accounting remains separate, using exact reconciled fees.

## Repeatable workflow

Choose a fixed cutoff before examining candidates. Export to a new private path
and retain the input digest printed in the resulting report. Example:

```sh
umask 077
set -C
npm run --silent strategy:paired-export -- 0.3.0-fade-limit.3 2026-09-21T00:00:00Z 2026-10-02T02:00:00Z > /tmp/paired-input-new.json
npm run --silent strategy:paired-replay -- --input /tmp/paired-input-new.json --recordings .runtime/market-data .runtime/market-evidence --output /tmp/paired-report-new.json
```

The replay output is created exclusively and refuses to overwrite earlier
evidence. It includes input/tape SHA-256, all per-case outcomes, assumptions,
censor counts, paired complete-subset differences, execution time and peak memory.
Do not select only recent winners or omit unresolved experiments from the cohort.
Repeating this command updates research evidence only; no scheduler, provider
dispatch, database mutation, automatic parameter tuning or live authority exists.

## Validation and rollback

Tests cover no-lookahead clocks, executable-side penetration, GTC persistence,
open/gap/late-peer/race censoring, stop slippage, isolated TP changes, decimal
validation, shared-budget proof, archive integrity/deduplication, unknown economics,
SQL scope/bounds/redaction and JSON Schema. No database migration is needed.

Final qualification on October 2:

- `.venv/bin/pytest tests/python -q`: **219 passed, 3 skipped**. Focused paired
  replay suite: **30 passed**, including exclusive-output and verified-byte tests.
- Node 22 `vitest run --exclude '**/*.integration.test.ts'`: **780 passed in 97
  files**, including JSON Schema, migration and fail-closed suites. New export
  and schema suites contribute seven tests. Actual frozen export also passes Ajv.
- Node 22 `tsc --noEmit -p tsconfig.json`, `eslint .`: passed. Isolated build
  `tsc -p tsconfig.build.json --outDir /tmp/issue253-build.NYr570`: passed;
  running `dist/` was not overwritten.
- `.venv/bin/ruff check python apps/dashboard tests/python` and
  `.venv/bin/mypy python apps/dashboard`: passed (36 typed source files).
- Changed-file formatting and `git diff --check`: passed. Full Prettier still
  reports five pre-existing files; full Ruff format still reports the pre-existing
  dashboard formatting difference. These baseline files are unchanged.
- Integration: **1 passed, 69 skipped**; isolated `TEST_DATABASE_URL` unavailable.
  Python replay fixture exits 0 with `ANALYSIS_CHART_RENDER_FAILED`, not a positive
  chart replay. Both limitations remain explicit.
- `npm audit`: three high findings; `pip-audit`: three urllib3 2.7.0 advisories.
  Dependencies unchanged. Secret scan reports the same nine filename false
  positives documented in ISSUE-249; no scanner suppression was introduced.
- `graphify update .`: AST update, 4,576 nodes / 9,224 edges. Known empty
  `pyproject.toml` warning remains; no semantic-document refresh is claimed.

The above baseline failures/skips prevent a fully qualified merge, so delivery
is a pushed **draft PR**, with no auto-merge or rollout. Logs use the private
`/tmp/issue253-*` prefix. The research workflow is implemented and exercised;
exact-fee counterfactual portfolio validation remains unsupported by available
evidence, not replaced by an optimistic estimate.

Rollback is a code revert of this research-only issue. Do not reset trading
history, clear recovery state, change the environment or restart trading services.
