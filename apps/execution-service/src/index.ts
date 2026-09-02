import "dotenv/config";

import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Decimal } from "decimal.js";

import { AnalyticsHttpClient } from "../../../packages/analytics-client/src/client.js";
import {
  AiOrchestratorHttpClient,
  aiOrchestratorCircuitResetMs,
  aiOrchestratorRequestTimeoutMs,
} from "../../../packages/ai-client/src/http-client.js";
import type {
  AccountAdapter,
  AccountState,
  ExecutionGateway,
  MarketSnapshot,
  Timeframe,
} from "../../../packages/contracts/src/index.js";
import { CTraderClient } from "../../../packages/ctrader-client/src/client.js";
import { CTraderTokenManager } from "../../../packages/ctrader-client/src/token-manager.js";
import { SecureTokenFileStore } from "../../../packages/ctrader-client/src/token-store.js";
import {
  createPool,
  ensureRuntimeIdentity,
  RuntimeControlStore,
} from "../../../packages/database/src/index.js";
import {
  BetterStackTransport,
  StructuredLogger,
} from "../../../packages/logging/src/index.js";
import { MarketDataHttpClient } from "../../../packages/market-data-client/src/client.js";
import { MetricsCollector } from "../../../packages/observability/src/metrics.js";
import { decimal } from "../../../packages/risk-engine/src/decimal.js";
import {
  evaluateAnalysisEligibility,
  evaluateAutomaticAnalysisEligibility,
} from "./safety-gates.js";
import { AnalysisCoordinator, type CycleResult } from "./coordinator.js";
import {
  alignedSchedulerDelayMs,
  evaluateAutomaticAnalysisWindow,
  PostgresAutomaticAnalysisSchedule,
} from "./automatic-analysis-schedule.js";
import { PostgresAutomaticAnalysisWatchdog } from "./automatic-analysis-watchdog.js";
import {
  enforceAutomaticAnalysisCampaign,
  PostgresAutomaticAnalysisCampaign,
} from "./automatic-analysis-campaign.js";
import {
  enforceAutomaticTradeCampaign,
  PostgresAutomaticTradeCampaign,
} from "./automatic-trade-campaign.js";
import { loadExecutionConfig, safetyConfigHash } from "./config.js";
import { compactTailCounts } from "./analytics-config.js";
import { CTraderMarginEstimator } from "./ctrader-margin.js";
import { CTraderDemoGateway, DEMO_ACKNOWLEDGEMENT } from "./demo-gateway.js";
import { DurableDemoExecutionRecorder } from "./demo-execution.js";
import { recoverDemoExecutions } from "./demo-execution-recovery.js";
import { DemoExecutionRecoveryRunner } from "./demo-execution-recovery-runner.js";
import { PostgresDemoExecutionStore } from "./demo-execution-store.js";
import { DailyRiskStore, tradingDayStart } from "./daily-risk-store.js";
import { DisabledLiveGateway } from "./live-compatible-gateway.js";
import {
  PostgresManagedSetupOverview,
  UNAVAILABLE_MANAGED_SETUP,
} from "./managed-setup-overview.js";
import {
  OcoRiskEvaluator,
  type MarginEstimator,
} from "./oco-risk-evaluator.js";
import { OrderMaintenance } from "./order-maintenance.js";
import {
  PostgresOpenPositionMonitor,
  unavailableOpenPositionMonitor,
} from "./open-position-monitor.js";
import { PostgresObservabilityOutbox } from "./observability-outbox.js";
import { PaperAccountAdapter, LinearMarginEstimator } from "./paper-account.js";
import { PaperGateway } from "./paper-gateway.js";
import { PostgresPerformanceContext } from "./performance-context.js";
import { PostgresDecisionTrail } from "./postgres-trail.js";
import { stableFailureReason } from "./failure-reasons.js";
import { createExecutionServer, type ExecutionStatus } from "./server.js";
import { ShadowGateway } from "./shadow-gateway.js";
import {
  PostgresSpreadObservationStore,
  SpreadObservationSampler,
} from "./spread-observations.js";
import {
  readFilesystemControls,
  type SafetyGateInput,
} from "./safety-gates.js";

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const configured = environment[name];
  const value = Number(
    configured === undefined || configured === "" ? fallback : configured,
  );
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`CONFIG_INTEGER_INVALID:${name}`);
  return value;
}

function optionalDecimal(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function boundedSecondsMs(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const seconds = integer(environment, name, fallback);
  if (seconds < minimum || seconds > maximum) {
    throw new Error(`CONFIG_INTEGER_OUT_OF_RANGE:${name}`);
  }
  return seconds * 1_000;
}

function counts(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<Timeframe, number>> {
  return {
    M1: integer(environment, "BARS_1M", 600),
    M5: integer(environment, "BARS_5M", 500),
    M15: integer(environment, "BARS_15M", 300),
  };
}

async function buildCTraderClient(
  environment: NodeJS.ProcessEnv,
  connectionMode: "demo" | "live",
  allowOrderCommands: boolean,
  logger: StructuredLogger,
): Promise<CTraderClient> {
  const tokenPath =
    environment.CTRADER_TOKEN_STATE_FILE ?? ".runtime/ctrader-token-state.json";
  const tokenStore = new SecureTokenFileStore(tokenPath);
  const stored = await tokenStore.read();
  const expiryText = environment.CTRADER_ACCESS_TOKEN_EXPIRES_AT;
  const manager = new CTraderTokenManager({
    clientId: environment.CTRADER_CLIENT_ID ?? "",
    clientSecret: environment.CTRADER_CLIENT_SECRET ?? "",
    tokenUrl:
      environment.CTRADER_TOKEN_URL ?? "https://openapi.ctrader.com/apps/token",
    accessToken: stored?.accessToken ?? environment.CTRADER_ACCESS_TOKEN ?? "",
    refreshToken:
      stored?.refreshToken ?? environment.CTRADER_REFRESH_TOKEN ?? "",
    ...(stored !== null
      ? { accessTokenExpiresAt: stored.expiresAt }
      : expiryText === undefined || expiryText === ""
        ? {}
        : { accessTokenExpiresAt: new Date(expiryText) }),
    onRefresh: async (tokens) => {
      await tokenStore.write(tokens);
      logger.log("info", {
        event_name: "ctrader_token_refreshed",
        outcome: "success",
      });
    },
    refreshCoordinator: (refreshToken, refresh) =>
      tokenStore.coordinateRefresh(refreshToken, refresh),
  });
  const accountId = environment.ACCOUNT_ID;
  const client = new CTraderClient({
    clientId: environment.CTRADER_CLIENT_ID ?? "",
    clientSecret: environment.CTRADER_CLIENT_SECRET ?? "",
    ...(accountId === undefined || accountId === "" ? {} : { accountId }),
    connectionMode,
    allowOrderCommands,
    tokenManager: manager,
    transportOptions: {
      host:
        environment.CTRADER_API_HOST ??
        (connectionMode === "live"
          ? "live.ctraderapi.com"
          : "demo.ctraderapi.com"),
      port: integer(environment, "CTRADER_API_PORT", 5036),
      requestTimeoutMs: integer(
        environment,
        "CTRADER_REQUEST_TIMEOUT_MS",
        10_000,
      ),
      reconnectMinMs: integer(environment, "CTRADER_RECONNECT_MIN_MS", 1_000),
      reconnectMaxMs: integer(environment, "CTRADER_RECONNECT_MAX_MS", 30_000),
    },
    orderBookTimeoutMs: integer(
      environment,
      "ORDER_BOOK_SNAPSHOT_TIMEOUT_MS",
      3_000,
    ),
  });
  await client.connect();
  return client;
}

async function main(): Promise<void> {
  const serviceStartedAt = new Date();
  const environment = process.env;
  const config = loadExecutionConfig(environment);
  if (!["paper", "demo", "shadow", "live"].includes(config.tradingMode)) {
    throw new Error("EXECUTION_SERVICE_MODE_UNSUPPORTED");
  }
  const betterStack = new BetterStackTransport({
    enabled: environment.BETTERSTACK_ENABLED === "true",
    ingestingHost: environment.BETTERSTACK_INGESTING_HOST ?? "",
    sourceToken: environment.BETTERSTACK_SOURCE_TOKEN ?? "",
  });
  const logger = new StructuredLogger({
    service: "execution-service",
    instanceId: config.instanceId,
    environment: config.appEnv,
    tradingMode: config.tradingMode,
    level: environment.LOG_LEVEL ?? "info",
    logFile: path.join(
      environment.LOCAL_LOG_DIR ?? "logs",
      "execution-service.log",
    ),
    betterStack,
  });
  const pool = createPool({
    connectionString: environment.DATABASE_URL ?? "",
    poolMin: integer(environment, "DATABASE_POOL_MIN", 1),
    poolMax: integer(environment, "DATABASE_POOL_MAX", 10),
    sslMode:
      environment.DATABASE_SSL_MODE === "disable" ? "disable" : "require",
  });
  await pool.query("SELECT 1");
  const observabilityOutbox = betterStack.configured
    ? new PostgresObservabilityOutbox({
        pool,
        transport: betterStack,
        batchSize: integer(environment, "BETTERSTACK_OUTBOX_BATCH_SIZE", 50),
        leaseMs:
          integer(environment, "BETTERSTACK_OUTBOX_LEASE_SECONDS", 30) * 1_000,
        retryBaseMs:
          integer(environment, "BETTERSTACK_OUTBOX_RETRY_BASE_SECONDS", 5) *
          1_000,
        retryMaxMs:
          integer(environment, "BETTERSTACK_OUTBOX_RETRY_MAX_SECONDS", 300) *
          1_000,
      })
    : null;

  const candleCounts = counts(environment);
  const persistedCandleTails = compactTailCounts(environment, candleCounts);
  const marketClient = new MarketDataHttpClient({
    baseUrl:
      environment.MARKET_DATA_BASE_URL ??
      `http://127.0.0.1:${environment.MARKET_DATA_PORT ?? "8081"}`,
    timeoutMs: 20_000,
    maxRetries: integer(environment, "MARKET_DATA_MAX_RETRIES", 1),
  });
  let latestSnapshot: MarketSnapshot | null = null;
  const market = {
    snapshot: async (
      symbol: string,
      requestedCounts: Readonly<Record<Timeframe, number>>,
      depth: number,
    ): Promise<MarketSnapshot> => {
      latestSnapshot = await marketClient.snapshot(
        symbol,
        requestedCounts,
        depth,
      );
      return latestSnapshot;
    },
  };
  latestSnapshot = await market.snapshot(
    config.symbol,
    candleCounts,
    integer(environment, "ORDER_BOOK_DEPTH", 20),
  );

  const connectionMode: "demo" | "live" =
    environment.CTRADER_CONNECTION_MODE === "live" ? "live" : "demo";
  if (config.tradingMode === "demo" && connectionMode !== "demo") {
    throw new Error("DEMO_MODE_REQUIRES_DEMO_CONNECTION");
  }
  if (
    (config.tradingMode === "shadow" || config.tradingMode === "live") &&
    connectionMode !== "live"
  ) {
    throw new Error("SHADOW_OR_LIVE_MODE_REQUIRES_LIVE_DATA_CONNECTION");
  }
  const configHash = safetyConfigHash(config);
  const strategyVersion = environment.STRATEGY_VERSION ?? "0.1.0";
  const identity = await ensureRuntimeIdentity(pool, {
    accountKey: config.accountKey,
    provider: config.tradingMode === "paper" ? "paper" : "ctrader",
    environment: config.tradingMode === "paper" ? "paper" : connectionMode,
    accountType: config.tradingMode === "paper" ? "paper" : connectionMode,
    currency: environment.ACCOUNT_CURRENCY ?? "USD",
    metadata: latestSnapshot.metadata,
    strategyVersion,
    codeHash: createHash("sha256")
      .update(environment.CODE_VERSION ?? "0.1.0")
      .digest("hex"),
    configHash,
    promptVersion: "system-v13",
    schemaVersion: "2.1",
    featureVersion: "1.1",
  });

  let account: AccountAdapter;
  let gateway: ExecutionGateway;
  let margin: MarginEstimator;
  let brokerClient: CTraderClient | null = null;
  let paperGateway: PaperGateway | null = null;
  let paperAccount: PaperAccountAdapter | null = null;
  let demoGateway: CTraderDemoGateway | null = null;
  if (config.tradingMode === "paper") {
    paperAccount = new PaperAccountAdapter({
      equity: environment.PAPER_ACCOUNT_EQUITY ?? "10000",
      balance: environment.PAPER_ACCOUNT_BALANCE ?? "10000",
      availableMargin: environment.PAPER_AVAILABLE_MARGIN ?? "10000",
    });
    paperGateway = new PaperGateway({
      tickSize: latestSnapshot.metadata.tickSize,
      tickValue: latestSnapshot.metadata.tickValue,
      slippagePoints: environment.PAPER_SLIPPAGE_POINTS ?? "0",
      maxSlippagePoints: environment.MAX_SLIPPAGE_POINTS ?? "5",
      maxSlippageBps: environment.MAX_SLIPPAGE_BPS ?? "2",
    });
    account = paperAccount;
    gateway = paperGateway;
    margin = new LinearMarginEstimator(
      environment.PAPER_MARGIN_PER_NATIVE_VOLUME ?? "1",
    );
    await account.authenticate();
  } else {
    brokerClient = await buildCTraderClient(
      environment,
      connectionMode,
      config.tradingMode === "demo" && config.demoTradingEnabled,
      logger,
    );
    const localMetadata = await brokerClient.discoverSymbol(config.symbol);
    if (
      localMetadata.symbolId !== latestSnapshot.metadata.symbolId ||
      localMetadata.tickSize !== latestSnapshot.metadata.tickSize ||
      localMetadata.pipSize !== latestSnapshot.metadata.pipSize ||
      localMetadata.tickValue !== latestSnapshot.metadata.tickValue ||
      localMetadata.volumeScale !== latestSnapshot.metadata.volumeScale ||
      localMetadata.volumeStep !== latestSnapshot.metadata.volumeStep ||
      localMetadata.quoteAsset !== latestSnapshot.metadata.quoteAsset ||
      localMetadata.accountAsset !== latestSnapshot.metadata.accountAsset ||
      localMetadata.quoteToAccountConversionRate !==
        latestSnapshot.metadata.quoteToAccountConversionRate ||
      JSON.stringify(localMetadata.commission) !==
        JSON.stringify(latestSnapshot.metadata.commission)
    ) {
      throw new Error("MARKET_AND_EXECUTION_SYMBOL_METADATA_MISMATCH");
    }
    account = brokerClient;
    margin = new CTraderMarginEstimator(brokerClient);
    if (config.tradingMode === "demo") {
      demoGateway = new CTraderDemoGateway({
        client: brokerClient,
        symbolId: localMetadata.symbolId,
        symbolName: localMetadata.symbolName,
        placementEnabled: config.demoTradingEnabled,
        acknowledgement: config.demoAcknowledgement,
        blockManualOrders:
          environment.BLOCK_ON_MANUAL_SYMBOL_ORDERS !== "false",
        blockManualPositions:
          environment.BLOCK_ON_MANUAL_SYMBOL_POSITIONS !== "false",
        tickSize: localMetadata.tickSize,
        maxSlippagePoints: environment.MAX_SLIPPAGE_POINTS ?? "5",
        maxSlippageBps: environment.MAX_SLIPPAGE_BPS ?? "2",
      });
      gateway = demoGateway;
    } else if (config.tradingMode === "shadow") {
      gateway = new ShadowGateway();
    } else {
      gateway = new DisabledLiveGateway();
    }
  }

  const controls = new RuntimeControlStore(pool);
  const dailyRisk = new DailyRiskStore(pool);
  const analytics = new AnalyticsHttpClient({
    baseUrl:
      environment.ANALYTICS_BASE_URL ??
      `http://127.0.0.1:${environment.ANALYTICS_PORT ?? "8090"}`,
    timeoutMs: 15_000,
  });
  const aiProviderTimeoutMs = integer(environment, "AI_TIMEOUT_MS", 30_000);
  const aiMaxRetries = integer(environment, "AI_MAX_RETRIES", 0);
  const model = new AiOrchestratorHttpClient({
    baseUrl:
      environment.AI_ORCHESTRATOR_BASE_URL ??
      `http://127.0.0.1:${environment.AI_ORCHESTRATOR_PORT ?? "8082"}`,
    schemaPath: path.resolve("schemas/model-response-2.1.json"),
    systemPromptPath: path.resolve("prompts/system-v13.md"),
    promptVersion: "system-v13",
    timeoutMs: aiOrchestratorRequestTimeoutMs({
      providerTimeoutMs: aiProviderTimeoutMs,
      maxRetries: aiMaxRetries,
    }),
    circuitResetMs: aiOrchestratorCircuitResetMs(
      integer(environment, "AI_CIRCUIT_BREAKER_RESET_SECONDS", 300),
    ),
    circuitBreakerFailures: integer(
      environment,
      "AI_CIRCUIT_BREAKER_FAILURES",
      3,
    ),
  });
  const risk = new OcoRiskEvaluator({
    marginEstimator: margin,
    baseRiskPercent: config.baseRiskPercent,
    maxRiskPercent: config.maxRiskPercent,
    maxMarginUsagePercent: environment.MAX_MARGIN_USAGE_PERCENT ?? "30",
    maxPositionNotional: config.maxPositionNotional,
    strategyVersion,
  });
  const trail = new PostgresDecisionTrail({
    pool,
    accountId: identity.accountId,
    symbolId: identity.symbolId,
    strategyVersionId: identity.strategyVersionId,
    mode: config.tradingMode,
    apiStyle:
      environment.AI_API_STYLE === "chat_completions"
        ? "chat_completions"
        : "responses",
    model: environment.AI_MODEL ?? "unconfigured",
    promptVersion: "system-v13",
    schemaVersion: "2.1",
    payloadMode: environment.MODEL_PAYLOAD_MODE === "full" ? "full" : "compact",
    instanceId: config.instanceId,
    environment: config.appEnv,
    persistedCandleTails,
  });
  const recoveredInterruptedAnalyses = await trail.recoverInterruptedAnalyses();
  if (recoveredInterruptedAnalyses > 0) {
    logger.log("warn", {
      event_name: "interrupted_analyses_recovered",
      outcome: "rejected",
      reason_code: "ANALYSIS_INTERRUPTED_BY_PROCESS_RESTART",
      count: recoveredInterruptedAnalyses,
    });
  }
  const executionSymbolId = latestSnapshot.metadata.symbolId;
  const automaticAnalysisSchedule = new PostgresAutomaticAnalysisSchedule({
    pool,
    accountId: identity.accountId,
    symbolId: identity.symbolId,
  });
  const automaticAnalysisCampaign = new PostgresAutomaticAnalysisCampaign({
    pool,
    accountId: identity.accountId,
    symbolId: identity.symbolId,
    strategyVersionId: identity.strategyVersionId,
    mode: config.tradingMode,
    configuredLimit: config.automaticAnalysisCompletedLimit,
    completedBaseline: config.automaticAnalysisCompletedBaseline,
  });
  const automaticTradeCampaign = new PostgresAutomaticTradeCampaign({
    pool,
    accountId: identity.accountId,
    symbolId: identity.symbolId,
    strategyVersionId: identity.strategyVersionId,
    configuredLimit: config.automaticDemoClosedTradeLimit,
    closedTradeBaseline: config.automaticDemoClosedTradeBaseline,
  });
  const managedSetupOverview = new PostgresManagedSetupOverview({
    pool,
    accountId: identity.accountId,
    symbolId: identity.symbolId,
    mode: config.tradingMode,
  });
  const automaticAnalysisWatchdog = new PostgresAutomaticAnalysisWatchdog({
    pool,
    accountId: identity.accountId,
    symbolId: identity.symbolId,
    strategyVersionId: identity.strategyVersionId,
    strategyVersion,
    symbol: config.symbol,
    accountKey: config.accountKey,
    instanceId: config.instanceId,
    environment: config.appEnv,
    mode: config.tradingMode,
    serviceStartedAt,
    stallAfterMs: boundedSecondsMs(
      environment,
      "AUTOMATIC_ANALYSIS_STALL_SECONDS",
      180,
      60,
      3600,
    ),
  });
  const openPositionMonitor =
    brokerClient === null
      ? null
      : new PostgresOpenPositionMonitor({
          pool,
          accountId: identity.accountId,
          symbolId: identity.symbolId,
          mode: config.tradingMode,
          providerSymbolId: executionSymbolId,
          symbolName: config.symbol,
          quote: () => marketClient.quote(config.symbol),
          pnl: (brokerPositionId) =>
            brokerClient.positionUnrealizedPnl(brokerPositionId),
        });
  const demoExecutionStore =
    brokerClient !== null && config.tradingMode === "demo"
      ? new PostgresDemoExecutionStore({
          pool,
          accountId: identity.accountId,
          symbolId: identity.symbolId,
        })
      : null;
  let latestDemoExecutionReasonCodes: readonly string[] = [];
  let latestSafetyDetailReasonCodes: readonly string[] = [];
  const demoExecutionRecorder =
    demoExecutionStore === null
      ? null
      : new DurableDemoExecutionRecorder(demoExecutionStore, {
          symbolId: executionSymbolId,
          onFailure: (failure) => {
            logger.log("error", {
              event_name: "demo_execution_callback_failed",
              outcome: "blocked",
              reason_code: failure.reasonCode,
              stage: failure.stage,
              execution_type: failure.executionType,
              order_status: failure.orderStatus,
              deal_status: failure.dealStatus,
              has_order: failure.hasOrder,
              has_position: failure.hasPosition,
              has_deal: failure.hasDeal,
              has_client_order_id: failure.hasClientOrderId,
              has_order_label: failure.hasOrderLabel,
            });
          },
        });
  const unsubscribeDemoExecutions =
    brokerClient === null || demoExecutionRecorder === null
      ? null
      : brokerClient.onExecution((execution) =>
          demoExecutionRecorder.enqueue(execution),
        );
  const runDemoRecovery = async (): Promise<{
    readonly certain: boolean;
    readonly reasonCodes: readonly string[];
  }> => {
    if (brokerClient === null || demoExecutionStore === null)
      return { certain: true, reasonCodes: [] };
    try {
      const recorderBeforeRecovery =
        demoExecutionRecorder === null
          ? { certain: true, reasonCodes: [] as readonly string[] }
          : await demoExecutionRecorder.flush();
      latestDemoExecutionReasonCodes = recorderBeforeRecovery.reasonCodes;
      const failureCheckpoint = demoExecutionRecorder?.failureCheckpoint() ?? 0;
      const recovered = await recoverDemoExecutions({
        pool,
        accountId: identity.accountId,
        symbolId: identity.symbolId,
        client: brokerClient,
        store: demoExecutionStore,
        normalizer: { symbolId: executionSymbolId },
      });
      const terminal = await demoExecutionStore.reconcileTerminalEvidence();
      const recoveryReasons = recovered.reasonCodes.filter(
        (reason) =>
          terminal.resolvedEventCount === 0 ||
          ![
            "DEMO_BROKER_EVENT_KEY_CONFLICT",
            "DEMO_TRADE_OUTCOME_CONFLICT",
          ].includes(reason),
      );
      const recoveredCertain =
        recovered.certain ||
        (recovered.reasonCodes.length > 0 && recoveryReasons.length === 0);
      const result = {
        certain: recoveredCertain && terminal.certain,
        reasonCodes: [
          ...new Set([...recoveryReasons, ...terminal.reasonCodes]),
        ].sort(),
      };
      if (
        demoExecutionRecorder !== null &&
        terminal.terminalProofKey !== null
      ) {
        demoExecutionRecorder.acknowledgeCertainTerminalRecovery(
          failureCheckpoint,
          terminal.terminalProofKey,
          result,
          terminal.terminalBrokerFillId,
        );
        const recorderState = await demoExecutionRecorder.flush();
        latestDemoExecutionReasonCodes = recorderState.reasonCodes;
        const finalRecovery = {
          certain: result.certain && recorderState.certain,
          reasonCodes: [
            ...new Set([...result.reasonCodes, ...recorderState.reasonCodes]),
          ].sort(),
        };
        if (demoGateway !== null && terminal.terminalOrderGroupId !== null) {
          demoGateway.acknowledgeCertainTerminalRecovery({
            orderGroupId: terminal.terminalOrderGroupId,
            terminalProofKey: terminal.terminalProofKey,
            certain: finalRecovery.certain,
          });
        }
        return finalRecovery;
      }
      return {
        certain: result.certain && recorderBeforeRecovery.certain,
        reasonCodes: [
          ...new Set([
            ...result.reasonCodes,
            ...recorderBeforeRecovery.reasonCodes,
          ]),
        ].sort(),
      };
    } catch (error) {
      return {
        certain: false,
        reasonCodes: [
          error instanceof Error
            ? error.message
            : "DEMO_EXECUTION_RECOVERY_FAILED",
        ],
      };
    }
  };
  const demoRecoveryIntervalSeconds = integer(
    environment,
    "DEMO_EXECUTION_RECOVERY_INTERVAL_SECONDS",
    15,
  );
  const demoRecoveryRunner = new DemoExecutionRecoveryRunner({
    recover: runDemoRecovery,
    intervalMs: demoRecoveryIntervalSeconds * 1_000,
  });
  let demoRecoveryState = await demoRecoveryRunner.run(true);
  const refreshDemoRecovery = async (force = false): Promise<void> => {
    const previousAttemptCount = demoRecoveryRunner.attemptCount;
    demoRecoveryState = await demoRecoveryRunner.run(force);
    startupChecksPassed =
      config.tradingMode !== "live" && demoRecoveryState.certain;
    if (
      !demoRecoveryState.certain &&
      demoRecoveryRunner.attemptCount > previousAttemptCount
    ) {
      logger.log("error", {
        event_name: "demo_execution_recovery_failed",
        outcome: "failed",
        reason_code:
          demoRecoveryState.reasonCodes[0] ??
          "DEMO_EXECUTION_RECOVERY_UNCERTAIN",
      });
    }
  };
  if (!demoRecoveryState.certain) {
    logger.log("error", {
      event_name: "demo_execution_recovery_failed",
      outcome: "failed",
      reason_code:
        demoRecoveryState.reasonCodes[0] ?? "DEMO_EXECUTION_RECOVERY_UNCERTAIN",
    });
  }
  let startupChecksPassed = false;
  const unsubscribeDemoSynchronization =
    brokerClient === null || demoExecutionStore === null
      ? null
      : brokerClient.onSynchronization(() => {
          void refreshDemoRecovery(true);
        });
  const performanceContext = new PostgresPerformanceContext({
    pool,
    accountId: identity.accountId,
    symbolId: identity.symbolId,
    mode: config.tradingMode,
    timezone: environment.DAILY_RISK_TIMEZONE ?? "UTC",
    minimumSamples: integer(environment, "PERFORMANCE_MINIMUM_SAMPLES", 20),
    decay: Number(environment.PERFORMANCE_DECAY ?? 0.97),
    window: integer(environment, "PERFORMANCE_ROLLING_TRADES", 200),
    summarize: (outcomes) => analytics.summarizePerformance(outcomes),
  });
  const spreadMinimumSamples = integer(
    environment,
    "SPREAD_PERCENTILE_MINIMUM_SAMPLES",
    30,
  );
  const spreadAbnormalMultiplier = decimal(
    environment.SPREAD_SESSION_ABNORMAL_MULTIPLIER ?? "3",
    "SPREAD_SESSION_ABNORMAL_MULTIPLIER_INVALID",
  );
  const spreadObservations = new PostgresSpreadObservationStore({
    pool,
    accountId: identity.accountId,
    symbolId: identity.symbolId,
  });
  const spreadContext = async (
    snapshot: MarketSnapshot,
  ): Promise<{
    observedPercentile: string | null;
    sessionAbnormal: boolean;
  }> => {
    return await spreadObservations.context({
      bid: snapshot.quote.bid,
      ask: snapshot.quote.ask,
      minimumSamples: spreadMinimumSamples,
      abnormalMultiplier: spreadAbnormalMultiplier,
    });
  };
  const maintenance = new OrderMaintenance(pool, gateway, config.symbol);
  const metrics = new MetricsCollector({
    pool,
    instanceId: config.instanceId,
    service: "execution-service",
    intervalSeconds: integer(environment, "SERVER_STATS_INTERVAL_SECONDS", 10),
    ...(environment.NETWORK_INTERFACE === undefined ||
    environment.NETWORK_INTERFACE === ""
      ? {}
      : { networkInterface: environment.NETWORK_INTERFACE }),
  });
  metrics.start();
  startupChecksPassed =
    config.tradingMode !== "live" && demoRecoveryState.certain;
  let lastCycle: CycleResult | null = null;
  let lastSafetyReasons: readonly string[] = [];
  const dailyRiskTimezone = environment.DAILY_RISK_TIMEZONE ?? "UTC";
  const baselineCaptureGraceSeconds = integer(
    environment,
    "DAILY_BASELINE_CAPTURE_GRACE_SECONDS",
    300,
  );
  const accountEquityFloor = optionalDecimal(environment.ACCOUNT_EQUITY_FLOOR);
  if (accountEquityFloor !== null)
    decimal(accountEquityFloor, "ACCOUNT_EQUITY_FLOOR_INVALID");
  let cashFlowCache: {
    readonly dayStart: string;
    readonly capturedAt: number;
    readonly netFlows: string;
  } | null = null;

  const dailyNetFlows = async (now: Date): Promise<string> => {
    if (brokerClient === null) return "0";
    const start = tradingDayStart(now, dailyRiskTimezone);
    if (
      cashFlowCache !== null &&
      cashFlowCache.dayStart === start.toISOString() &&
      now.getTime() - cashFlowCache.capturedAt < 10_000
    ) {
      return cashFlowCache.netFlows;
    }
    const summary = await brokerClient.externalCashFlows(start, now);
    cashFlowCache = {
      dayStart: start.toISOString(),
      capturedAt: now.getTime(),
      netFlows: summary.netFlows,
    };
    return summary.netFlows;
  };

  const safety = async (): Promise<SafetyGateInput> => {
    demoRecoveryState = await demoRecoveryRunner.settled();
    const filesystem = await readFilesystemControls({
      emergencyStopFile: config.emergencyStopFile,
      liveEnablementFile: config.liveEnablementFile,
      instanceId: config.instanceId,
      accountKey: config.accountKey,
    });
    const runtime = await controls.snapshot(config.instanceId, {
      instanceId: config.instanceId,
      accountKey: config.accountKey,
      configHash,
    });
    let state: AccountState;
    try {
      state = await account.reconcile(latestSnapshot!.metadata.symbolId);
    } catch {
      state = {
        reconciledAt: new Date().toISOString(),
        certain: false,
        equity: "0",
        balance: "0",
        availableMargin: "0",
        relevantPositionCount: 0,
        relevantPendingOrderCount: 0,
        hasPartialFill: false,
        hasCancellationPending: false,
        reasonCodes: ["ACCOUNT_RECONCILIATION_FAILED"],
      };
    }
    const external = await gateway.reconcile(config.symbol);
    const demoExecutionState =
      demoExecutionRecorder === null
        ? { certain: true, reasonCodes: [] as readonly string[] }
        : await demoExecutionRecorder.flush();
    latestDemoExecutionReasonCodes = demoExecutionState.reasonCodes;
    let reconciliationPersisted = true;
    try {
      await trail.reconciliation(external);
    } catch {
      reconciliationPersisted = false;
    }
    let dailyLocked: boolean;
    try {
      const riskNow = new Date();
      const netFlows = await dailyNetFlows(riskNow);
      dailyLocked = (
        await dailyRisk.reconcile({
          accountId: identity.accountId,
          account: state,
          timezone: dailyRiskTimezone,
          thresholdPercent: config.maxDailyLossPercent,
          includeUnrealized:
            environment.INCLUDE_UNREALIZED_IN_DAILY_LOSS !== "false",
          netFlows,
          allowBaselineBootstrap: brokerClient === null,
          baselineCaptureGraceSeconds,
          now: riskNow,
        })
      ).lockedOut;
    } catch (error) {
      dailyLocked = true;
      logger.log("error", {
        event_name: "daily_risk_reconciliation_failed",
        outcome: "failed",
        reason_code:
          error instanceof Error
            ? error.message
            : "DAILY_RISK_RECONCILIATION_FAILED",
      });
    }
    let databaseHealthy = true;
    let previousAnalysisExpired = false;
    let databaseRelevantOrderCount = 0;
    let databaseRelevantPositionCount = 0;
    let databasePartialFill = false;
    let databaseCancellationPending = false;
    let databaseReconciliationPending = false;
    let ordersToday = 0;
    try {
      await pool.query("SELECT 1");
      const active = await pool.query<{ active: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM analysis_runs
           WHERE account_id = $1 AND symbol_id = $2
             AND state IN ('PENDING', 'COLLECTING', 'FEATURED', 'MODEL_PENDING', 'VALIDATING', 'ACCEPTED')
             AND (valid_until IS NULL OR valid_until > now())
         ) AS active`,
        [identity.accountId, identity.symbolId],
      );
      previousAnalysisExpired = !(active.rows[0]?.active ?? true);
      const durable = await pool.query<{
        relevant_orders: string;
        relevant_positions: string;
        partial_fill: boolean;
        cancellation_pending: boolean;
        reconciliation_pending: boolean;
        orders_today: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM orders o
             JOIN order_groups og ON og.id = o.order_group_id
             JOIN analysis_runs ar ON ar.id = og.analysis_id
             WHERE ar.account_id = $1 AND ar.symbol_id = $2
               AND o.state IN ('INTENT','SUBMITTING','PENDING','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN')) AS relevant_orders,
           (SELECT count(*)::text FROM positions p
             WHERE p.account_id = $1 AND p.symbol_id = $2
               AND p.state IN ('OPEN','CLOSING','UNKNOWN','RECONCILIATION_PENDING')) AS relevant_positions,
           EXISTS (SELECT 1 FROM orders o
             JOIN order_groups og ON og.id = o.order_group_id
             JOIN analysis_runs ar ON ar.id = og.analysis_id
             WHERE ar.account_id = $1 AND ar.symbol_id = $2 AND o.state = 'PARTIALLY_FILLED') AS partial_fill,
           EXISTS (SELECT 1 FROM orders o
             JOIN order_groups og ON og.id = o.order_group_id
             JOIN analysis_runs ar ON ar.id = og.analysis_id
             WHERE ar.account_id = $1 AND ar.symbol_id = $2 AND o.state = 'CANCEL_PENDING') AS cancellation_pending,
           EXISTS (SELECT 1 FROM order_groups og
             JOIN analysis_runs ar ON ar.id = og.analysis_id
             WHERE ar.account_id = $1 AND ar.symbol_id = $2
               AND og.state = 'RECONCILIATION_REQUIRED') AS reconciliation_pending,
           (SELECT count(*)::text FROM order_groups og
             JOIN analysis_runs ar ON ar.id = og.analysis_id
             WHERE ar.account_id = $1 AND ar.symbol_id = $2
               AND og.created_at >= $3) AS orders_today`,
        [
          identity.accountId,
          identity.symbolId,
          tradingDayStart(new Date(), dailyRiskTimezone).toISOString(),
        ],
      );
      const row = durable.rows[0];
      databaseRelevantOrderCount = Number(row?.relevant_orders ?? 0);
      databaseRelevantPositionCount = Number(row?.relevant_positions ?? 0);
      databasePartialFill = row?.partial_fill ?? false;
      databaseCancellationPending = row?.cancellation_pending ?? false;
      databaseReconciliationPending = row?.reconciliation_pending ?? false;
      ordersToday = Number(row?.orders_today ?? 0);
    } catch {
      databaseHealthy = false;
    }
    latestSafetyDetailReasonCodes = [
      ...new Set([
        ...(state.certain ? [] : state.reasonCodes),
        ...(external.certain ? [] : external.reasonCodes),
        ...(demoRecoveryState.certain ? [] : demoRecoveryState.reasonCodes),
        ...(demoExecutionState.certain ? [] : demoExecutionState.reasonCodes),
        ...(reconciliationPersisted
          ? []
          : ["RECONCILIATION_AUDIT_PERSISTENCE_FAILED"]),
        ...(databaseReconciliationPending
          ? ["DATABASE_RECONCILIATION_PENDING"]
          : []),
      ]),
    ].sort();
    return {
      tradingMode: config.tradingMode,
      liveTradingEnabled: config.liveTradingEnabled,
      liveAcknowledgement: config.liveAcknowledgement,
      environmentEmergencyStop: config.emergencyStop,
      filesystemControlsCertain: filesystem.certain,
      filesystemEmergencyStop: filesystem.emergencyStop,
      liveEnablementFileValid: filesystem.liveEnablementValid,
      runtimeControlsCertain: runtime.certain,
      databaseEmergencyStop: runtime.emergencyStop,
      dashboardAcknowledged: runtime.dashboardAcknowledged,
      pauseNewAnalyses: config.pauseNewAnalyses || runtime.pauseNewAnalyses,
      startupChecksPassed,
      serviceHealthy: databaseHealthy,
      accountAuthenticated: state.certain,
      accountReconciled: state.certain,
      reconciliationCertain:
        state.certain &&
        external.certain &&
        demoRecoveryState.certain &&
        demoExecutionState.certain &&
        reconciliationPersisted &&
        !databaseReconciliationPending,
      relevantPositionCount: Math.max(
        state.relevantPositionCount,
        external.relevantPositionCount,
        databaseRelevantPositionCount,
      ),
      relevantPendingOrderCount: Math.max(
        state.relevantPendingOrderCount,
        external.orders.filter((order) =>
          ["PENDING", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.state),
        ).length,
        databaseRelevantOrderCount,
      ),
      partialFillPresent:
        state.hasPartialFill ||
        databasePartialFill ||
        external.orders.some((order) => order.state === "PARTIALLY_FILLED"),
      cancellationPending:
        state.hasCancellationPending || databaseCancellationPending,
      previousAnalysisExpired,
      candlesSynchronized: true,
      orderBookFresh: true,
      marketDataFresh: true,
      dailyLossLockout: dailyLocked,
      operationalRiskLockout:
        !demoRecoveryState.certain ||
        !demoExecutionState.certain ||
        (accountEquityFloor !== null &&
          (!state.certain ||
            new Decimal(state.equity).lt(accountEquityFloor))) ||
        (config.maxOrdersPerDay > 0 && ordersToday >= config.maxOrdersPerDay),
      aiCircuitOpen: model.circuitOpen,
      symbolMetadataValid: latestSnapshot !== null,
      aiResponseValid: false,
      deterministicRiskApproved: false,
      spreadSafe: false,
      duplicateFree: external.certain,
      criticalAuditAvailable:
        databaseHealthy &&
        reconciliationPersisted &&
        demoRecoveryState.certain &&
        demoExecutionState.certain,
    };
  };

  const minimumOrderExpirySeconds = integer(
    environment,
    "ORDER_EXPIRY_MIN_SECONDS",
    15,
  );
  const maximumOrderExpirySeconds = integer(
    environment,
    "ORDER_EXPIRY_MAX_SECONDS",
    1800,
  );
  const preferredOrderExpirySeconds = integer(
    environment,
    "PREFERRED_ORDER_EXPIRY_SECONDS",
    1500,
  );
  if (
    minimumOrderExpirySeconds < 1 ||
    maximumOrderExpirySeconds < minimumOrderExpirySeconds ||
    preferredOrderExpirySeconds < minimumOrderExpirySeconds ||
    preferredOrderExpirySeconds > maximumOrderExpirySeconds
  ) {
    throw new Error("CONFIG_ORDER_EXPIRY_RANGE_INVALID");
  }
  const coordinator = new AnalysisCoordinator({
    symbol: config.symbol,
    mode: config.tradingMode as "paper" | "demo" | "shadow" | "live",
    candleCounts,
    orderBookDepth: integer(environment, "ORDER_BOOK_DEPTH", 20),
    analyticsConfig: {
      atrPeriod: integer(environment, "ATR_PERIOD", 15),
      emaFastPeriod: integer(environment, "EMA_FAST_PERIOD", 5),
      emaSlowPeriod: integer(environment, "EMA_SLOW_PERIOD", 19),
      adxEnabled: environment.ADX_ENABLED !== "false",
      adxPeriod: integer(environment, "ADX_PERIOD", 14),
      rsiEnabled: environment.RSI_ENABLED !== "false",
      rsiPeriod: integer(environment, "RSI_PERIOD", 14),
      bollingerEnabled: environment.BOLLINGER_ENABLED === "true",
      bollingerPeriod: integer(environment, "BOLLINGER_PERIOD", 20),
      bollingerStddev: environment.BOLLINGER_STDDEV ?? "2",
      swingPivotLeft: integer(environment, "SWING_PIVOT_LEFT", 3),
      swingPivotRight: integer(environment, "SWING_PIVOT_RIGHT", 3),
      compactTail: persistedCandleTails,
      expectedCounts: candleCounts,
    },
    modelPayloadMode:
      environment.MODEL_PAYLOAD_MODE === "full" ? "full" : "compact",
    promptVersion: "system-v13",
    schemaVersion: "2.1",
    strategyVersion,
    minRiskRewardRatio: config.minRiskRewardRatio,
    minimumExpectedNetToFeesRatio: config.minimumExpectedNetToFeesRatio,
    minExpirySeconds: minimumOrderExpirySeconds,
    maxExpirySeconds: maximumOrderExpirySeconds,
    preferredExpirySeconds: preferredOrderExpirySeconds,
    maxStopDistanceAtr: environment.MAX_STOP_DISTANCE_ATR ?? "3",
    maxEntryDistanceAtr: config.maxEntryDistanceAtr,
    entryLatencyBufferAtr: config.entryLatencyBufferAtr,
    minStopDistancePoints: optionalDecimal(
      environment.MIN_STOP_DISTANCE_POINTS,
    ),
    maxQuoteAgeMs: config.maxQuoteAgeMs,
    maxMetadataAgeMs: config.maxMetadataAgeMs,
    maxOrderBookAgeMs: config.maxOrderBookAgeMs,
    maxSpreadPoints: optionalDecimal(environment.MAX_SPREAD_POINTS),
    maxSpreadAtrRatio: optionalDecimal(environment.MAX_SPREAD_ATR_RATIO),
    maxSpreadPercentile: optionalDecimal(environment.MAX_SPREAD_PERCENTILE),
    preModelStabilityCheck: true,
    enforceModelDeadline: true,
    minimumModelBudgetMs: boundedSecondsMs(
      environment,
      "MODEL_MINIMUM_CALL_BUDGET_SECONDS",
      40,
      1,
      55,
    ),
    postModelReserveMs: boundedSecondsMs(
      environment,
      "MODEL_POST_RESPONSE_RESERVE_SECONDS",
      5,
      1,
      30,
    ),
    spreadContext,
    market,
    analytics,
    model,
    account,
    risk,
    gateway,
    trail,
    safety,
    ...(demoExecutionRecorder === null
      ? {}
      : {
          flushExecutionEvents: async () => {
            await demoExecutionRecorder.flush();
          },
        }),
    performance: (analyticsResponse) =>
      performanceContext.build(analyticsResponse),
  });

  startupChecksPassed =
    config.tradingMode !== "live" && demoRecoveryState.certain;
  const status = async (): Promise<ExecutionStatus> => {
    const current = await safety();
    const managedSetup = await managedSetupOverview
      .read()
      .catch(() => UNAVAILABLE_MANAGED_SETUP);
    const campaign = await automaticAnalysisCampaign
      .progress()
      .catch((error) => ({
        enabled: config.automaticAnalysisCompletedLimit > 0,
        limit:
          config.automaticAnalysisCompletedLimit > 0
            ? config.automaticAnalysisCompletedLimit
            : null,
        baseline: config.automaticAnalysisCompletedBaseline,
        releaseCompleted: null,
        completed: null,
        lifetimeCompleted: null,
        remaining: null,
        complete: false,
        allowed: false,
        reasonCodes: [
          error instanceof Error &&
          error.message === "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID"
            ? error.message
            : "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_UNAVAILABLE",
        ],
      }));
    const tradeCampaign = await automaticTradeCampaign
      .progress()
      .catch((error) => ({
        enabled: config.automaticDemoClosedTradeLimit > 0,
        limit:
          config.automaticDemoClosedTradeLimit > 0
            ? config.automaticDemoClosedTradeLimit
            : null,
        baseline: config.automaticDemoClosedTradeBaseline,
        releaseClosedTrades: null,
        closedTrades: null,
        lifetimeClosedTrades: null,
        remaining: null,
        complete: false,
        allowed: false,
        reasonCodes: [
          error instanceof Error &&
          error.message === "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID"
            ? error.message
            : "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_UNAVAILABLE",
        ],
      }));
    const eligibility = evaluateAnalysisEligibility(current);
    const automationActivity = await automaticAnalysisWatchdog
      .snapshot({
        automaticAnalysisEnabled: config.automaticAnalysisEnabled,
        paused: current.pauseNewAnalyses,
        managedSetupActive: managedSetup.status === "ACTIVE",
      })
      .catch(() => ({
        state: "UNAVAILABLE" as const,
        lastClaimedAt: null,
        lastCompletedAt: null,
        lastLifecycleAt: null,
        lastProgressAt: null,
        latestMarketAt: null,
        stalledSince: null,
        reasonCodes: ["AUTOMATIC_WATCHDOG_UNAVAILABLE"],
      }));
    const modeReasons =
      config.tradingMode === "demo"
        ? [
            ...(config.demoTradingEnabled ? [] : ["DEMO_TRADING_DISABLED"]),
            ...(config.demoAcknowledgement === DEMO_ACKNOWLEDGEMENT
              ? []
              : ["DEMO_ACKNOWLEDGEMENT_INVALID"]),
          ]
        : [];
    lastSafetyReasons = [
      ...new Set([
        ...eligibility.reasonCodes,
        ...modeReasons,
        ...latestDemoExecutionReasonCodes,
        ...latestSafetyDetailReasonCodes,
        ...(automationActivity.state === "STALLED"
          ? automationActivity.reasonCodes
          : []),
      ]),
    ].sort();
    return {
      mode: config.tradingMode,
      symbol: config.symbol,
      accountType: connectionMode,
      emergencyStopped:
        current.environmentEmergencyStop ||
        current.filesystemEmergencyStop ||
        current.databaseEmergencyStop,
      pauseNewAnalyses: current.pauseNewAnalyses,
      automaticAnalysisEnabled: config.automaticAnalysisEnabled,
      automaticAnalysisCampaign: {
        enabled: campaign.enabled,
        limit: campaign.limit,
        baseline: campaign.baseline,
        releaseCompleted: campaign.releaseCompleted,
        completed: campaign.completed,
        lifetimeCompleted: campaign.lifetimeCompleted,
        remaining: campaign.remaining,
        complete: campaign.complete,
        reasonCodes: campaign.reasonCodes,
      },
      automaticDemoTradeCampaign: {
        enabled: tradeCampaign.enabled,
        limit: tradeCampaign.limit,
        baseline: tradeCampaign.baseline,
        releaseClosedTrades: tradeCampaign.releaseClosedTrades,
        closedTrades: tradeCampaign.closedTrades,
        lifetimeClosedTrades: tradeCampaign.lifetimeClosedTrades,
        remaining: tradeCampaign.remaining,
        complete: tradeCampaign.complete,
        reasonCodes: tradeCampaign.reasonCodes,
      },
      automationActivity,
      managedSetup,
      aiCircuitOpenUntil: model.circuitOpenUntil,
      tradingEnabled:
        eligibility.allowed &&
        gateway.canSubmitToBroker &&
        modeReasons.length === 0,
      startupChecksPassed,
      lastCycle,
      reasonCodes: lastSafetyReasons,
    };
  };
  const initializeDailyRiskBaseline = async (input: {
    readonly actor: string;
    readonly reason: string;
  }): Promise<{ readonly tradingDay: string; readonly timezone: string }> => {
    try {
      if (config.tradingMode !== "demo" || brokerClient === null) {
        throw new Error("DEMO_BASELINE_REQUIRES_DEMO_MODE");
      }
      if (!config.emergencyStop) {
        throw new Error("DEMO_BASELINE_REQUIRES_ENV_EMERGENCY_STOP");
      }
      if (config.demoTradingEnabled) {
        throw new Error("DEMO_BASELINE_REQUIRES_SUBMISSION_DISABLED");
      }
      const filesystem = await readFilesystemControls({
        emergencyStopFile: config.emergencyStopFile,
        liveEnablementFile: config.liveEnablementFile,
        instanceId: config.instanceId,
        accountKey: config.accountKey,
      });
      const runtime = await controls.snapshot(config.instanceId, {
        instanceId: config.instanceId,
        accountKey: config.accountKey,
        configHash,
      });
      if (!filesystem.certain || !runtime.certain) {
        throw new Error("DEMO_BASELINE_CONTROL_STATE_UNCERTAIN");
      }
      const start = tradingDayStart(new Date(), dailyRiskTimezone);
      const before = await brokerClient.reconcileRaw();
      if (before.positions.length > 0 || before.orders.length > 0) {
        throw new Error("DEMO_BASELINE_BROKER_STATE_NOT_EMPTY");
      }
      const accountState = await brokerClient.reconcile(
        latestSnapshot!.metadata.symbolId,
      );
      const firstEvidenceAt = new Date();
      const firstFlows = await brokerClient.externalCashFlows(
        start,
        firstEvidenceAt,
      );
      const firstDeals = await brokerClient.dealHistory(
        start,
        firstEvidenceAt,
        1,
      );
      if (firstDeals.dealCount > 0 || firstDeals.hasMore) {
        throw new Error("DEMO_BASELINE_DEALS_PRESENT");
      }
      const confirmedAccountState = await brokerClient.reconcile(
        latestSnapshot!.metadata.symbolId,
      );
      if (
        accountState.equity !== confirmedAccountState.equity ||
        accountState.balance !== confirmedAccountState.balance
      ) {
        throw new Error("DEMO_BASELINE_ACCOUNT_STATE_CHANGED");
      }
      const capturedAt = new Date();
      const flows = await brokerClient.externalCashFlows(start, capturedAt);
      const deals = await brokerClient.dealHistory(start, capturedAt, 1);
      if (deals.dealCount > 0 || deals.hasMore) {
        throw new Error("DEMO_BASELINE_DEALS_PRESENT");
      }
      if (
        flows.netFlows !== firstFlows.netFlows ||
        flows.operationCount !== firstFlows.operationCount
      ) {
        throw new Error("DEMO_BASELINE_CASH_FLOW_STATE_CHANGED");
      }
      const after = await brokerClient.reconcileRaw();
      if (after.positions.length > 0 || after.orders.length > 0) {
        throw new Error("DEMO_BASELINE_BROKER_STATE_CHANGED");
      }
      return await dailyRisk.initializeReconciledBaseline({
        accountId: identity.accountId,
        account: confirmedAccountState,
        timezone: dailyRiskTimezone,
        netFlows: flows.netFlows,
        brokerDealCount: deals.dealCount,
        brokerPositionCount: after.positions.length,
        brokerOrderCount: after.orders.length,
        externalFlowOperationCount: flows.operationCount,
        actor: input.actor,
        reason: input.reason,
        instanceId: config.instanceId,
        environment: config.appEnv,
        tradingMode: "demo",
        accountKey: config.accountKey,
        symbol: config.symbol,
        now: capturedAt,
      });
    } catch (error) {
      logger.log("warn", {
        event_name: "daily_risk_baseline_initialization_failed",
        outcome: "rejected",
        reason_code:
          error instanceof Error
            ? error.message
            : "DAILY_RISK_BASELINE_INITIALIZATION_FAILED",
      });
      throw error;
    }
  };
  const app = createExecutionServer({
    coordinator,
    maintenance,
    controls,
    controlToken: environment.DASHBOARD_CONTROL_TOKEN ?? "",
    scope: config.instanceId,
    instanceId: config.instanceId,
    accountKey: config.accountKey,
    configHash,
    mode: config.tradingMode,
    status,
    openPositionMonitor: async () => {
      if (openPositionMonitor === null) {
        return {
          status: "UNAVAILABLE",
          reasonCode: "OPEN_POSITION_MONITOR_UNSUPPORTED_MODE",
        };
      }
      return await openPositionMonitor
        .read()
        .catch(unavailableOpenPositionMonitor);
    },
    updateLastCycle: (result) => {
      lastCycle = result;
    },
    initializeDailyRiskBaseline,
    metrics: () => metrics.metrics(),
  });

  let ticking = false;
  let automaticCampaignPausePersisted = false;
  let automaticTradeCampaignPausePersisted = false;
  const persistAutomaticCampaignPause = async (): Promise<void> => {
    if (automaticCampaignPausePersisted) return;
    await controls.setControl({
      key: "PAUSE_NEW_ANALYSES",
      scope: config.instanceId,
      enabled: true,
      actor: "automatic-analysis-campaign",
      reason: `Configured campaign completed ${config.automaticAnalysisCompletedLimit} durable external-AI analyses; paused for review`,
    });
    automaticCampaignPausePersisted = true;
    logger.log("info", {
      event_name: "automatic_analysis_campaign_completed",
      outcome: "paused",
      completed: config.automaticAnalysisCompletedLimit,
      limit: config.automaticAnalysisCompletedLimit,
    });
  };
  const persistAutomaticTradeCampaignPause = async (): Promise<void> => {
    if (automaticTradeCampaignPausePersisted) return;
    await controls.setControl({
      key: "PAUSE_NEW_ANALYSES",
      scope: config.instanceId,
      enabled: true,
      actor: "automatic-trade-campaign",
      reason: `Configured campaign collected ${config.automaticDemoClosedTradeLimit} durable closed demo trades; paused for review`,
    });
    automaticTradeCampaignPausePersisted = true;
    logger.log("info", {
      event_name: "automatic_trade_campaign_completed",
      outcome: "paused",
      closed_trades: config.automaticDemoClosedTradeLimit,
      limit: config.automaticDemoClosedTradeLimit,
    });
  };
  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    let watchdogContext: {
      automaticAnalysisEnabled: boolean;
      paused: boolean;
      managedSetupActive: boolean;
    } | null = null;
    try {
      await refreshDemoRecovery();
      await maintenance.expireAndReconcile();
      if (paperGateway !== null && paperAccount !== null) {
        const quote = await marketClient.quote(config.symbol);
        const changes = paperGateway.processQuote(
          config.symbol,
          quote.quote.bid,
          quote.quote.ask,
          new Date(quote.quote.sourceTime),
        );
        paperAccount.update(
          paperGateway.accountMark(
            config.symbol,
            quote.quote.bid,
            quote.quote.ask,
          ),
        );
        await trail.paperState(changes, paperGateway.positions());
      }
      const current = await safety();
      watchdogContext = {
        automaticAnalysisEnabled: config.automaticAnalysisEnabled,
        paused: current.pauseNewAnalyses,
        managedSetupActive:
          current.relevantPositionCount > 0 ||
          current.relevantPendingOrderCount > 0 ||
          current.partialFillPresent ||
          current.cancellationPending,
      };
      if (
        current.environmentEmergencyStop ||
        current.filesystemEmergencyStop ||
        current.databaseEmergencyStop ||
        current.dailyLossLockout
      ) {
        await maintenance.cancelAll("AUTOMATIC_SAFETY_CANCELLATION");
      } else if (
        evaluateAutomaticAnalysisEligibility(
          current,
          config.automaticAnalysisEnabled,
        ).allowed
      ) {
        const campaignBefore = await automaticAnalysisCampaign.progress();
        const tradeCampaignBefore = await automaticTradeCampaign.progress();
        if (
          !(await enforceAutomaticTradeCampaign(
            tradeCampaignBefore,
            persistAutomaticTradeCampaignPause,
          ))
        ) {
          return;
        }
        if (
          !(await enforceAutomaticAnalysisCampaign(
            campaignBefore,
            persistAutomaticCampaignPause,
          ))
        ) {
          return;
        }
        const quote = await marketClient.quote(config.symbol);
        const window = evaluateAutomaticAnalysisWindow({
          serverTime: quote.serverTime,
          startWindowSeconds: config.automaticAnalysisStartWindowSeconds,
        });
        if (
          !window.allowed &&
          !window.reasonCodes.includes(
            "AUTOMATIC_ANALYSIS_OUTSIDE_M1_START_WINDOW",
          )
        ) {
          logger.log("error", {
            event_name: "automatic_analysis_window_rejected",
            outcome: "rejected",
            reason_code:
              window.reasonCodes[0] ?? "AUTOMATIC_ANALYSIS_WINDOW_REJECTED",
          });
        }
        if (window.allowed && window.intervalStart !== null) {
          const claimed = await automaticAnalysisSchedule.claim({
            intervalStart: window.intervalStart,
            brokerServerTime: quote.serverTime,
          });
          if (claimed) {
            logger.log("info", {
              event_name: "automatic_analysis_interval_claimed",
              outcome: "accepted",
              interval_start: window.intervalStart,
            });
            lastCycle = await coordinator.runOnce();
            await automaticAnalysisSchedule.complete(
              window.intervalStart,
              lastCycle,
            );
            logger.log("info", {
              event_name: "automatic_analysis_interval_completed",
              outcome: lastCycle.outcome.toLowerCase(),
              analysis_id: lastCycle.analysisId,
              ...(lastCycle.reasonCodes[0] === undefined
                ? {}
                : { reason_code: lastCycle.reasonCodes[0] }),
              interval_start: window.intervalStart,
            });
            await enforceAutomaticAnalysisCampaign(
              await automaticAnalysisCampaign.progress(),
              persistAutomaticCampaignPause,
            );
            await enforceAutomaticTradeCampaign(
              await automaticTradeCampaign.progress(),
              persistAutomaticTradeCampaignPause,
            );
          }
        }
      }
    } catch (error) {
      logger.log("error", {
        event_name: "scheduler_tick_failed",
        outcome: "failed",
        reason_code: stableFailureReason(error, "SCHEDULER_FAILED"),
      });
    } finally {
      if (watchdogContext !== null) {
        try {
          await automaticAnalysisWatchdog.observe(watchdogContext);
        } catch {
          logger.log("error", {
            event_name: "automatic_analysis_watchdog_failed",
            outcome: "failed",
            reason_code: "AUTOMATIC_WATCHDOG_UNAVAILABLE",
          });
        }
      }
      ticking = false;
    }
  };
  const intervalSeconds = integer(environment, "ANALYSIS_INTERVAL_SECONDS", 5);
  const schedulerLeadMs = integer(
    environment,
    "ANALYSIS_SCHEDULER_LEAD_MS",
    1_000,
  );
  const alignedDelayMs = alignedSchedulerDelayMs(
    Date.now(),
    intervalSeconds,
    schedulerLeadMs,
  );
  let timer: ReturnType<typeof setInterval> | null = null;
  const alignmentTimer = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), intervalSeconds * 1_000);
    timer.unref();
  }, alignedDelayMs);
  alignmentTimer.unref();
  const spreadSampler = new SpreadObservationSampler({
    symbol: config.symbol,
    providerSymbolId: executionSymbolId,
    maxQuoteAgeMs: config.maxQuoteAgeMs,
    quote: () => marketClient.quote(config.symbol),
    record: (snapshot, now) =>
      spreadObservations.record(snapshot, config.maxQuoteAgeMs, now),
  });
  let spreadSampling = false;
  const sampleSpread = async (): Promise<void> => {
    if (spreadSampling) return;
    spreadSampling = true;
    try {
      const inserted = await spreadSampler.sample();
      logger.log("info", {
        event_name: "spread_observation_sampled",
        outcome: inserted ? "success" : "duplicate",
      });
    } catch (error) {
      logger.log("warn", {
        event_name: "spread_observation_failed",
        outcome: "rejected",
        reason_code: stableFailureReason(error, "SPREAD_OBSERVATION_FAILED"),
      });
    } finally {
      spreadSampling = false;
    }
  };
  const spreadTimer = setInterval(() => void sampleSpread(), 60_000);
  spreadTimer.unref();
  const observabilityIntervalSeconds = integer(
    environment,
    "BETTERSTACK_OUTBOX_INTERVAL_SECONDS",
    5,
  );
  if (observabilityIntervalSeconds < 1) {
    throw new Error(
      "CONFIG_INTEGER_TOO_SMALL:BETTERSTACK_OUTBOX_INTERVAL_SECONDS",
    );
  }
  let observabilityTail = Promise.resolve();
  const scheduleObservabilityFlush = (): void => {
    if (observabilityOutbox === null) return;
    observabilityTail = observabilityTail.then(async () => {
      try {
        const result = await observabilityOutbox.flush();
        if (result.retried > 0) {
          logger.log("warn", {
            event_name: "better_stack_outbox_delivery_retried",
            outcome: "retrying",
            reason_code: "BETTER_STACK_DELIVERY_REJECTED",
            claimed: result.claimed,
            delivered: result.delivered,
            retried: result.retried,
          });
        }
      } catch {
        logger.log("error", {
          event_name: "better_stack_outbox_flush_failed",
          outcome: "failed",
          reason_code: "BETTER_STACK_OUTBOX_FLUSH_FAILED",
        });
      }
    });
  };
  const observabilityTimer = setInterval(
    scheduleObservabilityFlush,
    observabilityIntervalSeconds * 1_000,
  );
  observabilityTimer.unref();
  scheduleObservabilityFlush();
  const shutdown = async (): Promise<void> => {
    clearTimeout(alignmentTimer);
    if (timer !== null) clearInterval(timer);
    clearInterval(spreadTimer);
    clearInterval(observabilityTimer);
    await observabilityTail;
    metrics.stop();
    unsubscribeDemoExecutions?.();
    unsubscribeDemoSynchronization?.();
    await demoRecoveryRunner.settled();
    await demoExecutionRecorder?.flush();
    if (environment.SHUTDOWN_CANCEL_PENDING !== "false") {
      await maintenance.cancelAll("SERVICE_SHUTDOWN").catch(() => undefined);
    }
    await app.close();
    await brokerClient?.disconnect();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await app.listen({ host: config.host, port: config.port });
  logger.log("info", {
    event_name: "execution_service_started",
    outcome: "success",
    ...(config.emergencyStop
      ? { reason_code: "EMERGENCY_STOP_DEFAULT_ACTIVE" }
      : {}),
  });
  void tick();
  void sampleSpread();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
