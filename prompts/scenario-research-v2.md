Analyse the supplied completed M15, M5 and M1 OHLCV candles as numeric data.
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

Always include schema_version with the exact string "scenario-1.0".
Echo analysis_id, symbol, captured_at and valid_until exactly. Validity is fixed
by the application and cannot be extended. The application separately confirms
holds and failed reclaims using future completed candles as they arrive. Do not
pretend those confirmations already occurred. Do not add a confirmation, size,
SL, TP, reward/risk calculation, account policy, trading mode or execution command.
Do not move structural levels toward the current price just to create an entry.
If the supplied market evidence cannot support this map, do not invent evidence;
an invalid or unavailable response will leave execution waiting safely.

No chart image is supplied to this text-only model. Candles are chronological
within each timeframe. Each timeframe supplies `columns` and `rows`: every row
is an array whose values correspond exactly to the named columns in order.
Prices and volume are exact decimal strings, timestamps retain start/end times,
and completion/quality flags are explicit. Null volume is unavailable, not zero. The bounded tails contain up to 240 M1, 144 M5
and 96 M15 bars: about four, twelve and twenty-four hours without session gaps.
BROKER_SESSION_GAP_BEFORE marks a verified market closure before that bar;
do not interpolate prices, volume or confirmation across a closure. Volume is
broker-reported activity, not proof of total exchange volume or order flow.

Use M15 for broader structure, M5 to corroborate nearby zones and M1 for recent
structure. Distinguish repeated reactions from isolated wicks and stale distant
levels. Additional history is context, not a reason to widen thresholds or targets.
Base the immediate map on the most recent completed candles. Do not invent
quotes, order-book evidence, news, indicators or future candles. Return only the
required JSON fields; no prose, markdown or additional analysis fields.

Use exactly this JSON shape, replacing every angle-bracket placeholder with the
corresponding echoed value or a price supported by the supplied candles. Targets
are arrays of exactly two decimal strings, never objects or zones. Only
broader_resistance is an array of zones (one to three). No additional keys.

{"schema_version":"scenario-1.0","analysis_id":"<echo analysis_id>","symbol":"<echo symbol>","captured_at":"<echo captured_at>","valid_until":"<echo valid_until>","decision_zone":{"lower":"<price>","upper":"<price>"},"rebound_resistance":{"lower":"<price>","upper":"<price>"},"recovery_above":"<price>","bearish_below":"<price>","extension_below":"<price>","recovery_targets":["<first higher price>","<second higher price>"],"extension_targets":["<first lower price>","<second lower price>"],"broader_resistance":[{"lower":"<price>","upper":"<price>"}]}

Emit the entire JSON object on one line. Close every array and object, including
the final broader_resistance array and the outer object. Do not stop mid-JSON.
