import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadExecutionConfig } from "../../apps/execution-service/src/config.js";
import { DisabledLiveGateway } from "../../apps/execution-service/src/live-compatible-gateway.js";
import {
  LIVE_ACKNOWLEDGEMENT,
  LIVE_FILE_STATEMENT,
  evaluateAutomaticAnalysisEligibility,
  evaluatePlacementEligibility,
  readFilesystemControls,
  type SafetyGateInput,
} from "../../apps/execution-service/src/safety-gates.js";

function safeInput(): SafetyGateInput {
  return {
    tradingMode: "live",
    liveTradingEnabled: true,
    liveAcknowledgement: LIVE_ACKNOWLEDGEMENT,
    environmentEmergencyStop: false,
    filesystemControlsCertain: true,
    filesystemEmergencyStop: false,
    liveEnablementFileValid: true,
    runtimeControlsCertain: true,
    databaseEmergencyStop: false,
    dashboardAcknowledged: true,
    pauseNewAnalyses: false,
    startupChecksPassed: true,
    serviceHealthy: true,
    accountAuthenticated: true,
    accountReconciled: true,
    reconciliationCertain: true,
    relevantPositionCount: 0,
    relevantPendingOrderCount: 0,
    partialFillPresent: false,
    cancellationPending: false,
    previousAnalysisExpired: true,
    candlesSynchronized: true,
    orderBookFresh: true,
    marketDataFresh: true,
    dailyLossLockout: false,
    operationalRiskLockout: false,
    aiCircuitOpen: false,
    symbolMetadataValid: true,
    aiResponseValid: true,
    deterministicRiskApproved: true,
    spreadSafe: true,
    duplicateFree: true,
    criticalAuditAvailable: true,
  };
}

describe("execution safety gates", () => {
  it("defaults to paper, emergency-stopped, and live-disabled", () => {
    const config = loadExecutionConfig({});
    expect(config).toMatchObject({
      tradingMode: "paper",
      liveTradingEnabled: false,
      demoTradingEnabled: false,
      emergencyStop: true,
      automaticAnalysisEnabled: false,
      automaticAnalysisCompletedLimit: 0,
      automaticAnalysisStartWindowSeconds: 10,
    });
  });

  it("bounds the durable completed-analysis campaign limit", () => {
    expect(
      loadExecutionConfig({ AUTOMATIC_ANALYSIS_COMPLETED_LIMIT: "100" })
        .automaticAnalysisCompletedLimit,
    ).toBe(100);
    expect(
      loadExecutionConfig({ AUTOMATIC_ANALYSIS_COMPLETED_LIMIT: "10000" })
        .automaticAnalysisCompletedLimit,
    ).toBe(10_000);
    expect(() =>
      loadExecutionConfig({ AUTOMATIC_ANALYSIS_COMPLETED_LIMIT: "10001" }),
    ).toThrow("CONFIG_INTEGER_OUT_OF_RANGE:AUTOMATIC_ANALYSIS_COMPLETED_LIMIT");
    for (const value of ["-1", "1.5"]) {
      expect(() =>
        loadExecutionConfig({ AUTOMATIC_ANALYSIS_COMPLETED_LIMIT: value }),
      ).toThrow("CONFIG_INTEGER_INVALID:AUTOMATIC_ANALYSIS_COMPLETED_LIMIT");
    }
  });

  it("bounds the automatic broker-M1 start window", () => {
    expect(
      loadExecutionConfig({
        AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS: "1",
      }).automaticAnalysisStartWindowSeconds,
    ).toBe(1);
    expect(
      loadExecutionConfig({
        AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS: "30",
      }).automaticAnalysisStartWindowSeconds,
    ).toBe(30);
    for (const value of ["0", "31"]) {
      expect(() =>
        loadExecutionConfig({
          AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS: value,
        }),
      ).toThrow(
        "CONFIG_INTEGER_OUT_OF_RANGE:AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS",
      );
    }
    expect(() =>
      loadExecutionConfig({
        AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS: "1.5",
      }),
    ).toThrow("CONFIG_INTEGER_INVALID:AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS");
  });

  it("requires explicit bounded configuration before demo submission", () => {
    const enabled = {
      TRADING_MODE: "demo",
      DEMO_TRADING_ENABLED: "true",
      DEMO_TRADING_ACKNOWLEDGEMENT:
        "I_UNDERSTAND_DEMO_ORDERS_USE_A_BROKER_DEMO_ACCOUNT",
    };
    expect(() => loadExecutionConfig(enabled)).toThrow(
      "CONFIG_DEMO_ORDER_LIMIT_REQUIRED",
    );
    expect(() =>
      loadExecutionConfig({ ...enabled, MAX_ORDERS_PER_DAY: "1" }),
    ).toThrow("CONFIG_DEMO_NOTIONAL_LIMIT_REQUIRED");
    expect(() =>
      loadExecutionConfig({
        ...enabled,
        MAX_ORDERS_PER_DAY: "1",
        MAX_POSITION_NOTIONAL: "0",
      }),
    ).toThrow("CONFIG_DECIMAL_INVALID:MAX_POSITION_NOTIONAL");
    expect(
      loadExecutionConfig({
        ...enabled,
        MAX_ORDERS_PER_DAY: "1",
        MAX_POSITION_NOTIONAL: "5500",
      }),
    ).toMatchObject({
      demoTradingEnabled: true,
      maxOrdersPerDay: 1,
      maxPositionNotional: "5500",
      automaticAnalysisEnabled: false,
    });
    expect(() =>
      loadExecutionConfig({
        ...enabled,
        DEMO_TRADING_ACKNOWLEDGEMENT: "incorrect",
        MAX_ORDERS_PER_DAY: "1",
        MAX_POSITION_NOTIONAL: "5500",
      }),
    ).toThrow("CONFIG_DEMO_ACKNOWLEDGEMENT_REQUIRED");
  });

  it("keeps scheduler analysis off unless independently enabled", () => {
    expect(evaluateAutomaticAnalysisEligibility(safeInput(), false)).toEqual({
      allowed: false,
      reasonCodes: ["AUTOMATIC_ANALYSIS_DISABLED"],
    });
    expect(evaluateAutomaticAnalysisEligibility(safeInput(), true)).toEqual({
      allowed: true,
      reasonCodes: [],
    });
  });

  it("keeps the production live boundary structurally non-submitting", async () => {
    const gateway = new DisabledLiveGateway();
    expect(gateway.canSubmitToBroker).toBe(false);
    await expect(gateway.placeOco()).rejects.toThrow("LIVE_GATEWAY_NOT_WIRED");
    await expect(gateway.reconcile()).resolves.toMatchObject({
      certain: false,
      reasonCodes: ["LIVE_GATEWAY_NOT_WIRED"],
    });
  });

  it("requires every independent live gate", () => {
    expect(evaluatePlacementEligibility(safeInput())).toEqual({
      allowed: true,
      reasonCodes: [],
    });
    const denied = evaluatePlacementEligibility({
      ...safeInput(),
      liveTradingEnabled: false,
      dashboardAcknowledged: false,
      marketDataFresh: false,
      deterministicRiskApproved: false,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.reasonCodes).toEqual(
      expect.arrayContaining([
        "LIVE_TRADING_DISABLED",
        "DASHBOARD_ACKNOWLEDGEMENT_REQUIRED",
        "MARKET_DATA_STALE",
        "RISK_NOT_APPROVED",
      ]),
    );
  });

  it("validates a restrictive, instance-bound manual live file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "scalper-live-file-"));
    const enablement = path.join(directory, "live-enabled");
    const now = new Date("2026-01-01T00:00:00Z");
    await writeFile(
      enablement,
      JSON.stringify({
        instance_id: "instance",
        account_key: "account-key",
        nonce: "random_nonce_1234567890",
        created_at: "2025-12-31T23:55:00Z",
        expires_at: "2026-01-01T00:05:00Z",
        statement: LIVE_FILE_STATEMENT,
      }),
    );
    await chmod(enablement, 0o600);
    const result = await readFilesystemControls({
      emergencyStopFile: path.join(directory, "emergency-stop"),
      liveEnablementFile: enablement,
      instanceId: "instance",
      accountKey: "account-key",
      now,
    });
    expect(result).toEqual({
      certain: true,
      emergencyStop: false,
      liveEnablementValid: true,
      reasonCodes: [],
    });
  });
});
