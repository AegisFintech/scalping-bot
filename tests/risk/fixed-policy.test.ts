import { Decimal } from "decimal.js";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  MONEY_MANAGEMENT,
  resolveRuntimeEnvironment,
} from "../../packages/config/src/policy.js";
import {
  loadExecutionConfig,
  safetyConfigHash,
  strategyConfigHash,
} from "../../apps/execution-service/src/config.js";
import { DailyRiskStore } from "../../apps/execution-service/src/daily-risk-store.js";
import { dailyLoss, sizeOcoPair } from "../../packages/risk-engine/src/risk.js";
import { availableCapitalRiskPercent } from "../../packages/risk-engine/src/capital.js";
import { readFileSync } from "node:fs";
import type { ReplayInput } from "../../packages/scenario-engine/src/replay.js";

const metadata = (
  JSON.parse(
    readFileSync(
      "tests/fixtures/scenario/manual-levels-synthetic.json",
      "utf8",
    ),
  ) as ReplayInput
).metadata;
const config = loadExecutionConfig(resolveRuntimeEnvironment({}));

describe("fixed percentage policy, synthetic risk evidence only", () => {
  it("keeps scheduler authority in safety auditing without changing immutable strategy identity", () => {
    const stopped = loadExecutionConfig(
      resolveRuntimeEnvironment({ AUTOMATIC_ANALYSIS_ENABLED: "false" }),
    );
    const enabled = { ...stopped, automaticAnalysisEnabled: true };
    expect(strategyConfigHash(enabled)).toBe(strategyConfigHash(stopped));
    expect(safetyConfigHash(enabled)).not.toBe(safetyConfigHash(stopped));
    for (const patch of [
      { maxPositionNotional: "1000" },
      { baseRiskPercent: "0.5" },
      { maxDailyLossPercent: "4" },
      { tradingMode: "demo" as const },
    ]) {
      expect(strategyConfigHash({ ...stopped, ...patch })).not.toBe(
        strategyConfigHash(stopped),
      );
    }
  });

  it("has no account floor and fixes risk without changing explicit authorization", () => {
    const env = resolveRuntimeEnvironment({
      ACCOUNT_EQUITY_FLOOR: "999999999",
      AI_API_KEY: "fixture-private",
    });
    expect(env.ACCOUNT_EQUITY_FLOOR).toBeUndefined();
    expect(env.AI_API_KEY).toBe("fixture-private");
    expect(() => loadExecutionConfig({ BASE_RISK_PERCENT: "0.5" })).toThrow(
      "CONFIG_POLICY_CONFLICT:BASE_RISK_PERCENT",
    );
    expect(loadExecutionConfig(env)).toMatchObject({
      baseRiskPercent: "1",
      maxRiskPercent: "1",
      maxDailyLossPercent: "5",
      demoTradingEnabled: false,
      liveTradingEnabled: false,
    });
  });
  it.each(["BASE_RISK_PERCENT", "MAX_RISK_PERCENT", "MAX_DAILY_LOSS_PERCENT"])(
    "rejects conflicting legacy %s without echoing values",
    (key) => {
      expect(() =>
        resolveRuntimeEnvironment({ [key]: "private-invalid-value" }),
      ).toThrow(`CONFIG_POLICY_CONFLICT:${key}:`);
    },
  );
  it.each(["1000", "10000", "1000000"])(
    "keeps combined cost-inclusive OCO risk below 1%% at equity %s",
    (equity) => {
      const leg = {
        equity,
        availableMargin: equity,
        baseRiskPercent: config.baseRiskPercent,
        maxRiskPercent: config.maxRiskPercent,
        entryPrice: "4405",
        stopLoss: "4404",
        estimatedMarginPerVolume: "0.001",
        currentMargin: "0",
        maxMarginUsagePercent: "1",
        maxPositionNotional: "5500",
        metadata,
      };
      const result = sizeOcoPair({
        setupRiskPercent: config.baseRiskPercent,
        buy: leg,
        sell: { ...leg, entryPrice: "4404", stopLoss: "4405" },
      });
      expect(result.approved).toBe(true);
      const budget = new Decimal(equity)
        .mul(MONEY_MANAGEMENT.setupRiskPercent)
        .div(100);
      expect(new Decimal(result.combinedMaximumLoss!).lte(budget)).toBe(true);
      expect(new Decimal(result.buy.maximumLoss!).lte(budget.div(2))).toBe(
        true,
      );
      expect(new Decimal(result.sell.maximumLoss!).lte(budget.div(2))).toBe(
        true,
      );
      expect(
        new Decimal(result.buy.maximumLoss!)
          .plus(result.sell.maximumLoss!)
          .toFixed(),
      ).toBe(result.combinedMaximumLoss);
      const tiny = sizeOcoPair({
        setupRiskPercent: "0.00000001",
        buy: leg,
        sell: leg,
      });
      expect(tiny.approved).toBe(false);
    },
  );
  it("caps the final setup to the last daily loss capacity and rejects exhausted budgets", () => {
    const equity = "9510";
    const cap = availableCapitalRiskPercent(equity, "10");
    const leg = {
      equity,
      availableMargin: equity,
      baseRiskPercent: "1",
      maxRiskPercent: "1",
      entryPrice: "4405",
      stopLoss: "4404",
      estimatedMarginPerVolume: "0.001",
      currentMargin: "0",
      maxMarginUsagePercent: "1",
      maxPositionNotional: "5500",
      metadata,
    };
    const result = sizeOcoPair({
      setupRiskPercent: cap,
      buy: leg,
      sell: { ...leg, entryPrice: "4404", stopLoss: "4405" },
    });
    expect(result.approved).toBe(true);
    expect(new Decimal(result.combinedMaximumLoss!).lte(10)).toBe(true);
    expect(
      sizeOcoPair({
        setupRiskPercent: availableCapitalRiskPercent(equity, "0"),
        buy: leg,
        sell: leg,
      }).approved,
    ).toBe(false);
  });
  it.each(["0", "2000", "-2000"])(
    "locks at five percent without treating flow %s as trading P&L",
    (netFlows) => {
      const base = {
        baselineEquity: "10000",
        netFlows,
        thresholdPercent: config.maxDailyLossPercent,
      };
      expect(
        dailyLoss({
          ...base,
          currentEquity: new Decimal(9500).plus(netFlows).toFixed(),
        }).lockedOut,
      ).toBe(true);
      expect(
        dailyLoss({
          ...base,
          currentEquity: new Decimal("9500.01").plus(netFlows).toFixed(),
        }).lockedOut,
      ).toBe(false);
    },
  );
  it("honors a daily lock latched concurrently after the initial read", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ baseline_equity: "10000", locked_out: false }],
      })
      .mockResolvedValueOnce({ rows: [{ locked_out: true }] });
    const store = new DailyRiskStore({ query } as unknown as pg.Pool);
    const result = await store.reconcile({
      accountId: "test",
      account: {
        equity: "9999",
        balance: "10000",
        availableMargin: "9999",
        reconciledAt: "2026-09-07T00:01:00Z",
        certain: true,
        relevantPositionCount: 0,
        relevantPendingOrderCount: 0,
        hasPartialFill: false,
        hasCancellationPending: false,
        reasonCodes: [],
      },
      timezone: "UTC",
      thresholdPercent: "5",
      includeUnrealized: true,
      netFlows: "0",
      allowBaselineBootstrap: false,
      baselineCaptureGraceSeconds: 300,
      now: new Date("2026-09-07T00:01:00Z"),
    });
    expect(result).toMatchObject({
      lockedOut: true,
      remainingLossBudget: "0",
      lossPercent: "0.01",
    });
    expect(query.mock.calls[1]?.[0]).toContain("RETURNING locked_out");
  });
});
