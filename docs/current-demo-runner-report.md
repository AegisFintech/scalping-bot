# Current-contract screening and trial definitions — ISSUE-518

This additive module preserves every old replay, paired method and registration.
It describes current0.9 recorded lifecycle separately from conditional entry
hypotheses; it has no broker, model, sizing or promotion authority.

`python/backtest/current_scalp.py` reconstructs exact context/side/prices/GTD,
original mapped broker acceptance, fill receipt/volume, partial/open/manual close,
zero-fill terminal and signed-cost consistency at a fixed knowledge cutoff.
A local placement-result timestamp never substitutes for acceptance. Missing or
contradictory evidence is UNKNOWN. Native protection history availability is not
proof of fill-time stop risk or exact SL/TP cause. Range/queue counterfactuals and
closing proceeds remain null. Original trigger/range/GTD acknowledgement fields
absent from the bounded journal projection cannot be invented.

`python/research/idle_evidence.py` verifies original compressed and decompressed
bytes, manifest counts, source, sequence and clocks. Its STOP_LIMIT screening
requires observed trigger before observed limit-range eligibility, after actual
acceptance and before expiry. One-sided stale/unknown clocks, reconnects, missing
sequences and the sampled nature stay explicit. Expiry never proves broker terminal
state; post-trigger expiry races are not priced as invented fills. These are
conditional observations, not a queue simulation or continuous tick tape.

The finite catalogue `packages/config/src/demo-trial-catalogue.json` defines nine
unique profiles in five ordered batches: CODEX/local3/local5 entry, target0.4/0.6/1,
structural-stop buffers0/5/10ticks,180/60-second lifetime and30/10-point range.
The common prospective experimental exit uses a five-completed-M1 opposite range
anchor and declared fixed native target, subject to broker/cost validation. This
is a new test protocol, not a reinterpretation of old model-defined exits. No
experimental profile is active in this batch. Risk ceilings remain5% shared/2.5%
single leg; base target allowance5ticks and stress stop allowance65 remain distinct.

Python validates finite references, unique settings and one changed dimension per
batch. Repeated baseline IDs are replications, not different strategies. Conditional
screens use only completed contiguous M1/M5, three completed-M5 close direction,
unchanged original boundaries and recorded availability; they never clamp a line
or replace an actual recorded Codex WAIT. No hypothetical net is fabricated from
historical requests, and altered exits cannot invent later model requests.

Tests cover chronology, current/legacy separation, unreconciled expiry, partial
fills, manual closes/signed fees, immutable hashes, stale side clocks, nonfill
observations and catalogue dimensions. Full qualification, independent review and
future matched activation remain separate. The protocol/controller are #519/#520;
parent515 stays open until actual natural distinct-trial evidence exists.

Review corrections: the packet cutoff now censors future provider availability,
order/resolution/protection state; exact broker type, duplicate/terminal conflicts,
position-side/remaining-volume and per-position close chronology fail unknown.
All sums run in an isolated100-digit Decimal context, including30-significant-digit
mismatch regressions. Only freshly updated relevant-side evidence after acceptance
can produce a trigger observation. The complete focused suite covers these boundary
failures; they are not trading losses or qualification successes before correction.

Final chronology regressions additionally require provider availability before
intent, acceptance before terminal evidence, and monotonic relevant-side source
clocks.31 focused current/idle tests and the three-module mypy check pass.

Full combined qualification passes: 1302 Node, 157 database and 1313 Python tests (2772 total), every required gate and dependency audit. Independent Standards and Spec reviews found no remaining blocker after chronology corrections. Receipt: `docs/evidence/current-demo-runner-validation.json`. This source is not activated and does not close the natural experiment acceptance criteria.
