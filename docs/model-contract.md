# Model Contract 2.0

## Purpose

The model receives deterministic market/performance context and returns a bounded proposal. It has no authority to select volume, risk percent, account, broker IDs, mode, credentials, or execution eligibility.

The normative response schema for new requests is
`schemas/model-response-2.0.json`; the immutable 1.0 schema and system prompt
remain only to interpret historical runs.
`additionalProperties: false` applies to every object. Decimal execution values
are strings, original and adjusted confidence values are bounded integers,
arrays and strings are length-limited, and timestamps use ISO-8601 formats.

## Runtime instructions

The versioned system prompt tells the model to:

- analyze supplied completed candles, indicators, session, depth, spread, quality, and bounded performance context;
- describe possible structure/SMC interpretations as uncertain evidence, not objective facts;
- output JSON only, matching the supplied schema;
- return a waiting area and one mandatory buy-stop and sell-stop proposal with
  TP, SL, expiration, confidence, invalidation, concise evidence codes, risk
  flags, and warnings;
- reduce confidence after sufficiently sampled related losses;
- never calculate or suggest final position size or exceed deterministic policy;
- always return both conditional proposals after deterministic input eligibility
  has passed, including when evidence is conflicting or confidence is low.

## Mandatory proposal

Contract 2.0 has no decision field, no `NO_TRADE` value, and no per-leg enabled
switch. The presence of the two required stop objects means only that the model
proposed two conditional scenarios. It does not mean an intent was recorded or
an order was queued, submitted, accepted, or filled.

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

The validation pipeline requires exact symbol and analysis ID; plausible
`generated_at`; future `valid_until` within expiry policy; leg expirations that
match and do not exceed `valid_until`; ordered waiting bounds; side-correct
entry/SL/TP; entry beyond current bid/ask and broker distance; minimum R:R;
tick/precision alignment; current quote and symbol metadata; stop-distance
limits; deterministic performance-adjustment consistency; margin/sizing
feasibility; and inactive lockouts. Data quality was already accepted by the
deterministic analytics boundary before the model request.

`risk_reward_ratio` must agree with recomputed price distances within strict Decimal tolerance. Material discrepancies reject the response. Semantic failures are persisted as reason-coded validation results and create no order.

The request includes current bid/ask, digits, tick size, broker/configured
minimum stop distance, minimum reward-to-risk, maximum ATR stop distance, and
expiry bounds. It excludes account money, risk budget, broker volume, account
IDs, and execution authority.

## Request payload modes

`full` contains configured completed candle histories for all timeframes with timestamps, OHLCV, ATR(15) Wilder, EMA(5/19) close, enabled indicators, and quality flags.

`compact` contains configured raw tails plus latest/sloped indicators, returns, normalized ATR, rolling/session/previous-session ranges, pivots without look-ahead, VWAP distances, EMA alignment, realized volatility, volume stats, spread, depth imbalance/concentrations/changes, setup/session aggregates, drawdown/loss context, and every relevant timestamp.

Payloads are redacted and size-bounded before transport. The exact non-secret
versioned system prompt and its SHA-256 are persisted for each new request. The
execution-side client requires both to match the local tracked artifact, not
merely a self-consistent hash or version label.
legacy requests retain their recorded prompt version and use an explicitly
labelled tracked-artifact fallback in Streamlit. Full redacted user JSON and
the parsed response are restricted to the authenticated dashboard/database
boundary, while Better Stack continues to receive only bounded summaries.
