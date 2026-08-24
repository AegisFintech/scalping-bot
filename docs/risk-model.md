# Deterministic Risk Model

## Authority

The AI proposes price scenarios only. Deterministic code owns risk percent, volume, broker normalization, exposure, margin, eligibility, precision, freshness, spread/slippage, duplicate prevention, and mode gates. Materially invalid proposals are rejected, never silently corrected.

## Decimal arithmetic

Inputs arrive as canonical decimal strings and are parsed with arbitrary-precision decimal libraries. Binary floating-point is not used to compare execution levels or money. A price is valid only when `price / tick_size` is integral at broker precision.

Analytics feature decimals cross the Node/Python boundary with at most ten
fractional places. Python truncates toward zero using `Decimal`, matching the
risk parser's canonical string contract. For positive ATR and volatility inputs,
truncation cannot increase the value and therefore cannot relax an ATR-relative
spread or stop-distance check. Non-finite values fail before model or risk work.

## Position sizing

For one leg:

```text
risk_fraction = min(configured_base_risk_percent, configured_max_risk_percent, 5) / 100
risk_budget = max(0, account_equity * risk_fraction)
stop_ticks = abs(entry - stop_loss) / tick_size
loss_per_volume_unit = stop_ticks * tick_value_per_volume_unit
raw_volume = risk_budget / loss_per_volume_unit
normalized_volume = floor((raw_volume - min_volume) / volume_step) * volume_step + min_volume
```

The result is rejected if metadata is missing/non-positive, raw volume is below the minimum, normalized volume exceeds raw volume/risk budget/maximum volume, or broker units are unclear. Normalize down only. Recalculate realized maximum loss after normalization and reject any ceiling breach.

Tick value currency conversion and contract semantics must come from current
broker metadata/account currency. The adapter currently supports a matching
quote/deposit asset or a supplied conversion-rate provider; an absent conversion
blocks placement.

cTrader Open API reports both trade volume and symbol `lotSize` in hundredths
of a base unit. The adapter keeps broker-native integer volume for order calls,
uses `0.01` base units per native volume integer for notional and tick-value
calculations, and reports contract size separately as base units per lot. These
units must not be treated as whole lots.

## Reward-to-risk and levels

- Buy: `stop_loss < entry < take_profit`; buy-stop trigger/entry is above current ask plus broker distance.
- Sell: `take_profit < entry < stop_loss`; sell-stop trigger/entry is below current bid minus broker distance.
- `reward / risk >= MIN_RISK_REWARD_RATIO`, default `2`.
- Stop distance must meet broker/config minimum and not exceed configured ATR multiple.
- Entry/SL/TP/invalidation/expiration must all remain coherent at validation immediately before placement.

## Account and exposure checks

Reject when equity is missing/below floor; margin data is stale; estimated margin
exceeds available margin or configured usage; notional exceeds cap;
symbol/account currency conversion is unknown; open/pending counts exceed
limits; or any relevant state is uncertain. The configured setup risk is split
across the two OCO legs. Their normalized maximum losses are then added and must
remain within the single setup budget, which covers a possible
simultaneous-fill/cancellation race rather than assuming OCO is atomic.

## Daily loss lockout

The trading day is calculated in `DAILY_RISK_TIMEZONE`, default UTC. Baseline
equity is captured only after start-of-day account reconciliation. Broker capital
flows are queried and separated from trading P/L; unknown operation types or
missing flow history fail closed. Starting a broker-backed process after the
configured opening grace period without a persisted baseline also fails closed.
For a first demo startup after that grace, an authenticated operator may request
a one-time reconciled baseline while the environment emergency stop is active
and demo submission is disabled. The service rejects the request unless two
account-wide reconciliations are empty, cTrader deal history since the day
boundary is empty, capital-flow history is available, and no baseline already
exists. Initialization and its evidence counts are committed with an audit
event; an existing baseline is never overwritten.
Loss utilization includes trading P/L, fees/commissions, and configured negative
unrealized P/L:

```text
loss = max(0, baseline_equity - current_equity_adjusted_for_deposits_withdrawals)
utilization_percent = loss / baseline_equity * 100
```

At the configured threshold (default 10%): record a durable lockout, cancel strategy-owned pending orders safely, place no new orders, alert, and display status. Existing positions are not automatically closed by this control; their management needs a separately approved policy. Reset requires a new configured day plus successful reconciliation. AI cannot reset it.

## Spread protection

Adaptive mode evaluates all configured/available dimensions:

- absolute spread in broker points;
- spread basis points relative to midpoint;
- spread/ATR ratio;
- percentile against recent account/symbol history with a minimum sample;
- broker-session abnormality and reconnect/discontinuity flags.

Live mode refuses startup if every spread dimension is disabled. Missing ATR/history never turns protection off; an absolute conservative cap or explicit broker-reviewed fallback is required.

The current adaptive history is a bounded 24-hour account/symbol window backed
by one validated broker-source observation per UTC minute. At least 30 distinct
minutes are required by the protected demo configuration. Percentiles are
truncated toward zero to ten fractional places before crossing into risk. Quote
or database failure, invalid timestamp ordering/freshness, crossed prices, and
insufficient rows return no percentile and therefore retain
`SPREAD_HISTORY_MISSING` whenever the percentile gate is configured.

## Slippage

Allowed deviation is the stricter configured broker-native points and basis-points cap. A 1% price move is not an appropriate default scalping tolerance. Actual/simulated fills outside the cap are rejected where cancel is possible, otherwise flagged for reconciliation/risk handling; they never authorize size increases.

## Performance adjustment

Setup statistics are computed over a documented rolling window with exponential
decay and minimum sample size. Poor recent cohort results reduce contextual
confidence using bounded reason-coded deltas. The model must echo the
deterministic adjustment exactly and supply original plus adjusted confidence;
the validator recomputes the relationship. The adjustment can reject or lower
confidence but never increase permitted risk or volume. Exact tag-specific cohort
selection remains a future enhancement.

## Fail-closed reason codes

Examples include `RISK_METADATA_MISSING`, `RISK_TICK_VALUE_INVALID`, `RISK_VOLUME_BELOW_MIN`, `RISK_DAILY_LOCKOUT`, `RISK_MARGIN_STALE`, `RISK_EXPOSURE_LIMIT`, `SPREAD_UNSAFE`, `SLIPPAGE_POLICY_MISSING`, `PRICE_NOT_ON_TICK`, `STOP_DISTANCE_INVALID`, `REWARD_RISK_TOO_LOW`, and `ACCOUNT_STATE_UNCERTAIN`.
