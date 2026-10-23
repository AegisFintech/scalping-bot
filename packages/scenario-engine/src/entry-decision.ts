import {
  validateDirectionalPlan,
  type DirectionalEntryPlan,
} from "./directional-entry.js";
import { z } from "zod";
import { decimal } from "../../risk-engine/src/decimal.js";
import { hasDuplicateObjectKeys } from "../../risk-engine/src/model-validator.js";
import {
  bindEntryPrices,
  validateEntryPlan,
  type EntryPairPlan,
} from "./entry-plan.js";
import { time } from "./plan.js";

const price = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,10})?$/)
  .max(24)
  .refine((v) => decimal(v).gt(0));
export const entryDecisionSchema = z
  .object({
    decision: z.enum(["OCO", "WAIT"]),
    reason: z.string().min(1).max(1200),
    buy_stop: price.nullable(),
    sell_stop: price.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.decision === "WAIT" &&
        (v.buy_stop !== null || v.sell_stop !== null)) ||
      (v.decision === "OCO" && (v.buy_stop === null || v.sell_stop === null))
    )
      ctx.addIssue({
        code: "custom",
        message: "Decision and entries conflict",
      });
  });
export interface EntryWaitPlan {
  readonly schema_version: "entry-wait-1.0";
  readonly analysis_id: string;
  readonly symbol: string;
  readonly captured_at: string;
  readonly valid_until: string;
  readonly observed_m1_end: string;
  readonly reason: string;
}
export type EntryDecisionPlan =
  EntryPairPlan | DirectionalEntryPlan | EntryWaitPlan;
export function bindEntryDecision(
  raw: string,
  context: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    tickSize: string;
    observedM1End: string;
  },
): EntryDecisionPlan {
  if (Buffer.byteLength(raw) > 8192 || hasDuplicateObjectKeys(raw))
    throw new Error("AI_ENTRY_DECISION_AMBIGUOUS");
  const decision = entryDecisionSchema.parse(JSON.parse(raw));
  if (decision.decision === "OCO")
    return bindEntryPrices(
      JSON.stringify({
        buy_stop: decision.buy_stop,
        sell_stop: decision.sell_stop,
      }),
      context,
    );
  if (time(context.observedM1End) > time(context.capturedAt))
    throw new Error("SCENARIO_WAIT_CONTEXT_INVALID");
  return {
    schema_version: "entry-wait-1.0",
    analysis_id: context.analysisId,
    symbol: context.symbol,
    captured_at: context.capturedAt,
    valid_until: new Date(time(context.capturedAt) + 300_000).toISOString(),
    observed_m1_end: context.observedM1End,
    reason: decision.reason,
  };
}
export function validateEntryDecision(
  raw: string,
  context: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    availableAt: string;
    tickSize: string;
  },
): EntryDecisionPlan {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (value.schema_version === "entry-direction-1.0")
    return validateDirectionalPlan(raw, context);
  if (value.schema_version !== "entry-wait-1.0")
    return validateEntryPlan(raw, context);
  const wait = z
    .object({
      schema_version: z.literal("entry-wait-1.0"),
      analysis_id: z.literal(context.analysisId),
      symbol: z.literal(context.symbol),
      captured_at: z.literal(context.capturedAt),
      valid_until: z.string().datetime({ offset: true }),
      observed_m1_end: z.string().datetime({ offset: true }),
      reason: z.string().min(1).max(1200),
    })
    .strict()
    .parse(value);
  const captured = time(context.capturedAt),
    end = time(wait.observed_m1_end);
  if (
    time(wait.valid_until) !== captured + 300_000 ||
    end > captured ||
    captured - end >= 90_000 ||
    end % 60_000 !== 0 ||
    time(context.availableAt) < captured ||
    time(context.availableAt) >= captured + 300_000
  )
    throw new Error("SCENARIO_WAIT_CONTEXT_INVALID");
  return wait;
}
