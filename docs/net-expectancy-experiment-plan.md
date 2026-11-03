# Net-expectancy experiment programme

Prepared2026-11-03 after primary-source research and read-only operating review.
This is a concrete implementation backlog, not a strategy activation, experiment
registration or promise of a positive day. The operator prioritises frequent DEMO
experimentation and continuous follow-through; additional demo funding is available.
The existing bot remains the only broker executor. tc01 coordinates research and
tc02 supplies isolated compute; their existing fixed receivers are reused.

## Objective and measured starting point

Target positive after-cost daily expectancy, more useful trades and fewer large
losses. Report the share of positive/negative/flat Singapore days, average net/day,
loss tail/drawdown, exposure, fill frequency and all unfilled/unknown opportunities.
A single green day is a milestone, not economic qualification. Deposits/withdrawals
are separate cashflows. Broker closed-net, marked open P/L, estimated closing costs
and known/unknown model expenditure remain separate; open marks never become closes.
Singapore reporting is an additional view, not a reset of UTC accounting.

At02:35UTC the current0.9.2 source had zero groups/fills since deployment. Since
the previous15:22UTC handoff it had468 completed WAIT decisions and five FAILED
contexts, not468 paid-call attestations. The research collector had23 continuous
verified half-hour windows/480 overlapping origins through02:00UTC. Threshold
observations are not executable fills or profitable trades. The code-generation
lane remained TASK_ALREADY_PRESENT after its holding-payoff task. These facts
explain the missing loop; they do not establish an edge for a replacement.

The0.8 historical audit had10 wins totalling935.79USD and four losses totalling
6184.61USD: net-5248.82 after fees. Its variable quantities and old release cannot
qualify current strategies. See [the complete audit](loss496-review.md).

## The first economic assumption to test

Current policy requires modeled net target reward >= modeled net stop loss. In
the simplified USD/no-conversion case, target distance T, stop distance S and
commission-plus-exit-reserve c give T >= S+2c. A representative recorded model
input c ≈ 0.888 includes0.65 from the65-tick reserve and ≈ 0.238 modeled commission.
Thus T must be roughly S+1.776. This is a conservative admission assumption, not
an observed fee debit; it excludes sub1.0 targets regardless of direction quality.
The exact current conversion/volume formula remains authoritative.

First decompose actual signed commission, spread-side geometry, observed price
differences and stress allowance. Measure profit-taking and losing exits separately,
including touched-but-not-closed cases; do not calibrate only successful TP closes.
Keep the existing conservative loss-sizing reserve. A separately reviewed DEMO
experiment policy can test different target-side allowances and net reward/loss
ratios, with positive modeled target proceeds under explicitly stated base costs.
Stress results remain visible even when negative; a pilot need not pretend it
already has statistically proven profitability. No current guard changes in this plan.

Native cTrader TP and SL both close at the best available market price. A trigger
or green sample is not guaranteed closing proceeds. An explicit LIMIT is a separate
instruction with a different nonfill trade-off. [Official order semantics](https://help.ctrader.com/trading-with-ctrader/orders/).

## Ordered delivery, with an actual trading milestone

| Order | Deliverable and existing issue                           | Concrete acceptance                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Execution/cost evidence and WAIT attribution; #289/#400  | Per-side source/receive clocks while idle as well as during orders; source-pinned bounded recordings, gaps and retention manifests. Actual fee reconciliation and separate base/stress exit allowances; numeric reasons for each rejected entry/geometry. Known paths distinguished from modeled/unknown fills.                                                                               |
| 2     | Current-contract experiment runner; #400                 | Add a separate0.9/catalog-compatible module, preserve frozen0.8/paired/OHLC oracles. Reconstruct actual baseline lifecycle against broker evidence; test STOP_LIMIT activation/range, GTD races, fill-relative protection, costs, partial/open/manual outcomes and gaps. Replay screening can reject ideas; it cannot certify hypothetical fills/profit.                                      |
| 3     | Reviewed finite DEMO trial catalogue; #403               | A versioned operator-approved experimental protocol and additive schema/migration where needed. Same main bot runs one registered candidate at a time, with fresh account/risk and immutable native protection. Software/operationally qualified candidates may enter bounded demo trials before an economic edge is proven. Actual fill/close/net and nonfills become the experiment result. |
| 4     | Recurring next-experiment controller and /learning; #402 | Complete one trial, interpret it, choose/register a DIFFERENT eligible trial and run again without a manual stage nudge. Retain rejected/negative/unknown cases and all attempted variants. Show current hypothesis, inputs, trial/source, sample/coverage, costs/net, wait reason and next action. Existing signed publishing/independent review handles code changes.                       |

First engineering target: a qualified cost/tape preflight and executable catalogue
specification in the first workday, then the first registered broker DEMO pilot
as soon as its implementation, exact-head checks/review and activation checks pass.
This is a delivery target, not a guaranteed trade, completion date or positive day.
Do not wait for a perfect historical simulator or months of data before admitting
an explicitly experimental demo pilot. The runner must label modeled uncertainty
honestly, and the real demo supplies actual execution evidence. A code defect or
missing risk/protection evidence still blocks deployment/orders.

## Small sequential experiments

Do not run a giant cross-product or continually retune the same holdout. Freeze
one dimension per batch, including the baseline, before outcomes. Start with no
more than six named variants per batch; the first TP batch has four.

1. **Entry availability first.** Compare the current Codex proposal process with
   two explicit trend-continuation baselines: a completed-three-M1 compression
   boundary and a completed-five-M1 boundary, each with a one-native-tick breakout
   buffer and completed M5 trend direction. Use the same exit/risk rules for this
   entry batch. This is a proposed test definition, not an accuracy claim. Record
   costs/entry distance, quote crossing during inference, rejection and nonfill.
   Codex receives local SMC/DOM/candidate context and provides an auditable decision.
   The separately selected local-baseline trial may supply deterministic proposals
   under the new reviewed protocol; it is a visible alternative proposal source,
   never a silent override of a WAIT or a forced broker submission. The old
   production contract continues requiring its original model-derived plan.
2. **Native TP.** With one entry definition and unchanged structural-stop rule,
   compare baseline native TP against0.40/0.60/1.00 XAUUSD PRICE-UNIT targets.
   These are initial hypotheses, not recommended settings or assumed broker pips.
   Apply actual tick/min-distance constraints, volume-aware fees and the declared
   base exit allowance. Reject a target that cannot cover those costs. Current
   0.9 policy rejects much of this catalogue; testing requires the new protocol,
   not removing its version-bound checks. Actual costs above a proposed target
   can make even a target-hit trade lose net.
3. **Structural SL and reward/risk.** Hold the chosen entry/TP candidate fixed and
   compare the same completed-candle invalidation anchor with0/5/10 native-tick
   stop buffers, subject to valid broker geometry. Reward/risk is derived from
   distances AND costs, not a magic1:7 setting. Include all losers and evaluate
   uncertainty; choosing a provisional pilot is not declaring a profitable winner.
4. **Timing and execution.** Compare60/180-second capture-based entry lifetime,
   then original30 versus10 native-point STOP_LIMIT range, in separate batches.
   Narrower range can reduce worse fills and increase nonfills. Triggered expiry
   is not terminal proof. Keep each accepted order's original contract.
5. **Faster exits.** Only after native-TP measurements, compare native-only with
   one separately implemented early-profit rule or30-second no-progress time
   exit, one at a time. A profit trigger must use executable bid/ask, actual entry
   charges, declared future-cost estimate and measured closing delay. Preserve
   native SL/TP, exact ownership, partial/manual reconciliation and durable
   non-replayable close intent. A green trigger does not guarantee a green fill.

Clockwork means event-driven reconciliation after every trade and an operational
review after20 closed trades OR60 market-open minutes, whichever occurs first.
This checkpoint is not statistical qualification. Allocate the next predeclared
trial only after owned orders/positions are conclusively terminal; never cancel
or close exposure merely to hit a review/trade quota. Session closures and normal
freshness/cooldown gates automatically resume when valid. Offline work continues
under existing compute/token budgets. Every trial has a predeclared allocation,
cutoff and early-stop/retirement rule; exhausting allocation advances the agenda,
not the account's risk limits. Unknown commands remain query-only.

## Fair evaluation and use of the machines

Use prior data for development; freeze later comparison windows before outcomes.
Balance trial blocks across sessions using a predeclared schedule, rather than
assigning a promising variant only to favourable periods. Report results by session,
spread/cost band and official event timing. Overlapping paths are not independent;
rotate one candidate in the ONE demo, and do not add overlapping offline variants
into a fictional portfolio. Changing exits also changes later AI/entry opportunities:
fixed-request comparisons are conditional, not full-strategy counterfactuals.

Use tc02 for bounded local-CPU screening, with no model call per parameter/tick.
Use tc01 for relevant next-question selection, registration and result interpretation.
Codex focuses on experiment design/context and review. The fast order/protection
path stays deterministic. A future cached strategy-playbook design would require
its own validity/consumption contract; do not reuse a consumed model plan now.

Add compressed idle bid/ask evidence from the existing market-data path without
another trading session or delaying callbacks. Preflight actual recorder/remote
capacity first: generic tc02 SSH is not configured on the main host; the existing
forced scoring transport is not a shell. Retain hashes before transfer/eviction,
keep the2GiB main reserve and bounded cache, and mark dropped/unavailable paths.
Sampled input stays labelled sampled. Data shortages trigger a specific collection
or actual-demo experiment, not invented executions or an indefinite generic audit.

Initial external data: broker-local DOM plus timestamped official BLS/Fed calendar
annotations. No purchased news/global-order-book feed is needed to start. Add a
feature only through a declared incremental comparison. Broker DOM is not all
world gold liquidity; candle order blocks/FVGs do not establish actual resting orders.
[Primary-source evidence and validation limits](net-expectancy-primary-research.md).

## Delivery and completion contract

Reuse existing worker containment, signed publisher, aloycwl independent review,
CI and release verification. New code/data manifests stay source/parameter-bound.
A fully enumerated reviewed DEMO catalogue permits automated experimental
allocation within that protocol; it does not grant open-ended economic promotion.
A newly generated rule outside it needs its own review/release. Historical study
code, registrations and reports remain unchanged; coordinate new source segments
with honest right-censoring. Preserve all accounting, losses and unknown claims.

Keep current dynamic sizing,5% shared setup/2.5% single-leg ceilings, broker margin,
volume increments, account/session freshness, reconciliation and native protection.
New deposits can change reconciled equity/quantity through existing rules; they do
not count as profit or erase the earlier track record. No fixed-lot multiplication,
new demo executor, live authority or forced order/provider dispatch.

Complete THIS programme only after the scheduler naturally completes and reports
actual broker evidence for at least two distinct registered trading experiments,
chooses the next action, records every outcome/unknown and demonstrates duplicate/
restart recovery. A merged audit helper, heartbeat, test count, threshold touch or
one green day is insufficient. A statistically credible profitable strategy remains
an additional economic result, with its own uncertainty and later evidence.

## Planning validation

Both fresh independent Standards and Spec reviews are clear after fixing Markdown
approximation rendering. Changed-document formatting and secret scanning pass.
Executable source fingerprint573c6c3d927dccfc5797704b022e39740ec21c225edc24dd599fcc2bd620059e
remains identical to the corrected2,725-test qualified implementation; this is not
a new trading experiment or profitability test. Fresh exact-head hosted checks
and separate review precede planning delivery. Programme515 stays OPEN.
