import { createHash } from "node:crypto";

import type { TradingMode } from "../../../packages/contracts/src/index.js";

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
  readonly symbol: string;
  readonly accountKey: string;
  readonly baseRiskPercent: string;
  readonly maxRiskPercent: string;
  readonly maxDailyLossPercent: string;
  readonly maxQuoteAgeMs: number;
  readonly maxOrderBookAgeMs: number;
  readonly maxMetadataAgeMs: number;
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
    demoTradingEnabled: booleanValue(
      environment.DEMO_TRADING_ENABLED,
      false,
      "DEMO_TRADING_ENABLED",
    ),
    demoAcknowledgement: environment.DEMO_TRADING_ACKNOWLEDGEMENT ?? "",
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
      }),
    )
    .digest("hex");
}
