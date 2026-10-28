import { z } from "zod";
import {
  decimal,
  canonical,
  isTickAligned,
} from "../../risk-engine/src/decimal.js";
import { hasDuplicateObjectKeys } from "../../risk-engine/src/model-validator.js";
import { bindDirectionalDecision } from "./directional-entry.js";
import { bindEntryPrices } from "./entry-plan.js";
import type { ModeEntryPlan } from "./mode-entry.js";
import { time } from "./plan.js";

export { SCALP_LIMITS } from "../../config/src/policy.js";
import { SCALP_LIMITS } from "../../config/src/policy.js";

const price = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,10})?$/)
  .max(24)
  .refine((v) => decimal(v).gt(0));
export const scalpDecisionSchema = z
  .object({
    decision: z.enum(["BUY", "SELL", "WAIT"]),
    reason: z.string().min(1).max(1200),
    entry_price: price.nullable(),
    take_profit: price.nullable(),
    stop_loss: price.nullable(),
    pending_seconds: z
      .number()
      .int()
      .min(SCALP_LIMITS.minimumPendingSeconds)
      .max(SCALP_LIMITS.maximumPendingSeconds)
      .nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const values = [
      v.entry_price,
      v.take_profit,
      v.stop_loss,
      v.pending_seconds,
    ];
    if (
      v.decision === "WAIT"
        ? values.some((x) => x !== null)
        : values.some((x) => x === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Scalp decision conflicts with proposal",
      });
  });

export interface ScalpEntryPlan extends Omit<ModeEntryPlan, "schema_version"> {
  readonly schema_version: "entry-scalp-1.0";
  readonly take_profit: string;
  readonly stop_loss: string;
  readonly pending_seconds: number;
}
type BindContext = Parameters<typeof bindDirectionalDecision>[1];

export function bindScalpDecision(raw: string, context: BindContext) {
  if (Buffer.byteLength(raw) > 8192 || hasDuplicateObjectKeys(raw))
    throw new Error("AI_SCALP_RESPONSE_AMBIGUOUS");
  const v = scalpDecisionSchema.parse(JSON.parse(raw));
  if (v.decision === "WAIT")
    return bindDirectionalDecision(
      JSON.stringify({
        decision: "WAIT",
        reason: v.reason,
        upper_breakout: null,
        lower_breakout: null,
      }),
      context,
    );
  if (
    v.entry_price === null ||
    v.take_profit === null ||
    v.stop_loss === null ||
    v.pending_seconds === null
  )
    throw new Error("AI_SCALP_PROPOSAL_REQUIRED");
  const entry = decimal(v.entry_price),
    target = decimal(v.take_profit),
    stop = decimal(v.stop_loss);
  const reward = target.minus(entry).abs(),
    risk = stop.minus(entry).abs();
  if (
    (v.decision === "BUY"
      ? !(stop.lt(entry) && target.gt(entry))
      : !(target.lt(entry) && stop.gt(entry))) ||
    reward.gt(SCALP_LIMITS.maximumTargetDistance) ||
    risk.gt(SCALP_LIMITS.maximumStopDistance) ||
    reward.div(risk).lt(SCALP_LIMITS.minimumRiskReward) ||
    ![entry, target, stop].every((p) =>
      isTickAligned(p, decimal(context.tickSize)),
    )
  )
    throw new Error("AI_SCALP_GEOMETRY_INVALID");
  const pair = bindEntryPrices(
    JSON.stringify({
      buy_stop: canonical(v.decision === "BUY" ? entry : stop),
      sell_stop: canonical(v.decision === "SELL" ? entry : stop),
    }),
    context,
  );
  // The other reference is the supplied invalidation, never another entry authority.
  return {
    ...pair,
    schema_version: "entry-scalp-1.0" as const,
    entry_side: v.decision,
    reason: v.reason,
    take_profit: canonical(target),
    stop_loss: canonical(stop),
    pending_seconds: v.pending_seconds,
    valid_until: new Date(
      time(context.capturedAt) + v.pending_seconds * 1000,
    ).toISOString(),
  };
}

export function validateScalpPlan(
  raw: string,
  context: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    availableAt: string;
    tickSize: string;
  },
): ScalpEntryPlan {
  if (Buffer.byteLength(raw) > 8192 || hasDuplicateObjectKeys(raw))
    throw new Error("AI_SCALP_RESPONSE_AMBIGUOUS");
  const v = z
    .object({
      schema_version: z.literal("entry-scalp-1.0"),
      entry_side: z.enum(["BUY", "SELL"]),
      reason: z.string().min(1).max(1200),
      analysis_id: z.literal(context.analysisId),
      symbol: z.literal(context.symbol),
      captured_at: z.literal(context.capturedAt),
      valid_until: z.string().datetime({ offset: true }),
      buy_stop: price,
      sell_stop: price,
      take_profit: price,
      stop_loss: price,
      pending_seconds: z.number().int(),
    })
    .strict()
    .parse(JSON.parse(raw));
  const bound = bindScalpDecision(
    JSON.stringify({
      decision: v.entry_side,
      reason: v.reason,
      entry_price: v.entry_side === "BUY" ? v.buy_stop : v.sell_stop,
      take_profit: v.take_profit,
      stop_loss: v.stop_loss,
      pending_seconds: v.pending_seconds,
    }),
    { ...context, observedM1End: context.capturedAt },
  );
  if (
    bound.schema_version !== "entry-scalp-1.0" ||
    v.valid_until !== bound.valid_until ||
    v.buy_stop !== bound.buy_stop ||
    v.sell_stop !== bound.sell_stop ||
    time(context.availableAt) < time(context.capturedAt) ||
    time(context.availableAt) >= time(v.valid_until)
  )
    throw new Error("SCENARIO_SCALP_CONTEXT_INVALID");
  return v;
}
