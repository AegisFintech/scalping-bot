Select a tight buy-stop / sell-stop pair for the next local M1 breakout, using
the supplied completed candles and current bid/ask. Keep entries close to current
price and grounded in nearby support/resistance, with smart-money order blocks
as candle-based confluence.

0. The current quote and entry_boundaries are authoritative for order direction;
   historical candle closes are not the current market. Return buy_stop greater
   than or equal to entry_boundaries.buy_stop_minimum and sell_stop less than or
   equal to entry_boundaries.sell_stop_maximum. Check these inequalities using
   the final two numbers before returning them. A breached historical level is
   unusable even if it is a strong swing or order block. Reassess nearby structure.
   Prefer the supplied preferred_buy_stop_minimum / preferred_sell_stop_maximum
   when structure supports them. Their small movement_buffer is guidance for
   quote movement during processing, not a reason to choose distant levels.
   Do not clamp an old level onto these boundaries or invent a structure.
1. Use the latest 10 completed M1 candles for entry structure, prioritizing the
   latest 5. Older M1 and M5/M15 history explain context; their distant session
   highs/lows or outer order blocks must not replace nearer M1 entry structure.
2. Find the nearest local resistance above ask and support below bid: recent
   swing wicks and the edges of the current small consolidation. Select the
   nearest relevant levels, not the highest high and lowest low of the full
   history. Prefer separation from each quote side around one recent M1 candle
   range or less when supported by structure; do not widen to remote levels
   merely because they look stronger. Do not invent a level to meet a distance.
3. A bullish order block is the last bearish candle before a completed upward
   displacement that closes above a preceding local swing high; a bearish order
   block is the last bullish candle before the corresponding downward break.
   Displacement has a larger body than the preceding three M1 candles' median
   body. Use the block candle's full low/high range. The swing and the break must
   already be visible in completed candles, with no future confirmation assumed.
   Discard a bullish block after a subsequent M1 close below its low, or a bearish
   block after a close above its high. Prefer fresh nearby blocks over repeatedly
   tested ones. Order blocks add context to support/resistance; their absence
   does not require inventing a block or searching farther into history.
4. These are breakout STOP entries: buy just above nearby resistance, sell just
   below nearby support. A bullish demand block below price is not a buy-stop
   entry, and a bearish supply block above price is not a sell-stop entry. Do not
   output pullback limit entries. If price has already crossed a candidate,
   reassess the recent structure rather than shifting that old level arbitrarily.
5. Use only a small outward buffer supported by current spread and tick size;
   respect the supplied broker minimum entry distance. Buy must be above ask,
   sell below bid, and both positive decimal prices on the supplied tick grid.
   Do not add broad timeframe or stop-loss-sized buffers to entry prices.

Return only {"buy_stop":"<entry price>","sell_stop":"<entry price>"}.
No metadata, zones, explanation, SL, TP, volume, risk percentage or mode is required.
The application calculates protective exits and dynamic position size independently.

Each timeframe has columns and chronological rows; values correspond to the named
columns. Prices/volumes are decimal strings; null volume is unavailable. Candles
are completed. BROKER_SESSION_GAP_BEFORE marks a verified closure: do not infer
continuous structure across it. Candle patterns do not prove institutional orders;
do not invent order flow, news, future candles or guaranteed fills/profits. Broker
volume is not total exchange volume.
