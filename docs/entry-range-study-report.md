# Native entry-range observations — ISSUE-499

This is read-only prospective collection, not a new trading strategy or economic
qualification. The controlled demo stays on reviewed0.9 cost-balanced scalping,
with its original30-point STOP_LIMIT range, AI entry/TP/SL selection, GTD lifetime
and dynamic risk. This study cannot place/cancel orders, call a model, change
settings, or promote a candidate. Issue: https://github.com/AegisFintech/scalping-bot/issues/499.

Freeze one candidate:10 native broker points versus the acknowledged30 points.
Native point size is `10^-digits`, **not inferred from tick or pip size**. An
additive point receipt keeps strict integer digits0–12 (missing/boolean/invalid
is unknown), the unchanged1.0 normalized metadata receipt and both local clocks.
It is an independent endpoint response, never original acknowledgement metadata.
Only same-symbol receipts received before the callback within30seconds may link.
Original broker/source time, hypothetical fills/net/costs/margin stay unknown.

A private root-owned registration fixes the release, candidate, source hashes and
at most seven calendar days before a future full UTC hour. Seven days is a
collection batch, not sufficient validation. No older registration, method, oracle
or report changes. Source/release drift stops this observer only. No trading
restart or accounting change is needed for activation.

The dedicated existing SELECT-only Flight role runs two sandboxed oneshots:
metadata every30seconds and collection hourly at:09. Capture begins no earlier
than30seconds before the registered start. Each collection invocation processes
one oldest missing complete hour, with at least five minutes of settling delay.
It retains separate repeatable-read journal and acknowledgement snapshots and
bounded hash-verified Flight prefixes, then writes immutable input/report bytes.
Prefixes can be incomplete and are never described as sealed complete tick tapes.
A failed/unknown chain becomes explicitly unavailable; the order remains counted.
Retries use the first retained input, not a later favourable snapshot. Existing
reports must bind the expected registration, hour and retained input hash.

The report includes every exported order, with setup cohort role and current
order state **at the database snapshot**, not backdated state at the cutoff.
Provider WAIT contexts and carry-in/linked references remain visible. Counts
include original recorded fills, partial volume, fills without a closed-trade row,
closed rows before cutoff, no-recorded-fill orders, missing metadata/ACK/path and
recorded gaps. Fills with unordered clocks remain recorded unknown fills, never
no-fill observations; partial status is null when timing is uncertain. These are bounded journal observations, not proof of broker flatness
or a complete universe of opportunities. Role cohorts overlap between hours;
do not add closed/carry-in rows into a portfolio return.

Band counts require causal provider availability, exact mapped non-closing native
STOP_LIMIT acceptance, original30-point range/GTD/expiry/stop price and a prior
point receipt. Callback payload hash and event identity must agree. Local
`orders.submitted_at` never substitutes for acceptance. Quotes require ordered
source/receive/recording clocks before cutoff, fresh separately updated executable
ask for BUY or bid for SELL, after provider/acceptance evidence and before pending
expiry or an observed terminal event. No interpolation across recorded gaps.
Prices inside the sampled10/30-point bands are **not trigger or fill proof**.

Original deals within the candidate's adverse price ceiling (including favourable
prices below a BUY stop or above a SELL stop) are separate from those beyond it.
An original fill beyond10 points is not assumed to occur under the candidate;
an inside fill also does not prove the same fill time or outcome. No saved-loss,
missed-winner, counterfactual net or profitability claim follows from either.
Missing paths/partial/open/gap cases remain in the denominator and unknowns.

Storage is bounded to256MiB and50,000 files with a2GiB free-space reserve. Failures
stop research only, preserve existing bytes and emit safe errors. No automatic
archive deletion, trading credential access or financial DB write is authorized.
Collection stops after its fixed window (two-hour report grace), rather than
silently registering another experiment. Future collection or economic promotion
requires separate reviewed evidence.

Rollback: disable these two observer timers only; retain registration and all
inputs/reports. Existing Flight, provider, execution and dashboard are untouched.
Actual qualification, independent reviews, pushed delivery, frozen registration
and service readbacks are recorded on the issue. Tests alone are not qualification
of either entry range.
