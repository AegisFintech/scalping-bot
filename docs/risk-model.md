# Deterministic Risk Model

## Authority

The AI always proposes two conditional price scenarios after deterministic
input eligibility passes. Its confidence, risk flags, regime, and warnings are
diagnostic only. Deterministic code owns risk percent, volume, broker
normalization, exposure, margin, eligibility, precision, freshness,
spread/slippage, duplicate prevention, and mode gates. Materially invalid
proposals are rejected, never silently corrected.

The current execution exit policy preserves entry, chooses the smallest whole
broker-pip TP whose expected net profit after fees is strictly greater than one
full estimated round-trip fee, and sets SL distance to exactly twice that TP
distance. At the minimum ratio `1`, gross TP is therefore strictly greater than
twice fees. This is reward:risk `1:2`, represented internally as numeric
reward/risk `0.5`. Prompt `system-v13`
asks the endpoint for a technical target/stop envelope that contains those
effective levels. The coordinator uses Decimal arithmetic, rejects off-tick or
unsupported fee inputs without rounding, and keeps the original endpoint
response, effective values, and fee evidence separately auditable.

The coordinator derives tick-aligned preferred entry bands inside the unchanged
hard executable entry limits. `ENTRY_LATENCY_BUFFER_ATR` defaults to `0.75` and
insets both ends by that multiple of completed M1 ATR. An unsatisfiable inset
blocks before inference. The endpoint selects completed-candle structure within
the preferred band; post-model quote movement, spread, precision, freshness,
and risk checks remain unchanged and fail closed.

Schema 2.1 does not grant the chart or model execution authority. Deterministic
semantics require each OCO entry to equal its technical-map confirmation price
and each endpoint TP to equal the first corresponding target. The effective TP
must remain inside that target; the effective SL must remain inside both the
endpoint stop and invalidation. A mismatch, off-tick zone/target, or
directionally unordered target rejects; code does not invent a technical
envelope.

Before inference, reconciled equity and the configured setup-risk percent are
split across the two race-exposed OCO legs. The service floors the affordable
loss budget at broker minimum volume to whole ticks and sends only the resulting
maximum stop distance to the endpoint. It never sends equity, money budget,
volume, or account identity. The same constraint is recomputed after inference;
lower equity or changed metadata can only reject the unchanged endpoint SL.
Before the request, the same Decimal inputs produce exact tick-aligned BUY and
SELL entry intervals, an inclusive stop-distance interval, and one preferred
expiry timestamp. These are instructions to improve proposal compliance, not
an authority bypass: the unchanged response still passes schema, semantic,
freshness, spread, account, sizing, margin, and placement validation.

```text
per_leg_budget = equity * setup_risk_percent / 100 / 2
loss_per_tick_at_minimum = tick_value * min_volume
affordable_ticks = floor(per_leg_budget / loss_per_tick_at_minimum)
max_affordable_stop_distance = affordable_ticks * tick_size
```

Fewer than one affordable tick rejects before the endpoint. The downstream
position-sizing calculation remains authoritative and can still reject on newer
account state, margin, notional, or any other risk ceiling. The prompt's minimum
SL distance includes the larger of the broker/configured minimum and twice the
fee-buffered TP floor, so the policy cannot place an effective stop
inside the broker/configured minimum.

## Fee-buffered exit floor

The adapter discovers `pipPosition`, commission type/rate/minimum, base/quote
and account assets, positive-P/L conversion fee rate, and quote-to-account
conversion from current broker metadata. No zero-fee default is permitted. The
currently supported cTrader calculation is `USD_PER_MILLION_USD` for a
USD-quoted symbol:

```text
base_units = native_volume * volume_scale
one_way_commission = max(
  entry_or_exit_price * base_units * commission_rate / 1_000_000
    * quote_to_account_rate,
  converted_minimum_commission
)
gross_at_tp = tp_ticks * tick_value * native_volume
pnl_conversion_fee = gross_at_tp * pnl_conversion_fee_percent / 100
expected_net = gross_at_tp - opening_commission - closing_commission
  - pnl_conversion_fee
required_minimum_net = total_estimated_fees
  * minimum_expected_net_to_fees_ratio
```

The first whole-pip TP with `expected_net > required_minimum_net` is eligible;
equality is not. `MIN_EXPECTED_NET_TO_FEES_RATIO` defaults to `1`, cannot be
configured below `1`, and is included in the immutable safety configuration.
Before inference the calculation uses broker minimum volume and conservative
BUY/SELL entry bounds. After deterministic sizing it runs again on both exact
commands and their actual volume. An unsupported commission type, missing
asset conversion, unavailable fee-buffered TP inside the distance ceiling, or
insufficient expected net rejects without inference/placement as appropriate.
This final-volume calculation is the integration point for later deterministic
money management; the model still cannot choose volume.

At broker submission the demo adapter converts the already validated absolute
intent into cTrader relative SL/TP distances at `1/100000` price units and
requires exact integer representation. cTrader therefore applies the same TP
and exact `2x` SL distances from the actual fill. The pending entry is a
STOP_LIMIT order whose positive integer `MAX_SLIPPAGE_POINTS` is enforced by
the broker. Unrepresentable protection, invalid geometry, or invalid slippage
fails before submission. The durable intent retains the original absolute
levels; the broker position records its actual fill-relative levels.

After sizing and broker margin estimation, the account is reconciled again. Any
change to equity, balance, available margin, exposure, pending/fill/cancel, or
certainty state rejects the cycle rather than reusing a decision calculated on
older state. A final market snapshot must preserve the completed candles and
execution metadata; spread and both original/effective proposal semantics are
rechecked against its quote. Freshness thresholds are not extended—the final
quote and depth replace the older timestamps at the placement gate.

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
risk_normalized_volume = floor((raw_volume - min_volume) / volume_step) * volume_step + min_volume
notional_raw_volume = max_position_notional / (entry_price * broker_volume_scale)
notional_normalized_volume = floor((notional_raw_volume - min_volume) / volume_step) * volume_step + min_volume
normalized_volume = min(risk_normalized_volume, notional_normalized_volume, max_volume)
```

The notional branch is used only when a positive cap is configured. The result
is rejected if metadata is missing/non-positive, raw risk volume is below the
minimum, the notional cap cannot support the minimum, normalized volume exceeds
raw volume/risk budget/maximum/notional volume, or broker units are unclear.
Normalize down only. Recalculate realized maximum loss, margin, and notional
after normalization and reject any ceiling breach.

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
- `reward / risk >= MIN_RISK_REWARD_RATIO`, current default `0.5`.
- The effective TP is the nearest whole-pip fee-buffered target inside
  the AI technical target; effective SL distance is exactly twice TP distance.
- Stop distance must meet broker/config minimum and not exceed configured ATR multiple.
- Buy/sell confirmation distance from the current ask/bid must not exceed the
  configured M1-ATR reachability cap. This is checked after the model response
  and again against the final pre-placement quote.
- Entry/SL/TP/invalidation/expiration must all remain coherent at validation immediately before placement.
- A mathematically incompatible minimum/maximum stop-distance interval rejects before inference, so the model is never asked for an impossible proposal.

## Account and exposure checks

Reject when equity is missing/below floor; margin data is stale; estimated margin
exceeds available margin or configured usage; the notional cap cannot support
broker minimum volume or remains exceeded after downward normalization;
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
the validator recomputes the relationship. Low adjusted confidence remains
diagnostic and does not suppress an otherwise valid two-leg proposal. A
mismatched or risk-increasing adjustment is invalid, and the adjustment can
never increase permitted risk or volume. Exact tag-specific cohort selection
remains a future enhancement.

## Fail-closed reason codes

Examples include `RISK_METADATA_MISSING`, `RISK_TICK_VALUE_INVALID`, `RISK_VOLUME_BELOW_MIN`, `RISK_DAILY_LOCKOUT`, `RISK_MARGIN_STALE`, `RISK_EXPOSURE_LIMIT`, `SPREAD_UNSAFE`, `SLIPPAGE_POLICY_MISSING`, `PRICE_NOT_ON_TICK`, `STOP_DISTANCE_INVALID`, `REWARD_RISK_TOO_LOW`, and `ACCOUNT_STATE_UNCERTAIN`.
