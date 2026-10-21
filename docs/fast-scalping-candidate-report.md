# ISSUE-354 — Isolated fast-scalping candidates

Issue: <https://github.com/AegisFintech/scalping-bot/issues/354>.
This is a tested setup scanner, not a profitable strategy, execution integration,
registered outcome comparison or automatic promotion. No running service,
provider request, accepted GTC order, risk policy or accounting state is changed.

## Why this experiment

Read-only closed-demo review, October 19 through October 21 07:43:49.276 UTC:

| Release                   | Closed trades | Wins |   Net USD | Average win / loss USD |
| ------------------------- | ------------: | ---: | --------: | ---------------------: |
| Codex fade `.3-codex.1`   |            69 |   36 | -2,822.86 |        249.55 / 357.78 |
| Breakout `.1-codex.1`     |            42 |   29 |   -478.18 |        147.13 / 364.99 |
| SMC breakout `.1-codex.3` |             9 |    5 |   -670.79 |        155.42 / 361.97 |

Net includes stored signed fees once. These are different chronological/equity
cohorts, not randomized or risk-normalized comparisons. They exclude open trades,
failed submissions and nonfills; they are not account returns. The nine-trade SMC
cohort cannot establish whether the new context improves entries. The earlier
breakout's observed average payoffs require approximately 71.3% wins to break
even, versus 69.0% observed. Its gross +374.56 and signed fees -852.74 produce
net -478.18. High win rate alone is therefore an inadequate objective.

One breakout filled approximately five hours after its provider response. This
is descriptive provider-to-fill age, not dispatch latency or proof of stale
authorization: accepted GTC orders legitimately persist. It motivates a separately
tested setup-validity hypothesis, never retroactive cancellation of accepted orders.
Private aggregate receipt: `/tmp/strategy-review-20261021.json`.

## Frozen definitions, version scalp-candidates-1.0

All thresholds below are fixed hypotheses, not fitted/ranked using these outcomes.
`python.research.scalp_candidates` recomputes causal context from a saved validated
`technical-context-request-1.1`. Caller-supplied derived evidence is not accepted.
Required completed history is at least M1 720 / M5 576 / M15 480. Existing data,
book, quote, timezone, ordering, closure and snapshot-freshness checks apply.
The seven-bar M1 pattern window must be contiguous; it cannot bridge a closure.

- Trend pullback: M15 and M5 structure bias and EMA ordering agree. A fresh M1
  OB/FVG, at most 12 bars and strictly less than two minutes old, supplies the
  near edge for a LIMIT retest and the far edge for invalidation. Touched,
  resolved or future zones are withheld. Only the most recently available zone
  is tested; failed candidates do not search older zones until one passes.
- Sweep/reclaim: a completed M1 sweep closes back through its pivot and intersects
  an already available active same-direction M5/M15 OB/FVG. The reclaimed pivot
  supplies a LIMIT retest; the sweep extreme supplies invalidation. This candidate
  does not assert absorption or institutional intent.
- Compression breakout: both higher structure biases are UNKNOWN (a conservative
  research proxy, not a validated ranging classifier). Six completed M1 bars have
  total width between six modeled cost distances and 1.2 M1 ATR, each bar at most
  0.8 ATR. Outward STOP_LIMIT entries have opposite box-edge invalidation.

Spread must be at most 0.15 ATR. Buffer is max(two ticks, spread). Minimum proposed
stop distance is max(five ticks, twice spread); maximum is 1.5 ATR. Entries round
outward for their order type and stops inward. Proposed gross target distance is
exactly the stop distance (1:1). Reward must cover at least three times the modeled
cost distance, including spread; targets/stops are never widened to pass costs.
These are candidate price proposals, not actual broker protections or guaranteed
realized loss/reward. No quantity or monetary risk is selected here.

Known modeled round-trip fees plus adverse execution reserve are a required
positive decimal price-distance input, excluding spread because the scanner adds
it. Missing costs produce REJECTED, never zero cost. Supplied costs are scenarios,
not verified exact-volume broker evidence; unknown counterfactual net P/L stays null.
DOM is validated context only, not a directional gate; the shallow broker book is
not consolidated gold order flow. News/harmonics remain unavailable/unimplemented.

## OCO and speed boundary

Both BUY and SELL must qualify independently in the same setup family for an
`OCO_CANDIDATE`. A valid directional pullback/reclaim is retained as evidence but
returns `NO_PAIR` without a valid peer. Thus only compression currently forms a
two-sided pair; this deliberately exposes the incompatibility between universally
directional entries and mandatory opposite-side OCO. No fake second leg, automatic
single-side trade or cross-family pair is introduced. The current trading cycle is
unchanged. More selective signals can reduce frequency; no frequency claim is made.

Candidate admission lasts at most 60 seconds and never beyond 120 seconds after
source availability. This is historical research eligibility only. It does not
cancel accepted GTC orders, extend model validity, bypass a cooldown or authorize
a current order from an old saved snapshot. Python price checks are local and
deterministic; the scanner does not dispatch Codex or claim second-long fills.

## Usage and evidence handling

The request wrapper has `schemaVersion: scalp-scan-request-1.0`, `source` containing
the existing full saved technical request, and `round_trip_cost_price` containing
the explicit modeled cost scenario or null. Versioned request/report JSON Schemas
are generated from strict Python models and checked for exact parity. No HTTP,
SQL, historical schema or Node/Python production contract is modified.

```sh
.venv/bin/python -m python.research.scalp_candidates saved-request.json unused-report.json
```

The bounded CLI reads at most 1 MiB, rejects symlink inputs, creates a mode-0600
report exclusively, flushes/fsyncs it and never overwrites existing evidence or a
broken output symlink. CLI failures expose no raw input. Outputs always carry
execution authority false and promotion HOLD. Status describes a historical
snapshot, not current market readiness. There are no broker, database or provider
credentials/clients, collection timers, production imports or order commands.

## Qualification and subsequent work

Focused tests cover both directional pullbacks and sweeps, a full expanded-history
public compression pair, no invented peer, costs, tick geometry, malformed data,
forming/future/stale/gapped/incomplete evidence, failed reclaim, future/used zones,
schema parity, input immutability and private non-overwriting CLI failures.
Full qualification results are recorded below before delivery.

- [#355](https://github.com/AegisFintech/scalping-bot/issues/355): register a future
  all-cohort comparison, with source/threshold freeze, modeled-cost provenance,
  real availability/acceptance anchors, latency stress and nonfill/open/gap/OCO
  censoring. Extend the causal conditional replay; the legacy fade-only replay
  must not be invoked as though it supports these stop-limit candidates.
- [#356](https://github.com/AegisFintech/scalping-bot/issues/356): separately measure
  executable favorable/adverse movement, structural exits and profit protection.
  Change one economic dimension at a time; do not attribute exact exit causes
  from P/L, assume hypothetical closes or replay unknown broker commands.
- Subsequent execution adoption needs a reviewed release, Codex proposal binding,
  exact-volume costs/dynamic sizing, shared 1% setup budget, broker margin/precision,
  ownership/session/reconciliation/protection gates and idempotent OCO lifecycle.
  No automatic promotion follows unit tests or a winning complete-path subset.

Existing #334/#338/#351 registrations and immutable artifacts remain untouched.
Future collection must register windows before outcomes; 30 days is a collection
batch, not qualification. Rollback is a source revert or stopping this offline
command, never a database rollback, history deletion or trading-service restart.

## Completed checks

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed on source
`e031ade359382c35ac3b3044231f47adb7a040e2163e0c798d7cdf9cb13c5138`.
Private results: `/tmp/scalper-qualification-zqJzOf/checks/results.json`.

| Check                                                         | Result                                            |
| ------------------------------------------------------------- | ------------------------------------------------- |
| Node suite, including JSON Schema/migration/fail-closed tests | 974 passed                                        |
| Isolated PostgreSQL lifecycle suite                           | 94 passed                                         |
| Python suite, including 23 scanner tests                      | 404 passed                                        |
| Prettier, ESLint, TypeScript/noEmit and isolated build        | Passed                                            |
| Python Ruff format/lint and mypy                              | Passed                                            |
| Secret scan, npm audit and pip-audit                          | Passed                                            |
| `git diff --check`                                            | Passed                                            |
| `graphify update .`                                           | AST-only, no API cost; 6,632 nodes / 12,517 edges |

Only the existing Starlette/httpx deprecation warning remains. Graph update
reported the known zero-node pyproject/community-label warnings. No skipped
isolated-database qualification or failing dependency audit was accepted.
Final staged diff and secret scan are checked before commit; hosted checks are
required before merge.

A ten-run synthetic expanded-history benchmark (324,413-byte input) had median
129.67 ms and maximum 189.30 ms while qualification was running. This measures
local calculations only, not broker latency or expected trading performance.
A copied historical full broker snapshot passed context validation and rejected
with exactly MODELED_COSTS_UNAVAILABLE when supplied null costs. Its recorded
local capture clock was supplied to the v1.1 wrapper for this read-only smoke;
original files and registrations were not rewritten. No inference or order ran.

Current demo status remained the original `.codex.3`, ready/unpaused with no
operational fault; session/pending-order waiting reasons remain normal gates,
not research permissions. No service was restarted. Source delivery and hosted
PR receipts are recorded on the issue after push; economic validation remains
open in #355/#356.
