import { createHash } from "node:crypto";

import { Decimal } from "decimal.js";

import type { TradingMode } from "../../../packages/contracts/src/index.js";
import { DEMO_ACKNOWLEDGEMENT } from "./demo-authorization.js";

export interface ExecutionConfig {
  readonly appEnv: string;
  readonly instanceId: string;
  readonly host: string;
  readonly port: number;
  readonly tradingMode: TradingMode;
  readonly liveTradingEnabled: boolean;
  readonly liveAcknowledgement: string;
  readonly demoTradingEnabled: boolean;
  readonly demoAcknowledgement: string;
  readonly emergencyStop: boolean;
  readonly emergencyStopFile: string;
  readonly liveEnablementFile: string;
  readonly pauseNewAnalyses: boolean;
  readonly automaticAnalysisEnabled: boolean;
  readonly automaticAnalysisCompletedLimit: number;
  readonly automaticAnalysisCompletedBaseline: number;
  readonly automaticAnalysisStartWindowSeconds: number;
  readonly symbol: string;
  readonly accountKey: string;
  readonly baseRiskPercent: string;
  readonly maxRiskPercent: string;
  readonly maxDailyLossPercent: string;
  readonly maxQuoteAgeMs: number;
  readonly maxOrderBookAgeMs: number;
  readonly maxMetadataAgeMs: number;
  readonly maxOrdersPerDay: number;
  readonly maxPositionNotional: string | null;
}

function booleanValue(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`CONFIG_BOOLEAN_INVALID:${name}`);
}

function integerValue(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = Number(value === undefined || value === "" ? fallback : value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`CONFIG_INTEGER_INVALID:${name}`);
  return parsed;
}

function decimalPercent(
  value: string | undefined,
  fallback: string,
  name: string,
  maximum: number,
): string {
  const text = value ?? fallback;
  if (
    !/^\d+(?:\.\d+)?$/.test(text) ||
    Number(text) <= 0 ||
    Number(text) > maximum
  ) {
    throw new Error(`CONFIG_PERCENT_INVALID:${name}`);
  }
  return text;
}

function optionalPositiveDecimal(
  value: string | undefined,
  name: string,
): string | null {
  if (value === undefined || value === "") return null;
  try {
    if (!/^\d+(?:\.\d+)?$/.test(value))
      throw new Error(`CONFIG_DECIMAL_INVALID:${name}`);
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.lte(0))
      throw new Error(`CONFIG_DECIMAL_INVALID:${name}`);
    return value;
  } catch {
    throw new Error(`CONFIG_DECIMAL_INVALID:${name}`);
  }
}

export function loadExecutionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ExecutionConfig {
  const mode = environment.TRADING_MODE ?? "paper";
  if (
    !["replay", "backtest", "paper", "demo", "shadow", "live"].includes(mode)
  ) {
    throw new Error("CONFIG_TRADING_MODE_INVALID");
  }
  const symbol = environment.TRADING_SYMBOL ?? "XAUUSD";
  if (!/^[A-Z0-9._-]{1,32}$/.test(symbol))
    throw new Error("CONFIG_SYMBOL_INVALID");
  const demoTradingEnabled = booleanValue(
    environment.DEMO_TRADING_ENABLED,
    false,
    "DEMO_TRADING_ENABLED",
  );
  const demoAcknowledgement = environment.DEMO_TRADING_ACKNOWLEDGEMENT ?? "";
  const maxOrdersPerDay = integerValue(
    environment.MAX_ORDERS_PER_DAY,
    0,
    "MAX_ORDERS_PER_DAY",
  );
  const maxPositionNotional = optionalPositiveDecimal(
    environment.MAX_POSITION_NOTIONAL,
    "MAX_POSITION_NOTIONAL",
  );
  if (mode === "demo" && demoTradingEnabled) {
    if (demoAcknowledgement !== DEMO_ACKNOWLEDGEMENT)
      throw new Error("CONFIG_DEMO_ACKNOWLEDGEMENT_REQUIRED");
    if (maxOrdersPerDay < 1)
      throw new Error("CONFIG_DEMO_ORDER_LIMIT_REQUIRED");
    if (maxPositionNotional === null)
      throw new Error("CONFIG_DEMO_NOTIONAL_LIMIT_REQUIRED");
  }
  const automaticAnalysisCompletedLimit = integerValue(
    environment.AUTOMATIC_ANALYSIS_COMPLETED_LIMIT,
    0,
    "AUTOMATIC_ANALYSIS_COMPLETED_LIMIT",
  );
  const automaticAnalysisCompletedBaseline = integerValue(
    environment.AUTOMATIC_ANALYSIS_COMPLETED_BASELINE,
    0,
    "AUTOMATIC_ANALYSIS_COMPLETED_BASELINE",
  );
  if (automaticAnalysisCompletedLimit > 10_000)
    throw new Error(
      "CONFIG_INTEGER_OUT_OF_RANGE:AUTOMATIC_ANALYSIS_COMPLETED_LIMIT",
    );
  if (
    automaticAnalysisCompletedBaseline > automaticAnalysisCompletedLimit ||
    automaticAnalysisCompletedBaseline > 10_000
  ) {
    throw new Error(
      "CONFIG_INTEGER_OUT_OF_RANGE:AUTOMATIC_ANALYSIS_COMPLETED_BASELINE",
    );
  }
  return {
    appEnv: environment.APP_ENV ?? "development",
    instanceId: environment.INSTANCE_ID ?? "local-1",
    host: environment.HOST ?? "127.0.0.1",
    port: integerValue(environment.API_PORT, 8080, "API_PORT"),
    tradingMode: mode as TradingMode,
    liveTradingEnabled: booleanValue(
      environment.LIVE_TRADING_ENABLED,
      false,
      "LIVE_TRADING_ENABLED",
    ),
    liveAcknowledgement: environment.LIVE_TRADING_ACKNOWLEDGEMENT ?? "",
    demoTradingEnabled,
    demoAcknowledgement,
    emergencyStop: booleanValue(
      environment.EMERGENCY_STOP,
      true,
      "EMERGENCY_STOP",
    ),
    emergencyStopFile:
      environment.EMERGENCY_STOP_FILE ?? ".runtime/emergency-stop",
    liveEnablementFile:
      environment.LIVE_ENABLEMENT_FILE ?? ".runtime/live-enabled",
    pauseNewAnalyses: booleanValue(
      environment.PAUSE_NEW_ANALYSES,
      false,
      "PAUSE_NEW_ANALYSES",
    ),
    automaticAnalysisEnabled: booleanValue(
      environment.AUTOMATIC_ANALYSIS_ENABLED,
      false,
      "AUTOMATIC_ANALYSIS_ENABLED",
    ),
    automaticAnalysisCompletedLimit,
    automaticAnalysisCompletedBaseline,
    automaticAnalysisStartWindowSeconds: (() => {
      const value = integerValue(
        environment.AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS,
        5,
        "AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS",
      );
      if (value < 1 || value > 30) {
        throw new Error(
          "CONFIG_INTEGER_OUT_OF_RANGE:AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS",
        );
      }
      return value;
    })(),
    symbol,
    accountKey: environment.ACCOUNT_KEY ?? "unconfigured",
    baseRiskPercent: decimalPercent(
      environment.BASE_RISK_PERCENT,
      "1",
      "BASE_RISK_PERCENT",
      5,
    ),
    maxRiskPercent: decimalPercent(
      environment.MAX_RISK_PERCENT,
      "5",
      "MAX_RISK_PERCENT",
      5,
    ),
    maxDailyLossPercent: decimalPercent(
      environment.MAX_DAILY_LOSS_PERCENT,
      "10",
      "MAX_DAILY_LOSS_PERCENT",
      10,
    ),
    maxQuoteAgeMs: integerValue(
      environment.MAX_QUOTE_AGE_MS,
      3_000,
      "MAX_QUOTE_AGE_MS",
    ),
    maxOrderBookAgeMs: integerValue(
      environment.ORDER_BOOK_MAX_AGE_MS,
      3_000,
      "ORDER_BOOK_MAX_AGE_MS",
    ),
    maxMetadataAgeMs: integerValue(
      environment.SYMBOL_METADATA_MAX_AGE_MS,
      86_400_000,
      "SYMBOL_METADATA_MAX_AGE_MS",
    ),
    maxOrdersPerDay,
    maxPositionNotional,
  };
}

export function safetyConfigHash(config: ExecutionConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        appEnv: config.appEnv,
        instanceId: config.instanceId,
        tradingMode: config.tradingMode,
        symbol: config.symbol,
        accountKey: config.accountKey,
        baseRiskPercent: config.baseRiskPercent,
        maxRiskPercent: config.maxRiskPercent,
        maxDailyLossPercent: config.maxDailyLossPercent,
        maxQuoteAgeMs: config.maxQuoteAgeMs,
        maxOrderBookAgeMs: config.maxOrderBookAgeMs,
        maxMetadataAgeMs: config.maxMetadataAgeMs,
        maxOrdersPerDay: config.maxOrdersPerDay,
        maxPositionNotional: config.maxPositionNotional,
        automaticAnalysisEnabled: config.automaticAnalysisEnabled,
        automaticAnalysisCompletedLimit: config.automaticAnalysisCompletedLimit,
        automaticAnalysisCompletedBaseline:
          config.automaticAnalysisCompletedBaseline,
        automaticAnalysisStartWindowSeconds:
          config.automaticAnalysisStartWindowSeconds,
      }),
    )
    .digest("hex");
}
