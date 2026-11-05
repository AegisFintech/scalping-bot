import {
  trendBindingSchema,
  trendProfiles,
  type TrendProfile,
  TREND_RETEST_VERSION,
} from "./trend-retest-profile.js";
import { trendRetestGeometry } from "./trend-retest.js";
import {
  canonicalJson,
  digest,
  catalogueSha256,
} from "../../config/src/demo-catalogue.js";
export {
  canonicalJson,
  digest,
  catalogueSha256,
} from "../../config/src/demo-catalogue.js";
import { entryPriceBounds } from "../../scenario-engine/src/entry-prices.js";
/** Reviewed finite DEMO protocol. No environment-tuned profiles or hidden fallback. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import definitions from "../../config/src/demo-trial-catalogue.json" with { type: "json" };
import { DEMO_TRIAL_STRATEGY_VERSION } from "../../config/src/policy.js";
import type { EntryPlannerInput } from "../../scenario-engine/src/entry-planner.js";
import { scalpDecisionSchema } from "../../scenario-engine/src/scalp-entry.js";
import {
  canonical,
  decimal,
  isTickAligned,
} from "../../risk-engine/src/decimal.js";

export const trialProfileSchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
    proposalSource: z.enum(["CODEX", "LOCAL_RANGE"]),
    rangeBars: z.union([z.literal(3), z.literal(5)]),
    targetDistance: z.enum(["0.4", "0.6", "1"]),
    stopBufferTicks: z.union([z.literal(0), z.literal(5), z.literal(10)]),
    pendingSeconds: z.union([z.literal(60), z.literal(180)]),
    entryRangePoints: z.union([z.literal(10), z.literal(30)]),
    baseExitReservePoints: z.literal(5),
    stressExitReservePoints: z.literal(65),
  })
  .strict();
export type TrialProfile = z.infer<typeof trialProfileSchema> | TrendProfile;
export const profiles = trialProfileSchema
  .array()
  .length(9)
  .parse(definitions.profiles);
export function profileSha256(profile: TrialProfile): string {
  const parameters: Record<string, unknown> = { ...profile };
  delete parameters.id;
  return digest(parameters);
}
const legacyTrialBindingSchema = z
  .object({
    trialId: z.string().uuid(),
    profileId: z.string(),
    profileSha256: z.string().regex(/^[a-f0-9]{64}$/),
    catalogueSha256: z.literal(catalogueSha256),
    strategyVersion: z.literal(DEMO_TRIAL_STRATEGY_VERSION),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    registeredAt: z.string().datetime({ offset: true }),
    startsAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const profile = profiles.find((p) => p.id === value.profileId);
    if (
      !profile ||
      profileSha256(profile) !== value.profileSha256 ||
      Date.parse(value.registeredAt) >= Date.parse(value.startsAt)
    )
      ctx.addIssue({
        code: "custom",
        message: "SCENARIO_DEMO_TRIAL_BINDING_INVALID",
      });
  });
export const trialBindingSchema = z.union([
  legacyTrialBindingSchema,
  trendBindingSchema,
]);
export type TrialBinding = z.infer<typeof trialBindingSchema>;
export function trialProfile(binding: TrialBinding): TrialProfile {
  const value = trialBindingSchema.parse(binding);
  const found = (
    value.strategyVersion === TREND_RETEST_VERSION ? trendProfiles : profiles
  ).find((p) => p.id === value.profileId);
  if (!found) throw new Error("SCENARIO_DEMO_PROFILE_UNAVAILABLE");
  return found;
}
export function trialPrompt(binding: TrialBinding) {
  const profile = trialProfile(binding);
  const local = profile.proposalSource === "LOCAL_RANGE";
  const version =
    binding.strategyVersion === TREND_RETEST_VERSION
      ? ("entry-scalp-v4" as const)
      : local
        ? ("demo-local-range-v1" as const)
        : ("entry-scalp-v3" as const);
  const template = readFileSync(
    binding.strategyVersion === TREND_RETEST_VERSION
      ? "prompts/entry-scalp-v4.md"
      : local
        ? "prompts/demo-local-range-v1.md"
        : "prompts/entry-scalp-v3.md",
    "utf8",
  ).trim();
  const content =
    template +
    "\n\nREGISTERED_DEMO_TRIAL\n" +
    canonicalJson({ ...binding, profile });
  return {
    version,
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
export function trialGeometry(
  input: EntryPlannerInput,
  binding: TrialBinding,
  proposal?: unknown,
) {
  const profile = trialProfile(binding);
  if ("entryStyle" in profile) {
    if (proposal === undefined)
      throw new Error("AI_TREND_CODEX_PROPOSAL_REQUIRED");
    const parsed = scalpDecisionSchema.parse(proposal);
    if (Date.parse(input.capturedAt) < Date.parse(binding.startsAt))
      throw new Error("SCENARIO_DEMO_TRIAL_NOT_STARTED");
    if (parsed.decision === "WAIT") return parsed;
    const candidate = trendRetestGeometry(input, profile.entryStyle);
    if (
      candidate.decision === "WAIT" ||
      parsed.decision !== candidate.decision ||
      !decimal(parsed.entry_price!).eq(candidate.entryPrice) ||
      !decimal(parsed.stop_loss!).eq(candidate.stopLoss) ||
      !decimal(parsed.take_profit!).eq(candidate.takeProfit) ||
      parsed.pending_seconds !== candidate.pendingSeconds
    )
      throw new Error("AI_TREND_GEOMETRY_MISMATCH");
    return parsed;
  }
  const at = Date.parse(input.capturedAt);
  if (!Number.isFinite(at) || at < Date.parse(binding.startsAt))
    throw new Error("SCENARIO_DEMO_TRIAL_NOT_STARTED");
  const parsed =
    proposal === undefined ? null : scalpDecisionSchema.parse(proposal);
  const wait = (reason: string) =>
    scalpDecisionSchema.parse({
      decision: "WAIT",
      reason,
      entry_price: null,
      take_profit: null,
      stop_loss: null,
      pending_seconds: null,
    });
  if (profile.proposalSource === "CODEX" && parsed?.decision === "WAIT")
    return parsed;
  const invalid = (reason: string) => {
    if (profile.proposalSource === "CODEX")
      throw new Error("AI_DEMO_TRIAL_PROPOSAL_INVALID");
    return wait(reason);
  };
  const m1 =
    input.candles.find((f) => f.timeframe === "M1")?.candles.slice(-5) ?? [];
  const m5 =
    input.candles.find((f) => f.timeframe === "M5")?.candles.slice(-3) ?? [];
  if (
    m1.length !== 5 ||
    m5.length !== 3 ||
    [m1, m5].some((frame) =>
      frame.some(
        (bar, i) =>
          !bar.complete ||
          bar.qualityFlags.length > 0 ||
          !Number.isFinite(Date.parse(bar.startTime)) ||
          !Number.isFinite(Date.parse(bar.endTime)) ||
          Date.parse(bar.startTime) >= Date.parse(bar.endTime) ||
          Date.parse(bar.endTime) > at ||
          (i > 0 &&
            Date.parse(frame[i - 1]!.endTime) !== Date.parse(bar.startTime)),
      ),
    )
  )
    return invalid(
      "Completed contiguous M1/M5 history unavailable for registered trial",
    );
  const deltas = m5
    .slice(1)
    .map((bar, i) => decimal(bar.close).minus(m5[i]!.close));
  const side = deltas.every((d) => d.gt(0))
    ? "BUY"
    : deltas.every((d) => d.lt(0))
      ? "SELL"
      : null;
  if (side === null)
    return invalid(
      "Completed M5 direction unresolved for registered trend trial",
    );
  if (profile.proposalSource === "CODEX") {
    if (parsed === null) throw new Error("AI_DEMO_CODEX_PROPOSAL_REQUIRED");
    if (parsed.decision === "WAIT") return parsed;
    if (parsed.decision !== side)
      throw new Error("AI_DEMO_TREND_DIRECTION_INVALID");
  } else if (parsed !== null)
    throw new Error("SCENARIO_DEMO_LOCAL_SOURCE_CONFLICT");
  const tick = decimal(input.tickSize),
    sign = side === "BUY" ? 1 : -1;
  const working = m1.slice(-profile.rangeBars);
  const high = working
    .map((b) => decimal(b.high))
    .reduce((a, b) => (a.gt(b) ? a : b));
  const low = working
    .map((b) => decimal(b.low))
    .reduce((a, b) => (a.lt(b) ? a : b));
  const entry =
    profile.proposalSource === "CODEX"
      ? decimal(parsed!.entry_price!)
      : side === "BUY"
        ? high.plus(tick)
        : low.minus(tick);
  if (input.quote === undefined || input.minimumStopDistance === undefined)
    throw new Error("SCENARIO_ENTRY_QUOTE_MISSING");
  const bounds = entryPriceBounds(
    input.quote,
    input.tickSize,
    input.minimumStopDistance,
  );
  if (
    (side === "BUY" && entry.lt(bounds.buy_stop_minimum)) ||
    (side === "SELL" && entry.gt(bounds.sell_stop_maximum))
  )
    return invalid(
      "Original completed M1 boundary is already crossed or inside broker entry distance",
    );
  const stopAnchor = m1
    .map((b) => decimal(side === "BUY" ? b.low : b.high))
    .reduce((a, b) => (side === "BUY" ? (a.lt(b) ? a : b) : a.gt(b) ? a : b));
  const stop = stopAnchor.minus(tick.mul(profile.stopBufferTicks).mul(sign));
  const target = entry.plus(decimal(profile.targetDistance).mul(sign));
  const risk = entry.minus(stop).mul(sign);
  if (
    risk.lte(0) ||
    risk.gt(7) ||
    risk.gt(input.maximumStopDistance ?? "7") ||
    stop.lte(0) ||
    target.lte(0) ||
    ![entry, stop, target].every((p) => isTickAligned(p, tick))
  )
    return invalid(
      "Structural trial geometry outside finite broker-aligned bounds",
    );
  const result = {
    decision: side,
    reason:
      profile.proposalSource === "CODEX"
        ? parsed!.reason
        : `Registered LOCAL_RANGE M1=${profile.rangeBars}; completed M5 direction; no provider call`,
    entry_price: canonical(entry),
    take_profit: canonical(target),
    stop_loss: canonical(stop),
    pending_seconds: profile.pendingSeconds,
  };
  if (
    profile.proposalSource === "CODEX" &&
    (parsed!.pending_seconds !== result.pending_seconds ||
      !decimal(parsed!.take_profit!).eq(target) ||
      !decimal(parsed!.stop_loss!).eq(stop))
  )
    throw new Error("AI_DEMO_TRIAL_GEOMETRY_MISMATCH");
  return scalpDecisionSchema.parse(result);
}
