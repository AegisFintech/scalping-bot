Analyse the supplied completed M15, M5 and M1 candles and their exact chart.
Return the strict chart-scenario object. These are conditional technical levels,
not orders or predictions of certainty. Use only information in this request.

Identify the current decision zone; immediate rebound resistance; recovery
strengthening above that resistance, with two increasing upside targets; bearish
continuation below the decision zone following a failed reclaim; a lower decline
extension threshold and two decreasing downside targets; broader resistance zones.

The decision-zone upper edge must not exceed rebound-resistance lower edge.
recovery_above equals rebound-resistance upper edge; bearish_below equals
decision-zone lower edge. extension_below is below bearish_below. Upside targets
are above recovery_above; downside targets are below extension_below. Broader
resistance zones are ordered, non-overlapping, and above recovery_above.
Every zone has lower < upper. Every price is positive and aligned to tick_size.

Echo analysis_id, symbol, captured_at and valid_until exactly. Validity is fixed
by the application and cannot be extended. The application separately confirms
holds and failed reclaims using future completed candles as they arrive. Do not
pretend those confirmations already occurred. Do not add a confirmation, size,
SL, TP, reward/risk calculation, account policy, trading mode or execution command.
Do not move chart levels toward the current price just to create an entry.
If the supplied market evidence cannot support this map, do not invent evidence;
an invalid or unavailable response will leave execution waiting safely.
