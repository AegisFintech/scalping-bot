# Model Contract 2.1

## Purpose

The model receives deterministic market/performance context and returns a bounded proposal. It has no authority to select volume, risk percent, account, broker IDs, mode, credentials, or execution eligibility.

The normative response schema for new requests is
`schemas/model-response-2.1.json`. Prompt `system-v5` is current; immutable
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
- never calculate or suggest final position size or exceed deterministic policy;
- always return both conditional proposals after deterministic input eligibility
  has passed, including when evidence is conflicting or confidence is low.
- return a technical map with a decision zone, support/resistance zones, exact
  buffered breakout/breakdown confirmation prices, and ordered targets. The OCO
  entries must equal those confirmation prices, and each effective midpoint TP
  must equal the first corresponding target.
- provide the pre-transform reward distance required by the supplied proposal
  R:R. The request says that execution preserves entry/SL and divides TP
  distance by two, supplies both proposal and effective minimum R:R values, and
  requires an even whole-tick TP distance so the midpoint stays tick-aligned.
- keep each entry-to-SL distance at or below the supplied
  `max_affordable_stop_distance`. This is a derived non-sizing limit; the request
  still excludes equity, risk budget, broker volume, and account identity.

## Mandatory proposal

Contracts 2.0 and 2.1 have no decision field, no `NO_TRADE` value, and no per-leg enabled
switch. The presence of the two required stop objects means only that the model
proposed two conditional scenarios. It does not mean an intent was recorded or
an order was queued, submitted, accepted, or filled.

For `system-v3` and later requests, the exact parsed response remains immutable. The
execution coordinator separately derives each effective TP as
`entry + (proposed_tp - entry) / 2`, recomputes the diagnostic R:R, and records
both original and effective values in validation details. Entry and SL are not
changed. An off-tick midpoint or invalid Decimal rejects rather than rounding.

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

The validation pipeline first validates the exact AI proposal against the
pre-transform minimum R:R, then validates the audited TP transform, and finally
validates the effective proposal against the configured execution minimum R:R.
Both proposal stages require exact symbol and analysis ID; plausible
`generated_at`; future `valid_until` within expiry policy; leg expirations that
match and do not exceed `valid_until`; ordered waiting bounds; side-correct
entry/SL/TP; entry beyond current bid/ask and broker distance; minimum R:R;
tick/precision alignment; current quote and symbol metadata; stop-distance
limits, including the recomputed broker-minimum affordability ceiling;
deterministic performance-adjustment consistency; margin/sizing
feasibility; and inactive lockouts. Data quality was already accepted by the
deterministic analytics boundary before the model request.

Schema 2.1 additionally requires every technical zone and target to be
tick-aligned and directionally ordered. `waiting_area` must equal
`technical_map.decision_zone`; each stop entry must equal its named confirmation
price; and the proposal/effective validation phases independently prove that
the configured TP transform resolves to the first technical target.

`risk_reward_ratio` must agree with recomputed price distances within strict
Decimal tolerance at each stage. Material discrepancies reject the response.
Semantic failures and transform details are persisted as reason-coded
validation results and create no order.

The request includes current bid/ask, digits, tick size, broker/configured
minimum stop distance, minimum reward-to-risk, maximum ATR stop distance,
non-sizing maximum affordable stop distance, and expiry bounds. It excludes
account money, risk budget, broker volume, account IDs, and execution authority.

## Request payload modes

`full` contains configured completed candle histories for all timeframes with timestamps, OHLCV, ATR(15) Wilder, EMA(5/19) close, enabled indicators, and quality flags.

`compact` contains configured raw tails plus latest/sloped indicators, returns,
normalized ATR, rolling/session/previous-session ranges, pivots without
look-ahead, VWAP distances, EMA alignment, realized volatility, volume stats,
spread, depth imbalance/concentrations/changes, setup/session aggregates,
drawdown/loss context, and every relevant timestamp. The defaults retain the
newest 60 M1, 36 M5, and 24 M15 completed raw candles. Deterministic analytics
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
PostgreSQL stores one durable bytea artifact per analysis.
legacy requests retain their recorded prompt version and use an explicitly
labelled tracked-artifact fallback in Streamlit. Full redacted user JSON and
the parsed response are restricted to the authenticated dashboard/database
boundary, while Better Stack continues to receive only bounded summaries.
