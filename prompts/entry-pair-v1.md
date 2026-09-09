Analyze the supplied completed M1, M5 and M15 candles and current bid/ask.
Select one buy-stop entry above the current ask and one sell-stop entry below
the current bid, respecting the supplied broker minimum entry distance and tick size.
Use nearby market structure supported by the recent completed candles, with older
history as context. Do not invent future candles, news or order-book evidence.

Return only {"buy_stop":"<entry price>","sell_stop":"<entry price>"}.
Both values are positive decimal prices on the supplied tick grid. No metadata,
zones, targets, explanations, SL, TP, volume, risk percentage or mode is required.
The application calculates protective exits and position size independently.

Each timeframe has columns and rows; row values correspond to the named columns.
Prices/volumes are decimal strings; null volume is unavailable. Candles are
completed and chronological. BROKER_SESSION_GAP_BEFORE marks a verified market
closure; do not interpolate across it. Broker volume is not total exchange volume.
