import { describe, it, expect } from "vitest";
import { quickProfitExit } from "../../apps/execution-service/src/quick-profit-exit.js";
const HISTORICAL_PROFIT_SOURCE = "0.7.2-quick-oco.1-codex.1";
import { metadata } from "../helpers/breakout-candidate.js";
import type { ProtectionPosition } from "../../apps/execution-service/src/position-protection.js";
const now = new Date("2026-10-26T07:00:00Z");
const position: ProtectionPosition = {
  id: "p",
  brokerPositionId: "1",
  strategyVersion: HISTORICAL_PROFIT_SOURCE,
  entryCommission: "-29.67",
  entryPrice: "4004.19",
  volume: "24700",
  side: "SELL",
  orderEntry: "4004.43",
  orderStopLoss: "4011.43",
  orderTakeProfit: "4004.03",
  label: "ctrader-ai-scalper:test",
  repairAttempts: 0,
  commandAt: null,
  closeRequestedAt: null,
};
function input() {
  return {
    position,
    quote: {
      bid: "4003.70",
      ask: "4003.79",
      sourceTime: now.toISOString(),
      receivedAt: now.toISOString(),
    },
    metadata: { ...metadata(), metadataTime: now.toISOString() },
    raw: { swap: "0", moneyDigits: 2 },
    symbolId: metadata().symbolId,
    now,
  };
}
describe("cost-aware early profit", () => {
  it("covers both fees and execution allowance before closing a winning SELL", () => {
    const result = quickProfitExit(input());
    expect(result).not.toBeNull();
    expect(Number(result!.modeledNet)).toBeGreaterThan(
      Number(result!.requiredNet),
    );
    expect(result!.guaranteedProceeds).toBe(false);
  });
  it("uses executable BUY bid, not mid or ask", () => {
    const v = input();
    v.position = { ...position, side: "BUY" };
    v.quote = { ...v.quote, bid: "4004.59", ask: "4004.69" };
    expect(quickProfitExit(v)).not.toBeNull();
    v.quote.bid = "4004.30";
    expect(quickProfitExit(v)).toBeNull();
  });
  it("rejects green gross that does not cover fees and reserve", () => {
    const v = input();
    v.quote.ask = "4003.95";
    expect(quickProfitExit(v)).toBeNull();
  });
  it("refuses stale/future quotes or metadata and crossed/invalid tick quotes", () => {
    for (const patch of [
      { sourceTime: "2026-10-26T06:59:58Z" },
      { receivedAt: "2026-10-26T07:00:01Z" },
      { bid: "4004.00" },
      { ask: "4003.795" },
    ]) {
      const v = input();
      Object.assign(v.quote, patch);
      expect(quickProfitExit(v)).toBeNull();
    }
    const v = input();
    v.metadata.metadataTime = "2026-10-26T06:59:00Z";
    expect(quickProfitExit(v)).toBeNull();
  });
  it("leaves historical setups alone and refuses unknown costs/swap", () => {
    const v = input();
    v.position = { ...position, strategyVersion: "0.7.1-quick-oco.1-codex.1" };
    expect(quickProfitExit(v)).toBeNull();
    v.position = position;
    v.raw = { swap: undefined, moneyDigits: 2 } as unknown as typeof v.raw;
    expect(quickProfitExit(v)).toBeNull();
  });
  it("includes negative swap and changed commission instead of counting an unreal profit", () => {
    const v = input();
    v.raw.swap = "-10000";
    expect(quickProfitExit(v)).toBeNull();
    v.raw.swap = "0";
    v.metadata.commission = { ...v.metadata.commission, rate: "3000" };
    expect(quickProfitExit(v)).toBeNull();
  });
});
