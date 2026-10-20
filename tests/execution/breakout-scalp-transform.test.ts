import { describe, expect, it } from "vitest";
import { applyBreakoutScalpExitPolicy } from "../../apps/execution-service/src/proposal-transform.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
import { validateCommandFeeBuffer } from "../../packages/risk-engine/src/commission.js";
import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";
function input() {
  return {
    response: {
      ...response(),
      waiting_area: {
        ...response().waiting_area,
        description_code: "CONSOLIDATION_ZONE",
      },
    },
    metadata: metadata(),
    atr: "3",
    maximumStopDistance: "10",
  };
}
describe("reviewed breakout scalp transform", () => {
  it("preserves both breakout prices, rounds stops inward and produces valid local geometry", () => {
    const value = input(),
      before = structuredClone(value);
    const r = applyBreakoutScalpExitPolicy(value);
    expect(r.accepted).toBe(true);
    expect(r.response?.buy_stop.entry_price).toBe("4444");
    expect(r.response?.sell_stop.entry_price).toBe("4443");
    expect(r.response?.buy_stop.stop_loss).toBe("4436.5");
    expect(Number(r.response?.buy_stop.take_profit)).toBeLessThan(4450);
    expect(r.response?.technical_map.upside_targets).toEqual([
      r.response?.buy_stop.take_profit,
    ]);
    expect(
      new ModelResponseValidator("schemas/model-response-2.1.json").parse(
        JSON.stringify(r.response),
      ).accepted,
    ).toBe(true);
    expect(value).toEqual(before);
    const commands = (["BUY", "SELL"] as const).map((side) => {
      const leg = side === "BUY" ? r.response!.buy_stop : r.response!.sell_stop;
      return {
        side,
        entryPrice: leg.entry_price,
        takeProfit: leg.take_profit,
        volume: "100",
      } as PendingOrderCommand;
    }) as unknown as [PendingOrderCommand, PendingOrderCommand];
    expect(
      validateCommandFeeBuffer(commands, value.metadata, "1.5").approved,
    ).toBe(true);
  });
  it.each([{ maximumStopDistance: "7" }, { atr: "0" }, { atr: "0.1" }])(
    "rejects unaffordable or cost-defeating geometry %j",
    (patch) =>
      expect(
        applyBreakoutScalpExitPolicy({ ...input(), ...patch }).accepted,
      ).toBe(false),
  );
  it("does not widen a fractional ATR stop", () => {
    const r = applyBreakoutScalpExitPolicy({ ...input(), atr: "3.003" });
    expect(r.response?.buy_stop.stop_loss).toBe("4436.5");
  });
});
