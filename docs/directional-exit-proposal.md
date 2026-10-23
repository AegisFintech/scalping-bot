# Directional scalp exits — exact proposal for operator review

Depends on [ISSUE-368](https://github.com/AegisFintech/scalping-bot/issues/368) and
[ISSUE-356](https://github.com/AegisFintech/scalping-bot/issues/356).
**Proposed research definitions only. Not implemented, registered, qualified or
approved for broker execution.** Entry selection ships separately with unchanged
native stop/equal gross TP. These thresholds are hypotheses, not fitted optima,
promised net proceeds, a profitability claim or permission to close a position.

## Shared definitions and evidence

For the same approved entry and frozen quantity, let D be its unchanged native
fill-relative SL price distance. Let F be the deterministic exact-volume modeled
round-trip commission/known conversion cost expressed in price units; future
swap/FX/fees remain unknown where evidence is absent. Let S retain the current
execution reserves: 30 entry ticks and 65 exit ticks for ex-ante target comparison.
Use broker tick/pip precision and minimum target distances. Do not change the
stop, quantity, account risk, entry timing or another exit in the same comparison.

The 33 closed-trade baseline is negative before fees, but lacks executable sampled
paths to establish how often an early profit would have been available. No
counterfactual net result or best threshold is inferred from its complete subset.
Freeze new future candidate windows/code before collecting evaluation outcomes;
keep misses, latency, partial/unknown closes, gaps, costs and open/daily censoring.
Unknown counterfactual fees/swap/FX/margin stay null. A broker quote/green sample
never proves that a close would fill at that price. Compare independent days and
all eligible opportunities, not a chosen win-rate denominator.

## Candidate A — smaller native TP only

- Net price objective N = max(0.10 × D, 1.5 × F).
- Desired gross target distance = F + S + N; project onto the broker pip grid and
  verify the objective/fee coverage after rounding. Reject the candidate geometry
  if broker minimums/rounding make it at least as large as the unchanged D target;
  never widen SL or increase quantity to make it fit.
- Native SL remains D. No local giveback, time, break-even or trailing exit.
- Fees/reserves are modeled, not guaranteed. Exact native relative protection,
  failed/unknown amendments and restart proof must be qualified before any rollout.

This is a concrete cost-aware target to compare; it can still take minutes or
never fill. Smaller rewards may require a higher win rate merely to break even.
It is not evidence that 0.10 is economically superior.

## Candidate B — profit protection only

Keep the baseline native TP/SL. Compute estimated liquidatable net from the
actual fill and executable close side (bid for LONG, ask for SHORT), signed known
entry costs, estimated remaining closing fees and the existing 65-tick adverse
exit reserve. Quote-side spread is already in the executable mark; do not subtract
it twice. Missing exact scoped volume, conversion, cost, freshness or ownership
means no candidate trigger and explicit censored evidence.

- Arm once estimated liquidatable net in price units reaches 0.10 × D.
- After arming, track its peak. Proposed close trigger is net <=
  max(0.02 × D, peak − 0.05 × D).
- A jump below zero after arming still crosses that trigger; do not wait for green
  to return. Slippage/latency can make actual closing net negative despite the
  proposed positive floor. Never promise a profitable close.
- A future implementation would need an exact owned-position/volume re-read,
  native SL/TP retained until confirmed closed, a durable once-only close claim,
  no resend after timeout/unknown result, and complete broker deal/P&L proof.
  It cannot close protected/manual positions today: this remains unapproved.

A and B are separate experiments. Do not combine them, fit thresholds to winners,
turn either on automatically, change polarity or increase risk after losses.

## Pending-order limitation

GTC entries can outlive the plan's trend context. The directional release keeps
that existing authorization and does not add timed expiry or automatic structural
cancellation. A separately registered comparison can examine cancellation after
confirmed invalidation of the ORIGINAL range, preserving exact ownership,
fill/cancel races and unknown-command recovery. No reprice, chase, new provider
call with an active group, timer cancellation or production promotion is implied.

## Review boundary

Before either candidate is implemented, the operator should review these exact
rules plus the prospective sampled-path/cost/latency report. The seven-day path
collection is an initial measurement period, not qualification. Incomplete data
can support a software/observability fix; it cannot establish a profitable exit.
