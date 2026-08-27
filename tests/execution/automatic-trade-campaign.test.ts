import { describe, expect, it, vi } from "vitest";

import {
  enforceAutomaticTradeCampaign,
  evaluateAutomaticTradeCampaign,
  PostgresAutomaticTradeCampaign,
} from "../../apps/execution-service/src/automatic-trade-campaign.js";

describe("automatic closed-demo-trade campaign", () => {
  it("keeps the target separate from attempts and completed AI responses", () => {
    expect(evaluateAutomaticTradeCampaign(9, 100)).toEqual({
      enabled: true,
      limit: 100,
      baseline: 0,
      releaseClosedTrades: 9,
      closedTrades: 9,
      remaining: 91,
      complete: false,
      allowed: true,
      reasonCodes: [],
    });
    expect(evaluateAutomaticTradeCampaign(9, 0)).toMatchObject({
      enabled: false,
      limit: null,
      closedTrades: 9,
      allowed: true,
    });
  });

  it("blocks at the exact durable trade boundary and supports reviewed carry-forward", () => {
    expect(evaluateAutomaticTradeCampaign(97, 100, 3)).toMatchObject({
      releaseClosedTrades: 97,
      closedTrades: 100,
      remaining: 0,
      complete: true,
      allowed: false,
      reasonCodes: ["AUTOMATIC_TRADE_CAMPAIGN_COMPLETE"],
    });
    expect(evaluateAutomaticTradeCampaign(0, 100, 101)).toMatchObject({
      allowed: false,
      reasonCodes: ["AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID"],
    });
  });

  it("persists the pause only after the closed-trade target", async () => {
    const pause = vi.fn(() => Promise.resolve());
    await expect(
      enforceAutomaticTradeCampaign(
        evaluateAutomaticTradeCampaign(99, 100),
        pause,
      ),
    ).resolves.toBe(true);
    expect(pause).not.toHaveBeenCalled();
    await expect(
      enforceAutomaticTradeCampaign(
        evaluateAutomaticTradeCampaign(100, 100),
        pause,
      ),
    ).resolves.toBe(false);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("counts only durable closed demo trades for the exact strategy release", async () => {
    const query = vi.fn((sql: string, parameters: readonly unknown[]) => {
      expect(sql).toContain("count(DISTINCT t.id)");
      expect(sql).toContain("og.state = 'CLOSED'");
      expect(sql).toContain("t.mode = 'demo'");
      expect(parameters).toEqual(["account", "symbol", "strategy"]);
      return Promise.resolve({ rows: [{ closed_trades: "9" }] });
    });
    await expect(
      new PostgresAutomaticTradeCampaign({
        pool: { query } as never,
        accountId: "account",
        symbolId: "symbol",
        strategyVersionId: "strategy",
        configuredLimit: 100,
      }).progress(),
    ).resolves.toMatchObject({ closedTrades: 9, remaining: 91 });
  });

  it("fails closed when durable progress is unavailable or malformed", async () => {
    const unavailable = new PostgresAutomaticTradeCampaign({
      pool: {
        query: vi.fn(() => Promise.reject(new Error("private"))),
      } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      configuredLimit: 100,
    });
    await expect(unavailable.progress()).rejects.toThrow(
      "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_UNAVAILABLE",
    );
    const malformed = new PostgresAutomaticTradeCampaign({
      pool: {
        query: vi.fn(() =>
          Promise.resolve({ rows: [{ closed_trades: "1.5" }] }),
        ),
      } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      configuredLimit: 100,
    });
    await expect(malformed.progress()).rejects.toThrow(
      "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID",
    );
  });
});
