# Model Contract 2.1

## Purpose

The model receives deterministic market/performance context and returns a bounded proposal. It has no authority to select volume, risk percent, account, broker IDs, mode, credentials, or execution eligibility.

The normative response schema for new requests is
`schemas/model-response-2.1.json`. Prompt `system-v13` is current; immutable
earlier prompts plus schemas 1.0 and 2.0 remain available to interpret
historical runs.
`additionalProperties: false` applies to every object. Decimal execution values
are strings, original and adjusted confidence values are bounded integers,
arrays and strings are length-limited, and timestamps use ISO-8601 formats.

## Runtime instructions

The versioned system prompt tells the model to:

- analyze the supplied deterministic completed-candle EMA/ATR image together
  with its exact numeric candles, indicators, session, depth, spread, quality,
  and bounded performance context;
- describe possible structure/SMC interpretations as uncertain evidence, not objective facts;
- output JSON only, matching the supplied schema;
- return a waiting area and one mandatory buy-stop and sell-stop proposal with
  TP, SL, expiration, confidence, invalidation, concise evidence codes, risk
  flags, and warnings;
- reduce confidence after sufficiently sampled related losses;
- treat durable net P/L as authoritative, distinguish gross P/L from signed
  terminal fees, and count gross-positive/net-nonpositive closes as losses;
- never calculate or suggest final position size or exceed deterministic policy;
- always return both conditional proposals after deterministic input eligibility
  has passed, including when evidence is conflicting or confidence is low.
- return a technical map with a decision zone, support/resistance zones, exact
  buffered breakout/breakdown confirmation prices, and ordered targets. The OCO
  entries must equal those confirmation prices, and each JSON TP must equal the
  first corresponding technical target;
- place the first technical target at or beyond the supplied minimum
  fee-buffered TP distance and place its stop/invalidation at or beyond
  the supplied `2 * TP` effective stop floor. Execution chooses the nearest
  whole-pip fee-buffered TP within that envelope and uses numeric
  reward/risk `0.5` (reward:risk `1:2`). The endpoint does not calculate fees or
  volume;
- put each BUY/SELL confirmation inside its supplied inclusive, tick-aligned
  `buy_preferred_entry_*` or `sell_preferred_entry_*` band. Each preferred band
  is inset by `entry_latency_buffer_atr` inside the containing hard
  `buy_entry_*` or `sell_entry_*` range. The hard ranges already apply current
  executable quote side, broker/configured minimum distance, and the maximum
  M1-ATR reachability cap;
- keep each entry-to-SL distance inside the inclusive
  `minimum_stop_distance`/`maximum_stop_distance` range. The maximum includes
  the ATR cap and derived non-sizing affordable ceiling; the request still
  excludes equity, risk budget, broker volume, and account identity;
- set `valid_until` and both expiries exactly to `preferred_expires_at`. An
  expired response is never extended or reused.

The configured minimum/maximum expiry lifetime is measured from the trusted
pre-model broker capture used to derive `preferred_expires_at`, not from the
later post-inference wall clock. This prevents ordinary bounded inference
latency from shortening an otherwise exact requested lifetime. A response whose
expiry is already at or before post-inference validation time still rejects.

## Mandatory proposal

Contracts 2.0 and 2.1 have no decision field, no `NO_TRADE` value, and no per-leg enabled
switch. The presence of the two required stop objects means only that the model
proposed two conditional scenarios. It does not mean an intent was recorded or
an order was queued, submitted, accepted, or filled.

The exact parsed response remains immutable. For current `system-v13` requests,
the execution coordinator separately selects the smallest whole-pip effective
TP whose expected net after opening commission, closing commission, and
positive-P/L conversion fees is strictly greater than one full estimated
round-trip fee at broker minimum volume. It sets
effective SL distance to exactly twice effective TP distance, recomputes numeric
reward/risk as `0.5`, and records original/effective levels plus fee evidence.
The selected effective exits must remain inside the AI technical target and
stop/invalidation envelope. An off-tick result, unsupported commission model,
missing currency conversion, or invalid Decimal rejects rather than assuming a
fee or rounding. Historical prompts retain their versioned transformations.
For demo placement, cTrader receives the validated protection as distances from
the actual fill, not stale absolute exits from the requested stop price. The
entry is a stop-limit with configured positive-integer slippage points. Neither
transport representation changes the immutable AI response or lets it bypass
the deterministic fee, risk, precision, or final-volume checks.

Deterministic analytics owns input/data eligibility before inference. Model
warnings, risk flags, regime, and confidence remain visible diagnostics but
cannot veto the proposal. If required input is missing or invalid, the
orchestrator never calls the model. Provider refusal, malformed output, or a
proposal that cannot satisfy strict price/expiry semantics still fails closed.
If broker/configured minimum distance already exceeds the maximum ATR-relative
stop distance, the coordinator records an unsatisfiable deterministic constraint
and does not call the model; this avoids repeatedly requesting an impossible
proposal.

No free-form prose appears outside the JSON. Evidence, tags, warnings, and flags use bounded code strings. Example prices in documentation/fixtures are inert test data.

## Structured output request

For Responses-compatible endpoints, the request uses the documented `text.format` JSON Schema form with `strict: true` when supported. Chat-compatible endpoints use their JSON-Schema response format. Endpoint claims are not trusted: response status, refusal/incomplete conditions, byte/token limits, single-JSON parsing, schema validation, and semantic validation are always checked locally. Official OpenAI API documentation recommends JSON Schema structured output over older JSON mode for supporting models.

## Local schema validation

Reject:

- malformed JSON, duplicate/trailing JSON, extra prose, or oversized output;
- missing/extra fields, invalid enums, non-canonical decimals, excessive arrays/strings;
- credentials, account fields, broker IDs, position size, volume, executable text, URLs, or unsupported schema versions;
- legacy decision fields, `NO_TRADE`, enabled/disabled leg switches, and an
  AI-controlled data-quality acceptance boolean;
- response/refusal/incomplete states that do not contain one valid output object.

## Semantic validation

The validation pipeline first validates the exact AI proposal, then validates
the audited commission-aware exit policy, and finally validates the effective
proposal against configured numeric reward/risk `0.5`.
Both proposal stages require exact symbol and analysis ID; plausible
`generated_at`; future `valid_until` within expiry policy; leg expirations that
match and do not exceed `valid_until`; ordered waiting bounds; side-correct
entry/SL/TP; entry beyond current bid/ask and broker distance; minimum R:R;
tick/precision alignment; current quote and symbol metadata; stop-distance
limits, including the recomputed broker-minimum affordability ceiling;
deterministic performance-adjustment consistency; margin/sizing
feasibility; and inactive lockouts. Data quality was already accepted by the
deterministic analytics boundary before the model request.

Both proposal and final-placement validation recompute the BUY distance from
current ask and SELL distance from current bid and reject a confirmation beyond
the configured M1-ATR reachability cap. A nearer quote never permits an entry
inside the broker/configured minimum stop distance.

Schema 2.1 additionally requires every technical zone and target to be
tick-aligned and directionally ordered. `waiting_area` must equal
`technical_map.decision_zone`; each stop entry must equal its named confirmation
price; and the original proposal proves that each JSON TP is the first technical
target. Effective validation proves that the nearer commission-aware TP remains
inside that target and its `2×` SL remains inside the endpoint stop and
invalidation envelope.

`risk_reward_ratio` must agree with recomputed price distances within strict
Decimal tolerance at each stage. Material discrepancies reject the response.
Semantic failures and transform details are persisted as reason-coded
validation results and create no order.

The request includes current bid/ask, digits, tick/pip size,
broker/configured minimum stop distance, the minimum commission-covering TP
distance, the `2×` SL policy, maximum ATR stop distance, non-sizing maximum
affordable stop distance, and expiry bounds. It excludes account money, risk
budget, broker volume, account IDs, commission rates, and execution authority.

## Request payload modes

`full` contains configured completed candle histories for all timeframes with timestamps, OHLCV, ATR(15) Wilder, EMA(5/19) close, enabled indicators, and quality flags.

`compact` contains configured raw tails plus latest/sloped indicators, returns,
normalized ATR, rolling/session/previous-session ranges, pivots without
look-ahead, VWAP distances, EMA alignment, realized volatility, volume stats,
spread, depth imbalance/concentrations/changes, setup/session aggregates,
drawdown/loss context, and every relevant timestamp. The defaults retain the
newest 30 M1, 18 M5, and 12 M15 completed raw candles. Deterministic analytics
still computes all features from the full configured 600/500/300 histories;
only duplicated raw arrays crossing the paid model boundary are shortened.

Payloads are redacted and size-bounded before transport. The exact non-secret
versioned system prompt and its SHA-256 are persisted for each new request. The
execution-side client requires both to match the local tracked artifact, not
merely a self-consistent hash or version label.
The analytics image is bounded to 1 MiB and validated as a 1600x1200 PNG at the
analytics client, AI client, persistence boundary, and dashboard display. Its
SHA-256 and provenance are included in the numeric message. The base64 bytes
travel in the typed loopback AI call and provider multimodal content, while
PostgreSQL stores one durable bytea artifact per analysis. The provider request
may set the separately validated `AI_REASONING_EFFORT=low|medium|high`;
unsupported values reject at startup. Reasoning effort does not alter the JSON
schema or grant execution authority. Provider aborts and connection failures
are normalized to finite reason codes; free-form upstream errors do not cross
into execution status or logs.
legacy requests retain their recorded prompt version and use an explicitly
labelled tracked-artifact fallback in Streamlit. Full redacted user JSON and
the parsed response are restricted to the authenticated dashboard/database
boundary, while Better Stack continues to receive only bounded summaries.
