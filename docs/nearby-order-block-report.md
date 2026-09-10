# ISSUE-092 — Nearby support/resistance and order-block entries

Release `0.2.5-market-stop.5`, policy `market-stop-v1`.
[Issue #215](https://github.com/AegisFintech/scalping-bot/issues/215).
Status: implemented; all required checks passed; authorized demo resumed.
[Exact validation and runtime evidence](evidence/nearby-order-block-validation.json).

## Problem and approved scope

At 12:26 SGT on September 10 the existing demo STOP entries were 4420.92 and
4393.29, a gap of 27.63. The independently sampled quote was 4413.91 / 4414.03;
the arithmetic mean of the last 14 completed M1 true ranges was 0.94. This is a
dated observation, not a forecast of time to fill. The original prompt requested
nearby structure without specifying which history should determine entries.

The operator requests tight local support/resistance with smart-money order
blocks, simple code, an updated Graphify graph, and explicitly no five-minute
review. This release changes provider guidance and its identity wiring only.

## Definition and implementation

`prompts/entry-pair-v2.md` uses the latest 10 completed M1 candles, prioritizing
the latest 5. It selects the nearest relevant local resistance above ask and
support below bid, with a preference for entry distances around one recent M1
range or less when structure supports them. Older M1/M5/M15 history remains
available as context; distant outer/session levels should not replace nearer
microstructure. This is model guidance, not a numerical entry cap.

A bullish block is the final bearish candle before an upward completed
displacement closing above a preceding swing; a bearish block reverses those
directions. Displacement body must exceed the preceding three M1 bodies' median.
The block spans its candle's full low/high; a later completed close through its
far edge invalidates it. Fresh nearby blocks are preferred. These are explicit
candle-pattern conventions for this prompt, not observations of institutional
orders or a universally established SMC definition. The general opposing-candle
and structure-break interpretation is described by
[FXOpen](https://fxopen.com/blog/en/order-blocks-and-breaker-blocks-of-the-smart-money-concept/amp/).
The lookback, displacement comparison and range preference are this release's
assumptions; no performance improvement has been established.

The model supplies breakout STOP prices outside nearby support/resistance,
with a small spread/tick-aware outward buffer and broker minimum distances.
It must not confuse a demand-zone pullback buy limit with a buy stop, invent
blocks, assume future confirmation, interpolate across a broker session gap,
or substitute remote levels merely because those look stronger. An absent
block does not add a separate gate to ordinary nearby support/resistance.

One `ENTRY_PAIR_PROMPT` constant supplies the path and version to the provider,
HTTP prompt verification and durable pre-dispatch journal. Version/content/hash
mismatches still reject. Old `entry-pair-v1.md` bytes remain intact. The shared
artifact type admits v2; price request/response schemas and SQL shapes do not
change, so no schema replacement or migration is required. Exact prompt bytes
and available response text remain recorded by the existing storage contract.

## Preserved behavior

- Two readable model entry prices; the local engine owns TP, SL and volume.
- Dynamic sizing from current equity, remaining daily capacity, drawdown,
  costs, broker margin and increments; unchanged 1% shared setup and 5% daily
  ceilings and durable loss locks.
- GTC STOP/OCO, fill-triggered peer cancellation and broker-held exits.
- No timer review, expiry, automatic repricing, order-block rejection, price
  clamping, extra provider retry or new environment key.
- Existing freshness, precision, ownership, reconciliation, risk and idempotency.

Prompt guidance cannot guarantee tight output, an early fill or profitability.
Fixtures establish software behavior, not an SMC trading edge. Model compliance
and demo broker observations must be reported separately from test results.

## Verification and rollout

All 22 required gates passed: formatting, lint, TypeScript/build, 620 Node tests,
36 schema tests, three migration tests, five PostgreSQL/TLS integration tests,
Python formatting/lint/types and 161 tests, sample/populated policy and startup
checks, replay/backtest/scenario fixtures, secret scanning and both dependency
audits. A test-only lint finding was corrected with a request-body type guard;
full lint/type checks and 68 focused tests passed afterward. Exact commands and
results are linked above. No dashboard behavior or layout changed.

Graphify was refreshed with `graphify update .`, then three inline source-grounded
concepts and nine explicit links connected the prompt, identity and report.
`graphify cluster-only .` regenerated the report/HTML. A path query verifies
`ENTRY_PAIR_PROMPT → entry-pair-v2.md`. No external API inference was used. The
existing zero-node `pyproject.toml` parser warning remains; community names are
structural hub labels. Final graph counts are in the evidence.

At 12:38:16 SGT new analyses were paused for the reviewed rollout. A one-time
owned-pair cancellation was acknowledged at 12:38:19; independent broker
reconciliation at 12:38:47 confirmed zero orders and zero positions. Matching
AI/execution services restarted, passed readiness/startup checks, and retained
the pause. Daily/capital values and locks were byte-for-byte equal before and
after restart; the existing 0.5 drawdown reduction remained active. The populated
environment was byte-identical. All five PM2 services were online, with no cached
model/database/release/risk/automation overrides. The supervisor state was saved.

Automatic demo analysis resumed at 12:39:06. The first new request used exact
DeepSeek routing and prompt v2 with a matching stored content hash, all 480
completed candles, and recorded response text. It returned in 6,666 ms:
**buy 4409.00 / sell 4407.74**, versus captured bid/ask **4408.40 / 4408.50**.
Distances were **0.50 / 0.66** and total gap **1.26**. This verifies a nearby
response on one observed input, not consistent future compliance, an inferred
block identity, time-to-fill or profitable performance.

Execution status at 12:39:58 confirmed both new orders PENDING with GTC and null
pending expiry: buy 4409.00 (SL 4407.94 / TP 4409.53) and sell 4407.74
(SL 4408.80 / TP 4407.21). The independent broker observation is recorded in the
linked evidence.

The original distant GTC pair remains immutable in cancellation/history evidence.
No timer review or recurring repricing was introduced. No manual cycle was run.
Targeted checks exercise actual numeric/image HTTP routes, exact provider prompt
transport, version/content/hash mismatch rejection, and durable prompt evidence
before a failed provider dispatch. Existing GTC, dynamic-risk and failure tests
remain in the required suite.

Deploy matching AI/execution builds under an authenticated analysis pause.
Reconcile the existing owned pair before a one-time rollout replacement; a racing
fill remains an open protected trade. Accepted orders have no newly added timer.
Do not reuse an unconsumed v1 proposal: finish its existing setup or wait for its
original five-minute validity to expire before resuming the new release.
Preserve the environment, database, all historical artifacts and risk state.
No manual cycle, accounting reset or live mode is part of this rollout.

Rollback uses the previous matching AI/execution release under the same pause
and reconciliation procedure. Preserve completed/active setup evidence and risk
state; wait out a still-fresh unconsumed proposal before resuming. No database
downgrade, prompt history rewrite or automatic cancellation of manual orders.
