import type { Candle, Quote } from "../../contracts/src/index.js";
import type { EntryPlannerInput } from "../../scenario-engine/src/entry-planner.js";
import {
  canonical,
  decimal,
  isTickAligned,
} from "../../risk-engine/src/decimal.js";

export type TrendEntryStyle =
  "BREAKOUT" | "CONFIRMED_BREAKOUT" | "RETEST_LIMIT";
export type TrendGeometry =
  | { decision: "WAIT"; reason: string }
  | {
      decision: "BUY" | "SELL";
      reason: string;
      entryPrice: string;
      stopLoss: string;
      takeProfit: string;
      originalBoundary: string;
      confirmationEnd: string | null;
      targetKnownAt: string;
      executionOrderType: "STOP_LIMIT" | "LIMIT";
      pendingSeconds: 60;
    };

/** Pure prospective geometry. Actual-sized costs and execution remain separate gates. */
export function trendRetestGeometry(
  input: EntryPlannerInput,
  style: TrendEntryStyle,
): TrendGeometry {
  const wait = (reason: string): TrendGeometry => ({
    decision: "WAIT",
    reason,
  });
  if (!["BREAKOUT", "CONFIRMED_BREAKOUT", "RETEST_LIMIT"].includes(style))
    throw new Error("TREND_ENTRY_STYLE_INVALID");
  const captured = Date.parse(input.capturedAt);
  const tick = decimal(input.tickSize);
  if (!Number.isFinite(captured) || tick.lte(0))
    throw new Error("TREND_MARKET_METADATA_INVALID");
  const frame = (name: "M1" | "M5" | "M15", count: number) => {
    const matches = input.candles.filter((f) => f.timeframe === name);
    if (matches.length !== 1) return null;
    const bars = matches[0]!.candles.slice(-count);
    const duration = (name === "M1" ? 60 : name === "M5" ? 300 : 900) * 1000;
    if (
      bars.length !== count ||
      bars.some(
        (b, i) =>
          !validBar(b, duration, captured, input.tickSize) ||
          (i > 0 && b.startTime !== bars[i - 1]!.endTime),
      ) ||
      captured - Date.parse(bars.at(-1)!.endTime) > duration
    )
      return null;
    return bars;
  };
  const m1 = frame("M1", 6),
    m5 = frame("M5", 12),
    m15 = frame("M15", 12);
  if (!m1 || !m5 || !m15) return wait("TREND_COMPLETED_HISTORY_UNAVAILABLE");
  const closes = m5.slice(-3).map((b) => decimal(b.close));
  const up = closes[1]!.gt(closes[0]!) && closes[2]!.gt(closes[1]!);
  const down = closes[1]!.lt(closes[0]!) && closes[2]!.lt(closes[1]!);
  if (!up && !down) return wait("TREND_DIRECTION_UNRESOLVED");
  const side = up ? "BUY" : "SELL",
    sign = up ? 1 : -1;
  const original = style === "BREAKOUT" ? m1.slice(-5) : m1.slice(0, -1);
  const high = original
    .map((b) => decimal(b.high))
    .reduce((a, b) => (a.gt(b) ? a : b));
  const low = original
    .map((b) => decimal(b.low))
    .reduce((a, b) => (a.lt(b) ? a : b));
  const boundary = up ? high : low;
  const last = m1.at(-1)!;
  if (
    style !== "BREAKOUT" &&
    decimal(last.close).minus(boundary).mul(sign).lt(tick)
  )
    return wait("TREND_COMPLETED_BREAKOUT_NOT_CONFIRMED");
  const entry =
    style === "RETEST_LIMIT"
      ? boundary
      : style === "CONFIRMED_BREAKOUT"
        ? decimal(up ? last.high : last.low).plus(tick.mul(sign))
        : boundary.plus(tick.mul(sign));
  const stop = up ? low : high;
  const risk = entry.minus(stop).mul(sign);
  if (
    risk.lte(0) ||
    risk.gt("7") ||
    (input.maximumStopDistance !== undefined &&
      risk.gt(input.maximumStopDistance))
  )
    return wait("TREND_STRUCTURAL_STOP_OUTSIDE_BOUNDS");
  if (!input.quote || input.minimumStopDistance === undefined)
    return wait("TREND_QUOTE_UNAVAILABLE");
  if (!validQuote(input.quote, captured)) return wait("TREND_QUOTE_INVALID");
  const distance = decimal(input.minimumStopDistance);
  if (distance.lt(0)) throw new Error("TREND_MARKET_METADATA_INVALID");
  const minimum = distance.gt(tick) ? distance : tick;
  const bid = decimal(input.quote.bid),
    ask = decimal(input.quote.ask);
  if (
    style === "RETEST_LIMIT"
      ? up
        ? entry.gt(ask.minus(minimum))
        : entry.lt(bid.plus(minimum))
      : up
        ? entry.lt(ask.plus(minimum))
        : entry.gt(bid.minus(minimum))
  )
    return wait("TREND_ORIGINAL_ENTRY_NOT_EXECUTABLE");
  const targets: { price: ReturnType<typeof decimal>; knownAt: string }[] = [];
  for (const bars of [m5, m15])
    for (let i = 1; i < bars.length - 1; i++) {
      const a = bars[i - 1]!,
        b = bars[i]!,
        c = bars[i + 1]!;
      const price = decimal(up ? b.high : b.low);
      if (
        (up
          ? price.gt(a.high) && price.gt(c.high)
          : price.lt(a.low) && price.lt(c.low)) &&
        price.minus(entry).mul(sign).gt(0)
      )
        targets.push({ price, knownAt: c.endTime });
    }
  targets.sort((a, b) =>
    a.price.minus(entry).abs().cmp(b.price.minus(entry).abs()),
  );
  const target = targets[0];
  if (!target || target.price.minus(entry).abs().gt("7"))
    return wait("TREND_STRUCTURAL_TARGET_UNAVAILABLE");
  // Reject insufficient room; never skip the nearest level to manufacture R:R.
  if (target.price.minus(entry).mul(sign).lt(risk))
    return wait("TREND_STRUCTURAL_ROOM_BELOW_RISK");
  return {
    decision: side,
    reason: `Registered ${style}; completed M5 trend; structural target; actual-volume net-RR gate required`,
    entryPrice: canonical(entry),
    stopLoss: canonical(stop),
    takeProfit: canonical(target.price),
    originalBoundary: canonical(boundary),
    confirmationEnd: style === "BREAKOUT" ? null : last.endTime,
    targetKnownAt: target.knownAt,
    executionOrderType: style === "RETEST_LIMIT" ? "LIMIT" : "STOP_LIMIT",
    pendingSeconds: 60,
  };
}

function validBar(b: Candle, duration: number, at: number, tickSize: string) {
  const start = Date.parse(b.startTime),
    end = Date.parse(b.endTime);
  if (
    !b.complete ||
    b.qualityFlags.length ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end - start !== duration ||
    end > at
  )
    return false;
  const values = [b.open, b.high, b.low, b.close].map((v) => decimal(v));
  return (
    values.every((v) => v.gt(0) && isTickAligned(v, decimal(tickSize))) &&
    decimal(b.high).gte(b.low) &&
    decimal(b.high).gte(b.open) &&
    decimal(b.high).gte(b.close) &&
    decimal(b.low).lte(b.open) &&
    decimal(b.low).lte(b.close)
  );
}
function validQuote(q: Quote, at: number) {
  const source = Date.parse(q.sourceTime),
    received = Date.parse(q.receivedAt);
  return (
    Number.isFinite(source) &&
    Number.isFinite(received) &&
    source <= received &&
    received <= at &&
    at - source <= 3000 &&
    decimal(q.bid).gt(0) &&
    decimal(q.ask).gte(q.bid)
  );
}
