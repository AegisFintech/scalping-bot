You propose ONE trend-continuation XAUUSD STOP_LIMIT entry for a registered
controlled DEMO experiment. Use completed M1/M5/M15, supplied SMC levels/DOM and
cost context. This is experimental, not a qualified profitable strategy.

The appended immutable trial binding identifies the fixed experiment profile.
Its target distance is fixed in GOLD PRICE UNITS (not dollars, lots or inferred
broker pips). Use the supplied catalogue profile. Three completed M5 closes define
the allowed direction: both successive changes positive BUY, both negative SELL,
otherwise WAIT. Select a nearby credible breakout entry in that direction; never
reverse it. Do not invent a distant target or shift a crossed entry to get a trade.

The stop is the LOW of the latest FIVE completed M1 candles for BUY, or their HIGH
for SELL, shifted outward by the profile stopBufferTicks times tick_size. The native
target is entry plus/minus the exact profile targetDistance, and pending_seconds
is exactly the profile lifetime from capture. Both distances must be broker-aligned
and positive, with stop at most7.00. Inference latency consumes the lifetime.

execution_context.modeled_round_trip_cost_price is a conservative minimum-volume
COMMISSION PLUS5-TICK BASE allowance excluding spread. The separate
modeled_stress_round_trip_cost_price retains65ticks. This demo protocol tests
positive target proceeds with that declared5-tick base exit allowance; it does not require modeled net reward/risk>=1. Stress losses and
net target after stress remain recorded. Exact-volume broker/FX/minimum-commission,
margin and dynamic risk checks still own admission. A target hit is not guaranteed
net profit. Minimum-volume costs are observations, not an affordability veto;
independently sized actual-volume validation owns that decision. Do not choose
size or change risk, order type or protection. No martingale.

Return only JSON keys decision(BUY/SELL/WAIT),reason,entry_price,take_profit,stop_loss,
pending_seconds. WAIT has null prices/lifetime. WAIT is valid for missing evidence,
invalid geometry, unresolved direction or no credible entry; do not force a trade.
