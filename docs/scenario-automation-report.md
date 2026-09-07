# ISSUE-074: automatic chart-scenario research

Issue: [#178](https://github.com/AegisFintech/scalping-bot/issues/178).
Branch: `issue-074-automatic-chart-scenarios`. Baseline: `e2474ff`.
Date: 2026-09-07. This implements an executable research workflow, **not a
broker-connected replacement for the running bot**. No trading service was
restarted, no trading was enabled, and no populated environment was changed.

## What changed

The operator supplied conditional chart commentary: recovery above 4,410 and
holding, rebound resistance 4,406–4,410, decision zone 4,400–4,406, bearish
continuation below 4,400 after a failed reclaim, and decline extension below
4,396 toward 4,392/4,388. Recovery targets are 4,416/4,422 and broader resistance
is 4,422–4,428 then 4,436–4,440. These numbers appear only in the example fixture;
the observation path requests fresh levels from current charts.

The existing production strategy is different: narrow ATR entry bands, one-minute
expiry, and fee-buffered TP with double-distance SL. The new research path removes
those assumptions from **model analysis**. It preserves the production strategy
and its controls while implementing a separately testable replacement candidate.

- `ScenarioPlanner` reuses the existing bounded EPRToken client with literal
  `gpt-6-astra/u64`, Responses, chart input, 45-second timeout, no retries,
  1,500 output-token cap and a three-failure/five-minute circuit. The new strict
  schema contains zones/thresholds/targets and trusted identity/time only; it has
  no size, risk, execution mode, SL, TP or model-calculated reward/risk fields.
- `observeScenario` fetches the existing typed local market snapshot and Python
  analytics/chart. It validates complete chronological M1/M5/M15 candles and
  chart end times before inference. Numeric tails match the chart counts. The
  screenshot is rendered from cTrader data, not captured from TradingView; feed
  and chart-context equivalence to the manual workflow is not established.
- The fixed `chart-scenarios-v1` policy turns subsequent observations into
  candidate entries and automatic exits. The model call is a separate promise;
  an unresolved/failed provider request cannot suspend replay exits.
- Admission reuses `sizePosition`, spread checks and commission coverage. It
  retains the previous **half-setup** risk ceiling, daily remaining budget,
  capital reductions/floor, notional, margin, volume grid and exposure checks.
  It never rounds up to minimum volume or expands risk to create a trade.
- The offline lifecycle simulates submission latency, stop-limit triggers/range,
  executable bid/ask prices, slippage, commission and full-position exits.
  No gateway or SQL mutations are imported. No new environment knobs were added:
  the normal sample remains **22** entries; the populated file remains **26**.

## Explicit automatic rules

These are engineering assumptions for testing, not recovered rules from the
operator's trade history. They are fixed in code rather than an operator tuning file.

| Scenario          | Confirmation after plan availability                                                                   | Stop-limit trigger                         | Protective structural stop                                  | First target           |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- | ---------------------- |
| Recovery hold     | Two consecutive completed M1 closes above recovery threshold                                           | Latest confirmation candle high + one tick | Lowest of the two lows and recovery threshold − one tick    | First recovery target  |
| Failed reclaim    | Prior M1 close below bearish threshold, then next candle touches/exceeds threshold but closes below it | Retest candle low − one tick               | Higher of retest high and bearish threshold + one tick      | Extension threshold    |
| Decline extension | Two consecutive completed M1 closes below extension threshold                                          | Latest confirmation candle low − one tick  | Highest of the two highs and extension threshold + one tick | First extension target |

The decision/rebound zones and remaining targets stay analytical context. The
example does not define an entry trigger inside the decision zone. A touch alone
is not silently substituted for a hold or a failed reclaim. Confirmation candles
must start after model availability; pre-response candles cannot backdate entry.
One completed trade consumes the plan; it cannot loop into repeated entries.

Plans expire five minutes after trusted pre-model capture. Inference cannot extend
that time. Pending orders expire after at most 60 seconds from simulated placement,
and never later than their plan. An invalidating completed close cancels pending
orders. Expired plans cannot create new entries; existing positions still exit.

A position closes fully at the first target, the structural stop, a completed-M1
close back through its confirmation threshold, or ten minutes after fill. Local
invalidation/time exits incur the execution-delay assumption; stop/target exits
are modeled as broker-held protection. The latter is **a simulation assumption**,
not evidence of a broker close implementation. The candidate does not implement
partial profit-taking or trailing to the second target. It has no loss chasing,
averaging down, stop widening or unlimited waiting for a loser to recover.

Price precision, minimum stop distance, 0.5 minimum reward/risk, the existing
2.5-ATR entry/3-ATR stop caps and net-fee coverage still apply. Chart-derived
entries outside those bounds wait/block; they are not moved into acceptance.
New entries are excluded in the final 15 UTC minutes because overnight financing
has not been validated. Actual broker margin/reconciliation and durable capital
accounting must supply admission context in a future broker integration.

## Reproduction

Use Node 22 from the repository root. The replay does not read credentials or
make network requests. Output files are mode 0600 and must not already exist.

```sh
npm run scenario:replay -- tests/fixtures/scenario/manual-levels-synthetic.json artifacts/scenario-base.json
npm run scenario:replay -- tests/fixtures/scenario/manual-levels-synthetic.json artifacts/scenario-stress.json --stress
```

The base execution assumption is 500 ms submission/local-exit delay, two ticks
adverse entry, five ticks adverse exit, and a five-tick stop-limit range. The fixed
stress case uses 1,500 ms delay, four entry ticks and ten exit ticks. They are
research assumptions, not calibrated broker latency percentiles.

This explicit command reads the existing local services and may incur one model
charge. It does not call execution/control/order endpoints:

```sh
npm run scenario:observe -- artifacts/scenario-observation.json
```

It writes a prospective map with pre-model capture time, availability time and
usage/identity telemetry. It does not schedule continuous refresh, record a full
future tick path, or connect the plan to broker orders. The reusable planner and
replay APIs provide those separate integration boundaries.

Replay accepts supplied completed candles and timestamped quotes without sorting.
Future/forming/regressed/conflicting events fail closed. Exact duplicate event IDs
have no additional effect. Checkpoints include the policy input, ordered event
journal and failure/censor latches under a SHA-256 checksum; restoration replays
that journal deterministically. The checksum detects accidental corruption, not
malicious edits by someone controlling the file. This is research restart recovery,
not reconciliation with a broker. Failed events cannot erase a failure latch.

Quote gaps over three seconds during pending/position exposure censor the path.
A triggered stop-limit outside its range has an unknown subsequent limit-queue
outcome; replay censors it rather than inventing a fill or cancellation. Unresolved
admission, pending orders or open positions at the dataset end also withhold net
path P&L. A data-integrity halt withholds path returns even before an entry, since
missing future opportunities cannot be treated as a valid zero-return strategy.
Model costs remain null; net after model costs is unavailable. Per-trade
commission is subtracted once; adverse stop gaps can exceed modeled risk reserves.
Partial execution is not simulated and remains a broker-integration prerequisite.

## Evidence and limitations

The example and all its timestamps/market observations are **synthetic software
fixtures**. The provided commentary had no capture timestamp, original screenshots,
broker fill history or manual exit log. It cannot be applied retrospectively to
recordings without risking look-ahead selection. The reported manual 100% accuracy
is unverified and is not a success metric in the tests.

The fixture proves a complete automatic lifecycle and the tests exercise recovery,
failed reclaim, extension, target/stop/invalidation/time exits, unavailable inference,
stale/exposed accounts, insufficient minimum volume, risk reduction, spread and
history failure, passed entries, bad precision, event conflicts and censoring.
It does not establish profitable expectancy, improved frequency, fill rates or
old-versus-new net performance. No chronological out-of-sample comparison of this
new model/rule combination is available yet. The historical production evidence
in `overhaul-report.md` remains separately labelled and is not a matched comparator.

Two initial `scenario:observe` attempts returned `MARKET_DATA_HTTP_ERROR:503`
before model invocation. A diagnostic read identified `CTRADER_DEPTH_TIMEOUT`:
the new observation code requested 20 levels, despite this broker's established
four-level policy. It now uses that existing typed policy; completeness and
freshness checks are unchanged. The observation test asserts the four-level
request, and an unavailable market still prevents inference.

After correction, one real observation succeeded on 2026-09-07 at 04:32:07 UTC:
the exact requested model was `gpt-6-astra/u64`, the returned identity was
`gpt-6-astra`, and the scenario schema and semantic checks passed. This verifies
this prompt/schema/image combination on the configured Responses endpoint for
one request. Provider latency was 19,448 ms; usage was 22,116 input / 466 output
tokens. The 133,344-byte request included the chart and matching numeric tails.
Pricing remains unverified and cost is null. One successful request is not a
reliability or decision-quality benchmark. Mocked tests additionally cover the
failure circuit, bounded concurrency and redaction.

A read-only prospective sampling pass then followed the frozen map from 04:32:35
through 04:36:47 UTC. It captured 455 quote responses and two completed candles,
with 17 local read failures. Three returned quotes were 3,059–3,107 ms old when
processed and failed the unchanged three-second freshness contract. The failure
latch blocked subsequent entry; no risk context or broker authority was supplied.
This incomplete sampled path is censored and has no usable strategy P&L. It is
neither a complete tick tape nor a confirmation/fill benchmark. That pass exposed
a reporting defect: a halt before exposure could previously display zero return;
the report now withholds it, with regression coverage. The original observation
output is retained alongside the corrected replay report.

The general format distinction follows OpenAI's [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs):
matching a schema does not replace application correctness checks. That source
does not establish EPRToken capabilities. cTrader documents [stop-limit trigger,
range and expiry semantics](https://help.ctrader.com/ctrader/trading/orders/) and
[order/protection fields](https://help.ctrader.com/open-api/messages/). Those
mechanics do not implement a multi-candle hold/reclaim condition or guarantee fills;
the conditions must be evaluated before submission and broker outcomes reconciled.

## Rollout and rollback

[ISSUE-075 / #179](https://github.com/AegisFintech/scalping-bot/issues/179) tracks the remaining broker-connected lifecycle: durable
single-direction intent, acknowledged cancel/replace, protected idempotent
full-position close, partial/disconnect/restart recovery and actual account/margin
integration. Freeze prospective maps before collecting future quote outcomes,
validate sustained provider behavior/cost, compare the candidate with production on the
same unseen paths, and complete supervised demo failure drills before promotion.

The actual capital floor remains blank, and migration 0015 has not been deployed.
No capital limit was invented. Existing execution/AI processes retain their previous
release/model. This checkpoint cannot be activated merely by restarting those
services. No new SQL migration is required for the offline workflow. To roll back,
stop invoking the two research commands and revert this issue; retain audit/evidence
files. Do not erase production state, reset losses or modify trading authorization.

## Exact validation

All 22 completion commands exited 0 on Node 22.23.2 / Python 3.13.5. Exact
commands, exit codes, timings and synthetic outputs are in
[the validation record](evidence/scenario-validation.json). Raw logs remain ignored
under `artifacts/scenario-automation/gates-acceptance/`.

| Checks                                                                                   | Result                                              |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`             | Passed                                              |
| `npm test`                                                                               | 380 tests, 56 files; includes 45 new scenario tests |
| `npm run test:schemas`                                                                   | 22 passed (also included in Node total)             |
| `npm run test:migrations`                                                                | 3 passed (also included in Node total)              |
| Configured `npm run test:integration` with connection supplied through child environment | All 3 passed; isolated schemas only                 |
| Ruff format/check, mypy, `.venv/bin/pytest -q`                                           | Passed; 116 Python tests                            |
| Sample startup and actual-file policy checks                                             | Passed; 22 normal / 26 populated settings           |
| `bash scripts/secret-scan.sh`                                                            | Passed                                              |
| `npm audit --audit-level=high`, `pip-audit -r requirements.lock`                         | No known vulnerabilities                            |
| Existing replay/backtest fixture commands                                                | Passed; software evidence only                      |
| New scenario replay, base and stress                                                     | Passed; synthetic evidence only                     |

The base fixture completes one full target exit. The slower stress case ends with
admission still unresolved; its path return is withheld, not reported as zero or
as proof of inferior strategy performance. The initial full run found a lint
error in a nested test matcher; it was corrected. A further recovery test exposed
and fixed pending-intent resurrection after a rejected event. Final Node tests
include that regression. Formatting/lint/types/build were also repeated after the
final source edit. Initial logs were retained rather than rewritten as successful.

No dashboard code changed; no new rendering claim or screenshot is made. Existing
UI captures remain in `docs/images`. No live/demo trading was launched.

The separate `npm run config:check -- .env --startup` check still exits 1 with
`CONFIG_DEMO_EQUITY_FLOOR_REQUIRED`. This is a real upgrade-readiness blocker;
passing the actual-file policy check does not mean the trading service can start.
