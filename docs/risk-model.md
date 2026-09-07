# Deterministic risk model

ISSUE-076 applies the operator-authorized fixed percentage policy to the reusable
scenario implementation. Local `scenarioOco` constructs prices only; `OcoRiskEvaluator` remains
the sole sizing/margin authority. The account risk cap reserves remaining daily capacity before allocating risk;
there is no absolute account-equity floor.
Both race-exposed legs share the same cost-inclusive
budget. One durable intent consumes a map; no averaging, retries after uncertain
submission, or model-selected risk increases are introduced. Stops/targets remain
broker-held. The new candidate does not automate discretionary structural/time
closes; those remain separately tested research. See [the report](reusable-scenario-report.md).

Current policy: `fixed-risk-v2`. All money authority lives in the existing
risk engine and execution coordinator. The model cannot select size, leverage,
risk, broker precision, credentials, mode or a reset.

The separate chart-scenario research runner uses the same `sizePosition`, spread
and commission functions. Each confirmed directional entry is capped at the old
half-setup budget; it does not claim the unused opposite leg's budget. It retains
daily remaining budget, bounded reduction multipliers, capital floor, notional,
margin and minimum-volume checks. These inputs must come from trusted reconciled
state for future broker integration; a research fixture is not such evidence.
Structural stops, first-target exits, confirmation invalidation and a ten-minute
maximum hold are explicit candidate assumptions, not production policy changes.

## Fixed policy and capital limits

Risk percentages are hard-coded in `packages/config/src/policy.ts`: **1% of
current reconciled equity per setup**, **5% of the cash-flow-adjusted UTC day's
starting-equity baseline as the daily loss budget**, and the existing **5%
high-water drawdown lock**. No absolute starting-equity floor is required.
`MAX_POSITION_NOTIONAL` remains an explicit exposure authorization; the current
local value is unchanged. The 1% margin-use ceiling, 10-point absolute spread cap,
0.10 ATR spread cap, historical percentile cap and 100-order daily ceiling remain.

This explicitly raises the prior 0.001% setup / 1% daily policy at the operator's
request. It does not establish improved expectancy. One percent is a modeled
ceiling, not a required exposure: costs, volume increments, remaining daily
capacity, notional, margin and adverse-condition reductions can lower actual size.
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
                + ten ticks * tick value * native volume
                + conservative P/L conversion-fee reserve
```

Commission is estimated at the highest bounded entry/stop price plus the adverse
execution allowance. Minimum commissions are included. Ten ticks are an explicit
model reserve, not a claim that a stop caps realized slippage. Stop gaps can exceed
it and are modeled adversely in research. Spread is already represented by
executable entry/exit sides and is not added a second time to realized P&L.

The grid search respects minimum, maximum and step, including an off-grid broker
maximum. Both modeled losses are added against the one setup budget; both margins
are added against available margin and the margin-use ceiling. Actual broker
margin estimates are rechecked at the final sized volume. Notional is capped per
position in account currency using the discovered quote conversion. Unavailable fees/conversion/metadata, insufficient margin or an
unaffordable minimum rejects. No martingale, averaging down or loss chasing exists.

cTrader volume and lotSize are in hundredths of a base unit. Orders retain native
integer volume; metadata provides scale, tick value, commission and currency
conversion. Unsupported conversions or commission types block. Account currency
is discovered from broker metadata. See the official
[cTrader model definitions](https://help.ctrader.com/open-api/model-messages/).

## Daily and lifetime capital accounting

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

Preferred entries remain 0.25–0.75 completed-M1 ATR from the executable side,
inside the hard 2.5-ATR cap. Preferred expiry is 60 seconds from pre-model capture,
hard maximum 120 seconds. Inference cannot extend validity; changed completed
candles, moved-through entries or expired plans reject. Broker-held STOP_LIMIT
slippage and relative SL/TP are documented in
[cTrader order messages](https://help.ctrader.com/open-api/messages/).

## Failure behavior

Maintenance is independent of inference. Pause prevents new analyses; emergency
stop also requests strategy-owned pending cancellation. Existing positions keep
broker protection and are not implicitly flattened. Partial fills, double OCO
fills, duplicate callbacks and disconnect recovery retain the existing durable
journal. Multiple partial closing deals remain fail-closed pending reconciliation;
this overhaul does not claim unsupported broker lifecycle completion.

Testing proves rejection/idempotency properties, not profitability or maximum
realized loss. See `overhaul-report.md` for stress assumptions and missing evidence.
