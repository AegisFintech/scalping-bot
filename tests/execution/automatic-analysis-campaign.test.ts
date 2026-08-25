import { describe, expect, it, vi } from "vitest";

import {
  enforceAutomaticAnalysisCampaign,
  evaluateAutomaticAnalysisCampaign,
  PostgresAutomaticAnalysisCampaign,
} from "../../apps/execution-service/src/automatic-analysis-campaign.js";

describe("automatic completed-AI analysis campaign", () => {
  it("allows an unbounded default and reports bounded progress", () => {
    expect(evaluateAutomaticAnalysisCampaign(12, 0)).toEqual({
      enabled: false,
      limit: null,
      completed: 12,
      remaining: null,
      complete: false,
      allowed: true,
      reasonCodes: [],
    });
    expect(evaluateAutomaticAnalysisCampaign(99, 100)).toEqual({
      enabled: true,
      limit: 100,
      completed: 99,
      remaining: 1,
      complete: false,
      allowed: true,
      reasonCodes: [],
    });
  });

  it("blocks the exact limit and any overrun boundary", () => {
    for (const completed of [100, 101]) {
      expect(evaluateAutomaticAnalysisCampaign(completed, 100)).toMatchObject({
        completed,
        remaining: 0,
        complete: true,
        allowed: false,
        reasonCodes: ["AUTOMATIC_ANALYSIS_CAMPAIGN_COMPLETE"],
      });
    }
  });

  it("fails closed on invalid progress", () => {
    const invalid: readonly (readonly [number, number])[] = [
      [-1, 100],
      [1.5, 100],
      [0, -1],
    ];
    for (const [completed, limit] of invalid) {
      expect(evaluateAutomaticAnalysisCampaign(completed, limit)).toMatchObject(
        {
          allowed: false,
          complete: false,
          reasonCodes: ["AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID"],
        },
      );
    }
  });

  it("persists the pause only at campaign completion", async () => {
    const pause = vi.fn(() => Promise.resolve());
    await expect(
      enforceAutomaticAnalysisCampaign(
        evaluateAutomaticAnalysisCampaign(99, 100),
        pause,
      ),
    ).resolves.toBe(true);
    expect(pause).not.toHaveBeenCalled();

    await expect(
      enforceAutomaticAnalysisCampaign(
        evaluateAutomaticAnalysisCampaign(100, 100),
        pause,
      ),
    ).resolves.toBe(false);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("counts durable completed responses and survives reconstruction", async () => {
    const query = vi.fn((sql: string, parameters: readonly unknown[]) => {
      void sql;
      void parameters;
      return Promise.resolve({
        rows: [{ completed: "42" }],
      });
    });
    const input = {
      pool: { query } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      configuredLimit: 100,
    };
    await expect(
      new PostgresAutomaticAnalysisCampaign(input).progress(),
    ).resolves.toMatchObject({ completed: 42, remaining: 58, allowed: true });
    await expect(
      new PostgresAutomaticAnalysisCampaign(input).progress(),
    ).resolves.toMatchObject({ completed: 42, remaining: 58, allowed: true });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual(["account", "symbol", "strategy"]);
  });

  it("uses stable fail-closed errors for unavailable or invalid database progress", async () => {
    const unavailable = new PostgresAutomaticAnalysisCampaign({
      pool: {
        query: vi.fn(() => Promise.reject(new Error("private"))),
      } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      configuredLimit: 100,
    });
    await expect(unavailable.progress()).rejects.toThrow(
      "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_UNAVAILABLE",
    );

    const malformed = new PostgresAutomaticAnalysisCampaign({
      pool: {
        query: vi.fn(() => Promise.resolve({ rows: [{ completed: "1.5" }] })),
      } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      configuredLimit: 100,
    });
    await expect(malformed.progress()).rejects.toThrow(
      "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID",
    );
  });
});
