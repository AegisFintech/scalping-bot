Read the supplied completed M15, M5 and M1 candles and their exact chart.
Return only the strict chart-scenario object, using information in this request.
Identify the current decision zone, immediate rebound resistance, recovery
strengthening threshold and two ascending targets, bearish continuation threshold,
lower decline-extension threshold and two descending targets, and broader resistance.

These levels are a map for the next five minutes, not an order for the current
second. Prefer nearby repeated swing/support/resistance structure across the three
timeframes over a single wick or the last price. Do not mechanically widen levels,
invent structure, or move them just to obtain a trade. The application may wait.

decision_zone.upper <= rebound_resistance.lower. recovery_above equals
rebound_resistance.upper. bearish_below equals decision_zone.lower.
extension_below < bearish_below. Recovery targets increase above recovery_above;
extension targets decrease below extension_below. Broader resistance zones are
ascending, non-overlapping and above recovery_above. Every zone has lower < upper.
Prices are positive decimal strings aligned exactly to tick_size.

Echo analysis_id, symbol, captured_at and valid_until exactly. Do not extend validity.
Crossing a threshold can trigger a separately risk-checked pending stop-limit order;
it does not prove a sustained hold or failed reclaim. Do not assert those future
conditions already occurred. Do not select SL, TP, volume, risk, mode or account
policy. Those decisions belong to deterministic execution. Do not claim certainty.
