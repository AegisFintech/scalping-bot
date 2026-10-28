import type { ScalpEntryPlan } from "./scalp-entry.js";
import type { ModeEntryPlan } from "./mode-entry.js";
import { z } from "zod";
import { decimal } from "../../risk-engine/src/decimal.js";
import { hasDuplicateObjectKeys } from "../../risk-engine/src/model-validator.js";
import { bindEntryPrices, type EntryPairPlan } from "./entry-plan.js";
import { time } from "./plan.js";
const price = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,10})?$/)
  .max(24)
  .refine((v) => decimal(v).gt(0));
export const directionalDecisionSchema = z
  .object({
    decision: z.enum(["BUY", "SELL", "WAIT"]),
    reason: z.string().min(1).max(1200),
    upper_breakout: price.nullable(),
    lower_breakout: price.nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.decision === "WAIT"
        ? v.upper_breakout !== null || v.lower_breakout !== null
        : v.upper_breakout === null ||
          v.lower_breakout === null ||
          decimal(v.upper_breakout).lte(v.lower_breakout)
    )
      c.addIssue({
        code: "custom",
        message: "Directional decision and range conflict",
      });
  });
/** Both boundaries describe box geometry; only entry_side has order authority. */
export interface DirectionalEntryPlan extends Omit<
  EntryPairPlan,
  "schema_version"
> {
  readonly schema_version: "entry-direction-1.0";
  readonly entry_side: "BUY" | "SELL";
  readonly reason: string;
}
export function bindDirectionalDecision(
  raw: string,
  context: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    tickSize: string;
    observedM1End: string;
  },
) {
  if (Buffer.byteLength(raw) > 8192 || hasDuplicateObjectKeys(raw))
    throw new Error("AI_ENTRY_DECISION_AMBIGUOUS");
  const v = directionalDecisionSchema.parse(JSON.parse(raw));
  if (v.decision === "WAIT") {
    if (time(context.observedM1End) > time(context.capturedAt))
      throw new Error("SCENARIO_WAIT_CONTEXT_INVALID");
    return {
      schema_version: "entry-wait-1.0" as const,
      analysis_id: context.analysisId,
      symbol: context.symbol,
      captured_at: context.capturedAt,
      valid_until: new Date(time(context.capturedAt) + 300000).toISOString(),
      observed_m1_end: context.observedM1End,
      reason: v.reason,
    };
  }
  const pair = bindEntryPrices(
    JSON.stringify({ buy_stop: v.upper_breakout, sell_stop: v.lower_breakout }),
    context,
  );
  return {
    ...pair,
    schema_version: "entry-direction-1.0" as const,
    entry_side: v.decision,
    reason: v.reason,
  };
}
export function validateDirectionalPlan(
  raw: string,
  context: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    availableAt: string;
    tickSize: string;
  },
): DirectionalEntryPlan {
  const v = z
    .object({
      schema_version: z.literal("entry-direction-1.0"),
      entry_side: z.enum(["BUY", "SELL"]),
      reason: z.string().min(1).max(1200),
      analysis_id: z.literal(context.analysisId),
      symbol: z.literal(context.symbol),
      captured_at: z.literal(context.capturedAt),
      valid_until: z.string().datetime({ offset: true }),
      buy_stop: price,
      sell_stop: price,
    })
    .strict()
    .parse(JSON.parse(raw));
  const bound = bindEntryPrices(JSON.stringify(v), context);
  if (
    !decimal(v.buy_stop).gt(v.sell_stop) ||
    v.valid_until !== bound.valid_until ||
    time(context.availableAt) < time(context.capturedAt) ||
    time(context.availableAt) >= time(v.valid_until)
  )
    throw new Error("SCENARIO_ENTRY_CONTEXT_INVALID");
  return v;
}
export function isEntryPlan(
  plan: { schema_version: string } | null | undefined,
): plan is
  EntryPairPlan | DirectionalEntryPlan | ModeEntryPlan | ScalpEntryPlan {
  return (
    plan?.schema_version === "entry-scalp-1.0" ||
    plan?.schema_version === "entry-pair-1.0" ||
    plan?.schema_version === "entry-direction-1.0" ||
    plan?.schema_version === "entry-modes-1.0"
  );
}
