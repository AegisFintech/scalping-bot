import { describe, expect, it, vi } from "vitest";

import type { RuntimeControlStore } from "../../packages/database/src/runtime-controls.js";
import type { AnalysisCoordinator } from "../../apps/execution-service/src/coordinator.js";
import type { OrderMaintenance } from "../../apps/execution-service/src/order-maintenance.js";
import { createExecutionServer } from "../../apps/execution-service/src/server.js";

function server(
  mode: string,
  initialize: () => Promise<{ tradingDay: string; timezone: string }>,
) {
  return createExecutionServer({
    coordinator: {} as AnalysisCoordinator,
    maintenance: {} as OrderMaintenance,
    controls: {} as RuntimeControlStore,
    controlToken: "x".repeat(32),
    scope: "local-1",
    instanceId: "local-1",
    accountKey: "demo-pseudonym",
    configHash: "config-hash",
    mode,
    status: () =>
      Promise.resolve({
        mode,
        symbol: "XAUUSD",
        accountType: "demo",
        emergencyStopped: true,
        pauseNewAnalyses: false,
        automaticAnalysisEnabled: false,
        automaticAnalysisCampaign: {
          enabled: false,
          limit: null,
          completed: 0,
          remaining: null,
          complete: false,
          reasonCodes: [],
        },
        aiCircuitOpenUntil: null,
        tradingEnabled: false,
        startupChecksPassed: true,
        lastCycle: null,
        reasonCodes: ["EMERGENCY_STOP_ENV"],
      }),
    updateLastCycle: () => undefined,
    initializeDailyRiskBaseline: initialize,
  });
}

describe("demo baseline control", () => {
  it("requires control authentication and demo mode", async () => {
    const initialize = vi.fn(() =>
      Promise.resolve({ tradingDay: "2026-08-24", timezone: "UTC" }),
    );
    const demo = server("demo", initialize);
    const unauthorized = await demo.inject({
      method: "POST",
      url: "/v1/controls/daily-risk-baseline",
      payload: { actor: "operator", reason: "preflight" },
    });
    expect(unauthorized.statusCode).toBe(401);
    await demo.close();

    const paper = server("paper", initialize);
    const wrongMode = await paper.inject({
      method: "POST",
      url: "/v1/controls/daily-risk-baseline",
      headers: { "x-control-token": "x".repeat(32) },
      payload: { actor: "operator", reason: "preflight" },
    });
    expect(wrongMode.statusCode).toBe(409);
    expect(initialize).not.toHaveBeenCalled();
    await paper.close();
  });

  it("returns only bounded baseline metadata after successful reconciliation", async () => {
    const initialize = vi.fn(() =>
      Promise.resolve({
        tradingDay: "2026-08-24",
        timezone: "Asia/Singapore",
      }),
    );
    const app = server("demo", initialize);
    const response = await app.inject({
      method: "POST",
      url: "/v1/controls/daily-risk-baseline",
      headers: { "x-control-token": "x".repeat(32) },
      payload: { actor: "operator", reason: "emergency-stopped preflight" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: true,
      reconciliation: "certain",
      trading_day: "2026-08-24",
      timezone: "Asia/Singapore",
    });
    expect(initialize).toHaveBeenCalledWith({
      actor: "operator",
      reason: "emergency-stopped preflight",
    });
    await app.close();
  });
});
