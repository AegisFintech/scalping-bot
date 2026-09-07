# ISSUE-069 implementation and evidence

Date: 2026-09-07. Issue: [#172](https://github.com/AegisFintech/scalping-bot/issues/172).
Baseline: `2ee59bb`; branch: `issue-069-evidence-led-overhaul`.
Source release: `0.2.0-overhaul.1`. This is a source/UI implementation and offline
validation, not a service rollout. No new trading was launched, no live gateway
was enabled, no populated environment was rewritten, and migration `0015` was
only exercised in isolated test schemas.

## Outcome

The implementation simplifies operation and strengthens execution/accounting.
It does **not** demonstrate profitable scalping or justify promoting a faster
strategy. The sampled-quote candidates lose after assumed costs; historical
model comparisons are too sparse and selected to prove incremental model value.
Provider compatibility was observed but subsequent HTTP 403 responses prevent a
reliability conclusion. Model prices are unavailable, so costs are never recorded
as zero by inference.

## Audit and implemented changes

| Path              | Baseline finding                                                                                                   | Implemented behavior / remaining constraint                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Market and depth  | cTrader spot/depth events, completed M1/M5/M15 candles, reconnect checks                                           | Same completed-candle contract; recorder rejects stale/future/duplicate capture times and retains manifest checksums                                                            |
| Analytics         | Typed HTTP, 600/500/300 candle histories, compact tails plus a rendered PNG                                        | Numeric features remain authoritative; default provider call excludes image; chart remains archived and benchmarkable                                                           |
| Inference         | Synchronous proposal generation, old model, tens of seconds latency                                                | Exact EPRToken identifier, Responses, bounded inputs/responses, strict local validation, one in-flight request, 45-second timeout, zero automatic retries, circuit breaker      |
| Scheduling        | One durable claim per completed M1, first ten seconds start window, two-sided proposal, 60-second preferred expiry | Preserved pending better evidence; claims prevent duplicate/restart calls; model cannot extend expiry                                                                           |
| Order handling    | Main tick awaited inference before subsequent maintenance                                                          | Independent serialized two-second maintenance; paper marks/exits, expiry, peer cancellation and recovery continue outside model work; broker callbacks/SL/TP remain independent |
| Precision         | 47 recent `INVALID_DECIMAL` rejections; a stop bound divided by two could gain an eleventh decimal place           | Reproduced with `4.8635288115`; upper bounds floor and lower bounds ceil onto the existing whole-pip grid; schemas remain strict                                                |
| Sizing            | Stop-distance budget; per-leg margin checks                                                                        | Decimal cost-inclusive grid search; fees, minimum commission, adverse execution and conversion reserve; combined OCO loss/margin checks, no upward minimum rounding             |
| Account evidence  | Symbol filtering could omit other-symbol account exposure; P/L completeness not enforced                           | Other-symbol exposure blocks as unpriced; every account position requires exactly one P/L row; missing/duplicate/unknown evidence rejects                                       |
| Capital           | Durable cash-flow-aware daily risk, no lifetime reduction state                                                    | Strict signed flow parsing, daily remaining-budget cap, durable cash-flow-adjusted high water, bounded 1/0.5/0.25/0 multipliers and sticky 5% drawdown lockout                  |
| Maintenance scope | SQL selected strategy rows without account/symbol scope                                                            | Exact account/symbol ownership scope; manual orders excluded                                                                                                                    |
| Persistence       | Immutable model contracts, event journal and replay/recovery                                                       | Additive `0015`: strict provider telemetry, redacted failure codes and durable capital state; success telemetry commits with model trail                                        |
| Dashboard         | Eleven top-level tabs and repeated status/counters                                                                 | Three views, four money metrics, current state/reasons, exposure, latest decision/execution; detailed analytics/prompts/provider/infrastructure in drill-downs                  |
| Configuration     | 176 normal template assignments                                                                                    | 25 assignments; fixed typed policy, removal of duplicated PM2 strategy overrides, actionable legacy conflicts and broker metadata discovery                                     |

Remaining one-setup/open-position restrictions, fresh-quote/metadata checks,
spread/fee filters, reconciliation lockouts and expired/moved-through entry
rejections are legitimate safety gates. Slow inference can make a proposal stale;
that does not justify accepting it. Runtime telemetry now separates failures from
successful model requests, analysis from proposals, orders from fills, and fills
from closed trades. Protective maintenance still depends on functioning broker,
database and local event-loop services; a two-second timer is not a two-second
execution guarantee.

## Baseline evidence

Baseline gates: Prettier, ESLint, TypeScript typecheck/build, 311 Node tests,
96 Python tests, schema/migration checks and secret scan passed. Initial isolated
integration and dependency audits hit the former sandbox/network restriction.
After full access, all three configured integration tests passed and both audits
reported no known vulnerabilities. Fixtures and smoke outputs are software checks.

The existing **demo** `.43` journal contained 23 closed trades, net **−11.88**,
including **−5.98 signed fees** (2026-09-04 through 2026-09-07 at audit).
Fees must not be subtracted a second time. Earlier `.42` and `.41` journals also
had negative totals. [Sanitized aggregate evidence](evidence/baseline.json) contains
these releases and recent rejection groups; it contains no account identifiers.

A fixed September 1–7 query yielded 1,011 stored old-model requests:
`gpt-5.6-sol/u40`, latency p50 **24,307 ms**, p95 **41,291.5 ms**. This population
is not a matched benchmark against the two new-model successes. Recent rejection
groups included 220 spread-points/percentile, 207 absolute-spread, 53 combined
ATR/points/percentile, 47 invalid-decimal, 43 BUY-too-close, 28 SELL-too-close,
24 market-data HTTP 503 and 21 provider timeouts. Another 199 expired analysis
rows are lifecycle outcomes, not 199 proven lost trades. These groups are not
mutually exclusive causes of lost profit and do not establish opportunity quality.

## Provider verification and input experiment

The configured private EPRToken endpoint accepted the **literal** model identifier
`gpt-6-astra/u64` using `/responses`, strict JSON Schema, `store:false`, and bounded
`max_output_tokens`. It returned `gpt-6-astra`; the adapter records this observed
normalization without changing the requested model. No other substitution is
allowed. A small initial boolean-schema probe returned HTTP 200 in 3,810 ms
(4,414 input and 14 output tokens).

A six-call experiment used three earlier archived market inputs, each with and
without its exact PNG and the same `system-v16` instructions. Successful responses
passed schema/request-identity checks; this is not proof that all suggested prices
were tradable or economically good.

| Input profile, first matched input  | HTTP / schema          | Latency      | Request bytes | Input / output tokens |
| ----------------------------------- | ---------------------- | ------------ | ------------- | --------------------- |
| Structured plus PNG                 | 200 / valid            | 40,799 ms    | 125,350       | 19,214 / 1,191        |
| Structured alone                    | 200 / valid            | 43,684 ms    | 42,870        | 16,933 / 1,322        |
| Remaining two inputs, both profiles | four HTTP 403 failures | 600–1,176 ms | unavailable   | unavailable           |

Removing the PNG saved **65.8% request bytes and 11.9% input tokens** in this pair.
It did not improve observed latency; N=1 matched success cannot establish quality
or latency distributions. No measured decision-quality improvement justifies
sending the image by default. It remains an offline comparison option. Strict
output support and image acceptance are observed for these requests only.
Temperature, `reasoning.effort`, endpoint tariff, Chat-Completions compatibility,
retention guarantees and sustained access are **not verified**. The runtime omits
unverified optional generation parameters. `/u64` has no client-inferred semantics.
[Benchmark aggregates](evidence/provider-benchmark.json) preserve exact observations.

The circuit opens after three failures and allows a bounded probe after five
minutes. Errors expose allowlisted codes, not private URLs/provider bodies.
Telemetry uses `schemas/provider-telemetry-1.0.json` and matching runtime validation.
Costs remain null without an authoritative tariff/usage contract. Schema-rejected successful HTTP responses retain validated usage through the
error boundary and durable failure trail. HTTP/transport failures without usage
may incur unreported costs; that missing evidence is a readiness limitation.
Official [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs)
explains the API format; it does not establish a private reseller's model identity
or capabilities. Only the endpoint probes support those observations.

## Research and broker applicability

cTrader documents limits of 50 nonhistorical and five historical requests per
second per connection. Streaming events and broker-held stop orders can react
without a new inference call. These limits are not a latency guarantee, and this
retail CFD setup has no institutional HFT evidence.
[Official introduction](https://help.ctrader.com/open-api/).

Historical tick requests cover at most one week and can truncate; correct
recording/backfill requires checking completeness and independent bid/ask times.
The local 250 ms sampled recorder cannot establish every intervening trigger,
spread spike or queue position. [Official symbol-data guide](https://help.ctrader.com/open-api/symbol-data/).

Native volume/lot units, digits, pip position, commission, maximum exposure and
trading schedules are broker metadata. STOP_LIMIT supports bounded entry
slippage and relative protective distances; cancellation is not atomic OCO.
The audited XAUUSD configuration exposes a USD-notional commission convention,
used in the reproducible scenarios, but symbol/account metadata must be verified
again after reconnect/deployment. Broker margin estimates remain authoritative.
Net unrealized P/L excludes potential closing commission.
[Model definitions](https://help.ctrader.com/open-api/model-messages/),
[order messages](https://help.ctrader.com/open-api/messages/).

Cont, Kukanov and Stoikov find short-horizon order-flow imbalance relationships
in US equity data. This motivates testing directional microstructure hypotheses;
it does not prove that a broker's XAUUSD depth is the consolidated gold market or
predicts profitable CFD execution. [Primary research](https://arxiv.org/abs/1011.6402).
Their order-placement work also motivates explicit fee/nonfill sensitivity;
its venue/queue assumptions cannot be transferred to this broker without data.
[Primary order-placement research](https://arxiv.org/abs/1210.1625).

## Chronological comparison and ablation

The evaluator verified **257 gzip segments**, yielding **125,621 usable sampled
quotes**. It removed 151,623 repeated samples, 7,923 stale/future samples and 23
ambiguous samples. Dataset SHA-256:
`9623429ee52151cc0cdb0152f16ef5aec219c9a394427628ff50b4276dcd0875`.
A fixed manifest cutoff (`1788743999922`) prevents later recording from changing
this experiment. Raw recordings remain private/ignored; the report includes
aggregate metrics. Missing retained source segments prevent an independent rerun
until a suitably sanitized dataset is provided through an approved channel.

Three frozen deterministic hypotheses use only completed sampled M1 features:
two-sided M1 OCO, directional M1, and directional 15-second proposals with 1:1
reward/risk. These are a small strategy comparison, not parameter optimization.
The first chronological third is reserved for calibration; two subsequent
chronological blocks evaluate frozen rules. These blocks were revisited while
fixing price-grid, completed-minute and spread-policy implementation errors, so
they are not a pristine lockbox for significance claims. Past observations can seed features; future
candles/model context/performance cannot. An initial partial minute and post-gap
warmup cannot seed a completed bar. No training or profit-driven tuning was done.
This is a blocked out-of-sample comparison, not evidence of a fitted walk-forward
strategy succeeding over many independent regimes.

All candidates and observed legacy plans use the same sampled bid/ask, one base
unit per leg, 500 ms decision delay, 0.02 adverse entry, 0.05 adverse exit,
30 USD per million per side commission, 0.05 stop-limit tolerance, 500 ms OCO
cancel delay, 60-second candidate validity and 120-second time exit. Quote gaps
over three seconds censor exposure; stops execute at observed executable prices,
not ideal stop prices. No entry is admitted in the last five UTC minutes before
rollover; this does not validate overnight financing. Partial fills use a common
50% scenario, not a calibrated broker probability. Candidate creation uses a 0.01
research price grid rounded away from market and a 0.10 absolute spread ceiling.
Production percentile/history, final spread and broker session gates are not fully
reconstructed; this is not a behavior-identical production replay. Production sizing
is separate.

The table shows **observed closed outcomes only**, after spread/execution/commission
and before model costs. Whole-path net P&L is withheld whenever exposure is
censored. Drawdown is limited to observed paths and may understate actual losses.

| Candidate                      | Holdout | Closed N / censored positions | Closed net  | Mean net/trade        | Profit factor | Observed drawdown | Trades/observed hour | Fill rate         |
| ------------------------------ | ------- | ----------------------------- | ----------- | --------------------- | ------------- | ----------------- | -------------------- | ----------------- |
| Deterministic OCO M1           | 1       | 89 / 4                        | -40.6981    | -0.4573               | 0.498         | 40.7141           | 16.74                | 37.5%             |
| Deterministic OCO M1           | 2       | 30 / 2                        | -14.7251    | -0.4908               | 0.357         | 17.4155           | 4.53                 | 44.4%             |
| Directional M1                 | 1       | 47 / 3                        | -10.9398    | -0.2328               | 0.676         | 12.5995           | 8.84                 | 37.9%             |
| Directional M1                 | 2       | 24 / 1                        | -8.3933     | -0.3497               | 0.458         | 13.4654           | 3.63                 | 67.6%             |
| Directional 15s, 1:1           | 1       | 67 / 2                        | -16.7946    | -0.2507               | 0.595         | 16.8105           | 12.60                | 41.8%             |
| Directional 15s, 1:1           | 2       | 25 / 1                        | -3.4697     | -0.1388               | 0.678         | 6.3269            | 3.78                 | 47.3%             |
| Archived `.43` submitted plans | 1 / 2   | 0 / 1 closed                  | 0 / +0.2746 | unavailable / +0.2746 | unavailable   | 0 / 0.2727        | 0 / 0.15             | unavailable / 50% |

Only 63 archived submitted groups overlap the retained tape, and just one fills
in the holdouts. This is selection-biased and cannot reconstruct every original
analysis or compare old/new model skill. The common time exit is an experiment,
not an exact reconstruction of legacy broker exits. New production P&L, true
execution latency, fill probabilities and reliable equity drawdown are **missing**
because the new release was not traded.

The complete [machine-readable report](evidence/quote-evaluation.json) contains
exposure, expiry/validation/rejection/nonfill counts, fill rates, latency p50/p95,
exploratory seeded bootstrap intervals, and worse-cost/partial-fill scenarios.
The base candidate p50 measured on the sampled replay is 750 ms; p95 ranges
999–1,250 ms. These are scenario/sample timing, not observed broker placement
latency. The 15-second candidate does not even increase fills relative to every
baseline; removing a scheduling restriction does not manufacture qualified trades.

Worse costs use 1.5× spread, 45/million commission, 1,500 ms decision/cancel delay,
0.04 entry and 0.10 exit slippage. A slow-model ablation adds 40 seconds and an
**illustrative, unverified $0.01 per request** to identical deterministic plans.
This isolates latency/cost effects, not model-generated decision quality. Some
selected closed outcomes can improve simply by delayed entries being rejected;
censoring and few independent days preclude an economic conclusion. A prospective
model-context-versus-no-model experiment, known tariffs and more independent
complete quote paths are required to establish incremental value after costs.

Production therefore retains mandatory OCO, its entry corridor, fixed exit
relationship and M1 cadence. Directional abstention and bounded asynchronous
context are evaluated as candidates; no schema-breaking runtime strategy is
promoted on this evidence. Inference remains outside protective handling, while
model-derived proposals still undergo the full deterministic execution contract.

## Dashboard, configuration, rollout

[Overview screenshot](images/dashboard-overview.png) and
[history screenshot](images/dashboard-history.png) and
[provider diagnostics screenshot](images/dashboard-diagnostics.png) show the actual redesigned
Streamlit UI against existing demo read-only data. Missing new-policy telemetry
is visibly unavailable; no screenshot invents returns or freshness. Three views
replace eleven top-level tabs. Identity/reason/confirmation and token-authenticated
loopback controls remain; emergency stop cancels pending strategy orders and does
not implicitly flatten a position.

See [configuration and rollback](configuration.md), the complete setting inventory,
[architecture](architecture.md) and [risk model](risk-model.md). The first capital
high-water mark starts from the first verified observation after rollout; missing
historical peaks are not reconstructed. Deposit/withdrawal history failures block.
Multiple partial closing deals remain conservatively blocked when journal recovery
cannot establish their final state. No unsupported lifecycle completion is claimed.

## Exact final validation

Commands ran with Node **22.23.2**, Python **3.13.5**, pinned dependencies and
isolated PostgreSQL schemas. No deployment schema was changed.

| Command / validation                                                                                                                  | Result                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                                                                                                                | passed                                                                                                                            |
| `npm run lint`                                                                                                                        | passed                                                                                                                            |
| `npm run typecheck` / `npm run build`                                                                                                 | both passed                                                                                                                       |
| `npm test`                                                                                                                            | 331 tests in 52 files passed                                                                                                      |
| `npm run test:schemas`                                                                                                                | 19 passed                                                                                                                         |
| `npm run test:migrations`                                                                                                             | 3 passed                                                                                                                          |
| `npm run test:integration` with securely injected `TEST_DATABASE_URL`                                                                 | all 3 passed; fresh/upgrade schemas removed afterward                                                                             |
| `.venv/bin/ruff format --check python apps/dashboard tests/python`                                                                    | passed                                                                                                                            |
| `.venv/bin/ruff check python apps/dashboard tests/python`                                                                             | passed after formatting correction                                                                                                |
| `.venv/bin/mypy python apps/dashboard`                                                                                                | passed                                                                                                                            |
| `.venv/bin/pytest -q`                                                                                                                 | 107 passed, including rendered unavailable/unauthorized dashboard checks                                                          |
| `npm run config:check -- .env.sample`                                                                                                 | passed; 25 normal settings                                                                                                        |
| `npm run config:check -- .env`                                                                                                        | expected policy conflict; populated environment preserved                                                                         |
| `.venv/bin/python -m python.replay.cli --input tests/fixtures/replay/analytics-requests.jsonl`                                        | passed; fixture smoke only                                                                                                        |
| `.venv/bin/python -m python.backtest.cli --input tests/fixtures/backtest/oco-scenario.json --output artifacts/overhaul/backtest.json` | passed; synthetic smoke only                                                                                                      |
| Fixed-cutoff quote evaluation from README                                                                                             | completed; 125,621 usable quotes, four comparison sources / four scenarios / two blocks                                           |
| Chromium / Streamlit rendering                                                                                                        | Overview: 4 metrics; history: chart/table; fully rendered provider diagnostics; zero application exceptions; screenshots reviewed |
| `bash scripts/secret-scan.sh`                                                                                                         | passed before staging/commit                                                                                                      |
| `npm audit --audit-level=high`                                                                                                        | zero vulnerabilities                                                                                                              |
| `.venv/bin/pip-audit -r requirements.lock`                                                                                            | no known vulnerabilities                                                                                                          |

Early failures were corrected: provider stream/test typing under ESLint and an
AppTest relative path. Runtime/JSON schema and database persistence were retested
after rejected-output usage propagation. The fixed data comparison was rerun after
price-grid/spread-policy corrections; final Python checks include that version.
Machine-readable commands/timings are in `docs/evidence/validation.json`. Runtime
logs and raw artifacts remain ignored. Tests prove implemented invariants; no
new production/demo trading P&L or service rollout is implied.

## Remaining readiness requirements

Restore reliable EPRToken authorization with the existing credential owner and
obtain an authoritative tariff/retention contract; no token rotation was attempted.
Complete reviewed configuration migration and service rollout, then supervised demo
failure drills for broker races, partial closes, disconnects and equity/flow recovery.
Collect a complete prospective quote/event tape and frozen model contexts with
costs, preserve an untouched holdout, and demonstrate net benefit before promoting
any faster strategy. Verify backups/restores, broker limits, Debian service-user
hardening and separate live-readiness requirements. Live execution stays disabled.
