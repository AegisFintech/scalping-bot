# Deterministic risk model

ISSUE-076 applies the operator-authorized fixed percentage policy to the reusable
scenario implementation. Local `scenarioOco` constructs prices only; `OcoRiskEvaluator` remains
the sole sizing/margin authority. Outside demo, the account risk cap reserves
remaining daily capacity before allocating risk;
there is no absolute account-equity floor.
Both race-exposed legs share the same cost-inclusive
budget. One durable intent consumes a map; no averaging, retries after uncertain
submission, or model-selected risk increases are introduced. Stops/targets remain
broker-held. The new candidate does not automate discretionary structural/time
closes; those remain separately tested research. See [the report](reusable-scenario-report.md).

Current policy: `market-stop-v2`. ISSUE-086 replaces production scenario targets with two direct entry prices and removes spread/ATR/target-room/count strategy filters. Money management and data/lifecycle integrity remain; see [the exact scope](direct-entry-report.md). All money authority lives in the existing
risk engine and execution coordinator. The model cannot select size, leverage,
risk, broker precision, credentials, mode or a reset.

Release `0.2.2-fixed-risk.4` corrects account P/L matching for pending orders. The broker can report
zero P/L for a position identity reserved by an accepted, unfilled order. Exactly
one matching order, explicit zero executed volume, and zero gross/net P/L are required
to accept that extra row. All open positions still require exactly one P/L row;
unknown, duplicate, nonzero unmatched, partially filled and other-symbol exposure
remain blocked. Pending orders retain their OCO risk reservation and exposure count.
This changes neither risk percentages nor entry/stop/target distances. See
[the repair evidence](pending-order-reconciliation-report.md).

The separate chart-scenario research runner uses the same `sizePosition`, spread
and commission functions. Each confirmed directional entry is capped at the old
half-setup budget; it does not claim the unused opposite leg's budget. It retains
daily remaining budget, bounded reduction multipliers, capital floor, notional,
margin and minimum-volume checks. These inputs must come from trusted reconciled
state for future broker integration; a research fixture is not such evidence.
Structural stops, first-target exits, confirmation invalidation and a ten-minute
maximum hold are explicit candidate assumptions, not production policy changes.

## Demo development admission (ISSUE-094)

The operator authorized continuous demo development at the existing shared 1%
current-equity setup ceiling. `capitalAdmission` runs only after successful daily
and capital reconciliation/persistence. Demo uses multiplier 1 and a 1% cap even
when stored daily/high-water thresholds are exceeded. It does not reset baselines,
locks, loss percentages, flow history or trades. The accounting algorithm below
continues recording those measurements; its locks/reductions and remaining daily
capacity still govern other modes. Reverting the release re-enforces retained
locks, rather than beginning a fresh risk epoch.

Current account/data/storage failures, affordability, costs, broker margin,
volume increments, ownership, OCO races and protection still constrain demo.
One percent is shared across both legs and is a modeled ceiling; slippage and
broker failures can exceed it. Repeated demo losses reduce subsequent monetary
budgets with current equity. This is data collection for development, not model
training or evidence of profitability. See [implementation](demo-development-risk-report.md).

## Fixed policy and capital limits

Risk percentages are hard-coded in `packages/config/src/policy.ts`: **1% of
current reconciled equity per setup**, **5% of the cash-flow-adjusted UTC day's
starting-equity baseline as the daily loss budget**, and the existing **5%
high-water drawdown lock**. No absolute starting-equity floor is required.
At the operator's request, revision `.3` removes both the old fixed-dollar and
intermediate five-times-equity notional caps, and the unrelated 1% margin-use cap.
One percent refers to modeled loss at the stop, including costs, not collateral.
Broker leverage is unchanged. Sizing retains broker maximum/step volume and exact
margin requirements. Free margin must cover both legs plus a reserve equal to one
modeled setup loss. ISSUE-086 removes the absolute/ATR/percentile spread filters and daily order-count ceiling.

This explicitly raises the prior 0.001% setup / 1% daily policy at the operator's
request. It does not establish improved expectancy. One percent is a modeled
ceiling, not a required exposure: costs, volume increments, remaining daily
capacity, broker volume/margin and adverse-condition reductions can lower actual size.
There is no leverage increase or upward rounding to make the trade reach 1%.

One setup is admitted only with certain reconciled state. Positions/pending
orders, partial fills and cancellation/reconciliation uncertainty block new risk.
Other-symbol account exposure is treated as unpriced and blocks placement, rather
than assuming zero correlated exposure. Manual orders are not cancelled.

## Sizing and OCO race exposure

For each leg, derive a stop-only upper volume, then search downward on the broker
volume grid for a cost-inclusive volume inside half the setup budget:

```text
setup budget = min(equity * 1% * risk multiplier, remaining daily loss budget)
leg budget = setup budget / 2
modeled leg loss = stop ticks * tick value * native volume
                + conservative opening/closing commissions
                + thirty ticks * tick value * native volume
                + conservative P/L conversion-fee reserve
```

Commission is estimated at the highest bounded entry/stop price plus the adverse
execution allowance. Minimum commissions are included. Ten ticks are an explicit
model reserve, not a claim that a stop caps realized slippage. Stop gaps can exceed
it and are modeled adversely in research. Spread is already represented by
executable entry/exit sides and is not added a second time to realized P&L.

The grid search respects minimum, maximum and step, including an off-grid broker
maximum. Both modeled losses are added against the one setup budget. Before sizing, each
leg receives half the shared broker free margin after reserving one full setup
loss. Total collateral cannot exceed equity or available broker margin. Volumes are floored to that allowance instead of
rejecting an otherwise affordable smaller order. Exact broker margin is confirmed
at final volume, with at most two further downward recalculations for margin tiers.
Discovered currency conversion is required for fees and exposure calculations. Unavailable fees/conversion/metadata, insufficient margin or an
unaffordable minimum rejects. No martingale, averaging down or loss chasing exists.

cTrader volume and lotSize are in hundredths of a base unit. Orders retain native
integer volume; metadata provides scale, tick value, commission and currency
conversion. Unsupported conversions or commission types block. Account currency
is discovered from broker metadata. See the official
[cTrader model definitions](https://help.ctrader.com/open-api/model-messages/).

## Daily and lifetime capital accounting

ISSUE-091 is a separately authorized one-time fresh demo accounting transition
after inaccessible hosted history. Its new local database uses freshly reconciled
baseline evidence, preserves the historical archive separately, and retains all
subsequent lock/reduction persistence. Money management remains dynamic against
current equity, drawdown, remaining daily capacity, costs and broker margin;
the percentage limits below are unchanged. See [activation evidence](fresh-local-demo-report.md).

The existing reconciled UTC daily baseline and broker capital-flow history remain
authoritative. Missing history or a missing late-start baseline fails closed.
Signed flows are strictly parsed; NaN cannot turn a daily lockout into false.
Utilization is rounded upward to eight decimal places. The remaining monetary
budget is rounded down and caps every new setup, including a final risk-cap check.
Daily lockout is durable until the next valid day; neither AI, a policy update,
nor restart resets it. The returned admission budget uses the persisted lock,
including a lock latched by an overlapping reconciler. Open losses count via equity;
deposits and withdrawals adjust flows, not profit. At a 4.9% daily loss only the
remaining 0.1% of the baseline is available for the next combined setup.

`capital_risk_state` begins at the first reconciled observation after migration.
It does not invent historical intraday high-water marks or reset daily losses.
The reference uses the account observation timestamp; regressed observations reject.
All broker capital flows since that reference through the current account observation
are queried again, including across
restarts/downtime. Flow-history failure blocks new risk. Deposits/withdrawals adjust
capital, not trading performance. A transaction/advisory lock protects the high
water and persisted reduction state.

- At 2% drawdown or 2.5% daily loss, multiplier is at most 0.5.
- At 4% drawdown or 3.75% daily loss, multiplier is at most 0.25.
- At 5% drawdown, lockout and zero multiplier persist across deposits/restarts.
- A nonlocked reduction recovers only below **both** 1% drawdown and 1.25% daily
  loss. It returns at most to the original fixed policy, never above it.
- There is no automatic drawdown-reset endpoint. An operator-reviewed capital
  transition and evidence are required to change a locked reference.

## Entry guidance (ISSUE-092)

Prompt `entry-pair-v2` asks for nearby M1 support/resistance and candle-based
order-block confluence. Its preference for about one recent M1 range of entry
distance is guidance, not a reinstated ATR/corridor rejection or a deterministic
fill-time guarantee. No price clamping, new order gate or timer cancellation is
added. Shared cost-inclusive setup sizing, daily/drawdown state and local
fee-buffered TP/double-SL remain unchanged.

## Price validation and exits

Schema 2.1 still requires two conditional legs. The production exit hypothesis
remains the first whole-pip TP whose expected net exceeds a full round-trip fee,
with SL twice TP. Model output remains immutable; effective values must fit inside
its technical target, stop and invalidation envelope. Current experiments do not
establish a better production relationship.

ATR-derived bounds may have ten decimal places. Dividing by two can create an
extra decimal internally. The transform now floors upper bounds and ceils lower
bounds onto the mandatory pip grid before the fee search. This eliminates a
reproduced `INVALID_DECIMAL` bottleneck while tightening the feasible interval.
Strict boundary precision is unchanged.

Production uses model entry prices directly without the former 0.25–0.75 ATR preferred corridor or 2.5-ATR entry cap. The 3-ATR stop ceiling and model first-target-room check are removed; broker minimum distances, affordability and local fee-buffered exits remain. The 180-second local proposal deadline, capped by the
five-minute map, authorizes fresh submission only. ISSUE-083 production orders use
explicit GTC with no pending timer expiry. No model or stale proposal can create
new orders after its authorization deadline. Sizing still occurs immediately before
submission; volume is not automatically enlarged while an order waits. Broker
margin checks, order cancellation and gap/slippage exposure remain relevant at a
later trigger. A support/resistance level is not guaranteed to stay useful forever.

Both pending legs keep their combined risk reservation until certain cancellation,
fill or closure. Daily/drawdown emergency cancellation remains independent of AI.
Normal process restarts preserve broker GTC orders; the broker-held SL/TP stays
attached to eventual fills. No evidence yet establishes positive expectancy for
this operator-selected lifecycle. See [lifecycle report](persistent-order-loop-report.md).

ISSUE-084 treats a confirmed zero-fill terminal peer as an incomplete pair and
cancels its remaining owned pending order. No timer is added. Failed cancellation,
racing fills and unresolved events retain reconciliation blocks; unfilled cleanup
is not a trade close and cannot grant the post-close refresh exception. Durable
peer cancellation also retries after partial fills. Local SL/TP and sizing remain
unchanged. See [recovery report](oco-pair-recovery-report.md).

## Scenario target mapping (ISSUE-080)

The fee-buffered fixed TP must fit before the first actual target on each side:
`recovery_targets[0]` for buys and `extension_targets[0]` for sells. The former
sell check incorrectly used `extension_below`, an intermediate continuation
trigger, as the target. This could discard both legs when an otherwise valid TP
lay slightly past that trigger but well before the supplied downside target.
Release `.6` corrects that mapping; it does not widen TP, SL, risk, the entry
distance bound or expiry, and never skips the first target to reach a later one.
Freshness, full semantic validation and the existing money manager remain required.
This contract correction does not establish positive net expectancy.

## Failure behavior

Maintenance is independent of inference. Pause prevents new analyses; emergency
stop also requests strategy-owned pending cancellation. Existing positions keep
broker protection and are not implicitly flattened. Partial fills, double OCO
fills, duplicate callbacks and disconnect recovery retain the existing durable
journal. Multiple partial closing deals remain fail-closed pending reconciliation;
this overhaul does not claim unsupported broker lifecycle completion.

Testing proves rejection/idempotency properties, not profitability or maximum
realized loss. See `overhaul-report.md` for stress assumptions and missing evidence.

ISSUE-079 sizing comparison uses the same recorded prices, current broker metadata
and cost assumptions, not a profitable backtest. At the observed million-dollar
demo equity, the old USD 5,500 notional cap admitted only 0.01 lot. The current
policy admits much larger affordable volumes. The intermediate 1% collateral
ceiling was removed in ISSUE-079; broker margin/volume constraints and the reserved
setup-loss capacity still apply. Treat the 1% loss budget as a maximum, never a
requirement to force leverage or spend every dollar of risk. See the current
[equity-sizing report](equity-sizing-recovery-report.md).

ISSUE-087 reserves 30 ticks of adverse slippage per leg for production STOP
execution (previously 10), using the same reserve in minimum-volume affordability
and final OCO sizing. This is a conservative demo assumption following an observed
17-point trigger gap, not an empirically established tail bound. TP remains the
local fee-buffered distance and SL remains twice TP. Both are relative to actual
fill. Sizes decrease on identical inputs; the 1% shared setup budget, 5% daily
budget and drawdown locks are unchanged. A STOP becomes a market order and can
slip beyond this reserve; neither the reserve nor the broker stop guarantees a
maximum realized loss. Existing fill monitoring latches uncertainty beyond
30 points or 2 bps while preserving fills and peer cancellation; matching terminal
recovery clears the latch. [Demo evidence](market-stop-report.md).

### Post-fill protection verification

ISSUE-093 retains fee-buffered TP, twice-TP SL, shared 1% OCO risk and the
30-point modeled slippage reserve. Independent repairs use actual fill VWAP,
inward rounding and tighter existing protection. New close authority applies
only to a freshly confirmed owned demo position with no broker SL, after repair
is impossible or two attempts fail. Quotes alone never authorize closing a
position that has an SL. The exact position/volume is re-read before a durable
close claim; unknown dispatch is never retried. Historical and current closes
require matching deal/P&L evidence. No global pause, daily/drawdown reset, size
increase or widening is introduced. Existing SL/TP exits remain broker managed.
Stop and emergency-close execution can slip or fail; neither modeled risk nor
this recovery path guarantees a realized loss ceiling. See
[implementation and limits](missing-stop-recovery-report.md).

## Unsubmitted entry recovery (ISSUE-097)

A readable model response does not authorize execution. Prompt v3 states exact
buy-above-ask / sell-below-bid boundaries, including the broker minimum and tick.
An additional max(two ticks, current spread) buffer is guidance only: it is not a
new distance gate and does not widen a stop, target or position. Fresh quote checks
retire an unusable unsubmitted pair instead of changing its price. One bounded
replacement request is permitted for an original successfully completed context;
failure/unknown-dispatch, active exposure and all sizing/semantic checks remain.
Retirement cannot follow intent, and a retired map cannot create intent. Existing
GTC positions/orders and the shared current-equity 1% budget are unchanged. This
improves recovery behavior; it does not establish better returns or continuous fills.
