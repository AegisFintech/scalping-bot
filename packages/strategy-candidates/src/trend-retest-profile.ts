import { z } from "zod";
import definition from "../../config/src/trend-retest-catalogue.json" with { type: "json" };
import { digest } from "../../config/src/demo-catalogue.js";
import { TREND_RETEST_VERSION } from "../../config/src/trend-retest-policy.js";
export {
  TREND_RETEST_VERSION,
  TREND_RETEST_POLICY,
} from "../../config/src/trend-retest-policy.js";
export const trendProfileSchema = z
  .object({
    id: z.enum(["TREND_BREAKOUT", "TREND_CONFIRMED", "TREND_RETEST"]),
    proposalSource: z.literal("CODEX"),
    entryStyle: z.enum(["BREAKOUT", "CONFIRMED_BREAKOUT", "RETEST_LIMIT"]),
    rangeBars: z.literal(5),
    targetDistance: z.literal("STRUCTURAL"),
    stopBufferTicks: z.literal(0),
    pendingSeconds: z.literal(60),
    entryRangePoints: z.union([z.literal(0), z.literal(30)]),
    baseExitReservePoints: z.literal(65),
    stressExitReservePoints: z.literal(65),
    minimumNetRewardRisk: z.literal("1"),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.entryStyle === "RETEST_LIMIT") !== (p.entryRangePoints === 0))
      ctx.addIssue({ code: "custom", message: "TREND_RANGE_TYPE_MISMATCH" });
  });
export type TrendProfile = z.infer<typeof trendProfileSchema>;
export const trendProfiles = trendProfileSchema
  .array()
  .length(3)
  .parse(definition.profiles);
export const trendCatalogueSha256 = digest(definition);
export function trendProfileSha256(profile: TrendProfile) {
  const parameters: Record<string, unknown> = { ...profile };
  delete parameters.id;
  return digest(parameters);
}
export const trendBindingSchema = z
  .object({
    trialId: z.string().uuid(),
    profileId: z.string(),
    profileSha256: z.string().regex(/^[a-f0-9]{64}$/),
    catalogueSha256: z.literal(trendCatalogueSha256),
    strategyVersion: z.literal(TREND_RETEST_VERSION),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    registeredAt: z.string().datetime({ offset: true }),
    startsAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((b, ctx) => {
    const p = trendProfiles.find((p) => p.id === b.profileId);
    if (
      !p ||
      trendProfileSha256(p) !== b.profileSha256 ||
      Date.parse(b.registeredAt) >= Date.parse(b.startsAt)
    )
      ctx.addIssue({ code: "custom", message: "TREND_BINDING_INVALID" });
  });
export type TrendBinding = z.infer<typeof trendBindingSchema>;
