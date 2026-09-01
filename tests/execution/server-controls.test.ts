import { describe, expect, it, vi } from "vitest";

import type { RuntimeControlStore } from "../../packages/database/src/runtime-controls.js";
import type { AnalysisCoordinator } from "../../apps/execution-service/src/coordinator.js";
import type { OrderMaintenance } from "../../apps/execution-service/src/order-maintenance.js";
import { createExecutionServer } from "../../apps/execution-service/src/server.js";
import type { OpenPositionMonitor } from "../../packages/contracts/src/index.js";

function server(
  mode: string,
  initialize: () => Promise<{ tradingDay: string; timezone: string }>,
  openPositionMonitor?: () => Promise<OpenPositionMonitor>,
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
          baseline: 0,
          releaseCompleted: 0,
          completed: 0,
          lifetimeCompleted: 0,
          remaining: null,
          complete: false,
          reasonCodes: [],
        },
        automaticDemoTradeCampaign: {
          enabled: false,
          limit: null,
          baseline: 0,
          releaseClosedTrades: 0,
          closedTrades: 0,
          lifetimeClosedTrades: 0,
          remaining: null,
          complete: false,
          reasonCodes: [],
        },
        automationActivity: {
          state: "DISABLED",
          lastClaimedAt: null,
          lastCompletedAt: null,
          lastLifecycleAt: null,
          lastProgressAt: null,
          latestMarketAt: null,
          stalledSince: null,
          reasonCodes: [],
        },
        managedSetup: {
          status: "NONE",
          groupState: null,
          groupExpiresAt: null,
          groupUpdatedAt: null,
          orders: [],
          positions: [],
          trades: [],
          position: null,
          trade: null,
        },
        aiCircuitOpenUntil: null,
        tradingEnabled: false,
        startupChecksPassed: true,
        lastCycle: null,
        reasonCodes: ["EMERGENCY_STOP_ENV"],
      }),
    updateLastCycle: () => undefined,
    initializeDailyRiskBaseline: initialize,
    ...(openPositionMonitor === undefined ? {} : { openPositionMonitor }),
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

describe("open position monitor route", () => {
  it("returns the bounded read-only monitor without authentication", async () => {
    const read = vi.fn(() =>
      Promise.resolve<OpenPositionMonitor>({
        status: "AVAILABLE",
        executionState: "NORMAL",
        side: "BUY",
        accountCurrency: "USD",
        bid: "4641.2",
        ask: "4641.4",
        markPrice: "4641.2",
        grossUnrealizedPnl: "3.2",
        netUnrealizedPnl: "2.75",
        recordedCommission: "-0.3",
        quoteSourceTime: "2026-08-25T04:00:00.000Z",
        quoteReceivedAt: "2026-08-25T04:00:00.050Z",
        pnlCapturedAt: "2026-08-25T04:00:00.060Z",
      }),
    );
    const app = server("demo", vi.fn(), read);
    const response = await app.inject({
      method: "GET",
      url: "/v1/open-position-monitor",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "AVAILABLE",
      executionState: "NORMAL",
      markPrice: "4641.2",
      netUnrealizedPnl: "2.75",
    });
    expect(read).toHaveBeenCalledOnce();
    await app.close();
  });

  it("reports disabled instead of inferring data when no monitor exists", async () => {
    const app = server("paper", vi.fn());
    const response = await app.inject({
      method: "GET",
      url: "/v1/open-position-monitor",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      status: "UNAVAILABLE",
      reasonCode: "OPEN_POSITION_MONITOR_DISABLED",
    });
    await app.close();
  });
});
