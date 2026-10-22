import { describe, expect, it } from "vitest";
import { evidenceDemoTransform } from "../../packages/strategy-candidates/src/evidence-demo.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
import type { MarketSnapshot } from "../../packages/contracts/src/index.js";
function fixture() {
  return {
    snapshot: { metadata: metadata() } as MarketSnapshot,
    response: response(),
    maximumStopDistance: "100",
  };
}
describe("evidence-first protection", () => {
  it("preserves Codex levels without scanner, ATR, trend or compression admission", () => {
    const input = fixture(),
      before = structuredClone(input);
    const result = evidenceDemoTransform(input);
    expect(result.accepted).toBe(true);
    expect(result.response?.buy_stop.entry_price).toBe(
      input.response.buy_stop.entry_price,
    );
    expect(result.response?.sell_stop.entry_price).toBe(
      input.response.sell_stop.entry_price,
    );
    expect(result.response?.buy_stop.risk_reward_ratio).toBe("1");
    expect(input).toEqual(before);
  });
  it.each(["crossed", "off_tick", "unaffordable", "too_small"])(
    "fails closed: %s",
    (fault) => {
      const input = fixture();
      if (fault === "crossed")
        input.response = {
          ...input.response,
          buy_stop: {
            ...input.response.buy_stop,
            entry_price: input.response.sell_stop.entry_price,
          },
        };
      if (fault === "off_tick")
        input.response = {
          ...input.response,
          buy_stop: { ...input.response.buy_stop, entry_price: "4444.001" },
        };
      if (fault === "unaffordable") input.maximumStopDistance = "0.1";
      if (fault === "too_small")
        input.snapshot = {
          ...input.snapshot,
          metadata: { ...input.snapshot.metadata, minStopDistance: "500" },
        };
      expect(evidenceDemoTransform(input).accepted).toBe(false);
    },
  );
});
