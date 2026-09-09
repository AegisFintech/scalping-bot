/** Async context deadlines, independent of order validity and protective exits. */
export const SCENARIO_REQUEST_POLICY = Object.freeze({
  providerTimeoutMs: 90_000,
  transportGraceMs: 5_000,
  dispatchCooldownMs: 300_000,
  localCircuitRecheckMs: 60_000,
  // Pro is text-only. More numeric history replaces provider-side chart reading.
  candleLimits: Object.freeze({ M1: 240, M5: 144, M15: 96 }),
  maxOutputTokens: 4096,
  // EPRToken's thinking output exhausted 4096 tokens without a plan, even at low.
  reasoningEffort: "none" as const,
});

/** This exact failure is emitted before any provider HTTP request is dispatched. */
export function isLocalCircuitRejection(
  state: string,
  reason: string | null,
): boolean {
  return state === "FAILED" && reason === "AI_CIRCUIT_OPEN";
}
