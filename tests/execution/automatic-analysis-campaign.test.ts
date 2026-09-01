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
      baseline: 0,
      releaseCompleted: 12,
      completed: 12,
      lifetimeCompleted: 12,
      remaining: null,
      complete: false,
      allowed: true,
      reasonCodes: [],
    });
    expect(evaluateAutomaticAnalysisCampaign(99, 100)).toEqual({
      enabled: true,
      limit: 100,
      baseline: 0,
      releaseCompleted: 99,
      completed: 99,
      lifetimeCompleted: 99,
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

  it("carries forward only an explicit reviewed baseline", () => {
    expect(evaluateAutomaticAnalysisCampaign(2, 100, 4)).toMatchObject({
      baseline: 4,
      releaseCompleted: 2,
      completed: 6,
      remaining: 94,
      allowed: true,
    });
    expect(evaluateAutomaticAnalysisCampaign(0, 100, 101)).toMatchObject({
      allowed: false,
      reasonCodes: ["AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID"],
    });
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
        evaluateAutomaticAnalysisCampaign(50_000, 0, 0, 51_000),
        pause,
      ),
    ).resolves.toBe(true);
    expect(pause).not.toHaveBeenCalled();
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
        rows: [{ completed: "42", lifetime_completed: "1009" }],
      });
    });
    const input = {
      pool: { query } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      mode: "demo",
      configuredLimit: 100,
      completedBaseline: 4,
    };
    await expect(
      new PostgresAutomaticAnalysisCampaign(input).progress(),
    ).resolves.toMatchObject({
      baseline: 4,
      releaseCompleted: 42,
      completed: 46,
      lifetimeCompleted: 1009,
      remaining: 54,
      allowed: true,
    });
    await expect(
      new PostgresAutomaticAnalysisCampaign(input).progress(),
    ).resolves.toMatchObject({ completed: 46, remaining: 54, allowed: true });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "account",
      "symbol",
      "strategy",
      "demo",
    ]);
  });

  it("uses stable fail-closed errors for unavailable or invalid database progress", async () => {
    const unavailable = new PostgresAutomaticAnalysisCampaign({
      pool: {
        query: vi.fn(() => Promise.reject(new Error("private"))),
      } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      mode: "demo",
      configuredLimit: 100,
    });
    await expect(unavailable.progress()).rejects.toThrow(
      "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_UNAVAILABLE",
    );

    const malformed = new PostgresAutomaticAnalysisCampaign({
      pool: {
        query: vi.fn(() =>
          Promise.resolve({
            rows: [{ completed: "1.5", lifetime_completed: "42" }],
          }),
        ),
      } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      mode: "demo",
      configuredLimit: 100,
    });
    await expect(malformed.progress()).rejects.toThrow(
      "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID",
    );
  });

  it("fails closed when lifetime progress is below release progress", async () => {
    const campaign = new PostgresAutomaticAnalysisCampaign({
      pool: {
        query: vi.fn(() =>
          Promise.resolve({
            rows: [{ completed: "2", lifetime_completed: "1" }],
          }),
        ),
      } as never,
      accountId: "account",
      symbolId: "symbol",
      strategyVersionId: "strategy",
      mode: "demo",
      configuredLimit: 0,
    });
    await expect(campaign.progress()).rejects.toThrow(
      "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID",
    );
  });
});
