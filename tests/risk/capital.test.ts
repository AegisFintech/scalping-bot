import { OcoRiskEvaluator } from "../../apps/execution-service/src/oco-risk-evaluator.js";
import { describe, expect, it } from "vitest";
import {
  capitalRisk,
  availableCapitalRiskPercent,
  type CapitalState,
} from "../../packages/risk-engine/src/capital.js";

const evaluate = (
  equity: string,
  flows = "0",
  previous: CapitalState | null = null,
  daily = "0",
) =>
  capitalRisk({
    equity,
    cumulativeNetFlows: flows,
    previous,
    dailyLossPercent: daily,
    referenceEquity: "10000",
    observedHighWater: "10000",
  });
describe("capital-aware risk reductions", () => {
  it("uses remaining daily capacity at any positive equity without an absolute floor", () => {
    expect(availableCapitalRiskPercent("10000", "500")).toBe("5");
    expect(availableCapitalRiskPercent("100", "5")).toBe("5");
    expect(availableCapitalRiskPercent("10000", "0.5")).toBe("0.005");
    expect(availableCapitalRiskPercent("10000", "0")).toBe("0");
    expect(availableCapitalRiskPercent("3", "0.1")).toBe("3.3333333333");
    expect(() => availableCapitalRiskPercent("0", "100")).toThrow(
      "CAPITAL_EQUITY_INVALID",
    );
    expect(() => availableCapitalRiskPercent("10000", "bad")).toThrow();
  });
  it("does not mistake deposits or withdrawals for performance", () => {
    expect(evaluate("12000", "2000")).toMatchObject({
      drawdownPercent: "0",
      riskMultiplier: "1",
    });
    expect(evaluate("8000", "-2000")).toMatchObject({
      drawdownPercent: "0",
      riskMultiplier: "1",
    });
    expect(evaluate("7800", "-2000")).toMatchObject({
      drawdownPercent: "2",
      riskMultiplier: "0.5",
    });
  });
  it("preserves reductions across restart and recovers only inside hysteresis", () => {
    const reduced = evaluate("9600");
    expect(reduced.riskMultiplier).toBe("0.25");
    expect(
      evaluate("9850", "0", JSON.parse(JSON.stringify(reduced)) as CapitalState)
        .riskMultiplier,
    ).toBe("0.25");
    expect(evaluate("9950", "0", reduced).riskMultiplier).toBe("1");
  });
  it("never resets a drawdown lockout through a deposit or restart", () => {
    const locked = evaluate("9500");
    expect(evaluate("14000", "4000", locked)).toMatchObject({
      lockedOut: true,
      riskMultiplier: "0",
    });
  });
  it("scales daily reductions to the five-percent budget and recovers only below both limits", () => {
    expect(evaluate("10000", "0", null, "2.49").riskMultiplier).toBe("1");
    const half = evaluate("10000", "0", null, "2.5");
    expect(half.riskMultiplier).toBe("0.5");
    const quarter = evaluate("10000", "0", half, "3.75");
    expect(quarter.riskMultiplier).toBe("0.25");
    expect(evaluate("10000", "0", quarter, "1.25").riskMultiplier).toBe("0.25");
    expect(evaluate("10000", "0", quarter, "1.24").riskMultiplier).toBe("1");
  });
  it("reduces on daily losses and rejects malformed accounting", () => {
    expect(evaluate("10000", "0", null, "2.5").riskMultiplier).toBe("0.5");
    let remainingCap = "0.0002";
    const sizing = new OcoRiskEvaluator({
      marginEstimator: { estimate: () => Promise.resolve("1") },
      baseRiskPercent: "1",
      maxRiskPercent: "1",
      maxMarginUsagePercent: "1",
      maxPositionNotional: "5500",
      strategyVersion: "test",
      riskMultiplier: () => evaluate("10000", "0", null, "2.5").riskMultiplier,
      riskPercentCap: () => remainingCap,
    });
    expect(sizing.currentSetupRiskPercent()).toBe("0.0002");
    remainingCap = "0";
    expect(() => sizing.currentSetupRiskPercent()).toThrow(
      "CAPITAL_RISK_BUDGET_EXHAUSTED",
    );
    expect(() => evaluate("NaN")).toThrow();
    expect(() => evaluate("9000", "10000")).toThrow("CAPITAL_STATE_INVALID");
  });
});
