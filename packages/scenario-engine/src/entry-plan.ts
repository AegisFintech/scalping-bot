import { Decimal } from "decimal.js";
import {
  canonical,
  decimal,
  isTickAligned,
} from "../../risk-engine/src/decimal.js";
import {
  hasDuplicateObjectKeys,
  ModelResponseValidator,
} from "../../risk-engine/src/model-validator.js";
import { time } from "./plan.js";

export interface EntryPairPlan {
  readonly schema_version: "entry-pair-1.0";
  readonly analysis_id: string;
  readonly symbol: string;
  readonly captured_at: string;
  readonly valid_until: string;
  readonly buy_stop: string;
  readonly sell_stop: string;
}

const contextValidator = new ModelResponseValidator<EntryPairPlan>(
  "schemas/entry-pair-context-1.0.json",
);

/** Read one unambiguous object, allowing surrounding prose/fences and unused fields. */
export function parseEntryPrices(raw: string): {
  buy_stop: string;
  sell_stop: string;
} {
  if (Buffer.byteLength(raw, "utf8") > 65_536)
    throw new Error("AI_ENTRY_RESPONSE_OVERSIZED");
  const candidates: string[] = [];
  let depth = 0,
    start = -1,
    quoted = false,
    escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (depth === 0) {
      if (c === "{") {
        start = i;
        depth = 1;
        quoted = false;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0)
      candidates.push(raw.slice(start, i + 1));
  }
  const pairs: { buy_stop: string; sell_stop: string }[] = [];
  for (const candidate of candidates) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!("buy_stop" in value) && !("sell_stop" in value)) continue;
    if (hasDuplicateObjectKeys(candidate))
      throw new Error("AI_ENTRY_DUPLICATE_KEYS");
    const price = (value: unknown): string => {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        const fields = value as Record<string, unknown>;
        if ("entry_price" in fields && "price" in fields)
          throw new Error("AI_ENTRY_PRICE_AMBIGUOUS");
        value = fields.entry_price ?? fields.price;
      }
      if (typeof value !== "string" && typeof value !== "number")
        throw new Error("AI_ENTRY_PRICE_MISSING");
      // Numeric JSON is accepted only inside reliable decimal precision; boundaries stay strings.
      if (
        typeof value === "number" &&
        (!Number.isFinite(value) || new Decimal(value).precision() > 15)
      )
        throw new Error("AI_ENTRY_PRICE_INVALID");
      try {
        const result = decimal(
          typeof value === "number"
            ? new Decimal(value).toFixed()
            : value.trim(),
        );
        if (result.lte(0)) throw new Error("nonpositive");
        return canonical(result);
      } catch {
        throw new Error("AI_ENTRY_PRICE_INVALID");
      }
    };
    pairs.push({
      buy_stop: price(value.buy_stop),
      sell_stop: price(value.sell_stop),
    });
  }
  if (pairs.length !== 1 || depth !== 0)
    throw new Error(
      pairs.length > 1 ? "AI_ENTRY_PAIR_AMBIGUOUS" : "AI_ENTRY_PAIR_UNREADABLE",
    );
  return pairs[0]!;
}

export function bindEntryPrices(
  raw: string,
  context: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    tickSize: string;
  },
): EntryPairPlan {
  const prices = parseEntryPrices(raw);
  const tick = decimal(context.tickSize);
  if (
    tick.lte(0) ||
    ![prices.buy_stop, prices.sell_stop].every((p) =>
      isTickAligned(decimal(p), tick),
    )
  )
    throw new Error("AI_ENTRY_PRICE_NOT_ON_TICK");
  return {
    schema_version: "entry-pair-1.0",
    analysis_id: context.analysisId,
    symbol: context.symbol,
    captured_at: context.capturedAt,
    valid_until: new Date(time(context.capturedAt) + 300_000).toISOString(),
    ...prices,
  };
}

export function validateEntryPlan(
  raw: string,
  context: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    availableAt: string;
    tickSize: string;
  },
): EntryPairPlan {
  const parsed = contextValidator.parse(raw);
  if (!parsed.accepted || parsed.response === null)
    throw new Error("SCENARIO_ENTRY_CONTEXT_INVALID");
  const value = parsed.response;
  const bound = bindEntryPrices(raw, context);
  if (
    value.schema_version !== bound.schema_version ||
    value.analysis_id !== bound.analysis_id ||
    value.symbol !== bound.symbol ||
    value.captured_at !== bound.captured_at ||
    value.valid_until !== bound.valid_until ||
    time(context.availableAt) < time(bound.captured_at) ||
    time(context.availableAt) >= time(bound.valid_until)
  )
    throw new Error("SCENARIO_ENTRY_CONTEXT_INVALID");
  return bound;
}
