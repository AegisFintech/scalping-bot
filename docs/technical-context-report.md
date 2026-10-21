# ISSUE-348 — Causal technical context for Codex candidates

Issue: https://github.com/AegisFintech/scalping-bot/issues/348.

This batch implements and tests candidate input preparation, not a trading release
or a profitability claim. The operator approved local Python analysis and more
OHLC/DOM context. Current demo execution, v5 provider input, Codex worker, shared
1% dynamic setup budget, protection, GTC orders, database and frozen studies stay
unchanged. Nothing here dispatches inference or promotes a strategy.

## Broker feasibility and observed performance

A read-only request to the existing market-data service returned HTTP 200 at
`2026-10-21T03:36:20.209Z` with exactly 720 completed M1, 576 M5 and 480 M15 bars,
and four broker-depth levels per side. No new credentials, subscription, broker
connection, order command or paid data service was needed. This verifies that
specific broker/time sample, not universal history availability.

[cTrader historical bars](https://help.ctrader.com/open-api/symbol-data/) support
period, count and time bounds. Responses can be paginated;
[the protocol](https://help.ctrader.com/open-api/messages/#protoaogettrendbarsres)
exposes `hasMore`. Historical requests are limited to
[five per second per connection](https://help.ctrader.com/open-api/), so the
candidate collector serializes bounded pages through the existing paced adapter.
The successful feasibility probe used the existing snapshot endpoint; it did not
replace the active collector or prove a new broker connection's behavior.

The broker sample passed pure Python analysis and the typed HTTP/CLI preparation
path on an isolated local analytics process at port 8091. Initial five-run Python
measurement was median 103.15 ms / maximum 112.32 ms, before the final small
historical-pivot-cluster addition; the final measurement is recorded below.
The final five-run measurement during concurrent qualification was median
187.00 ms / maximum 359.32 ms. Final candidate payload: 27,227 bytes. Typed
HTTP output exactly matched pure Python output. [Sanitized receipt](evidence/technical-context-validation.json).
The compact payload is not the full 1,776 bars.
These are single-host/sample timings, not execution-latency or economic guarantees.
Private broker input/output remains outside Git in `/tmp/technical-context-348/`.

## Delivered components and boundaries

- `CandidateHistoryCache` reads up to 180 bars per page and at most eight pages per
  frame, M15/M5/M1 serially. Targets are 480/576/720 respectively. Same-boundary
  calls reuse history; updates include one overlapping completed bar to reject
  revisions. Quotes and books are always reacquired after collection. Failure,
  clock regression, scope/connection reset or changed schedule invalidates cached
  history. Cached bars are frozen; partial refresh never falls back to stale data.
- `TechnicalContextCollector` accepts only a read-method interface on an already
  connected adapter. It has no connect/submit/cancel/close/provider authority.
  Every reconnect must call `reset()`; in-flight/queued work checks its generation.
  The production CTrader adapter's existing serialized pacing/deadlines apply.
  The candidate explicitly requests a seven-day calendar lookback per page to
  bridge normal weekend closures. This optional adapter parameter is bounded;
  ordinary callers' three-times-count lookback and behavior are unchanged.
  Broker truncation, empty/partial pages, missing recent bars and unverified
  open-session gaps reject rather than invent candles. Longer shutdowns can still
  produce insufficient history and must remain unavailable.
- Python `prepare_context` is pure Decimal analysis. New typed HTTP
  `/v1/technical-context` accepts the versioned request wrapper and emits the
  versioned response, with JSON Schemas generated from the shared Python models.
  No old analytics, journal, provider transport or migration schema is rewritten.
  No database persistence contract is added, so no SQL migration is required.
- `TechnicalContextHttpClient` validates both schemas, identity/capture time,
  prompt fingerprint, evidence/payload consistency, bounded responses and explicit
  non-authority. It permits local HTTP only, uses a 15-second deadline, and neither
  retries nor forwards anything to Codex/execution.
- `scripts/prepare-technical-context.ts` reads one saved bounded request, calls
  this local endpoint and exclusively writes one mode-0600 candidate file. It
  does not load credentials or overwrite an existing report. The preparation
  result includes original request/analysis IDs, normalized input SHA-256 and
  exact research prompt byte SHA-256. The input hash is normalized parsed JSON,
  not the original file bytes, broker authenticity or proof of availability.

Use an isolated analytics process for review; the active service is not replaced:

```sh
.venv/bin/python -m uvicorn python.analytics.api:app --host 127.0.0.1 --port 8091 --no-access-log
# In another shell, with a saved technical-context-request-1.0 document:
node --import tsx scripts/prepare-technical-context.ts /private/request.json /private/new-context.json http://127.0.0.1:8091
```

The response's `codexPayload` contains ranked findings plus the last twelve
completed candles per frame, current quote and outward tick-rounded executable
bounds. Every accepted result is at most 64 KB of candidate payload. Rejection
withholds both findings and payload; an unacceptable result cannot be mistaken
for an empty bullish/bearish setup. Short valid windows can be inspected with
`history_targets_met=false`; collector output requires the full target counts.

The research prompt supports candidate/NO_SETUP plus supporting zone references.
It is deliberately incompatible with the active two-price worker and is not sent
there. No new provider request, worker transport, trading prompt, input recording
migration, strategy release, persistent observer or autonomous research loop was
activated. Full inference comparison/adoption is separate
[#349](https://github.com/AegisFintech/scalping-bot/issues/349), represented in
`plan.md`. A generated input is not evidence that Codex saw it or chose better
entries.

## Frozen descriptive definitions: causal-smc-1.0

These explicit first definitions are engineering choices, not optimized parameters
or proof of institutional intent. They apply separately to M1/M5/M15.

| Finding                   | Definition / when it becomes available                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Swing                     | Strict high/low versus three candles on each side. Tied extrema do not create pivots. Known only when the third right candle closes; retain center and availability timestamps.                                                                                                |
| Initial break / BOS / MSS | First completed close strictly beyond a confirmed unbroken swing. First directional break is INITIAL_BREAK, same-direction later break is BOS, opposite-direction break is MSS. This is a simple confirmed-break state machine, not a claim about external/internal structure. |
| Displacement              | Body at least 1.5 times the prior 15-period Wilder ATR and at least 60% of the candle range. No current/future ATR is used to qualify that historical bar.                                                                                                                     |
| Order block               | Most recent opposite-colour candle within ten bars before a displacement break. Body bounds, not wick bounds; deduplicate the same origin/direction. Availability is the break close, never the origin.                                                                        |
| FVG                       | Strict three-candle gap: third low above first high, or third high below first low. Known at third close; no minimum fitted gap size or claim that every FVG predicts a fill.                                                                                                  |
| Zone lifecycle            | Only later bars change a new zone. Range overlap marks TOUCHED; a later FVG wick reaching its far edge marks FILLED; completed close strictly beyond the adverse edge marks INVALIDATED, taking precedence. OB touches stay touched until invalidation.                        |
| Sweep                     | Wick strictly beyond an unbroken confirmed swing followed by a completed close strictly back across it. It is an observed rejection, not a future directional instruction.                                                                                                     |
| Equal highs/lows          | Confirmed same-side pivots within two broker ticks of the first cluster pivot, at least two confirmations. Historical pivot clusters only, not verified resting orders.                                                                                                        |
| POI ranking               | Active OB/FVG zones ordered by distance from quote midpoint, then same-frame/same-direction overlap count, then age. At most eight active and four recently resolved zones per frame; keep total counts so truncation is visible. This is not a confidence/profit score.       |

Confirmed structure/zones/pivot clusters reset at each verified broker-session
gap. No bar, pivot, imbalance or block bridges a closure. Standard EMA5/EMA19,
Wilder ATR15, RSI14 and ADX14 retain the supplied historical series, including
observed overnight true ranges; they do not synthesize missing bars or require
hours of fresh M15 warmup after each daily closure. Forty historical candles are
required per timeframe. Indicator configuration is the frozen candidate recipe,
not a new environment tuning surface or a change to production risk indicators.

A previous UTC-day high/low is called complete only with every expected bar over
that entire UTC day. Normal broker closures or short windows leave it explicitly
unavailable. This is not a fabricated previous trading-session high/low. Accurate
broker-session ranges require a later schedule-aware definition. News and
harmonics are explicitly NOT_COLLECTED / NOT_IMPLEMENTED; counterfactual costs are
null. No headline interpretation, external data purchase or harmonic fit is added.

## DOM and freshness limitations

The payload includes actual bid/ask level counts, total recorded-depth imbalance,
spread, top-level microprice bias and the existing 60-second sampled liquidity
changes/sample count. Empty liquidity makes imbalance/microprice unknown; zero
rolling samples makes change unknown. Shallow and symmetric-size ladders are
flagged. There are no fake distinct top-5/10/20 signals from a four-level book.

Depth is broker-specific. Its source clock is inherited from the latest broker
spot time and paired with local receipt, not an independently timestamped exchange
event. Samples do not establish executions-at-price, absorption or consolidated
gold order flow. The current feed may offer useful execution context without
predictive directional value. Deeper-feed availability remains a separate audit.

Existing OHLC quality rules apply: exact expected count, completed chronological
nonoverlapping bars, correct durations and only verified closure markers. Each
frame's latest close must be less than one timeframe old at the recorded snapshot.
Quote/book source and receipt must be ordered/aware and no older than three seconds
at that snapshot; analysis must precede snapshot by at most three seconds. Crossed,
duplicate-price, incomplete or discontinuous books reject. This is historical
snapshot validation, not a current trading permission; a replayed old input is
never relabelled live. Existing execution/provider/session gates remain separate.

## Qualification and next step

Focused tests cover causal confirmation/MSS prefix stability, OB formation and
invalidation, FVG availability/touch/fill, equal-level confirmation, gap reset and
indicator warmup, count/forming/future/stale/duplicate/malformed inputs, depth and
quote failures, zero/shallow liquidity, HTTP/schema parity, cache page integrity,
serialization/overlap conflict/clock/reset/failure behavior and client provenance.

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed on stable source
`6ef80f77de5d818f7648cd99e4b759b21beddfa456cdd8313b7a58de69ccc5b2`:
969 Node / 94 isolated PostgreSQL / 366 Python tests (1,429 total), Prettier,
ESLint, TypeScript/build, Python format/lint/mypy, schemas/migrations/fail-closed
suites, secret scanning and npm/Python dependency audits. Logs:
`/tmp/scalper-qualification-NKqqpm/checks/results.json`. No skipped database
qualification or failed audit was accepted. Existing Starlette/httpx TestClient
deprecation warning only. Final real-input timing/HTTP parity and preservation
checks are in the [sanitized receipt](evidence/technical-context-validation.json).
`graphify update .` completed AST-only, no API cost: 6,524 nodes / 12,258 edges;
known zero-node pyproject warning and community-name hub fallback. Tracked diff,
staged diff, final documentation formatting and the pre-commit secret scan are
checked separately. Hosted final-head checks must pass before merge. The isolated
review process was stopped; no persistent service was created or replaced.

No economic candidate comparison is asserted.
Register future comparison windows before any candidate inference/outcomes, retain
all abstentions/nonfills/open/gap/OCO paths and unknown counterfactual economics.
Keep #334/#338 immutable. A subsequent trading adoption needs its own reviewed
release, evidence/journal binding and qualified rollout; it cannot reuse these
preparation files as order authority.

Rollback: stop invoking candidate preparation and stop the isolated review
process. No active services, configuration, orders, journals, research checkpoints
or migration ledger need rollback.
