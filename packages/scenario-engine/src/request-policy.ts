/** Async context deadlines, independent of order validity and protective exits. */
export const SCENARIO_REQUEST_POLICY = Object.freeze({
  providerTimeoutMs: 90_000,
  transportGraceMs: 5_000,
  dispatchCooldownMs: 300_000,
  localCircuitRecheckMs: 60_000,
});

/** This exact failure is emitted before any provider HTTP request is dispatched. */
export function isLocalCircuitRejection(
  state: string,
  reason: string | null,
): boolean {
  return state === "FAILED" && reason === "AI_CIRCUIT_OPEN";
}
