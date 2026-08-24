# Model Contract 1.0

## Purpose

The model receives deterministic market/performance context and returns a bounded proposal. It has no authority to select volume, risk percent, account, broker IDs, mode, credentials, or execution eligibility.

The normative response schema is `schemas/model-response-1.0.json`.
`additionalProperties: false` applies to every object. Decimal execution values
are strings, original and adjusted confidence values are bounded integers,
arrays and strings are length-limited, and timestamps use ISO-8601 formats.

## Runtime instructions

The versioned system prompt tells the model to:

- analyze supplied completed candles, indicators, session, depth, spread, quality, and bounded performance context;
- describe possible structure/SMC interpretations as uncertain evidence, not objective facts;
- output JSON only, matching the supplied schema;
- return a waiting area and one buy-stop and sell-stop proposal with TP, SL, expiration, confidence, invalidation, concise evidence codes, and risk flags;
- reduce confidence after sufficiently sampled related losses;
- never calculate or suggest final position size or exceed deterministic policy;
- select `NO_TRADE` when evidence/data are insufficient.

## Response decisions

- `PLACE_OCO`: both legs must be enabled and semantically valid.
- `NO_TRADE`: both legs must be disabled; fields retain schema shape but are ignored for execution.

No free-form prose appears outside the JSON. Evidence, tags, warnings, and flags use bounded code strings. Example prices in documentation/fixtures are inert test data.

## Structured output request

For Responses-compatible endpoints, the request uses the documented `text.format` JSON Schema form with `strict: true` when supported. Chat-compatible endpoints use their JSON-Schema response format. Endpoint claims are not trusted: response status, refusal/incomplete conditions, byte/token limits, single-JSON parsing, schema validation, and semantic validation are always checked locally. Official OpenAI API documentation recommends JSON Schema structured output over older JSON mode for supporting models.

## Local schema validation

Reject:

- malformed JSON, duplicate/trailing JSON, extra prose, or oversized output;
- missing/extra fields, invalid enums, non-canonical decimals, excessive arrays/strings;
- credentials, account fields, broker IDs, position size, volume, executable text, URLs, or unsupported schema versions;
- response/refusal/incomplete states that do not contain one valid output object.

## Semantic validation

The validation pipeline requires exact symbol and analysis ID; plausible
`generated_at`; future `valid_until` within expiry policy; leg expirations that
match and do not exceed `valid_until`; ordered waiting bounds; side-correct
entry/SL/TP; entry beyond current bid/ask and broker distance; minimum R:R;
tick/precision alignment; current quote and symbol metadata; stop-distance
limits; deterministic performance-adjustment consistency; margin/sizing
feasibility; inactive lockouts; and acceptable data quality.

`risk_reward_ratio` must agree with recomputed price distances within strict Decimal tolerance. Material discrepancies reject the response. Semantic failures are persisted as reason-coded validation results and create no order.

## Request payload modes

`full` contains configured completed candle histories for all timeframes with timestamps, OHLCV, ATR(15) Wilder, EMA(5/19) close, enabled indicators, and quality flags.

`compact` contains configured raw tails plus latest/sloped indicators, returns, normalized ATR, rolling/session/previous-session ranges, pivots without look-ahead, VWAP distances, EMA alignment, realized volatility, volume stats, spread, depth imbalance/concentrations/changes, setup/session aggregates, drawdown/loss context, and every relevant timestamp.

Payloads are redacted and size-bounded before transport. Full request/response storage is restricted and redacted; hashes and version metadata support audit comparison.
