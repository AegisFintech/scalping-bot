# ISSUE-387 — Native TP audit and entry evidence

Issue: https://github.com/AegisFintech/scalping-bot/issues/387.

## Scope and findings

The operator approved investigating the recorded native TP crossing, then recording
entry context and comparing touch, small price buffers and completed-M1 confirmation
read-only. The deployed trading source remains `0.7.3-quick-oco.1-codex.1`:
STOP_LIMIT/GTC/OCO, gross TP0.40, SL7.00, dynamic shared5% demo ceiling, original
promptv4 and all gates/protection/reconciliation remain unchanged. No entry filter,
round-number snapping, prompt change, forced provider/order or strategy promotion.
Only the separate SELECT-only Flight observer and research tools change.
The existing reader receives SELECT on only the newly needed context/candle
columns; no schema, financial data or write authority changes. Market/execution
processes reference the same verified private environment file with no initial
credential/symbol overrides observed; this does not reconstruct historical liquidity.

The descriptive cohort includes **all14 scoped intents** created from
2026-10-27T03:54:41.136842Z through06:41:11.521592Z, including unfilled/unfinished
setups. This was selected after observing results and is **not prospective evidence**.
[Retained full14-intent diagnostic](evidence/entry-trigger-review.json) and
[independent sanitized broker history](evidence/entry-broker-history.json).
Its generating source is retained with the private immutable baseline. Final
source adds a stricter recursive storage guard; the frozen snapshot is not rewritten.
It is a trigger/path diagnostic, not ISSUE-253 economic paired replay. No hypothetical
orders, fill prices, net profit, fees, swap, FX or margin are manufactured. All
existing frozen registrations/reports remain untouched.

For the loss raised by the operator:

- Codex's recorded context preferred **SELL**, describing declining M15/M5 and a
  four-M1 holding range4006.65–4008.36. The exact returned execution levels were
  BUY4008.45 / SELL4006.56. The current dual OCO policy authorized either leg;
  model direction does not restrict the pair to trend-following.
- Actual BUY fill4008.70 at05:15:27.367Z was0.25 above its4008.45 trigger.
  Prior fresh broker snapshots reported native TP4009.10 / SL4001.70.
- Four fresh, updated bid observations at05:19:03.987/04.357/05.073/06.524Z were
  4009.15/4009.16/4009.13/4009.10. Hash-chain verification and prior protection
  observation times support the recorded crossing, not an executable-fill claim.
- A separate read-only authenticated broker history query matched the exact local
  position, entry and close, with complete order/deal histories over05:14–05:31Z.
  Entry type6 STOP_LIMIT carried relativeTP40000 / relativeSL700000 in protocol
  units. Its closing type4 STOP_LOSS_TAKE_PROFIT order retained limitPrice4009.10,
  stopPrice4001.70 and trigger method1. Actual close was4001.49 at05:30:14.950Z.
  Gross−1773.66 plus signed fees−59.11 equals net**−1832.77**.
- This rules out a merely missing TP value or a wrong0.40 distance in the inspected
  normalized/protocol fields. It **does not identify why the earlier quote did not
  execute the native TP**. Historical trigger-time broker liquidity/receipt/trigger
  diagnostics are unavailable. Normalized historical events omit some raw fields;
  current metadata cannot reconstruct them. Broker-side investigation remains
  necessary ([separate unresolved issue #388](https://github.com/AegisFintech/scalping-bot/issues/388)); no broker fault, intentional suppression or guaranteed missed profit
  is inferred, and no message was sent to anyone.

The same bounded cohort also contains native TP crossings followed by positive
closes. Crossing alone is not proof of failure. The next diagnostic priority is
the broker's historical TP trigger/execution explanation for the exact loss.
Do not replace this unresolved question with a wider target, larger lots or a
new market-close fallback. Those are separate economic/execution changes.

## Entry context recording

`load_setup` adds an optional `entryContext` to new Flight lifecycle/summary records.
Existing1.0 records remain readable and are never rewritten. The projection binds
exact request/prompt hashes, capture/provider-availability times, original model
levels, preferred direction, tick/spread and movement-buffer guidance. It computes
5/10-completed-M1 envelopes separately and explicitly leaves the model's exact
selected box null: buffered prices/prose cannot identify it reliably.

Nearby5/10-price-unit round levels include signed distances from both model entries,
observed M1 touches and close crossings. Touch counts are candles, not independent retests. They describe historical reactions, not
proven clustered orders, institutional intent or a new entry filter. Round-level
liquidity remains null. Available DOM summary/hash is broker-only: this loss's
recorded book was four levels each side, symmetric, imbalance0, with SHALLOW_BOOK
and SYMMETRIC_SIZE_LADDER warnings. It cannot establish global gold order flow or
absorption at4000/4010. No extra information is sent to Codex in this work.

Invalid, future/forming/gapped/stale candles, crossed/invalid quotes, unsupported
precision, missing/oversized input and unavailable provenance produce explicit
UNAVAILABLE context. Every leg records actual mapped broker acceptance, separately
from the local placement-result timestamp. Exact group/order ownership and closing
order exclusion bind those acceptance observations.

## Read-only comparison and limits

Frozen candidate definitions: TOUCH, additional0.05/0.10/0.20 **price-unit** buffers,
and completed-M1 close strictly outside the original model boundary. With the
observed0.01 pip/tick, buffers are5/10/20 broker pips, respectively. These are
research choices, not optimized or approved trading settings. Original entries
already contain model-selected offsets; an additional buffer is distinct.

The comparison gates each side on actual provider availability and that exact
leg's broker acceptance; it never substitutes `orders.submitted_at`. BUY triggers
use ask and SELL triggers bid; subsequent observed moves use executable opposite
quotes. References are quotes, never hypothetical fills. First observation already
beyond a threshold is not a proven observed crossing. M1 confirmation requires a
fully post-admission completed candle and its first recorded local availability,
then a later eligible quote: candle end alone cannot backdate entry. Compact
snapshot marker DECISION_COMPACT_V1 is storage provenance, not a market-quality
fault; other snapshot flags and candle flags are rejected.

Original GTC orders have no invented timer expiry. Both candidate-side signals
remain visible; near-simultaneous signals are OCO-race ambiguous, not two assumed
wins. A recorder ending after the actual trade does not complete a delayed
candidate's path. Gaps, partial side updates (candidate quotes require both sides updated), restarts, stale/duplicate/out-of-order
quotes, daily cutoffs and right-censored/unknown paths remain explicit. Missing M1
confirmation evidence is not proof that the market never closed outside a box.
All candidate fill/net economics stay null; no win-rate ranking or promotion.
The retained result has8 actual entries/8 canonical closes and56 candidate rows
with observed signals/14 without observed signals. Every candidate path is censored.
These70 rows are14 setups ×5 diagnostics, not70 trades. The snapshot contains165
usable completed-M1 observations with first recorded availability. For the loss,
the M1-close SELL signal is only locally evidenced at05:30:23.486221Z, after the
actual close; using the earlier candle end would invent earlier eligibility.

An implementable candle-close strategy would also need fresh submission authority
and broker-distance validation when confirmation arrives. This diagnostic does
not model those new orders. A larger offset can miss or chase a move and an old
accepted GTC context is not permission to submit a new delayed order.

## Prospective collection

A new, separate30-day registration freezes this diagnostic code, exporter, recorder,
existing paired primitives, policy/prompt, schemas and dependencies before its future
start. Each daily window settles for10minutes. The bounded SELECT-only runner writes
at most one missing daily report per invocation, with exclusive read-only input and
report files; retries reuse exact saved input. Source/registration or running-release
drift halts research only. It never controls the bot, makes provider calls, changes
orders or rewrites prior studies.30days is a collection batch, not qualification.

Budgets: at most1000 intents/window,128KiB exact input projection,16MiB exported
input/report,32MiB decoded per Flight chain,1000 recorder sessions/review,512MiB
study storage with headroom and2GiB free disk. Oversize/incomplete/mutated chains
fail visibly. Hashes prove retained-byte integrity, not authenticity of broker
prices or guaranteed execution. Missing sources are retained as unavailable rows.

## Validation and delivery

Positive/failure tests cover context, invalid provenance, actual acceptance,
causal M1 knowledge, buffer delays, OCO ambiguity, partial/gapped/cutoff paths,
TP crossing evidence, gzip/hash mutations, prospective registration/drift and
isolated PostgreSQL scope/compact-candle queries. Required full qualification,
secret/dependency scans, refreshed AST Graphify, pushed reviewed PR and exact-head
green checks precede observer-only activation. Exact results and operational
receipts are linked on the issue. No trading service restart or economic rollout
is needed. Old observer artifacts/registrations remain frozen.

Rollback stops only the new research timer and repoints the Flight service to its
previous384 artifact. Preserve all new/old recordings, registrations and reports.
No database migration, financial reset, bot restart or cancellation is required.

## Final delivery qualification

Full `PYTHONDONTWRITEBYTECODE=1 node scripts/qualify.mjs` passed all required
format/lint/type/build/schema/migration/lifecycle/replay/fail-closed/recovery, secret
and both dependency-audit gates: **1,126 Node +124 PostgreSQL +485 Python =1,735 tests**.
Both sample and populated policy/startup checks pass; populated settings remain
unchanged. The new reader's column-scoped SELECT smoke and retained report schema
validation pass. AST Graphify is refreshed without provider calls. One existing
upstream FastAPI/httpx deprecation warning remains.

[Exact qualification, commands, corrections and limits](evidence/entry-evidence-validation.json).
PR/observer activation receipts are appended to the issue after delivery; they do
not rewrite frozen baseline evidence or imply an entry strategy was promoted.
