import { describe, expect, it } from "vitest";
import {
  buildBreakoutCandidate,
  type BreakoutCandidateInput,
} from "../../packages/strategy-candidates/src/breakout.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
function input(): BreakoutCandidateInput {
  return {
    response: response(),
    metadata: metadata(),
    now: "2026-09-01T00:00:02.000Z",
    availableAt: "2026-09-01T00:00:01.000Z",
    quote: {
      bid: "4443.4",
      ask: "4443.6",
      sourceTime: "2026-09-01T00:00:01.500Z",
      receivedAt: "2026-09-01T00:00:01.700Z",
    },
  };
}
describe("breakout candidate", () => {
  it("preserves breakout levels, sides and historical input without fade or quote clamping", () => {
    const value = input();
    const before = structuredClone(value);
    const result = buildBreakoutCandidate(value);
    expect(result).toMatchObject({
      accepted: true,
      authority: "RESEARCH_ONLY",
      orderType: "STOP_LIMIT",
      timeInForce: "GTC",
      maxSlippagePoints: "30",
    });
    expect(result.response).toEqual(value.response);
    expect(result.response).not.toBe(value.response);
    expect(value).toEqual(before);
  });
  it.each(["BUY", "SELL"] as const)(
    "rejects crossed %s instead of moving an entry",
    (side) => {
      const value = input();
      const leg =
        side === "BUY" ? value.response.buy_stop : value.response.sell_stop;
      Object.assign(leg, { entry_price: "4443.5", trigger_price: "4443.5" });
      expect(buildBreakoutCandidate(value).reasonCodes).toContain(
        `${side}_BREAKOUT_LEVEL_CROSSED_OR_INVALID`,
      );
    },
  );
  it.each(["source", "receipt", "availability", "expiry", "metadata"])(
    "rejects invalid %s provenance",
    (kind) => {
      const value = input();
      if (kind === "source")
        Object.assign(value.quote, { sourceTime: "2026-08-31T23:59:50Z" });
      if (kind === "receipt")
        Object.assign(value.quote, { receivedAt: "2026-09-01T00:00:03Z" });
      if (kind === "availability")
        Object.assign(value, { availableAt: "2026-09-01T00:00:03Z" });
      if (kind === "expiry")
        Object.assign(value.response, { valid_until: value.now });
      if (kind === "metadata")
        Object.assign(value.metadata, { metadataTime: "2026-08-29T00:00:00Z" });
      expect(buildBreakoutCandidate(value)).toMatchObject({
        accepted: false,
        response: null,
      });
    },
  );
  it("rejects invalid geometry and off-tick prices", () => {
    const value = input();
    Object.assign(value.response.buy_stop, {
      stop_loss: "4445",
      entry_price: "4444.001",
    });
    const result = buildBreakoutCandidate(value);
    expect(result.reasonCodes).toContain("BUY_BREAKOUT_PRICE_INVALID");
    expect(result.reasonCodes).toContain("BUY_BREAKOUT_PROTECTION_INVALID");
  });
  it("rejects ambiguous timezone and broker minimum-distance violations", () => {
    const value = input();
    Object.assign(value, { availableAt: "2026-09-01T00:00:01" });
    expect(buildBreakoutCandidate(value).accepted).toBe(false);
    const restricted = input();
    Object.assign(restricted.metadata, { minStopDistance: "0.5" });
    expect(buildBreakoutCandidate(restricted).reasonCodes).toContain(
      "BUY_BREAKOUT_BROKER_DISTANCE_INVALID",
    );
  });
});
