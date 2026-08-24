import { lstat, readFile } from "node:fs/promises";

import type { TradingMode } from "../../../packages/contracts/src/index.js";

export const LIVE_ACKNOWLEDGEMENT = "I_UNDERSTAND_LIVE_ORDERS_CAN_LOSE_MONEY";
export const LIVE_FILE_STATEMENT = "LIVE ORDERS AUTHORIZED FOR THIS INSTANCE";

export interface FilesystemControlState {
  readonly certain: boolean;
  readonly emergencyStop: boolean;
  readonly liveEnablementValid: boolean;
  readonly reasonCodes: readonly string[];
}

export interface LiveEnablementOptions {
  readonly emergencyStopFile: string;
  readonly liveEnablementFile: string;
  readonly instanceId: string;
  readonly accountKey: string;
  readonly now?: Date;
  readonly maximumValidityMs?: number;
  readonly allowedOwnerUids?: readonly number[];
}

interface LiveFile {
  instance_id?: unknown;
  account_key?: unknown;
  nonce?: unknown;
  created_at?: unknown;
  expires_at?: unknown;
  statement?: unknown;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readFilesystemControls(
  options: LiveEnablementOptions,
): Promise<FilesystemControlState> {
  const reasons: string[] = [];
  try {
    const emergencyStop = await exists(options.emergencyStopFile);
    let liveEnablementValid = false;
    try {
      const stat = await lstat(options.liveEnablementFile);
      if (!stat.isFile() || stat.isSymbolicLink())
        reasons.push("LIVE_FILE_TYPE_INVALID");
      if ((stat.mode & 0o022) !== 0)
        reasons.push("LIVE_FILE_PERMISSIONS_UNSAFE");
      const allowedOwners = options.allowedOwnerUids ?? [
        0,
        process.getuid?.() ?? -1,
      ];
      if (!allowedOwners.includes(stat.uid))
        reasons.push("LIVE_FILE_OWNER_INVALID");
      const parsed = JSON.parse(
        await readFile(options.liveEnablementFile, "utf8"),
      ) as LiveFile;
      const createdAt =
        typeof parsed.created_at === "string"
          ? Date.parse(parsed.created_at)
          : Number.NaN;
      const expiresAt =
        typeof parsed.expires_at === "string"
          ? Date.parse(parsed.expires_at)
          : Number.NaN;
      const now = (options.now ?? new Date()).getTime();
      const maxValidity = options.maximumValidityMs ?? 24 * 60 * 60 * 1_000;
      if (parsed.instance_id !== options.instanceId)
        reasons.push("LIVE_FILE_INSTANCE_MISMATCH");
      if (parsed.account_key !== options.accountKey)
        reasons.push("LIVE_FILE_ACCOUNT_MISMATCH");
      if (
        typeof parsed.nonce !== "string" ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(parsed.nonce)
      ) {
        reasons.push("LIVE_FILE_NONCE_INVALID");
      }
      if (parsed.statement !== LIVE_FILE_STATEMENT)
        reasons.push("LIVE_FILE_STATEMENT_INVALID");
      if (
        !Number.isFinite(createdAt) ||
        !Number.isFinite(expiresAt) ||
        createdAt > now ||
        expiresAt <= now
      ) {
        reasons.push("LIVE_FILE_TIME_INVALID");
      } else if (expiresAt - createdAt > maxValidity) {
        reasons.push("LIVE_FILE_VALIDITY_EXCESSIVE");
      }
      liveEnablementValid = reasons.length === 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        reasons.push("LIVE_FILE_MISSING");
      else if (error instanceof SyntaxError)
        reasons.push("LIVE_FILE_JSON_INVALID");
      else throw error;
    }
    return {
      certain: true,
      emergencyStop,
      liveEnablementValid,
      reasonCodes: [...new Set(reasons)].sort(),
    };
  } catch {
    return {
      certain: false,
      emergencyStop: true,
      liveEnablementValid: false,
      reasonCodes: ["FILESYSTEM_CONTROLS_UNAVAILABLE"],
    };
  }
}

export interface SafetyGateInput {
  readonly tradingMode: TradingMode;
  readonly liveTradingEnabled: boolean;
  readonly liveAcknowledgement: string;
  readonly environmentEmergencyStop: boolean;
  readonly filesystemControlsCertain: boolean;
  readonly filesystemEmergencyStop: boolean;
  readonly liveEnablementFileValid: boolean;
  readonly runtimeControlsCertain: boolean;
  readonly databaseEmergencyStop: boolean;
  readonly dashboardAcknowledged: boolean;
  readonly pauseNewAnalyses: boolean;
  readonly startupChecksPassed: boolean;
  readonly serviceHealthy: boolean;
  readonly accountAuthenticated: boolean;
  readonly accountReconciled: boolean;
  readonly reconciliationCertain: boolean;
  readonly relevantPositionCount: number;
  readonly relevantPendingOrderCount: number;
  readonly partialFillPresent: boolean;
  readonly cancellationPending: boolean;
  readonly previousAnalysisExpired: boolean;
  readonly candlesSynchronized: boolean;
  readonly orderBookFresh: boolean;
  readonly marketDataFresh: boolean;
  readonly dailyLossLockout: boolean;
  readonly operationalRiskLockout: boolean;
  readonly aiCircuitOpen: boolean;
  readonly symbolMetadataValid: boolean;
  readonly aiResponseValid: boolean;
  readonly deterministicRiskApproved: boolean;
  readonly spreadSafe: boolean;
  readonly duplicateFree: boolean;
  readonly criticalAuditAvailable: boolean;
}

export interface SafetyGateResult {
  readonly allowed: boolean;
  readonly reasonCodes: readonly string[];
}

function commonReasons(input: SafetyGateInput): string[] {
  const checks: readonly [boolean, string][] = [
    [input.serviceHealthy, "SERVICE_UNHEALTHY"],
    [!input.environmentEmergencyStop, "EMERGENCY_STOP_ENV"],
    [input.filesystemControlsCertain, "FILESYSTEM_CONTROLS_UNCERTAIN"],
    [!input.filesystemEmergencyStop, "EMERGENCY_STOP_FILE"],
    [input.runtimeControlsCertain, "RUNTIME_CONTROLS_UNCERTAIN"],
    [!input.databaseEmergencyStop, "EMERGENCY_STOP_DATABASE"],
    [!input.pauseNewAnalyses, "ANALYSES_PAUSED"],
    [input.accountAuthenticated, "ACCOUNT_NOT_AUTHENTICATED"],
    [input.accountReconciled, "ACCOUNT_NOT_RECONCILED"],
    [input.reconciliationCertain, "RECONCILIATION_UNCERTAIN"],
    [input.relevantPositionCount === 0, "RELEVANT_POSITION_EXISTS"],
    [input.relevantPendingOrderCount === 0, "RELEVANT_PENDING_ORDER_EXISTS"],
    [!input.partialFillPresent, "PARTIAL_FILL_BLOCKING"],
    [!input.cancellationPending, "CANCELLATION_PENDING"],
    [input.previousAnalysisExpired, "PREVIOUS_ANALYSIS_ACTIVE"],
    [input.candlesSynchronized, "CANDLES_UNSYNCHRONIZED"],
    [input.orderBookFresh, "ORDER_BOOK_STALE"],
    [input.marketDataFresh, "MARKET_DATA_STALE"],
    [!input.dailyLossLockout, "DAILY_LOSS_LOCKOUT"],
    [!input.operationalRiskLockout, "OPERATIONAL_RISK_LOCKOUT"],
    [!input.aiCircuitOpen, "AI_CIRCUIT_OPEN"],
    [input.symbolMetadataValid, "SYMBOL_METADATA_INVALID"],
  ];
  return checks.filter(([accepted]) => !accepted).map(([, reason]) => reason);
}

export function evaluateAnalysisEligibility(
  input: SafetyGateInput,
): SafetyGateResult {
  const reasons = commonReasons(input);
  return { allowed: reasons.length === 0, reasonCodes: reasons.sort() };
}

export function evaluatePlacementEligibility(
  input: SafetyGateInput,
): SafetyGateResult {
  const reasons = commonReasons(input);
  const checks: readonly [boolean, string][] = [
    [input.aiResponseValid, "AI_RESPONSE_INVALID"],
    [input.deterministicRiskApproved, "RISK_NOT_APPROVED"],
    [input.spreadSafe, "SPREAD_UNSAFE"],
    [input.duplicateFree, "DUPLICATE_ORDER_RISK"],
    [input.criticalAuditAvailable, "CRITICAL_AUDIT_UNAVAILABLE"],
  ];
  reasons.push(
    ...checks.filter(([accepted]) => !accepted).map(([, reason]) => reason),
  );
  if (input.tradingMode === "live") {
    const liveChecks: readonly [boolean, string][] = [
      [input.liveTradingEnabled, "LIVE_TRADING_DISABLED"],
      [
        input.liveAcknowledgement === LIVE_ACKNOWLEDGEMENT,
        "LIVE_ACKNOWLEDGEMENT_INVALID",
      ],
      [input.liveEnablementFileValid, "LIVE_ENABLEMENT_FILE_INVALID"],
      [input.startupChecksPassed, "STARTUP_SAFETY_CHECKS_FAILED"],
      [input.dashboardAcknowledged, "DASHBOARD_ACKNOWLEDGEMENT_REQUIRED"],
    ];
    reasons.push(
      ...liveChecks
        .filter(([accepted]) => !accepted)
        .map(([, reason]) => reason),
    );
  }
  return {
    allowed: reasons.length === 0,
    reasonCodes: [...new Set(reasons)].sort(),
  };
}
