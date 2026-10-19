# Trade evidence: first diagnostic batch

Issue [#324](https://github.com/AegisFintech/scalping-bot/issues/324).

The offline evidence brief is implemented. It recomputes descriptive context from
one saved, validated analytics 1.0 input. It is not yet connected to the journal,
dashboard or provider. No trading service, strategy, registered experiment,
accounting state or external subscription changes in this batch.

## What already exists

`python/features/builder.py` computes M1/M5/M15 EMA alignment/slopes, ATR,
optional RSI/ADX/Bollinger bandwidth, rolling ranges, confirmed pivots, partial
UTC-date ranges/VWAP, volume statistics and broker-depth features. Analytics
validates completed candles. The production input is numerical, not screenshots.

Depth already includes spread, microprice, top-5/10/20 imbalance and rolling
liquidity changes. A displayed top-five summary can contain fewer than five
levels: the new brief includes actual counts. Broker depth is not evidence of
global gold order flow or institutional intent. cTrader describes DOM as the
available liquidity at quoted prices; symbol pricing depends on the broker's
liquidity providers ([DOM](https://help.ctrader.com/trading-with-ctrader/depth-of-market/),
[markets](https://help.ctrader.com/trading-with-ctrader/markets/)).

The current execution transform replaces AI breakout prices with quote-adjacent
fade LIMIT prices. Additional indicators alone do not reproduce the manual
breakout method or prove better entries. See [#321](https://github.com/AegisFintech/scalping-bot/issues/321).

## Delivered interface

```sh
.venv/bin/python -m python.research.trade_evidence /path/to/saved-analytics-request.json
```

Input is an existing analytics **1.0 request**, not a provider response or the
2.0 HTTP wrapper. CLI reads at most 4 MiB and emits validated JSON to stdout;
it does not create or overwrite an input/report, use database credentials,
call a model, fetch news or place trades. Exit 0 means context was computed,
1 means explicit quality rejection, 2 means invalid/unavailable input. Errors
never echo paths, raw validation exceptions or supplied payloads.

`EvidenceBrief` is the shared Python output type;
`schemas/trade-evidence-1.0.json` is generated from its Pydantic schema and checked
for exact parity. There is no production HTTP contract or SQL migration.

The report exposes:

- Completed candle end and age for each timeframe, EMA alignment, ATR and
  optional RSI/ADX; all price/indicator values remain decimal strings.
- Exact highest high / lowest low of the last five and ten completed candles.
  These are descriptive bounds, **not** an inferred manual holding range,
  smart-money order block, executable entry or invalidation rule.
- Recorded broker source/receipt times, source age, depth level counts, spread,
  top-five imbalance and microprice bias. Zero liquidity yields null imbalance.
- Cross-timeframe EMA agreement, without buy/sell recommendation, confidence
  score, voting filter or a claim that alignment is predictive.
- Explicit null costs, holding range, entry rationale, invalidation and profit
  exit rule; news is `NOT_COLLECTED`. A deterministic list names needed evidence.

Existing analytics quality checks apply. Additional **diagnostic-only** limits
require each candle end to be less than one timeframe old at recorded server
time, book source age at most five seconds, aware/ordered book timestamps,
analysis no later than snapshot, and sufficient indicator warmup. Failure emits
no frames/depth narrative. These are not new trading gates or measured optimal
thresholds. Age is relative to the saved snapshot, never current wall-clock
freshness. An old file can yield valid historical context, not permission to trade.

The input SHA-256 covers the sorted, parsed, normalized analytics request,
including its original local identity. It is **not** an original-file byte hash,
proof of broker authenticity, code fingerprint or proof of pre-decision
availability. Request/analysis IDs and full candle arrays are not emitted.
The report recomputes current feature code; it does not pretend to recover the
original AI reasoning or the exact historical indicator implementation. Reports
should remain private when derived from private trading inputs.

## Sequenced work and evidence needed

| Batch                                                           | Deliverable / dependency                                                                             | Status                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| [#324](https://github.com/AegisFintech/scalping-bot/issues/324) | Offline technical/depth brief, explicit unknowns and failure tests                                   | Implemented; qualification below |
| [#325](https://github.com/AegisFintech/scalping-bot/issues/325) | Bind original provider/intent/journal provenance and expose Diagnostics; depends on #324/#289/#321   | Planned, not activated           |
| [#326](https://github.com/AegisFintech/scalping-bot/issues/326) | Timestamped economic-calendar observer; depends on #325/#290                                         | Planned, not activated           |
| [#327](https://github.com/AegisFintech/scalping-bot/issues/327) | Broker-depth coverage and one-feature-at-a-time technical evaluation; depends on #321/#289/#290/#325 | Planned, not qualified           |

For #321, the remaining user-specific evidence is the exact manual range prompt
and reply, how profits are closed, how losers are abandoned, and when longer
holds are intentional. The workbook alone cannot recover these decisions. Never
copy its fixed lots into dynamic sizing. The earlier question remains unanswered;
no discretionary rule is invented here.

For #325, use exact pre-decision evidence and distinguish received/available
values from hindsight. Include rejected, unfilled, open and closed setups, with
ambiguous links explicit. Show original model range separately from effective
entries, intended protection separately from observed broker protection, and
estimated fees separately from realized costs. No counterfactual net return is
computed from assumed costs. Keep current dashboard navigation and bounded reads.

For #326, start with scheduled events from primary sources:
[BLS calendars](https://www.bls.gov/schedule/) and
[Federal Reserve FOMC calendars](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm).
BLS schedules are in Eastern Time: retain timezone and DST conversion, first
seen/fetched times, revisions and availability. Missing calendar evidence means
unknown, not 'no news'. Headline sentiment, consensus surprises, yields and USD
prices need a later source/coverage/licensing/latency review. No purchase or new
credentials are needed for this first offline batch.

For #327, freeze explicit range/pivot/sweep/order-block definitions and actual
confirmation availability; never backdate a pivot to its center candle. Evaluate
technical context, then depth, then calendar separately against a frozen baseline.
Preserve every gap, nonfill and open outcome; register future windows before
outcomes. Existing fast-exit observations concern fade fills and do not validate
the manual breakout method. No claim that SMC or a collection of indicators has
highest accuracy. Existing #323 execution recovery qualification remains separate.

## Validation and rollback

Initial focused tests: 15 passed, covering deterministic output, privacy, disabled
indicators, missing liquidity, forming/future/stale/gapped candles, warmup,
invalid depth, schema parity and bounded CLI failures. Synthetic inputs only;
no current trading-result or operational integration claim.

Full qualification: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed
all checks; logs `/tmp/scalper-qualification-FpdBfV/checks/results.json`.
This includes Prettier/ESLint/TypeScript/build, 900 Node tests (schema, migrations
and fail-closed replay included), 91 isolated PostgreSQL lifecycle tests, 376 Python
tests, Python format/lint/mypy, secret scanning and npm/Python dependency audits. No integration skips or failed gates were accepted.
The Python suite includes all 15 new cases. Existing FastAPI/httpx deprecation
warning only. Separate synthetic CLI smoke exited 0; private output is
`/tmp/issue324-synthetic-brief.json`.

`graphify update .` completed AST-only: 6,250 nodes / 11,908 edges; known
zero-node pyproject warning, no API cost. Staged diff inspection,
`git diff --cached --check` and `bash scripts/secret-scan.sh` passed before commit.
Final documentation formatting is rechecked; hosted final-head checks must pass
before auto-merge. Rollback is to stop invoking this offline tool. It adds no
service, timer, data mutation or order gate.
