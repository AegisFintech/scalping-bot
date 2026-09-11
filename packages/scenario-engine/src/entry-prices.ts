import { Decimal } from "decimal.js";
import type {
  EntryRetirementEvidence,
  MarketSnapshot,
  Quote,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import {
  canonical,
  decimal,
  isTickAligned,
} from "../../risk-engine/src/decimal.js";
import type { EntryPairPlan } from "./entry-plan.js";

export function entryMinimumDistance(
  metadata: Pick<SymbolMetadata, "tickSize" | "minStopDistance">,
  minimumPoints: string | null,
): string {
  const tick = decimal(metadata.tickSize);
  const broker = decimal(metadata.minStopDistance);
  const points =
    minimumPoints === null ? new Decimal(1) : decimal(minimumPoints);
  if (tick.lte(0) || broker.lt(0) || points.lt(0))
    throw new Error("SCENARIO_ENTRY_QUOTE_INVALID");
  return canonical(Decimal.max(tick, broker, tick.mul(points)));
}

/** Exact broker-side boundaries. The spread buffer is prompt guidance, never a gate. */
export function entryPriceBounds(
  quote: Quote,
  tickSize: string,
  minimumDistance: string,
) {
  const tick = decimal(tickSize);
  const minimum = decimal(minimumDistance);
  const bid = decimal(quote.bid);
  const ask = decimal(quote.ask);
  if (tick.lte(0) || minimum.lt(0) || bid.lte(0) || ask.lt(bid))
    throw new Error("SCENARIO_ENTRY_QUOTE_INVALID");
  const distance = Decimal.max(tick, minimum);
  const buy = ask.plus(distance).div(tick).ceil().mul(tick);
  const sell = bid.minus(distance).div(tick).floor().mul(tick);
  if (sell.lte(0)) throw new Error("SCENARIO_ENTRY_QUOTE_INVALID");
  const buffer = Decimal.max(tick.mul(2), ask.minus(bid))
    .div(tick)
    .ceil()
    .mul(tick);
  return {
    minimum_entry_distance: canonical(distance),
    buy_stop_minimum: canonical(buy),
    sell_stop_maximum: canonical(sell),
    movement_buffer: canonical(buffer),
    preferred_buy_stop_minimum: canonical(buy.plus(buffer)),
    preferred_sell_stop_maximum: canonical(
      Decimal.max(tick, sell.minus(buffer)),
    ),
  };
}

/** Only proven price-side failures qualify for retirement. Bad data throws instead. */
export function checkEntryPrices(
  plan: EntryPairPlan,
  snapshot: Pick<MarketSnapshot, "quote" | "metadata" | "serverTime">,
  phase: EntryRetirementEvidence["phase"],
  now: number,
  options: {
    maxQuoteAgeMs: number;
    maxMetadataAgeMs: number;
    minimumPoints: string | null;
  },
): EntryRetirementEvidence | null {
  const source = Date.parse(snapshot.quote.sourceTime);
  const received = Date.parse(snapshot.quote.receivedAt);
  const server = Date.parse(snapshot.serverTime);
  const metadataAt = Date.parse(snapshot.metadata.metadataTime);
  if (
    ![now, source, received, server, metadataAt].every(Number.isFinite) ||
    source > server ||
    received > now ||
    server > now ||
    metadataAt > now ||
    now - source > options.maxQuoteAgeMs ||
    now - received > options.maxQuoteAgeMs ||
    now - server > options.maxQuoteAgeMs ||
    now - metadataAt > options.maxMetadataAgeMs ||
    now < Date.parse(plan.captured_at) ||
    now >= Date.parse(plan.valid_until) ||
    snapshot.metadata.symbolName !== plan.symbol
  )
    throw new Error("SCENARIO_ENTRY_CHECK_DATA_INVALID");
  const tick = decimal(snapshot.metadata.tickSize);
  if (
    ![plan.buy_stop, plan.sell_stop].every((price) =>
      isTickAligned(decimal(price), tick),
    )
  )
    throw new Error("SCENARIO_ENTRY_CHECK_PRECISION_INVALID");
  const minimum = entryMinimumDistance(
    snapshot.metadata,
    options.minimumPoints,
  );
  const bounds = entryPriceBounds(snapshot.quote, canonical(tick), minimum);
  const reasonCodes: EntryRetirementEvidence["reasonCodes"][number][] = [];
  if (decimal(plan.buy_stop).lt(bounds.buy_stop_minimum))
    reasonCodes.push("BUY_ENTRY_TOO_CLOSE");
  if (decimal(plan.sell_stop).gt(bounds.sell_stop_maximum))
    reasonCodes.push("SELL_ENTRY_TOO_CLOSE");
  if (reasonCodes.length === 0) return null;
  return {
    schemaVersion: "1.0",
    phase,
    reasonCodes,
    observedAt: new Date(now).toISOString(),
    quote: snapshot.quote,
    tickSize: canonical(tick),
    minimumEntryDistance: bounds.minimum_entry_distance,
    buyStop: plan.buy_stop,
    sellStop: plan.sell_stop,
  };
}
