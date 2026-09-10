import type { OcoEvaluation } from "../../apps/execution-service/src/oco-risk-evaluator.js";
import { transitionCharts } from "../../packages/database/src/chart-archive.js";
import { readChart } from "../../packages/database/src/chart-store.js";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPool,
  migrate,
  migrationFiles,
} from "../../packages/database/src/index.js";
import { DailyRiskStore } from "../../apps/execution-service/src/daily-risk-store.js";
import { ensureRuntimeIdentity } from "../../packages/database/src/registry.js";
import {
  loadExecutionConfig,
  strategyConfigHash,
} from "../../apps/execution-service/src/config.js";
import { CapitalRiskStore } from "../../apps/execution-service/src/capital-risk-store.js";
import { capitalAdmission } from "../../packages/risk-engine/src/capital.js";
import { PostgresContextStore } from "../../apps/execution-service/src/scenario-context.js";
import { PostgresAutomaticAnalysisSchedule } from "../../apps/execution-service/src/automatic-analysis-schedule.js";
import { PostgresAutomaticAnalysisCampaign } from "../../apps/execution-service/src/automatic-analysis-campaign.js";
import { PostgresAutomaticTradeCampaign } from "../../apps/execution-service/src/automatic-trade-campaign.js";
import { PostgresAutomaticAnalysisWatchdog } from "../../apps/execution-service/src/automatic-analysis-watchdog.js";
import { normalizeDemoExecution } from "../../apps/execution-service/src/demo-execution.js";
import { PostgresDemoExecutionStore } from "../../apps/execution-service/src/demo-execution-store.js";
import { PostgresPositionProtection } from "../../apps/execution-service/src/postgres-position-protection.js";
import { protectiveCloseAuthorized } from "../../apps/execution-service/src/protective-close-evidence.js";
import { PostgresObservabilityOutbox } from "../../apps/execution-service/src/observability-outbox.js";
import { OrderMaintenance } from "../../apps/execution-service/src/order-maintenance.js";
import { PostgresDecisionTrail } from "../../apps/execution-service/src/postgres-trail.js";
import { PostgresSpreadObservationStore } from "../../apps/execution-service/src/spread-observations.js";
import type {
  MarketSnapshot,
  ModelResponse,
  ReconciliationSnapshot,
} from "../../packages/contracts/src/index.js";
import type { BrokerExecution } from "../../packages/ctrader-client/src/client.js";
import { analysisChart } from "../helpers/analysis-chart.js";

const connectionString = process.env.TEST_DATABASE_URL;
const databaseTest =
  connectionString === undefined || connectionString === "" ? it.skip : it;

function ocoResponse(
  analysisId: string,
  validUntil = "2026-08-24T00:05:00.000Z",
): ModelResponse {
  const buyOrder = {
    trigger_price: "3",
    entry_price: "3",
    stop_loss: "2",
    take_profit: "5",
    risk_reward_ratio: "2",
    expires_at: validUntil,
    invalidation_price: "2",
  };
  const sellOrder = {
    trigger_price: "1",
    entry_price: "1",
    stop_loss: "2",
    take_profit: "0",
    risk_reward_ratio: "1",
    expires_at: validUntil,
    invalidation_price: "2",
  };
  return {
    schema_version: "2.1",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: "2026-08-24T00:00:00.000Z",
    valid_until: validUntil,
    market_regime: "UNCERTAIN",
    technical_map: {
      decision_zone: { lower: "1", upper: "2" },
      resistance_zones: [{ lower: "2", upper: "3" }],
      support_zones: [{ lower: "1", upper: "2" }],
      bullish_confirmation: {
        price: "3",
        condition_code: "BUFFERED_BREAKOUT_ABOVE_RESISTANCE",
      },
      bearish_confirmation: {
        price: "1",
        condition_code: "BUFFERED_BREAKDOWN_BELOW_SUPPORT",
      },
      upside_targets: ["4"],
      downside_targets: ["0"],
    },
    waiting_area: {
      lower: "1",
      upper: "2",
      description_code: "IMMEDIATE_DECISION_ZONE",
    },
    buy_stop: buyOrder,
    sell_stop: sellOrder,
    confidence: {
      overall: 0,
      buy: 0,
      sell: 0,
      original_overall: 0,
      original_buy: 0,
      original_sell: 0,
    },
    setup_tags: [],
    evidence_codes: [],
    risk_flags: ["INSUFFICIENT_EVIDENCE"],
    performance_adjustment: {
      applied: false,
      confidence_delta: 0,
      reason_codes: [],
    },
    data_quality: { warnings: [] },
  };
}

const promptContent = "Return a mandatory OCO proposal.";
const promptArtifact = {
  version: "system-v2" as const,
  content: promptContent,
  sha256: createHash("sha256").update(promptContent).digest("hex"),
};

function decisionSnapshot(
  timestamp: string,
  bid = "4649.12",
  ask = "4649.21",
): MarketSnapshot {
  return {
    serverTime: timestamp,
    capturedAt: timestamp,
    observedSkewMs: 0,
    metadata: {
      symbolId: "integration-symbol",
      symbolName: "XAUUSD",
      digits: 2,
      pipPosition: 2,
      pipSize: "0.01",
      tickSize: "0.01",
      tickValue: "0.01",
      baseAsset: "XAU",
      quoteAsset: "USD",
      accountAsset: "USD",
      quoteToAccountConversionRate: "1",
      contractSize: "100",
      volumeScale: "0.01",
      minVolume: "100",
      maxVolume: "100000",
      volumeStep: "100",
      minStopDistance: "0.1",
      commission: {
        type: "USD_PER_MILLION_USD",
        rate: "30",
        minimum: "0",
        minimumType: "QUOTE_CURRENCY",
        minimumAsset: "USD",
        pnlConversionFeeRate: "0",
      },
      metadataTime: timestamp,
    },
    quote: { bid, ask, sourceTime: timestamp, receivedAt: timestamp },
    candles: ["M1", "M5", "M15"].map((timeframe) => ({
      timeframe: timeframe as "M1" | "M5" | "M15",
      candles: [],
    })),
    orderBook: {
      sourceTime: timestamp,
      receivedAt: timestamp,
      bids: [{ price: bid, size: "10" }],
      asks: [{ price: ask, size: "12" }],
      complete: true,
      discontinuity: false,
      reconnectSequence: 0,
      aggregates: [
        {
          windowMs: 60_000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
        {
          windowMs: 300_000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
        {
          windowMs: 900_000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
      ],
    },
  };
}

describe("PostgreSQL migrations integration", () => {
  databaseTest.each([false, true])("migrations close=%s", async (closeMode) => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const admin = createPool({ connectionString: connectionString as string });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(connectionString as string);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    const isolated = createPool({
      connectionString: url.toString(),
      sslMode: "require",
    });
    try {
      expect(await migrate(isolated, path.resolve("migrations"))).toEqual([
        "0001",
        "0002",
        "0003",
        "0004",
        "0005",
        "0006",
        "0007",
        "0008",
        "0009",
        "0010",
        "0011",
        "0012",
        "0013",
        "0014",
        "0015",
        "0016",
        "0017",
        "0018",
        "0019",
        "0020",
        "0021",
        "0022",
        "0023",
      ]);
      const stoppedConfig = loadExecutionConfig({});
      const registryInput = {
        accountKey: "fixed-risk-identity-fixture",
        provider: "paper" as const,
        environment: "paper" as const,
        accountType: "paper" as const,
        currency: "USD",
        metadata: decisionSnapshot("2026-09-07T00:00:00Z").metadata,
        strategyVersion: "fixed-risk-identity-test",
        codeHash: "fixed-risk-code",
        configHash: strategyConfigHash(stoppedConfig),
        promptVersion: "scenario-execution-v1",
        schemaVersion: "2.1",
        featureVersion: "1.1",
      };
      const stoppedIdentity = await ensureRuntimeIdentity(
        isolated,
        registryInput,
      );
      expect(
        await ensureRuntimeIdentity(isolated, {
          ...registryInput,
          configHash: strategyConfigHash({
            ...stoppedConfig,
            automaticAnalysisEnabled: true,
          }),
        }),
      ).toEqual(stoppedIdentity);
      await expect(
        ensureRuntimeIdentity(isolated, {
          ...registryInput,
          configHash: strategyConfigHash({
            ...stoppedConfig,
            maxPositionNotional: "1000",
          }),
        }),
      ).rejects.toThrow("STRATEGY_VERSION_IMMUTABILITY_VIOLATION");
      const column = await isolated.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'symbols' AND column_name = 'volume_scale'
         ) AS exists`,
        [schema],
      );
      expect(column.rows[0]?.exists).toBe(true);
      const netFlows = await isolated.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'daily_risk_state'
             AND column_name = 'net_flows'
         ) AS exists`,
        [schema],
      );
      expect(netFlows.rows[0]?.exists).toBe(true);
      const promptColumn = await isolated.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'model_requests'
             AND column_name = 'system_prompt_sha256'
         ) AS exists`,
        [schema],
      );
      expect(promptColumn.rows[0]?.exists).toBe(true);
      const automaticIntervals = await isolated.query<{ exists: boolean }>(
        `SELECT to_regclass('automatic_analysis_intervals') IS NOT NULL AS exists`,
      );
      expect(automaticIntervals.rows[0]?.exists).toBe(true);
      const tradeOutcomeIndex = await isolated.query<{
        position_unique: boolean;
        group_constraint_removed: boolean;
      }>(
        `SELECT to_regclass('unique_trade_position_id') IS NOT NULL
                  AS position_unique,
                NOT EXISTS (
                  SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'trades'::regclass
                    AND conname = 'trades_order_group_id_key'
                ) AS group_constraint_removed`,
      );
      expect(tradeOutcomeIndex.rows[0]).toEqual({
        position_unique: true,
        group_constraint_removed: true,
      });
      await isolated.query(
        `INSERT INTO accounts
          (id, provider, provider_account_key_hash, environment, account_type, currency)
         VALUES ($1, 'paper', $2, 'paper', 'paper', 'USD')`,
        [randomUUID(), "a".repeat(64)],
      );
      const demoAccountId = randomUUID();
      await isolated.query(
        `INSERT INTO accounts
          (id, provider, provider_account_key_hash, environment, account_type, currency)
         VALUES ($1, 'ctrader', $2, 'demo', 'demo', 'USD')`,
        [demoAccountId, "b".repeat(64)],
      );
      const risk = new DailyRiskStore(isolated);
      const baselineInput = {
        accountId: demoAccountId,
        account: {
          reconciledAt: "2026-08-24T01:00:00.000Z",
          certain: true,
          equity: "10005",
          balance: "10005",
          availableMargin: "10005",
          relevantPositionCount: 0,
          relevantPendingOrderCount: 0,
          hasPartialFill: false,
          hasCancellationPending: false,
          reasonCodes: [],
        },
        timezone: "UTC",
        netFlows: "5",
        brokerDealCount: 0,
        brokerPositionCount: 0,
        brokerOrderCount: 0,
        externalFlowOperationCount: 1,
        actor: "integration-test",
        reason: "verify reconciled one-time initialization",
        instanceId: "test-instance",
        environment: "test",
        tradingMode: "demo" as const,
        accountKey: "test-demo-pseudonym",
        symbol: "XAUUSD",
        now: new Date("2026-08-24T01:00:00.000Z"),
      };
      await expect(
        risk.initializeReconciledBaseline(baselineInput),
      ).resolves.toEqual({
        tradingDay: "2026-08-24",
        timezone: "UTC",
      });
      const persisted = await isolated.query<{ baseline_equity: string }>(
        `SELECT baseline_equity::text FROM daily_risk_state
         WHERE account_id = $1`,
        [demoAccountId],
      );
      expect(persisted.rows[0]?.baseline_equity).toBe("10000.0000000000");
      const dailyInput = {
        accountId: demoAccountId,
        account: baselineInput.account,
        timezone: "UTC",
        thresholdPercent: "5",
        includeUnrealized: true,
        netFlows: "5",
        allowBaselineBootstrap: false,
        baselineCaptureGraceSeconds: 300,
        now: baselineInput.now,
      };
      expect(await risk.reconcile(dailyInput)).toMatchObject({
        lockedOut: false,
        remainingLossBudget: "500",
      });
      expect(
        await risk.reconcile({
          ...dailyInput,
          account: { ...baselineInput.account, equity: "9505" },
        }),
      ).toMatchObject({
        lockedOut: true,
        remainingLossBudget: "0",
        lossPercent: "5",
      });
      expect(
        await new DailyRiskStore(isolated).reconcile(dailyInput),
      ).toMatchObject({
        lockedOut: true,
        remainingLossBudget: "0",
      });
      expect(
        await new DailyRiskStore(isolated).reconcile({
          ...dailyInput,
          now: new Date("2026-08-25T00:00:01Z"),
          account: {
            ...baselineInput.account,
            reconciledAt: "2026-08-25T00:00:01Z",
          },
        }),
      ).toMatchObject({ lockedOut: false, remainingLossBudget: "500" });
      const capitalStore = new CapitalRiskStore(isolated);
      const capitalInput = {
        accountId: demoAccountId,
        account: baselineInput.account,
        netFlowsSinceReference: "0",
        dailyLossPercent: "0",
        now: baselineInput.now,
      };
      expect((await capitalStore.reconcile(capitalInput)).riskMultiplier).toBe(
        "1",
      );
      await expect(
        capitalStore.reconcile({
          ...capitalInput,
          account: {
            ...baselineInput.account,
            reconciledAt: new Date(
              Date.parse(baselineInput.account.reconciledAt) - 100,
            ).toISOString(),
          },
        }),
      ).rejects.toThrow("CAPITAL_OBSERVATION_REGRESSED");
      expect(
        (
          await capitalStore.reconcile({
            ...capitalInput,
            account: { ...baselineInput.account, equity: "12005" },
            netFlowsSinceReference: "2000",
          })
        ).drawdownPercent,
      ).toBe("0");
      expect(
        (
          await capitalStore.reconcile({
            ...capitalInput,
            account: { ...baselineInput.account, equity: "9504.75" },
          })
        ).lockedOut,
      ).toBe(true);
      expect(
        (await new CapitalRiskStore(isolated).reconcile(capitalInput))
          .lockedOut,
      ).toBe(true);
      await expect(
        capitalStore.reconcile({
          ...capitalInput,
          now: new Date(baselineInput.now.getTime() + 11000),
        }),
      ).rejects.toThrow("CAPITAL_ACCOUNT_STALE_OR_UNCERTAIN");
      await expect(
        risk.initializeReconciledBaseline(baselineInput),
      ).rejects.toThrow("DAILY_RISK_BASELINE_ALREADY_EXISTS");

      // A restarted demo applies its new admission policy to real, still-locked
      // accounting. No row reset, baseline replacement or synthetic risk state.
      const demoDaily = await new DailyRiskStore(isolated).reconcile(
        dailyInput,
      );
      const demoCapital = await new CapitalRiskStore(isolated).reconcile(
        capitalInput,
      );
      expect(demoDaily.lockedOut).toBe(true);
      expect(demoCapital.lockedOut).toBe(true);
      const admissionInput = {
        equity: baselineInput.account.equity,
        daily: demoDaily,
        capital: demoCapital,
      };
      expect(capitalAdmission({ ...admissionInput, mode: "demo" })).toEqual({
        lockedOut: false,
        riskMultiplier: "1",
        riskPercentCap: "1",
      });
      expect(
        capitalAdmission({ ...admissionInput, mode: "live" }).lockedOut,
      ).toBe(true);
      const retained = await isolated.query<{
        daily: boolean;
        capital: boolean;
        baseline: string;
      }>(
        `SELECT d.locked_out AS daily, c.locked_out AS capital, d.baseline_equity::text AS baseline
         FROM daily_risk_state d JOIN capital_risk_state c USING (account_id)
         WHERE d.account_id=$1 AND d.trading_day='2026-08-24'`,
        [demoAccountId],
      );
      expect(retained.rows).toEqual([
        { daily: true, capital: true, baseline: "10000.0000000000" },
      ]);

      const symbolId = randomUUID();
      const strategyVersionId = randomUUID();
      const analysisId = randomUUID();
      const orderGroupId = randomUUID();
      await isolated.query(
        `INSERT INTO symbols
          (id, account_id, provider_symbol_id, name, digits, tick_size, tick_value,
           contract_size, min_volume, max_volume, volume_step, min_stop_distance,
           metadata_revision, metadata_at, volume_scale)
         VALUES ($1, $2, '7', 'XAUUSD', 2, 0.01, 0.01, 100, 1, 100000,
                 1, 0, 'integration', now(), 0.01)`,
        [symbolId, demoAccountId],
      );
      const spreadQuote = {
        serverTime: "2026-08-24T00:00:00.950Z",
        metadata: { symbolId: "7", symbolName: "XAUUSD" },
        quote: {
          bid: "4649.12",
          ask: "4649.21",
          sourceTime: "2026-08-24T00:00:00.900Z",
          receivedAt: "2026-08-24T00:00:00.980Z",
        },
      };
      const spreadNow = new Date("2026-08-24T00:00:01.000Z");
      const spreadStore = new PostgresSpreadObservationStore({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
      });
      await expect(
        spreadStore.record(spreadQuote, 3_000, spreadNow),
      ).resolves.toBe(true);
      const restartedSpreadStore = new PostgresSpreadObservationStore({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
      });
      await expect(
        restartedSpreadStore.record(spreadQuote, 3_000, spreadNow),
      ).resolves.toBe(false);
      const spreadRows = await isolated.query<{
        count: string;
        bid: string;
        ask: string;
        spread: string;
      }>(
        `SELECT count(*)::text AS count, min(bid)::text AS bid,
                min(ask)::text AS ask, min(spread)::text AS spread
         FROM spread_observations
         WHERE account_id = $1 AND symbol_id = $2`,
        [demoAccountId, symbolId],
      );
      expect(spreadRows.rows[0]).toEqual({
        count: "1",
        bid: "4649.1200000000",
        ask: "4649.2100000000",
        spread: "0.0900000000",
      });
      await expect(
        isolated.query(
          `INSERT INTO spread_observations
            (id, account_id, symbol_id, source_minute, source_time, received_at,
             server_time, bid, ask, spread, created_at)
           VALUES ($1, $2, $3, 29792161, '2026-08-24T00:01:00.900Z',
                   '2026-08-24T00:01:00.980Z', '2026-08-24T00:01:00.950Z',
                   4649.22, 4649.21, 0, '2026-08-24T00:01:01.000Z')`,
          [randomUUID(), demoAccountId, symbolId],
        ),
      ).rejects.toThrow();
      await isolated.query(
        `INSERT INTO strategy_versions
          (id, version, code_hash, config_hash, prompt_version, schema_version, feature_version)
         VALUES ($1, $2, $3, $4, 'system-v2', '2.0', '1.0')`,
        [
          strategyVersionId,
          `integration-${strategyVersionId}`,
          "c".repeat(64),
          "d".repeat(64),
        ],
      );
      await isolated.query(
        `INSERT INTO analysis_runs
          (id, account_id, symbol_id, strategy_version_id, mode, state, analysis_time, valid_until)
         VALUES ($1, $2, $3, $4, 'demo', 'ACCEPTED', now(), now() + interval '1 hour')`,
        [analysisId, demoAccountId, symbolId, strategyVersionId],
      );
      const automaticSchedule = new PostgresAutomaticAnalysisSchedule({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
      });
      const automaticInterval = "2026-08-24T00:00:00.000Z";
      await expect(
        automaticSchedule.claim({
          intervalStart: automaticInterval,
          brokerServerTime: "2026-08-24T00:00:03.000Z",
        }),
      ).resolves.toBe(true);
      const restartedAutomaticSchedule = new PostgresAutomaticAnalysisSchedule({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
      });
      await expect(
        restartedAutomaticSchedule.claim({
          intervalStart: automaticInterval,
          brokerServerTime: "2026-08-24T00:00:04.000Z",
        }),
      ).resolves.toBe(false);
      await restartedAutomaticSchedule.complete(automaticInterval, {
        analysisId,
        outcome: "REJECTED",
        reasonCodes: ["TEST_REJECTION"],
        placement: null,
      });
      const completedInterval = await isolated.query<{
        cycle_id: string;
        analysis_id: string;
        outcome: string;
      }>(
        `SELECT cycle_id, analysis_id, outcome
         FROM automatic_analysis_intervals
         WHERE account_id = $1 AND symbol_id = $2 AND interval_start = $3`,
        [demoAccountId, symbolId, automaticInterval],
      );
      expect(completedInterval.rows[0]).toEqual({
        cycle_id: analysisId,
        analysis_id: analysisId,
        outcome: "REJECTED",
      });
      await isolated.query(
        `UPDATE automatic_analysis_intervals
         SET claimed_at = '2026-08-24T00:00:03.000Z',
             completed_at = '2026-08-24T00:00:30.000Z'
         WHERE account_id = $1 AND symbol_id = $2 AND interval_start = $3`,
        [demoAccountId, symbolId, automaticInterval],
      );
      await isolated.query(
        `INSERT INTO spread_observations
          (id, account_id, symbol_id, source_minute, source_time, received_at,
           server_time, bid, ask, spread, created_at)
         VALUES ($1, $2, $3, 29792170, '2026-08-24T00:10:00.900Z',
                 '2026-08-24T00:10:00.980Z', '2026-08-24T00:10:00.950Z',
                 4649.12, 4649.21, 0.09, '2026-08-24T00:10:01.000Z')`,
        [randomUUID(), demoAccountId, symbolId],
      );
      const watchdog = new PostgresAutomaticAnalysisWatchdog({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
        strategyVersionId,
        strategyVersion: `integration-${strategyVersionId}`,
        symbol: "XAUUSD",
        accountKey: "integration-demo-account",
        instanceId: "integration-instance",
        environment: "test",
        mode: "demo",
        serviceStartedAt: new Date("2026-08-23T23:50:00.000Z"),
        stallAfterMs: 180_000,
      });
      await expect(
        watchdog.observe({
          automaticAnalysisEnabled: true,
          paused: false,
          managedSetupActive: false,
          now: new Date("2026-08-24T00:10:30.000Z"),
        }),
      ).resolves.toMatchObject({
        state: "STALLED",
        reasonCodes: ["AUTOMATIC_ANALYSIS_STALLED"],
      });
      await expect(
        watchdog.observe({
          automaticAnalysisEnabled: true,
          paused: true,
          managedSetupActive: false,
          now: new Date("2026-08-24T00:10:30.500Z"),
        }),
      ).resolves.toMatchObject({ state: "PAUSED", reasonCodes: [] });
      await expect(
        watchdog.observe({
          automaticAnalysisEnabled: true,
          paused: false,
          managedSetupActive: true,
          now: new Date("2026-08-24T00:10:31.000Z"),
        }),
      ).resolves.toMatchObject({ state: "MANAGING_SETUP", reasonCodes: [] });
      const watchdogAudit = await isolated.query<{
        event_name: string;
        outbox_status: string;
      }>(
        `SELECT ae.event_name, oo.status AS outbox_status
         FROM audit_events ae
         JOIN observability_outbox oo ON oo.audit_event_id = ae.id
         WHERE ae.event_name IN
           ('automatic_analysis_stalled', 'automatic_analysis_resumed')
         ORDER BY ae.occurred_at`,
      );
      expect(watchdogAudit.rows).toEqual([
        {
          event_name: "automatic_analysis_stalled",
          outbox_status: "PENDING",
        },
        {
          event_name: "automatic_analysis_resumed",
          outbox_status: "PENDING",
        },
      ]);
      const preflightInterval = "2026-08-24T00:01:00.000Z";
      await expect(
        automaticSchedule.claim({
          intervalStart: preflightInterval,
          brokerServerTime: "2026-08-24T00:01:02.000Z",
        }),
      ).resolves.toBe(true);
      const unpersistedCycleId = randomUUID();
      await automaticSchedule.complete(preflightInterval, {
        analysisId: unpersistedCycleId,
        outcome: "REJECTED",
        reasonCodes: ["PREVIOUS_ANALYSIS_ACTIVE"],
        placement: null,
      });
      const preflightCompletion = await isolated.query<{
        cycle_id: string;
        analysis_id: string | null;
        outcome: string;
      }>(
        `SELECT cycle_id, analysis_id, outcome
         FROM automatic_analysis_intervals
         WHERE account_id = $1 AND symbol_id = $2 AND interval_start = $3`,
        [demoAccountId, symbolId, preflightInterval],
      );
      expect(preflightCompletion.rows[0]).toEqual({
        cycle_id: unpersistedCycleId,
        analysis_id: null,
        outcome: "REJECTED",
      });
      await expect(
        automaticSchedule.complete(preflightInterval, {
          analysisId: unpersistedCycleId,
          outcome: "REJECTED",
          reasonCodes: [],
          placement: null,
        }),
      ).rejects.toThrow("AUTOMATIC_ANALYSIS_INTERVAL_COMPLETION_MISSING");
      const trail = new PostgresDecisionTrail({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
        strategyVersionId,
        mode: "demo",
        apiStyle: "responses",
        model: "integration-model",
        promptVersion: "system-v2",
        schemaVersion: "2.1",
        payloadMode: "compact",
        instanceId: "integration-instance",
        environment: "test",
        persistedCandleTails: { M1: 1, M5: 1, M15: 1 },
      });
      const contextStore = new PostgresContextStore(isolated, {
        accountId: demoAccountId,
        symbolId,
        mode: "demo",
      });
      const contextClaim = {
        id: randomUUID(),
        sourceAnalysisId: analysisId,
        capturedAt: new Date().toISOString(),
        tickSize: "0.01",
        providerEvidence: {
          requestText: '{"candles":[]}',
          promptContent: "fixture exact provider prompt",
          promptVersion: "entry-pair-v1",
        },
      };
      await expect(
        contextStore.claim({
          ...contextClaim,
          id: randomUUID(),
          providerEvidence: {
            ...contextClaim.providerEvidence,
            promptContent: "",
          },
        }),
      ).rejects.toThrow();
      expect(await contextStore.latest()).toBeNull();
      const claims = await Promise.all([
        contextStore.claim(contextClaim),
        new PostgresContextStore(isolated, {
          mode: "demo",
          symbolId,
          accountId: demoAccountId,
        }).claim({ ...contextClaim, id: randomUUID() }),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const currentContext = await contextStore.latest();
      expect(currentContext?.state).toBe("REQUESTING");
      expect(currentContext?.requestedModel).toBe("deepseek-v4-pro/u5W");
      const evidence = await isolated.query(
        `SELECT e.request_text,e.response_text,p.content
        FROM context_provider_evidence e JOIN provider_prompt_artifacts p ON p.content_sha256=e.prompt_sha256
        WHERE e.context_id=$1`,
        [currentContext!.id],
      );
      expect(evidence.rows).toEqual([
        {
          request_text: '{"candles":[]}',
          response_text: null,
          content: "fixture exact provider prompt",
        },
      ]);
      await expect(
        isolated.query(
          "UPDATE scenario_contexts SET requested_model='unapproved-model' WHERE id=$1",
          [currentContext!.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await isolated.query(
        "UPDATE scenario_contexts SET requested_model='gpt-5.6-sol/u40' WHERE id=$1",
        [currentContext!.id],
      );
      expect((await contextStore.latest())?.requestedModel).toBe(
        "gpt-5.6-sol/u40",
      );
      await isolated.query(
        "UPDATE scenario_contexts SET requested_model='gpt-6-astra/u64' WHERE id=$1",
        [currentContext!.id],
      );
      await contextStore.finish(
        currentContext!.id,
        null,
        "AI_PROVIDER_TIMEOUT",
        undefined,
        '{"buy_stop":"invalid"}',
      );
      expect((await contextStore.latest())?.state).toBe("FAILED");
      expect(
        (
          await isolated.query<{ response_text: string | null }>(
            "SELECT response_text FROM context_provider_evidence WHERE context_id=$1",
            [currentContext!.id],
          )
        ).rows[0]!.response_text,
      ).toBe('{"buy_stop":"invalid"}');
      await expect(
        contextStore.finish(
          currentContext!.id,
          null,
          "AI_OTHER",
          undefined,
          "overwrite",
        ),
      ).rejects.toThrow("SCENARIO_COMPLETION_MISSING");
      expect(
        (
          await isolated.query<{ response_text: string | null }>(
            "SELECT response_text FROM context_provider_evidence WHERE context_id=$1",
            [currentContext!.id],
          )
        ).rows[0]!.response_text,
      ).toBe('{"buy_stop":"invalid"}');
      expect(
        await new PostgresContextStore(isolated, {
          accountId: demoAccountId,
          symbolId,
          mode: "demo",
        }).claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(false);
      // Separate scope: local circuit failures cannot spend a fresh five-minute
      // dispatch budget, but every local retry still has a durable one-minute floor.
      const recoveryScope = {
        accountId: demoAccountId,
        symbolId,
        mode: "shadow",
      };
      const recoveryStore = new PostgresContextStore(isolated, recoveryScope);
      const recoveryId = randomUUID();
      expect(
        await recoveryStore.claim({ ...contextClaim, id: recoveryId }),
      ).toBe(true);
      await recoveryStore.finish(recoveryId, null, "AI_CIRCUIT_OPEN");
      expect(
        await recoveryStore.claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(false);
      await isolated.query(
        "UPDATE scenario_contexts SET requested_at=clock_timestamp()-interval '61 seconds' WHERE id=$1",
        [recoveryId],
      );
      const recoveryClaims = await Promise.all([
        recoveryStore.claim({ ...contextClaim, id: randomUUID() }),
        new PostgresContextStore(isolated, recoveryScope).claim({
          ...contextClaim,
          id: randomUUID(),
        }),
      ]);
      expect(recoveryClaims.filter(Boolean)).toHaveLength(1);
      const recoveryCurrent = (await recoveryStore.latest())!;
      await recoveryStore.finish(
        recoveryCurrent.id,
        null,
        "AI_PROVIDER_TIMEOUT",
      );
      await isolated.query(
        "UPDATE scenario_contexts SET requested_at=clock_timestamp()-interval '61 seconds' WHERE id=$1",
        [recoveryCurrent.id],
      );
      expect(
        await new PostgresContextStore(isolated, recoveryScope).claim({
          ...contextClaim,
          id: randomUUID(),
        }),
      ).toBe(false);
      // A later local rejection cannot conceal an earlier potentially paid request.
      await isolated.query(
        `INSERT INTO scenario_contexts
        (id,account_id,symbol_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,source_analysis_id,reason)
        SELECT $1,account_id,symbol_id,mode,clock_timestamp()-interval '60 seconds',captured_at,valid_until,'FAILED',requested_model,tick_size,source_analysis_id,'AI_CIRCUIT_OPEN'
        FROM scenario_contexts WHERE id=$2`,
        [randomUUID(), recoveryId],
      );
      expect(
        await recoveryStore.claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(false);
      await isolated.query(
        "UPDATE scenario_contexts SET requested_at=clock_timestamp()-interval '301 seconds' WHERE id=$1",
        [recoveryCurrent.id],
      );
      expect(
        await recoveryStore.claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(true);
      const scenarioSchedule = new PostgresAutomaticAnalysisSchedule({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
        scenarioCadence: true,
      });
      const slot = "2026-08-24T00:00:25.000Z";
      expect(
        await scenarioSchedule.claim({
          intervalStart: slot,
          brokerServerTime: "2026-08-24T00:00:26.000Z",
        }),
      ).toBe(true);
      await scenarioSchedule.complete(slot, {
        analysisId,
        outcome: "DEFERRED",
        reasonCodes: ["SCENARIO_REFRESH_STARTED"],
        placement: null,
      });
      expect(
        await scenarioSchedule.claim({
          intervalStart: slot,
          brokerServerTime: "2026-08-24T00:00:27.000Z",
        }),
      ).toBe(false);
      const analysisCampaign = new PostgresAutomaticAnalysisCampaign({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
        strategyVersionId,
        mode: "demo",
        configuredLimit: 1,
      });
      await expect(analysisCampaign.progress()).resolves.toMatchObject({
        completed: 0,
        remaining: 1,
        complete: false,
        allowed: true,
      });
      await trail.market(
        analysisId,
        decisionSnapshot("2026-08-24T00:00:00.000Z"),
      );
      const chart = analysisChart();
      await trail.analytics(analysisId, {
        schemaVersion: "1.1",
        requestId: randomUUID(),
        analysisId,
        generatedAt: "2026-08-24T00:00:01.000Z",
        acceptable: true,
        rejectionReasons: [],
        features: {
          timeframes: {
            M1: { atr: "1", ema_fast: "2", ema_slow: "3" },
            M5: {},
            M15: {},
          },
        },
        chart,
      });
      const persistedChart = await isolated.query<{
        image_sha256: string;
        byte_count: number | null;
        storage_kind: string;
        completed_only: boolean;
      }>(
        `SELECT image_sha256, octet_length(image_bytes) AS byte_count, storage_kind,
                (source_metadata->>'completed_candles_only')::boolean AS completed_only
         FROM analysis_chart_artifacts WHERE analysis_id = $1`,
        [analysisId],
      );
      expect(persistedChart.rows[0]).toEqual({
        image_sha256: chart.sha256,
        byte_count: null,
        storage_kind: "local_sha256",
        completed_only: true,
      });
      expect(await readChart(chart.sha256)).toEqual(
        Buffer.from(chart.dataBase64, "base64"),
      );
      await expect(
        isolated.query(
          "UPDATE analysis_chart_artifacts SET storage_kind = 'database' WHERE analysis_id = $1",
          [analysisId],
        ),
      ).rejects.toThrow();
      const chartId = (
        await isolated.query<{ id: string }>(
          "SELECT id::text FROM analysis_chart_artifacts WHERE analysis_id = $1",
          [analysisId],
        )
      ).rows[0]!.id;
      const manifest = [
        {
          id: chartId,
          digest: chart.sha256,
          bytes: Buffer.from(chart.dataBase64, "base64").length,
        },
      ];
      expect(await transitionCharts(isolated, manifest, "restore")).toBe(1);
      expect(await transitionCharts(isolated, manifest, "restore")).toBe(0);
      await expect(
        transitionCharts(isolated, [{ ...manifest[0]!, bytes: 1 }], "relocate"),
      ).rejects.toThrow("CHART_ARCHIVE_SIZE_MISMATCH");
      expect(
        (
          await isolated.query<{ image_bytes: Buffer }>(
            "SELECT image_bytes FROM analysis_chart_artifacts WHERE id = $1",
            [chartId],
          )
        ).rows[0]!.image_bytes,
      ).toEqual(Buffer.from(chart.dataBase64, "base64"));
      expect(await transitionCharts(isolated, manifest, "relocate")).toBe(1);
      expect(await transitionCharts(isolated, manifest, "relocate")).toBe(0);
      const initialMarketIds = await isolated.query<{
        candle_snapshot_id: string;
        order_book_snapshot_id: string;
      }>(
        `SELECT candle_snapshot_id, order_book_snapshot_id
         FROM analysis_runs WHERE id = $1`,
        [analysisId],
      );
      await trail.decisionMarket(
        analysisId,
        decisionSnapshot("2026-08-24T00:00:10.000Z", "4649.14", "4649.22"),
      );
      await trail.decisionMarket(
        analysisId,
        decisionSnapshot("2026-08-24T00:00:11.000Z", "4649.15", "4649.23"),
        "PRE_PLACEMENT",
      );
      const refreshedMarket = await isolated.query<{
        candle_snapshot_id: string;
        order_book_snapshot_id: string;
        source_time: Date;
        order_book_count: string;
        refresh_audit_count: string;
        post_model_refresh_count: string;
        pre_placement_refresh_count: string;
      }>(
        `SELECT ar.candle_snapshot_id, ar.order_book_snapshot_id,
                obs.source_time,
                (SELECT count(*)::text FROM order_book_snapshots
                 WHERE candle_snapshot_id = ar.candle_snapshot_id) AS order_book_count,
                (SELECT count(*)::text FROM audit_events
                 WHERE analysis_id = ar.id
                   AND event_name = 'decision_market_refreshed') AS refresh_audit_count,
                (SELECT count(*)::text FROM audit_events
                 WHERE analysis_id = ar.id
                   AND event_name = 'decision_market_refreshed'
                   AND details->>'refresh_phase' = 'POST_MODEL') AS post_model_refresh_count,
                (SELECT count(*)::text FROM audit_events
                 WHERE analysis_id = ar.id
                   AND event_name = 'decision_market_refreshed'
                   AND details->>'refresh_phase' = 'PRE_PLACEMENT') AS pre_placement_refresh_count
         FROM analysis_runs ar
         JOIN order_book_snapshots obs ON obs.id = ar.order_book_snapshot_id
         WHERE ar.id = $1`,
        [analysisId],
      );
      expect(refreshedMarket.rows[0]).toMatchObject({
        candle_snapshot_id: initialMarketIds.rows[0]?.candle_snapshot_id,
        source_time: new Date("2026-08-24T00:00:11.000Z"),
        order_book_count: "3",
        refresh_audit_count: "2",
        post_model_refresh_count: "1",
        pre_placement_refresh_count: "1",
      });
      expect(refreshedMarket.rows[0]?.order_book_snapshot_id).not.toBe(
        initialMarketIds.rows[0]?.order_book_snapshot_id,
      );
      await expect(
        trail.model(
          analysisId,
          { schema_version: "2.0", authorization: "must-be-redacted" },
          ocoResponse(analysisId),
          '{"status":"completed"}',
          promptArtifact,
          {
            latencyMs: 1234,
            retryCount: 1,
            telemetry: {
              requestedModel: "integration-model",
              returnedModel: "integration-model",
              inputProfile: "structured",
              requestBytes: 100,
              responseBytes: 200,
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              costAmount: null,
              costCurrency: null,
              costSource: "unavailable",
            },
          },
        ),
      ).resolves.toBeUndefined();
      expect(
        (
          await isolated.query<{ telemetry: unknown }>(
            "SELECT telemetry FROM model_call_telemetry",
          )
        ).rows[0]?.telemetry,
      ).toMatchObject({
        requestedModel: "integration-model",
        costAmount: null,
      });
      await expect(
        trail.modelFailure(analysisId, "private URL must never persist", 20),
      ).rejects.toThrow("MODEL_FAILURE_DIAGNOSTIC_INVALID");
      await trail.modelFailure(analysisId, "AI_HTTP_ERROR:403", 20, {
        requestedModel: "integration-model",
        returnedModel: "integration-model",
        inputProfile: "structured",
        requestBytes: 100,
        responseBytes: 200,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costAmount: null,
        costCurrency: null,
        costSource: "unavailable",
      });
      expect(
        (
          await isolated.query<{ telemetry: { inputTokens: number } }>(
            "SELECT telemetry FROM provider_failures WHERE analysis_id=$1",
            [analysisId],
          )
        ).rows[0]?.telemetry.inputTokens,
      ).toBe(10);
      await trail.modelFailure(analysisId, "AI_HTTP_ERROR:403", 21);
      expect(
        (
          await isolated.query(
            "SELECT reason,duration_ms FROM provider_failures WHERE analysis_id=$1",
            [analysisId],
          )
        ).rows,
      ).toEqual([{ reason: "AI_HTTP_ERROR:403", duration_ms: 20 }]);
      const modelTrail = await isolated.query<{
        id_matches_request_id: boolean;
        requests: string;
        responses: string;
        valid_until: Date | null;
        authorization: string;
        system_prompt: string;
        system_prompt_sha256: string;
        attempt_count: number;
        duration_ms: number;
      }>(
        `SELECT mr.id::text = mr.request_id AS id_matches_request_id,
                (SELECT count(*)::text FROM model_requests WHERE analysis_id = $1) AS requests,
                (SELECT count(*)::text FROM model_responses mres
                 JOIN model_requests mreq ON mreq.id = mres.model_request_id
                 WHERE mreq.analysis_id = $1) AS responses,
                ar.valid_until,
                mr.payload_redacted ->> 'authorization' AS authorization,
                mr.system_prompt, mr.system_prompt_sha256,
                mr.attempt_count, mr.duration_ms
         FROM analysis_runs ar
         JOIN model_requests mr ON mr.analysis_id = ar.id
         WHERE ar.id = $1`,
        [analysisId],
      );
      expect(modelTrail.rows[0]).toEqual({
        id_matches_request_id: true,
        requests: "1",
        responses: "1",
        valid_until: new Date("2026-08-24T00:05:00.000Z"),
        authorization: "[REDACTED]",
        system_prompt: promptContent,
        system_prompt_sha256: promptArtifact.sha256,
        attempt_count: 2,
        duration_ms: 1234,
      });
      await expect(
        new PostgresAutomaticAnalysisCampaign({
          pool: isolated,
          accountId: demoAccountId,
          symbolId,
          strategyVersionId,
          mode: "demo",
          configuredLimit: 1,
        }).progress(),
      ).resolves.toMatchObject({
        completed: 1,
        remaining: 0,
        complete: true,
        allowed: false,
        reasonCodes: ["AUTOMATIC_ANALYSIS_CAMPAIGN_COMPLETE"],
      });
      await expect(
        trail.model(
          analysisId,
          { schema_version: "2.0" },
          ocoResponse(analysisId),
          "{}",
          promptArtifact,
          { latencyMs: -1, retryCount: 0 },
        ),
      ).rejects.toThrow("MODEL_TIMING_INVALID");
      await expect(
        trail.model(
          analysisId,
          { schema_version: "2.0" },
          ocoResponse(analysisId, "not-a-timestamp"),
          "{}",
          promptArtifact,
        ),
      ).rejects.toThrow();
      const rolledBackModelTrail = await isolated.query<{
        requests: string;
        responses: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM model_requests WHERE analysis_id = $1) AS requests,
           (SELECT count(*)::text FROM model_responses mres
            JOIN model_requests mreq ON mreq.id = mres.model_request_id
            WHERE mreq.analysis_id = $1) AS responses`,
        [analysisId],
      );
      expect(rolledBackModelTrail.rows[0]).toEqual({
        requests: "1",
        responses: "1",
      });
      const transformDetails = {
        validation_scope: "TAKE_PROFIT_TRANSFORM",
        proposal_transform: {
          code: "TAKE_PROFIT_DISTANCE_DIVIDED_BY_2",
          divisor: "2",
          buy: {
            entry_price: "2001",
            stop_loss: "2000",
            original_take_profit: "2005",
            effective_take_profit: "2003",
            original_risk_reward_ratio: "4",
            effective_risk_reward_ratio: "2",
          },
          sell: {
            entry_price: "1999",
            stop_loss: "2000",
            original_take_profit: "1995",
            effective_take_profit: "1997",
            original_risk_reward_ratio: "4",
            effective_risk_reward_ratio: "2",
          },
        },
      };
      await trail.validation(
        analysisId,
        "SEMANTIC",
        true,
        [],
        transformDetails,
      );
      const storedTransform = await isolated.query<{
        details: Record<string, unknown>;
        audit_details: Record<string, unknown>;
      }>(
        `SELECT vr.details,
                (SELECT ae.details FROM audit_events ae
                 WHERE ae.analysis_id = vr.analysis_id
                   AND ae.event_name = 'validation_completed'
                   AND ae.details ->> 'validation_scope' = 'TAKE_PROFIT_TRANSFORM'
                 ORDER BY ae.occurred_at DESC LIMIT 1) AS audit_details
         FROM validation_results vr
         WHERE vr.analysis_id = $1 AND vr.stage = 'SEMANTIC'
           AND vr.details ->> 'validation_scope' = 'TAKE_PROFIT_TRANSFORM'
         ORDER BY vr.validated_at DESC LIMIT 1`,
        [analysisId],
      );
      expect(storedTransform.rows[0]?.details).toEqual(transformDetails);
      expect(storedTransform.rows[0]?.audit_details).toMatchObject(
        transformDetails,
      );
      const reconciliation: ReconciliationSnapshot = {
        asOf: "2026-08-24T00:09:00.000Z",
        certain: true,
        reasonCodes: [],
        orders: [
          {
            clientOrderId: "operator-order",
            brokerOrderId: "must-not-export-broker-order-id",
            state: "PENDING",
            filledVolume: "0",
            updatedAt: "2026-08-24T00:09:00.000Z",
            reasonCode: "DEMO_MANUAL_ORDER_BLOCKING",
          },
        ],
        relevantPositionCount: 0,
      };
      await trail.reconciliation(reconciliation);
      await trail.reconciliation(reconciliation);
      await isolated.query(
        `UPDATE analysis_runs
         SET state = 'EXPIRED', rejection_reasons = '[]'::jsonb
         WHERE id = $1`,
        [analysisId],
      );
      const interruptedAnalysisId = randomUUID();
      await isolated.query(
        `INSERT INTO analysis_runs
          (id, account_id, symbol_id, strategy_version_id, mode, state, analysis_time)
         VALUES ($1, $2, $3, $4, 'demo', 'MODEL_PENDING', now())`,
        [interruptedAnalysisId, demoAccountId, symbolId, strategyVersionId],
      );
      await expect(trail.recoverInterruptedAnalyses()).resolves.toBe(1);
      await expect(trail.recoverInterruptedAnalyses()).resolves.toBe(0);
      const interruptedAnalysis = await isolated.query<{
        state: string;
        rejection_reasons: string[];
        audit_count: string;
      }>(
        `SELECT ar.state, ar.rejection_reasons,
                (SELECT count(*)::text FROM audit_events ae
                 WHERE ae.analysis_id = ar.id
                   AND ae.event_name = 'interrupted_analysis_recovered') AS audit_count
         FROM analysis_runs ar WHERE ar.id = $1`,
        [interruptedAnalysisId],
      );
      expect(interruptedAnalysis.rows[0]).toEqual({
        state: "REJECTED",
        rejection_reasons: ["ANALYSIS_INTERRUPTED_BY_PROCESS_RESTART"],
        audit_count: "1",
      });
      await isolated.query(
        `UPDATE analysis_runs SET state = 'ACCEPTED' WHERE id = $1`,
        [analysisId],
      );
      const reconciliationAudit = await isolated.query<{
        count: string;
        details: Record<string, unknown>;
      }>(
        `SELECT count(*) OVER ()::text AS count, details
         FROM audit_events WHERE event_name = 'reconciliation_completed'
         LIMIT 1`,
      );
      expect(reconciliationAudit.rows[0]?.count).toBe("1");
      expect(reconciliationAudit.rows[0]?.details).toMatchObject({
        certain: true,
        manual_order_count: 1,
        strategy_order_count: 0,
      });
      const deliveredPayloads: unknown[] = [];
      const successfulOutbox = new PostgresObservabilityOutbox({
        pool: isolated,
        transport: {
          send: (payload) => {
            deliveredPayloads.push(payload);
            return Promise.resolve(true);
          },
        },
        batchSize: 50,
        now: () => new Date("2099-08-24T00:10:00.000Z"),
      });
      const successfulFlush = await successfulOutbox.flush();
      expect(successfulFlush.claimed).toBeGreaterThanOrEqual(2);
      expect(successfulFlush.retried).toBe(0);
      const modelDelivery = deliveredPayloads.find(
        (payload) =>
          (payload as { event_name?: unknown }).event_name ===
          "model_completed",
      ) as Record<string, unknown> | undefined;
      expect(modelDelivery).toMatchObject({
        analysis_id: analysisId,
        event_name: "model_completed",
        outcome: "accepted",
      });
      expect(JSON.stringify(modelDelivery)).not.toContain("must-be-redacted");
      const reconciliationDelivery = deliveredPayloads.find(
        (payload) =>
          (payload as { event_name?: unknown }).event_name ===
          "reconciliation_completed",
      );
      expect(JSON.stringify(reconciliationDelivery)).not.toContain(
        "must-not-export-broker-order-id",
      );

      const retryAuditId = randomUUID();
      await isolated.query(
        `INSERT INTO audit_events
          (id, occurred_at, severity, service, instance_id, environment,
           trading_mode, analysis_id, event_name, outcome, details)
         VALUES ($1, '2026-08-24T00:11:00.000Z', 'warn', 'execution-service',
                 'integration-instance', 'test', 'demo', $2,
                 'delivery_retry_test', 'failed', $3::jsonb)`,
        [
          retryAuditId,
          analysisId,
          JSON.stringify({ authorization: "must-not-leak" }),
        ],
      );
      const rejectedOutbox = new PostgresObservabilityOutbox({
        pool: isolated,
        transport: { send: () => Promise.resolve(false) },
        now: () => new Date("2099-08-24T00:11:01.000Z"),
        retryBaseMs: 5_000,
      });
      await expect(rejectedOutbox.flush()).resolves.toEqual({
        claimed: 1,
        delivered: 0,
        retried: 1,
      });
      const retryState = await isolated.query<{
        status: string;
        attempt_count: number;
        last_error_code: string | null;
      }>(
        `SELECT status, attempt_count, last_error_code
         FROM observability_outbox WHERE audit_event_id = $1`,
        [retryAuditId],
      );
      expect(retryState.rows[0]).toEqual({
        status: "RETRY",
        attempt_count: 1,
        last_error_code: "BETTER_STACK_DELIVERY_REJECTED",
      });
      await isolated.query(
        `UPDATE observability_outbox
         SET next_attempt_at = '2099-08-24T00:11:05.000Z'
         WHERE audit_event_id = $1`,
        [retryAuditId],
      );
      const retriedPayloads: unknown[] = [];
      const recoveredOutbox = new PostgresObservabilityOutbox({
        pool: isolated,
        transport: {
          send: (payload) => {
            retriedPayloads.push(payload);
            return Promise.resolve(true);
          },
        },
        now: () => new Date("2099-08-24T00:11:06.000Z"),
      });
      await expect(recoveredOutbox.flush()).resolves.toEqual({
        claimed: 1,
        delivered: 1,
        retried: 0,
      });
      expect(JSON.stringify(retriedPayloads)).toContain(retryAuditId);
      expect(JSON.stringify(retriedPayloads)).toContain("[REDACTED]");
      expect(JSON.stringify(retriedPayloads)).not.toContain("must-not-leak");
      const deliveredState = await isolated.query<{
        status: string;
        attempt_count: number;
        delivered_at: Date | null;
      }>(
        `SELECT status, attempt_count, delivered_at
         FROM observability_outbox WHERE audit_event_id = $1`,
        [retryAuditId],
      );
      expect(deliveredState.rows[0]).toEqual({
        status: "DELIVERED",
        attempt_count: 2,
        delivered_at: new Date("2099-08-24T00:11:06.000Z"),
      });
      const reclaimedAuditId = randomUUID();
      await isolated.query(
        `INSERT INTO audit_events
          (id, occurred_at, severity, service, instance_id, environment,
           trading_mode, analysis_id, event_name, outcome)
         VALUES ($1, '2026-08-24T00:12:00.000Z', 'warn', 'execution-service',
                 'integration-instance', 'test', 'demo', $2,
                 'delivery_lease_reclaimed_test', 'failed')`,
        [reclaimedAuditId, analysisId],
      );
      const staleClaimOutbox = new PostgresObservabilityOutbox({
        pool: isolated,
        transport: {
          send: async () => {
            await isolated.query(
              `UPDATE observability_outbox
               SET attempt_count = attempt_count + 1
               WHERE audit_event_id = $1`,
              [reclaimedAuditId],
            );
            return true;
          },
        },
        now: () => new Date("2099-08-24T00:12:01.000Z"),
      });
      await expect(staleClaimOutbox.flush()).rejects.toThrow(
        "OBSERVABILITY_DELIVERY_STATE_CONFLICT",
      );
      const reclaimedState = await isolated.query<{
        status: string;
        attempt_count: number;
        delivered_at: Date | null;
      }>(
        `SELECT status, attempt_count, delivered_at
         FROM observability_outbox WHERE audit_event_id = $1`,
        [reclaimedAuditId],
      );
      expect(reclaimedState.rows[0]).toEqual({
        status: "DELIVERING",
        attempt_count: 2,
        delivered_at: null,
      });
      await isolated.query(
        `INSERT INTO order_groups
          (id, analysis_id, idempotency_key, mode, state, expires_at)
         VALUES ($1, $2, $3, 'demo', 'ACTIVE', now() + interval '1 hour')`,
        [orderGroupId, analysisId, `group-${orderGroupId}`],
      );
      for (const [side, clientOrderId] of [
        ["BUY", "cas-buy-111111111111111111111111"],
        ["SELL", "cas-sell-22222222222222222222222"],
      ] as const) {
        await isolated.query(
          `INSERT INTO orders
            (id, account_id, order_group_id, side, order_type, state, client_order_id,
             strategy_owned, strategy_label, idempotency_key, entry_price, stop_loss,
             take_profit, requested_volume, normalized_volume, expires_at)
           VALUES ($1, $2, $3, $4, 'STOP', 'INTENT', $5, true,
                   'ctrader-ai-scalper:0.1.0', $6, 2001, 1999, 2005, 100, 100,
                   now() + interval '1 hour')`,
          [
            randomUUID(),
            demoAccountId,
            orderGroupId,
            side,
            clientOrderId,
            `order-${clientOrderId}`,
          ],
        );
      }
      const eventFixture = async (name: string): Promise<BrokerExecution> =>
        JSON.parse(
          await readFile(
            path.resolve("tests", "fixtures", "ctrader", name),
            "utf8",
          ),
        ) as BrokerExecution;
      const store = new PostgresDemoExecutionStore({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
      });
      await isolated.query(
        `UPDATE orders SET broker_order_id = '501'
         WHERE account_id = $1 AND client_order_id = $2`,
        [demoAccountId, "cas-buy-111111111111111111111111"],
      );
      const acceptedRaw = await eventFixture("demo-order-accepted-v1.json");
      delete (acceptedRaw.order as Record<string, unknown>).clientOrderId;
      const accepted = normalizeDemoExecution(
        {
          ...acceptedRaw,
          position: {
            positionId: "801",
            positionStatus: 1,
            tradeData: {
              symbolId: "7",
              volume: "0",
              tradeSide: 1,
              label: "ctrader-ai-scalper:integration",
            },
          },
        },
        { symbolId: "7" },
      );
      expect(accepted).not.toBeNull();
      expect(accepted?.clientOrderId).toBeNull();
      expect(accepted?.position).toBeNull();
      await expect(
        Promise.all([store.persist(accepted!), store.persist(accepted!)]),
      ).resolves.toEqual([
        { certain: true, reasonCodes: [] },
        { certain: true, reasonCodes: [] },
      ]);
      const acceptedRows = await isolated.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM broker_execution_events WHERE account_id = $1",
        [demoAccountId],
      );
      expect(acceptedRows.rows[0]?.count).toBe("1");
      await expect(store.readiness()).resolves.toEqual({
        certain: true,
        reasonCodes: [],
      });

      const partial = normalizeDemoExecution(
        await eventFixture("demo-order-partial-fill-v1.json"),
        { symbolId: "7" },
      );
      expect(partial).not.toBeNull();
      await expect(store.persist(partial!)).resolves.toEqual({
        certain: false,
        reasonCodes: ["DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED"],
      });
      const durableExecution = await isolated.query<{
        order_state: string;
        filled_volume: string;
        group_state: string;
        fills: string;
        positions: string;
      }>(
        `SELECT o.state AS order_state, o.filled_volume::text,
                og.state AS group_state,
                (SELECT count(*)::text FROM fills f WHERE f.order_id = o.id) AS fills,
                (SELECT count(*)::text FROM positions p WHERE p.order_group_id = og.id) AS positions
         FROM orders o
         JOIN order_groups og ON og.id = o.order_group_id
         WHERE o.account_id = $1 AND o.client_order_id = $2`,
        [demoAccountId, "cas-buy-111111111111111111111111"],
      );
      expect(durableExecution.rows[0]).toEqual({
        order_state: "PARTIALLY_FILLED",
        filled_volume: "40.0000000000",
        group_state: "RECONCILIATION_REQUIRED",
        fills: "1",
        positions: "1",
      });
      await expect(store.readiness()).resolves.toEqual({
        certain: false,
        reasonCodes: ["DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED"],
      });

      const filled = normalizeDemoExecution(
        await eventFixture("demo-order-filled-v1.json"),
        { symbolId: "7" },
      );
      expect(filled).not.toBeNull();
      await expect(store.persist(filled!)).resolves.toEqual({
        certain: true,
        reasonCodes: [],
      });
      const completedExecution = await isolated.query<{
        order_state: string;
        filled_volume: string;
        group_state: string;
        fills: string;
        unresolved_partials: string;
      }>(
        `SELECT o.state AS order_state, o.filled_volume::text,
                og.state AS group_state,
                (SELECT count(*)::text FROM fills f WHERE f.order_id = o.id) AS fills,
                (SELECT count(*)::text FROM broker_execution_events e
                 WHERE e.account_id = $1
                   AND e.reason_codes @> '["DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED"]'::jsonb
                   AND e.resolved_at IS NULL) AS unresolved_partials
         FROM orders o
         JOIN order_groups og ON og.id = o.order_group_id
         WHERE o.account_id = $1 AND o.client_order_id = $2`,
        [demoAccountId, "cas-buy-111111111111111111111111"],
      );
      expect(completedExecution.rows[0]).toEqual({
        order_state: "FILLED",
        filled_volume: "100.0000000000",
        group_state: "CANCELLING_PEER",
        fills: "2",
        unresolved_partials: "0",
      });
      await expect(store.readiness()).resolves.toEqual({
        certain: true,
        reasonCodes: [],
      });
      await expect(store.persist(partial!)).resolves.toEqual({
        certain: true,
        reasonCodes: [],
      });
      await isolated.query(
        `UPDATE orders SET state = 'CANCELLED', updated_at = now()
         WHERE account_id = $1 AND client_order_id = $2`,
        [demoAccountId, "cas-sell-22222222222222222222222"],
      );
      const closingAcceptedRaw = {
        ...(await eventFixture("demo-order-accepted-v1.json")),
        position: {
          positionId: "801",
          positionStatus: 1,
          tradeData: {
            symbolId: "7",
            volume: "100",
            tradeSide: 1,
            label: "ctrader-ai-scalper:integration",
          },
        },
      };
      const closingAcceptedOrder = closingAcceptedRaw.order as Record<
        string,
        unknown
      >;
      closingAcceptedOrder.orderId = "601";
      closingAcceptedOrder.orderType = 4;
      closingAcceptedOrder.closingOrder = true;
      (closingAcceptedOrder.tradeData as Record<string, unknown>).tradeSide = 2;
      const closingAccepted = normalizeDemoExecution(closingAcceptedRaw, {
        symbolId: "7",
      });
      expect(closingAccepted).not.toBeNull();
      await expect(store.persist(closingAccepted!)).resolves.toEqual({
        certain: false,
        reasonCodes: ["DEMO_CLOSING_ORDER_AWAITING_DEAL"],
      });
      await expect(store.readiness()).resolves.toEqual({
        certain: false,
        reasonCodes: ["DEMO_CLOSING_ORDER_AWAITING_DEAL"],
      });
      const unchangedEntryOrder = await isolated.query<{
        broker_order_id: string;
      }>(
        `SELECT broker_order_id FROM orders
         WHERE account_id = $1 AND client_order_id = $2`,
        [demoAccountId, "cas-buy-111111111111111111111111"],
      );
      expect(unchangedEntryOrder.rows[0]?.broker_order_id).toBe("501");
      const closedRaw = await eventFixture("demo-position-closed-v1.json");
      if (closeMode) {
        const protection = new PostgresPositionProtection({
          pool: isolated,
          accountId: demoAccountId,
          symbolId,
        });
        const closeTime = new Date(Number(closedRaw.deal!.executionTimestamp));
        const requestedAt = new Date(closeTime.getTime() - 1000).toISOString();
        await protection.exclusive(async (session) => {
          const positions = await session.positions();
          expect(positions).toHaveLength(1);
          const position = positions[0]!;
          await session.observe(position, {
            schemaVersion: "1.0",
            status: "VERIFIED",
            stopLoss: "1999.28",
            takeProfit: "2005.25",
            expectedStopLoss: "1999.28",
            expectedTakeProfit: "2005.25",
            observedAt: requestedAt,
            reasonCode: "POSITION_PROTECTION_CONFIRMED",
          });
          expect(
            await session.claimRepair(
              position,
              new Date(closeTime.getTime() - 13000).toISOString(),
            ),
          ).toBe(true);
          expect(
            await session.claimRepair(
              position,
              new Date(closeTime.getTime() - 7000).toISOString(),
            ),
          ).toBe(true);
          expect(await session.claimRepair(position, requestedAt)).toBe(false);
          // Present SL cannot authorize the new missing-SL close path.
          expect(await session.claimClose(position, requestedAt, "100")).toBe(
            false,
          );
          await session.observe(position, {
            schemaVersion: "1.0",
            status: "CLOSE_REQUIRED",
            stopLoss: null,
            takeProfit: "2005.25",
            expectedStopLoss: "1999.28",
            expectedTakeProfit: "2005.25",
            observedAt: requestedAt,
            reasonCode: "POSITION_PROTECTION_MISSING_SL_REPAIR_EXHAUSTED",
          });
          expect(await session.claimClose(position, requestedAt, "99")).toBe(
            false,
          );
          expect(
            await session.claimClose(
              position,
              new Date(closeTime.getTime() + 2000).toISOString(),
              "100",
            ),
          ).toBe(false);
          await new PostgresPositionProtection({
            pool: isolated,
            accountId: randomUUID(),
            symbolId,
          }).exclusive(async (other) => {
            expect(await other.claimClose(position, requestedAt, "100")).toBe(
              false,
            );
          });
          expect(await session.claimClose(position, requestedAt, "100")).toBe(
            true,
          );
          expect(await session.claimClose(position, requestedAt, "100")).toBe(
            false,
          );
          await session.closeAcknowledged(position, "601");
          await expect(
            session.closeAcknowledged(position, "602"),
          ).rejects.toThrow("POSITION_PROTECTION_CLOSE_ACK_CONFLICT");
        });
        await new PostgresPositionProtection({
          pool: isolated,
          accountId: demoAccountId,
          symbolId,
        }).exclusive(async (session) => {
          const position = (await session.positions())[0]!;
          expect(position.repairAttempts).toBe(2);
          expect(position.closeRequestedAt).toBe(requestedAt);
          expect(await session.claimRepair(position, requestedAt)).toBe(false);
          expect(await session.claimClose(position, requestedAt, "100")).toBe(
            false,
          );
        });
        const proof = {
          accountId: demoAccountId,
          symbolId,
          brokerPositionId: "801",
          brokerOrderId: "601",
          occurredAt: closeTime.toISOString(),
          closedVolume: "100",
        };
        expect(await protectiveCloseAuthorized(isolated, proof)).toBe(true);
        expect(
          await protectiveCloseAuthorized(isolated, {
            ...proof,
            accountId: randomUUID(),
          }),
        ).toBe(false);
        expect(
          await protectiveCloseAuthorized(isolated, {
            ...proof,
            closedVolume: "99",
          }),
        ).toBe(false);
        expect(
          await protectiveCloseAuthorized(isolated, {
            ...proof,
            occurredAt: new Date(closeTime.getTime() + 121000).toISOString(),
          }),
        ).toBe(false);
        await expect(store.readiness()).resolves.toEqual({
          certain: true,
          reasonCodes: [],
        });
        closedRaw.order!.orderType = 1;
        // A distinct, unfilled TP child remains pending when a market close starts.
        const pendingChild = structuredClone(closingAcceptedRaw);
        pendingChild.order!.orderId = "605";
        pendingChild.order!.utcLastUpdateTimestamp = closeTime.getTime() - 500;
        const childEvent = normalizeDemoExecution(pendingChild, {
          symbolId: "7",
        })!;
        await expect(store.persist(childEvent)).resolves.toEqual({
          certain: false,
          reasonCodes: ["DEMO_CLOSING_ORDER_AWAITING_DEAL"],
        });
      }
      const closed = normalizeDemoExecution(closedRaw, { symbolId: "7" });
      expect(closed).not.toBeNull();
      await expect(store.persist(closed!)).resolves.toEqual({
        certain: true,
        reasonCodes: [],
      });
      if (closeMode) {
        // Even a complete position close cannot discard an unproven child outcome.
        expect((await store.reconcileTerminalEvidence()).certain).toBe(false);
        const cancelledChild = structuredClone(closingAcceptedRaw);
        cancelledChild.executionType = 5;
        cancelledChild.order!.orderId = "605";
        cancelledChild.order!.orderStatus = 5;
        cancelledChild.order!.utcLastUpdateTimestamp =
          Number(closedRaw.deal!.executionTimestamp) + 1;
        const cancellation = normalizeDemoExecution(cancelledChild, {
          symbolId: "7",
        })!;
        await store.persist(cancellation);
        // Incomplete group reconciliation still prevents resolving the child.
        await isolated.query(
          "UPDATE order_groups SET state='RECONCILIATION_REQUIRED' WHERE id=$1",
          [orderGroupId],
        );
        expect((await store.reconcileTerminalEvidence()).certain).toBe(false);
        await isolated.query(
          "UPDATE order_groups SET state='CLOSED' WHERE id=$1",
          [orderGroupId],
        );
        await expect(store.reconcileTerminalEvidence()).resolves.toMatchObject({
          certain: true,
          resolvedEventCount: 1,
        });
        await expect(store.reconcileTerminalEvidence()).resolves.toMatchObject({
          certain: true,
          resolvedEventCount: 0,
        });
      }
      const closedLifecycle = await isolated.query<{
        group_state: string;
        position_state: string;
        direction: string;
        realized_pnl: string;
        fees: string;
        model_version: string;
        prompt_version: string;
        schema_version: string;
        strategy_version: string;
      }>(
        `SELECT og.state AS group_state, p.state AS position_state,
                t.direction, t.realized_pnl::text, t.fees::text,
                t.model_version, t.prompt_version, t.schema_version,
                t.strategy_version
         FROM order_groups og
         JOIN positions p ON p.order_group_id = og.id
         JOIN trades t ON t.order_group_id = og.id
         WHERE og.id = $1`,
        [orderGroupId],
      );
      expect(closedLifecycle.rows[0]).toEqual({
        group_state: "CLOSED",
        position_state: "CLOSED",
        direction: "LONG",
        realized_pnl: "9.6500000000",
        fees: "-0.3500000000",
        model_version: "integration-model",
        prompt_version: "system-v2",
        schema_version: "2.1",
        strategy_version: `integration-${strategyVersionId}`,
      });
      await expect(
        new PostgresAutomaticTradeCampaign({
          pool: isolated,
          accountId: demoAccountId,
          symbolId,
          strategyVersionId,
          configuredLimit: 100,
        }).progress(),
      ).resolves.toMatchObject({
        releaseClosedTrades: 1,
        closedTrades: 1,
        remaining: 99,
        complete: false,
        allowed: true,
      });
      const closingEvidence = await isolated.query<{
        broker_order_type: number;
        closing_order: boolean;
        unresolved: string;
      }>(
        `SELECT max(broker_order_type)::integer AS broker_order_type,
                bool_and(closing_order) AS closing_order,
                count(*) FILTER (WHERE resolved_at IS NULL
                  AND jsonb_array_length(reason_codes) > 0)::text AS unresolved
         FROM broker_execution_events
         WHERE account_id = $1 AND broker_order_id = '601'`,
        [demoAccountId],
      );
      expect(closingEvidence.rows[0]).toEqual({
        broker_order_type: 4,
        closing_order: true,
        unresolved: "0",
      });
      const duplicateFilledRaw = await eventFixture(
        "demo-order-filled-v1.json",
      );
      (duplicateFilledRaw.position as Record<string, unknown>).takeProfit =
        2006.25;
      const duplicateFilled = normalizeDemoExecution(duplicateFilledRaw, {
        symbolId: "7",
      });
      await expect(store.persist(duplicateFilled!)).resolves.toEqual({
        certain: false,
        reasonCodes: ["DEMO_BROKER_EVENT_KEY_CONFLICT"],
      });
      await expect(store.readiness()).resolves.toEqual({
        certain: false,
        reasonCodes: ["DEMO_BROKER_EVENT_KEY_CONFLICT"],
      });
      const terminalReconciliation = await store.reconcileTerminalEvidence();
      expect(terminalReconciliation).toMatchObject({
        certain: true,
        reasonCodes: [],
        resolvedEventCount: 1,
      });
      expect(terminalReconciliation.terminalProofKey).toMatch(
        /^terminal:[0-9a-f]{64}$/,
      );
      expect(terminalReconciliation.terminalOrderGroupId).toBe(orderGroupId);
      expect(terminalReconciliation.terminalBrokerFillId).toBe("903");
      const retainedConflict = await isolated.query<{
        mapping_state: string;
        reason_codes: string[];
        resolved: boolean;
        resolution_event_key: string | null;
      }>(
        `SELECT mapping_state, reason_codes, resolved_at IS NOT NULL AS resolved,
                resolution_event_key
         FROM broker_execution_events
         WHERE account_id = $1 AND broker_event_key = $2`,
        [demoAccountId, duplicateFilled!.eventKey],
      );
      expect(retainedConflict.rows[0]).toEqual({
        mapping_state: "CONFLICT",
        reason_codes: ["DEMO_BROKER_EVENT_KEY_CONFLICT"],
        resolved: true,
        resolution_event_key: closed!.eventKey,
      });
      const restartedStore = new PostgresDemoExecutionStore({
        pool: isolated,
        accountId: demoAccountId,
        symbolId,
      });
      await expect(restartedStore.persist(closed!)).resolves.toEqual({
        certain: true,
        reasonCodes: [],
      });

      await isolated.query(
        `UPDATE analysis_runs
         SET valid_until = now() + interval '1 hour'
         WHERE id = $1`,
        [analysisId],
      );
      const unusedGateway = {
        kind: "ctrader-demo" as const,
        canSubmitToBroker: true,
        placeOco: () => Promise.reject(new Error("UNEXPECTED_PLACEMENT")),
        cancelStrategyOrder: () =>
          Promise.reject(new Error("UNEXPECTED_CANCELLATION")),
        reconcile: () => Promise.reject(new Error("UNEXPECTED_RECONCILIATION")),
      };
      const maintenance = new OrderMaintenance(
        isolated,
        unusedGateway,
        "XAUUSD",
        { accountId: demoAccountId, symbolId },
      );
      await maintenance.expireAndReconcile();
      const terminalAnalysis = await isolated.query<{ state: string }>(
        "SELECT state FROM analysis_runs WHERE id = $1",
        [analysisId],
      );
      expect(terminalAnalysis.rows[0]?.state).toBe("EXPIRED");

      let terminalBrokerSequence = 900;
      const persistTerminalPair = async (
        terminalStates: readonly ["CANCELLED" | "REJECTED", "CANCELLED"],
      ): Promise<string> => {
        const terminalAnalysisId = randomUUID();
        const terminalGroupId = randomUUID();
        await isolated.query(
          `INSERT INTO analysis_runs
            (id, account_id, symbol_id, strategy_version_id, mode, state,
             analysis_time, valid_until)
           VALUES ($1, $2, $3, $4, 'demo', 'ACCEPTED', now(),
                   now() + interval '1 hour')`,
          [terminalAnalysisId, demoAccountId, symbolId, strategyVersionId],
        );
        await isolated.query(
          `INSERT INTO order_groups
            (id, analysis_id, idempotency_key, mode, state, expires_at)
           VALUES ($1, $2, $3, 'demo', 'ACTIVE', now() + interval '1 hour')`,
          [terminalGroupId, terminalAnalysisId, `terminal-${terminalGroupId}`],
        );
        for (const [index, side] of ["BUY", "SELL"].entries()) {
          const clientOrderId = `terminal-${terminalGroupId.slice(0, 8)}-${side.toLowerCase()}`;
          await isolated.query(
            `INSERT INTO orders
              (id, account_id, order_group_id, side, order_type, state,
               client_order_id, strategy_owned, strategy_label, idempotency_key,
               entry_price, stop_loss, take_profit, requested_volume,
               normalized_volume, expires_at)
             VALUES ($1, $2, $3, $4, 'STOP', 'INTENT', $5, true,
                     'ctrader-ai-scalper:integration', $6, 2001, 1999, 2005,
                     100, 100, now() + interval '1 hour')`,
            [
              randomUUID(),
              demoAccountId,
              terminalGroupId,
              side,
              clientOrderId,
              `terminal-order-${terminalGroupId}-${side}`,
            ],
          );
          const raw = structuredClone(acceptedRaw) as unknown as Record<
            string,
            unknown
          >;
          raw.executionType = terminalStates[index] === "CANCELLED" ? 5 : 7;
          const rawOrder = raw.order as Record<string, unknown>;
          rawOrder.orderId = String(terminalBrokerSequence++);
          rawOrder.orderStatus = terminalStates[index] === "CANCELLED" ? 5 : 3;
          rawOrder.clientOrderId = clientOrderId;
          rawOrder.utcLastUpdateTimestamp = 1787544060000 + index;
          (rawOrder.tradeData as Record<string, unknown>).tradeSide = index + 1;
          raw.receivedAt = `2026-08-24T04:01:0${index}.100Z`;
          const normalized = normalizeDemoExecution(
            raw as unknown as BrokerExecution,
            { symbolId: "7" },
          );
          expect(normalized).not.toBeNull();
          await store.persist(normalized!);
        }
        await isolated.query(
          "UPDATE analysis_runs SET state = 'EXPIRED' WHERE id = $1",
          [terminalAnalysisId],
        );
        return terminalGroupId;
      };

      const cancelledGroupId = await persistTerminalPair([
        "CANCELLED",
        "CANCELLED",
      ]);
      const cancelledGroup = await isolated.query<{
        state: string;
        cancellation_reason: string | null;
      }>(`SELECT state, cancellation_reason FROM order_groups WHERE id = $1`, [
        cancelledGroupId,
      ]);
      expect(cancelledGroup.rows[0]).toEqual({
        state: "FAILED",
        cancellation_reason: "DEMO_BROKER_ZERO_FILL_CANCELLED",
      });

      const rejectedGroupId = await persistTerminalPair([
        "REJECTED",
        "CANCELLED",
      ]);
      const rejectedGroup = await isolated.query<{
        state: string;
        cancellation_reason: string | null;
      }>(`SELECT state, cancellation_reason FROM order_groups WHERE id = $1`, [
        rejectedGroupId,
      ]);
      expect(rejectedGroup.rows[0]).toEqual({
        state: "FAILED",
        cancellation_reason: null,
      });
      // The database, not an in-memory cache, prevents map reuse after any intent.
      await isolated.query(
        "UPDATE order_groups SET context_plan_id=$2 WHERE id=$1",
        [cancelledGroupId, currentContext!.id],
      );
      await expect(
        isolated.query(
          "UPDATE order_groups SET context_plan_id=$2 WHERE id=$1",
          [rejectedGroupId, currentContext!.id],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      expect((await contextStore.latest())?.consumed).toBe(true);
      // Explicit GTC survives its submission deadline and process reconstruction.
      await isolated.query(
        "UPDATE order_groups SET time_in_force='GTC',submission_valid_until=expires_at,expires_at=NULL WHERE id=$1",
        [orderGroupId],
      );
      await isolated.query(
        "UPDATE orders SET time_in_force='GTC',submission_valid_until=expires_at,expires_at=NULL WHERE order_group_id=$1",
        [orderGroupId],
      );
      await expect(
        isolated.query(
          "UPDATE orders SET expires_at=now() WHERE order_group_id=$1",
          [orderGroupId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        isolated.query(
          "UPDATE order_groups SET time_in_force='GTD' WHERE id=$1",
          [orderGroupId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      // Real SQL: a reconstructed maintenance worker never timer-cancels GTC,
      // including during normal shutdown; emergency still cancels owned GTC.
      await isolated.query(
        "UPDATE order_groups SET state='ACTIVE',time_in_force='GTC',submission_valid_until=expires_at,expires_at=NULL WHERE id=$1",
        [cancelledGroupId],
      );
      await isolated.query(
        "UPDATE orders SET state='PENDING',time_in_force='GTC',submission_valid_until=expires_at,expires_at=NULL WHERE order_group_id=$1",
        [cancelledGroupId],
      );
      const cancellations: string[] = [];
      const persistentMaintenance = new OrderMaintenance(
        isolated,
        {
          kind: "ctrader-demo",
          canSubmitToBroker: true,
          placeOco: () =>
            Promise.reject(new Error("FORBIDDEN_TEST_SUBMISSION")),
          cancelStrategyOrder: (clientOrderId: string) => {
            cancellations.push(clientOrderId);
            return Promise.resolve({
              clientOrderId,
              brokerOrderId: null,
              state: "CANCELLED" as const,
              filledVolume: "0",
              updatedAt: new Date().toISOString(),
              reasonCode: "TEST_CANCELLATION",
            });
          },
          reconcile: () =>
            Promise.resolve({
              asOf: new Date().toISOString(),
              certain: true,
              reasonCodes: [],
              orders: [],
              relevantPositionCount: 0,
            }),
        },
        "XAUUSD",
        { accountId: demoAccountId, symbolId },
      );
      const pendingIds = (
        await isolated.query<{ client_order_id: string }>(
          "SELECT client_order_id FROM orders WHERE order_group_id=$1",
          [cancelledGroupId],
        )
      ).rows.map((r) => r.client_order_id);
      await persistentMaintenance.expireAndReconcile();
      await persistentMaintenance.cancelAll("SERVICE_SHUTDOWN", true);
      expect(cancellations.filter((id) => pendingIds.includes(id))).toEqual([]);
      expect(
        (
          await isolated.query<{ state: string }>(
            "SELECT state FROM orders WHERE order_group_id=$1",
            [cancelledGroupId],
          )
        ).rows.map((r) => r.state),
      ).toEqual(["PENDING", "PENDING"]);
      expect(
        await contextStore.claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(false);
      await persistentMaintenance.cancelAll("EMERGENCY_TEST");
      expect(
        cancellations.filter((id) => pendingIds.includes(id)).sort(),
      ).toEqual(pendingIds.sort());

      // A GTC survivor of a broker-confirmed, unfilled terminal peer must not
      // leave the loop managing an unintended single-leg setup indefinitely.
      const resetIncompletePair = async () => {
        await isolated.query(
          "UPDATE order_groups SET state='ACTIVE' WHERE id=$1",
          [cancelledGroupId],
        );
        await isolated.query(
          "UPDATE orders SET state=CASE WHEN client_order_id=$2 THEN 'CANCELLED' ELSE 'PENDING' END,filled_volume=0,strategy_owned=true WHERE order_group_id=$1",
          [cancelledGroupId, pendingIds[0]],
        );
      };
      await resetIncompletePair();
      cancellations.length = 0;
      // Missing terminal evidence, unknown states, manual ownership, partial
      // execution and unresolved callbacks must not authorize unfilled cleanup.
      for (const state of ["UNKNOWN", "INTENT", "PENDING"]) {
        await isolated.query(
          "UPDATE orders SET state=$2 WHERE client_order_id=$1",
          [pendingIds[0], state],
        );
        await persistentMaintenance.expireAndReconcile();
        expect(cancellations).toEqual([]);
      }
      await resetIncompletePair();
      await isolated.query(
        "UPDATE broker_execution_events SET order_id=NULL WHERE order_group_id=$1",
        [cancelledGroupId],
      );
      await persistentMaintenance.expireAndReconcile();
      expect(cancellations).toEqual([]);
      await isolated.query(
        "UPDATE broker_execution_events e SET order_id=o.id FROM orders o WHERE e.order_group_id=$1 AND e.account_id=o.account_id AND e.client_order_id=o.client_order_id",
        [cancelledGroupId],
      );
      await isolated.query(
        "UPDATE orders SET strategy_owned=false WHERE client_order_id=$1",
        [pendingIds[0]],
      );
      await persistentMaintenance.expireAndReconcile();
      expect(cancellations).toEqual([]);
      await resetIncompletePair();
      await isolated.query(
        "UPDATE broker_execution_events SET mapping_state='CONFLICT' WHERE order_group_id=$1",
        [cancelledGroupId],
      );
      await persistentMaintenance.expireAndReconcile();
      expect(cancellations).toEqual([]);
      await isolated.query(
        "UPDATE broker_execution_events SET mapping_state='MAPPED' WHERE order_group_id=$1",
        [cancelledGroupId],
      );

      // A broker timeout preserves durable cancellation uncertainty. A new
      // worker retries the exact same owned order after restart.
      const retryMaintenance = new OrderMaintenance(
        isolated,
        {
          ...unusedGateway,
          cancelStrategyOrder: () =>
            Promise.reject(new Error("TEST_CANCEL_TIMEOUT")),
          reconcile: () =>
            Promise.resolve({
              asOf: new Date().toISOString(),
              certain: false,
              reasonCodes: ["TEST_CANCEL_UNCERTAIN"],
              orders: [],
              relevantPositionCount: 0,
            }),
        },
        "XAUUSD",
        { accountId: demoAccountId, symbolId },
      );
      await expect(retryMaintenance.expireAndReconcile()).rejects.toThrow(
        "ORDER_MAINTENANCE_RECONCILIATION_REQUIRED",
      );
      expect(
        (
          await isolated.query<{ state: string }>(
            "SELECT state FROM order_groups WHERE id=$1",
            [cancelledGroupId],
          )
        ).rows[0]?.state,
      ).toBe("RECONCILIATION_REQUIRED");
      expect(
        await contextStore.claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(false);
      await persistentMaintenance.expireAndReconcile();
      expect(cancellations).toEqual([pendingIds[1]]);
      expect(
        (
          await isolated.query<{
            state: string;
            cancellation_reason: string;
          }>("SELECT state,cancellation_reason FROM order_groups WHERE id=$1", [
            cancelledGroupId,
          ])
        ).rows[0],
      ).toEqual({
        state: "FAILED",
        cancellation_reason: "OCO_PEER_UNFILLED_TERMINAL",
      });
      expect((await contextStore.latest())?.closedAt).toBeNull();

      const stopAnalysisId = randomUUID();
      const stopGroupId = randomUUID();
      await isolated.query(
        `INSERT INTO analysis_runs (id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time)
        VALUES ($1,$2,$3,$4,'demo','ACCEPTED',now())`,
        [stopAnalysisId, demoAccountId, symbolId, strategyVersionId],
      );
      const stopDecision = {
        approved: true,
        reasonCodes: [],
        riskBudget: "5000",
        rawVolume: "100",
        normalizedVolume: "100",
        maximumLoss: "100",
        estimatedMargin: "100",
      };
      const stopCommands = (["BUY", "SELL"] as const).map((side) => ({
        executionOrderType: "STOP" as const,
        idempotencyKey: `stop-${stopGroupId}-${side}`,
        analysisId: stopAnalysisId,
        orderGroupId: stopGroupId,
        clientOrderId: `stop-${stopGroupId}-${side}`,
        symbol: "XAUUSD",
        side,
        volume: "100",
        entryPrice: "2000",
        stopLoss: side === "BUY" ? "1999" : "2001",
        takeProfit: side === "BUY" ? "2000.5" : "1999.5",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        timeInForce: "GTC" as const,
        strategyLabel: "ctrader-ai-scalper:fixture",
      }));
      const stopEvaluation: OcoEvaluation = {
        approved: true,
        reasonCodes: [],
        equity: "1000000",
        perLegRiskPercent: "0.5",
        commands: [stopCommands[0]!, stopCommands[1]!],
        risk: {
          approved: true,
          reasonCodes: [],
          buy: stopDecision,
          sell: stopDecision,
          combinedMaximumLoss: "200",
        },
      };
      await expect(
        trail.intent(stopAnalysisId, {
          ...stopEvaluation,
          commands: [
            stopCommands[0]!,
            { ...stopCommands[1]!, executionOrderType: "STOP_LIMIT" },
          ],
        }),
      ).rejects.toThrow("TRAIL_EXECUTION_TYPE_MISMATCH");
      await trail.intent(stopAnalysisId, stopEvaluation);
      expect(
        (
          await isolated.query(
            "SELECT execution_order_type,time_in_force,expires_at FROM orders WHERE order_group_id=$1",
            [stopGroupId],
          )
        ).rows,
      ).toEqual([
        {
          execution_order_type: "STOP",
          time_in_force: "GTC",
          expires_at: null,
        },
        {
          execution_order_type: "STOP",
          time_in_force: "GTC",
          expires_at: null,
        },
      ]);
      await isolated.query(
        "UPDATE orders SET state='REJECTED' WHERE order_group_id=$1",
        [stopGroupId],
      );
      await isolated.query(
        "UPDATE order_groups SET state='FAILED' WHERE id=$1",
        [stopGroupId],
      );
      // Explicit execution intent is additive; historical generic STOP remains unknown.
      expect(
        (
          await isolated.query<{ execution_order_type: string | null }>(
            "SELECT execution_order_type FROM orders WHERE order_group_id=$1",
            [cancelledGroupId],
          )
        ).rows.every((r) => r.execution_order_type === null),
      ).toBe(true);
      await expect(
        isolated.query(
          "UPDATE orders SET execution_order_type='MARKET' WHERE order_group_id=$1",
          [cancelledGroupId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await isolated.query(
        "UPDATE orders SET execution_order_type='STOP' WHERE order_group_id=$1",
        [cancelledGroupId],
      );
      await isolated.query(
        "UPDATE scenario_contexts SET state='READY',plan='{}',available_at=clock_timestamp(),requested_model='deepseek-v4-pro/u5W' WHERE id=$1",
        [currentContext!.id],
      );
      expect((await contextStore.latest())?.zeroFillTerminalAt).not.toBeNull();
      const afterZero = {
        ...contextClaim,
        afterContextId: currentContext!.id,
      };
      for (const [block, restore] of [
        [
          "UPDATE orders SET strategy_owned=false WHERE order_group_id=$1",
          "UPDATE orders SET strategy_owned=true WHERE order_group_id=$1",
        ],
        [
          "UPDATE orders SET filled_volume=1 WHERE order_group_id=$1",
          "UPDATE orders SET filled_volume=0 WHERE order_group_id=$1",
        ],
        [
          "UPDATE orders SET state='UNKNOWN' WHERE order_group_id=$1",
          "UPDATE orders SET state='CANCELLED' WHERE order_group_id=$1",
        ],
        [
          "UPDATE broker_execution_events SET mapping_state='CONFLICT' WHERE order_group_id=$1",
          "UPDATE broker_execution_events SET mapping_state='MAPPED' WHERE order_group_id=$1",
        ],
        [
          "UPDATE order_groups SET state='RECONCILIATION_REQUIRED' WHERE id=$1",
          "UPDATE order_groups SET state='FAILED' WHERE id=$1",
        ],
      ]) {
        await isolated.query(block!, [cancelledGroupId]);
        expect((await contextStore.latest())?.zeroFillTerminalAt).toBeNull();
        expect(
          await contextStore.claim({ ...afterZero, id: randomUUID() }),
        ).toBe(false);
        await isolated.query(restore!, [cancelledGroupId]);
      }
      const zeroRaceFill = randomUUID();
      await isolated.query(
        `INSERT INTO fills (id,order_id,broker_event_key,price,volume,occurred_at,received_at)
        SELECT $1::uuid,id,$1::text,entry_price,1,now(),now() FROM orders WHERE order_group_id=$2 LIMIT 1`,
        [zeroRaceFill, cancelledGroupId],
      );
      expect(await contextStore.claim({ ...afterZero, id: randomUUID() })).toBe(
        false,
      );
      await isolated.query("DELETE FROM fills WHERE id=$1", [zeroRaceFill]);
      const zeroClaims = await Promise.all([
        contextStore.claim({ ...afterZero, id: randomUUID() }),
        new PostgresContextStore(isolated, {
          accountId: demoAccountId,
          symbolId,
          mode: "demo",
        }).claim({ ...afterZero, id: randomUUID() }),
      ]);
      expect(zeroClaims.filter(Boolean)).toHaveLength(1);
      expect(await contextStore.claim({ ...afterZero, id: randomUUID() })).toBe(
        false,
      );
      expect(
        await contextStore.claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(false);

      await persistentMaintenance.expireAndReconcile();
      expect(cancellations).toEqual([pendingIds[1]]);

      // Durable fill evidence wins even if the cancellation response and a
      // later broker snapshot both appear flat (a rapid fill/close race).
      await resetIncompletePair();
      const racingFillId = randomUUID();
      const racingMaintenance = new OrderMaintenance(
        isolated,
        {
          ...unusedGateway,
          cancelStrategyOrder: async (clientOrderId) => {
            await isolated.query(
              `INSERT INTO fills (id,order_id,broker_event_key,price,volume,occurred_at,received_at)
             SELECT $1::uuid,id,$1::text,entry_price,50,now(),now() FROM orders WHERE client_order_id=$2`,
              [racingFillId, clientOrderId],
            );
            return {
              clientOrderId,
              brokerOrderId: null,
              state: "CANCELLED" as const,
              filledVolume: "0",
              updatedAt: new Date().toISOString(),
              reasonCode: "TEST_CANCEL_RACE",
            };
          },
          reconcile: () =>
            Promise.resolve({
              asOf: new Date().toISOString(),
              certain: true,
              reasonCodes: [],
              orders: [],
              relevantPositionCount: 0,
            }),
        },
        "XAUUSD",
        { accountId: demoAccountId, symbolId },
      );
      await racingMaintenance.expireAndReconcile();
      expect(
        (
          await isolated.query<{ state: string }>(
            "SELECT state FROM order_groups WHERE id=$1",
            [cancelledGroupId],
          )
        ).rows[0]?.state,
      ).toBe("RECONCILIATION_REQUIRED");
      expect(
        await contextStore.claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(false);
      await isolated.query("DELETE FROM fills WHERE id=$1", [racingFillId]);

      // A partial fill requires peer cancellation even when the immediate
      // callback failed. It can never be classified as an unfilled setup.
      await resetIncompletePair();
      await isolated.query(
        "UPDATE orders SET state='PARTIALLY_FILLED',filled_volume=50 WHERE client_order_id=$1",
        [pendingIds[0]],
      );
      cancellations.length = 0;
      const partialMaintenance = new OrderMaintenance(
        isolated,
        {
          ...unusedGateway,
          cancelStrategyOrder: (clientOrderId) => {
            cancellations.push(clientOrderId);
            return Promise.resolve({
              clientOrderId,
              brokerOrderId: null,
              state: "CANCELLED" as const,
              filledVolume: "0",
              updatedAt: new Date().toISOString(),
              reasonCode: "OCO_PEER_FILLED",
            });
          },
          reconcile: () =>
            Promise.resolve({
              asOf: new Date().toISOString(),
              certain: false,
              reasonCodes: ["PARTIAL_FILL"],
              orders: [],
              relevantPositionCount: 1,
            }),
        },
        "XAUUSD",
        { accountId: demoAccountId, symbolId },
      );
      await expect(partialMaintenance.expireAndReconcile()).rejects.toThrow(
        "ORDER_MAINTENANCE_RECONCILIATION_REQUIRED",
      );
      expect(cancellations).toEqual([pendingIds[1]]);
      expect(
        (
          await isolated.query<{ state: string }>(
            "SELECT state FROM order_groups WHERE id=$1",
            [cancelledGroupId],
          )
        ).rows[0]?.state,
      ).toBe("RECONCILIATION_REQUIRED");
      await isolated.query(
        "UPDATE orders SET state='CANCELLED',filled_volume=0 WHERE order_group_id=$1",
        [cancelledGroupId],
      );
      await isolated.query(
        "UPDATE order_groups SET state='FAILED' WHERE id=$1",
        [cancelledGroupId],
      );
      // Isolate the already reconciled closed fixture from other test/demo contexts.
      await isolated.query("UPDATE order_groups SET mode='paper' WHERE id=$1", [
        orderGroupId,
      ]);
      const closeScope = {
        accountId: demoAccountId,
        symbolId,
        mode: "paper",
      };
      const closeStore = new PostgresContextStore(isolated, closeScope);
      const closedContextId = randomUUID();
      expect(
        await closeStore.claim({ ...contextClaim, id: closedContextId }),
      ).toBe(true);
      await isolated.query(
        "UPDATE scenario_contexts SET state='READY',plan='{}',available_at=clock_timestamp() WHERE id=$1",
        [closedContextId],
      );
      await isolated.query(
        "UPDATE order_groups SET context_plan_id=$2 WHERE id=$1",
        [orderGroupId, closedContextId],
      );
      expect((await closeStore.latest())?.closedAt).not.toBeNull();
      const afterClose = { ...contextClaim, afterContextId: closedContextId };
      // Active and uncertain state must still prohibit dispatch even with close evidence.
      await isolated.query(
        "UPDATE order_groups SET state='RECONCILIATION_REQUIRED' WHERE id=$1",
        [orderGroupId],
      );
      expect(await closeStore.claim({ ...afterClose, id: randomUUID() })).toBe(
        false,
      );
      await isolated.query(
        "UPDATE order_groups SET state='CLOSED' WHERE id=$1",
        [orderGroupId],
      );
      const closeClaims = await Promise.all([
        closeStore.claim({ ...afterClose, id: randomUUID() }),
        new PostgresContextStore(isolated, closeScope).claim({
          ...afterClose,
          id: randomUUID(),
        }),
      ]);
      expect(closeClaims.filter(Boolean)).toHaveLength(1);
      expect(
        await new PostgresContextStore(isolated, closeScope).claim({
          ...afterClose,
          id: randomUUID(),
        }),
      ).toBe(false);
      expect(
        await closeStore.claim({ ...contextClaim, id: randomUUID() }),
      ).toBe(false);
      // Restore the original demo scope so this rejection still tests conflicting
      // close evidence, rather than a mode mismatch introduced by the claim test.
      await isolated.query("UPDATE order_groups SET mode='demo' WHERE id=$1", [
        orderGroupId,
      ]);
      const conflictingRaw = structuredClone(closedRaw);
      const conflictingDeal = conflictingRaw.deal as Record<string, unknown>;
      conflictingDeal.dealId = "904";
      const conflictingDetail = conflictingDeal.closePositionDetail as Record<
        string,
        unknown
      >;
      conflictingDetail.grossProfit = "1100";
      const conflictingClose = normalizeDemoExecution(conflictingRaw, {
        symbolId: "7",
      });
      await expect(restartedStore.persist(conflictingClose!)).resolves.toEqual({
        certain: false,
        reasonCodes: ["DEMO_TRADE_OUTCOME_CONFLICT"],
      });
      const conflictingOutcome = await isolated.query<{
        mapping_state: string;
        reason_codes: string[];
      }>(
        `SELECT mapping_state, reason_codes
         FROM broker_execution_events
         WHERE account_id = $1 AND broker_event_key = $2`,
        [demoAccountId, conflictingClose!.eventKey],
      );
      expect(conflictingOutcome.rows[0]).toEqual({
        mapping_state: "CONFLICT",
        reason_codes: ["DEMO_TRADE_OUTCOME_CONFLICT"],
      });
      await expect(restartedStore.readiness()).resolves.toEqual({
        certain: false,
        reasonCodes: ["DEMO_TRADE_OUTCOME_CONFLICT"],
      });
      await expect(
        restartedStore.reconcileTerminalEvidence(),
      ).resolves.toMatchObject({
        certain: false,
        reasonCodes: ["DEMO_TRADE_OUTCOME_CONFLICT"],
        resolvedEventCount: 0,
      });
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });

  databaseTest("upgrades 0005 safely through 0011", async () => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const migrationDirectory = await mkdtemp(
      path.join(os.tmpdir(), "ctrader-migrations-"),
    );
    const admin = createPool({ connectionString: connectionString as string });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(connectionString as string);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    const isolated = createPool({
      connectionString: url.toString(),
      sslMode: "require",
    });
    try {
      for (const file of [
        "0001_initial.sql",
        "0002_dashboard_views.sql",
        "0003_symbol_volume_scale.sql",
        "0004_daily_risk_net_flows.sql",
        "0005_paper_account_identity.sql",
      ]) {
        await copyFile(
          path.resolve("migrations", file),
          path.join(migrationDirectory, file),
        );
      }
      expect(await migrate(isolated, migrationDirectory)).toEqual([
        "0001",
        "0002",
        "0003",
        "0004",
        "0005",
      ]);
      const accountId = randomUUID();
      const symbolId = randomUUID();
      const strategyVersionId = randomUUID();
      const analysisId = randomUUID();
      const orderGroupId = randomUUID();
      const orderId = randomUUID();
      await isolated.query(
        `INSERT INTO accounts
          (id, provider, provider_account_key_hash, environment, account_type, currency)
         VALUES ($1, 'ctrader', $2, 'demo', 'demo', 'USD')`,
        [accountId, "e".repeat(64)],
      );
      await isolated.query(
        `INSERT INTO symbols
          (id, account_id, provider_symbol_id, name, digits, tick_size, tick_value,
           contract_size, min_volume, max_volume, volume_step, min_stop_distance,
           metadata_revision, metadata_at, volume_scale)
         VALUES ($1, $2, '7', 'XAUUSD', 2, 0.01, 0.01, 100, 1, 100000,
                 1, 0, 'upgrade', now(), 0.01)`,
        [symbolId, accountId],
      );
      await isolated.query(
        `INSERT INTO strategy_versions
          (id, version, code_hash, config_hash, prompt_version, schema_version, feature_version)
         VALUES ($1, $2, $3, $4, 'system-v1', '1.0', '1.0')`,
        [
          strategyVersionId,
          `upgrade-${strategyVersionId}`,
          "f".repeat(64),
          "0".repeat(64),
        ],
      );
      await isolated.query(
        `INSERT INTO analysis_runs
          (id, account_id, symbol_id, strategy_version_id, mode, state, analysis_time)
         VALUES ($1, $2, $3, $4, 'demo', 'ACCEPTED', now())`,
        [analysisId, accountId, symbolId, strategyVersionId],
      );
      const legacyModelRequestId = randomUUID();
      await isolated.query(
        `INSERT INTO model_requests
          (id, analysis_id, request_id, api_style, model, prompt_version,
           schema_version, payload_mode, payload_redacted, payload_sha256,
           status, attempt_count, requested_at, completed_at)
         VALUES ($1, $2, $3, 'responses', 'legacy-model', 'system-v1', '1.0',
                 'compact', '{}'::jsonb, $4, 'COMPLETED', 1, now(), now())`,
        [
          legacyModelRequestId,
          analysisId,
          legacyModelRequestId,
          "1".repeat(64),
        ],
      );
      await isolated.query(
        `INSERT INTO order_groups
          (id, analysis_id, idempotency_key, mode, state, expires_at)
         VALUES ($1, $2, $3, 'demo', 'ACTIVE', now() + interval '1 hour')`,
        [orderGroupId, analysisId, `upgrade-${orderGroupId}`],
      );
      await isolated.query(
        `INSERT INTO orders
          (id, order_group_id, side, order_type, state, client_order_id,
           strategy_label, idempotency_key, entry_price, stop_loss, take_profit,
           requested_volume, normalized_volume, expires_at)
         VALUES ($1, $2, 'BUY', 'STOP', 'PENDING', $3,
                 'ctrader-ai-scalper:upgrade', $4, 2001, 1999, 2005,
                 100, 100, now() + interval '1 hour')`,
        [orderId, orderGroupId, `upgrade-${orderId}`, `idempotency-${orderId}`],
      );
      const legacyAuditId = randomUUID();
      await isolated.query(
        `INSERT INTO audit_events
          (id, occurred_at, severity, service, instance_id, environment,
           trading_mode, analysis_id, event_name, outcome)
         VALUES ($1, now(), 'info', 'execution-service', 'upgrade-instance',
                 'test', 'demo', $2, 'legacy_before_outbox', 'accepted')`,
        [legacyAuditId, analysisId],
      );
      await copyFile(
        path.resolve("migrations", "0006_ctrader_demo_execution_events.sql"),
        path.join(migrationDirectory, "0006_ctrader_demo_execution_events.sql"),
      );
      await copyFile(
        path.resolve("migrations", "0007_spread_observations.sql"),
        path.join(migrationDirectory, "0007_spread_observations.sql"),
      );
      await copyFile(
        path.resolve("migrations", "0008_observability_outbox.sql"),
        path.join(migrationDirectory, "0008_observability_outbox.sql"),
      );
      await copyFile(
        path.resolve("migrations", "0009_model_prompt_artifacts.sql"),
        path.join(migrationDirectory, "0009_model_prompt_artifacts.sql"),
      );
      await copyFile(
        path.resolve("migrations", "0010_automatic_analysis_intervals.sql"),
        path.join(migrationDirectory, "0010_automatic_analysis_intervals.sql"),
      );
      expect(await migrate(isolated, migrationDirectory)).toEqual([
        "0006",
        "0007",
        "0008",
        "0009",
        "0010",
      ]);
      await isolated.query(
        `UPDATE orders
         SET state = 'FILLED', broker_order_id = 'closing-child-601',
             filled_volume = 100
         WHERE id = $1`,
        [orderId],
      );
      await isolated.query(
        `INSERT INTO broker_execution_events
          (id, account_id, symbol_id, order_group_id, order_id,
           broker_event_key, payload_hash, schema_version, execution_type,
           client_order_id, broker_order_id, broker_fill_id, mapping_state,
           reason_codes, normalized_payload, occurred_at, received_at)
         VALUES ($1, $2, $3, $4, $5, 'deal:upgrade-fill', $6, '1.0', 3,
                 $7, 'entry-order-501', 'upgrade-fill', 'MAPPED', '[]'::jsonb,
                 '{}'::jsonb, now() - interval '1 minute', now())`,
        [
          randomUUID(),
          accountId,
          symbolId,
          orderGroupId,
          orderId,
          "2".repeat(64),
          `upgrade-${orderId}`,
        ],
      );
      await copyFile(
        path.resolve("migrations", "0011_ctrader_closing_order_evidence.sql"),
        path.join(
          migrationDirectory,
          "0011_ctrader_closing_order_evidence.sql",
        ),
      );
      expect(await migrate(isolated, migrationDirectory)).toEqual(["0011"]);
      const restoredEntry = await isolated.query<{
        broker_order_id: string;
        broker_order_type: number | null;
        closing_order: boolean;
      }>(
        `SELECT o.broker_order_id, e.broker_order_type, e.closing_order
         FROM orders o
         JOIN broker_execution_events e ON e.order_id = o.id
         WHERE o.id = $1`,
        [orderId],
      );
      expect(restoredEntry.rows[0]).toEqual({
        broker_order_id: "entry-order-501",
        broker_order_type: null,
        closing_order: false,
      });
      const legacyPrompt = await isolated.query<{
        system_prompt: string | null;
        system_prompt_sha256: string | null;
      }>(
        `SELECT system_prompt, system_prompt_sha256
         FROM model_requests WHERE id = $1`,
        [legacyModelRequestId],
      );
      expect(legacyPrompt.rows[0]).toEqual({
        system_prompt: null,
        system_prompt_sha256: null,
      });
      await expect(
        isolated.query(
          `UPDATE model_requests SET system_prompt = 'incomplete' WHERE id = $1`,
          [legacyModelRequestId],
        ),
      ).rejects.toThrow();
      await expect(
        isolated.query(
          `UPDATE model_requests
           SET prompt_version = 'system-v2', schema_version = '2.0'
           WHERE id = $1`,
          [legacyModelRequestId],
        ),
      ).rejects.toThrow();
      const upgraded = await isolated.query<{ account_id: string }>(
        "SELECT account_id FROM orders WHERE id = $1",
        [orderId],
      );
      expect(upgraded.rows[0]?.account_id).toBe(accountId);
      const journal = await isolated.query<{ exists: boolean }>(
        `SELECT to_regclass('broker_execution_events') IS NOT NULL AS exists`,
      );
      expect(journal.rows[0]?.exists).toBe(true);
      const spreadTable = await isolated.query<{ exists: boolean }>(
        `SELECT to_regclass('spread_observations') IS NOT NULL AS exists`,
      );
      expect(spreadTable.rows[0]?.exists).toBe(true);
      const automaticIntervalTable = await isolated.query<{ exists: boolean }>(
        `SELECT to_regclass('automatic_analysis_intervals') IS NOT NULL AS exists`,
      );
      expect(automaticIntervalTable.rows[0]?.exists).toBe(true);
      const legacyOutbox = await isolated.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM observability_outbox
         WHERE audit_event_id = $1`,
        [legacyAuditId],
      );
      expect(legacyOutbox.rows[0]?.count).toBe("0");
      const newAuditId = randomUUID();
      await isolated.query(
        `INSERT INTO audit_events
          (id, occurred_at, severity, service, instance_id, environment,
           trading_mode, analysis_id, event_name, outcome)
         VALUES ($1, now(), 'info', 'execution-service', 'upgrade-instance',
                 'test', 'demo', $2, 'new_after_outbox', 'accepted')`,
        [newAuditId, analysisId],
      );
      const newOutbox = await isolated.query<{
        count: string;
        status: string;
      }>(
        `SELECT count(*)::text AS count, min(status) AS status
         FROM observability_outbox WHERE audit_event_id = $1`,
        [newAuditId],
      );
      expect(newOutbox.rows[0]).toEqual({ count: "1", status: "PENDING" });
      const clientOrderConstraints = await isolated.query<{
        definition: string;
      }>(
        `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'orders'::regclass AND contype = 'u'
           AND pg_get_constraintdef(oid) LIKE '%client_order_id%'`,
      );
      expect(clientOrderConstraints.rows.map((row) => row.definition)).toEqual([
        "UNIQUE (account_id, client_order_id)",
      ]);
      for (const file of (
        await migrationFiles(path.resolve("migrations"))
      ).filter((file) => file >= "0012" && file < "0020")) {
        await copyFile(
          path.resolve("migrations", file),
          path.join(migrationDirectory, file),
        );
      }
      await migrate(isolated, migrationDirectory);
      const insertContext = (model: string) =>
        isolated.query(
          `INSERT INTO scenario_contexts
          (id,account_id,symbol_id,source_analysis_id,mode,requested_at,captured_at,
           valid_until,state,requested_model,tick_size,reason)
         VALUES ($1,$2,$3,$4,'demo',now(),now(),now()+interval '5 minutes',
                 'FAILED',$5,'0.01','AI_PROVIDER_TIMEOUT')`,
          [randomUUID(), accountId, symbolId, analysisId, model],
        );
      await insertContext("gpt-6-astra/u64");
      await insertContext("gpt-5.6-sol/u40");
      const historyBefore = (
        await isolated.query("SELECT * FROM scenario_contexts ORDER BY id")
      ).rows;
      await expect(insertContext("deepseek-v4-pro/u5W")).rejects.toMatchObject({
        code: "23514",
      });
      await copyFile(
        path.resolve("migrations", "0020_deepseek_context_model.sql"),
        path.join(migrationDirectory, "0020_deepseek_context_model.sql"),
      );
      expect(await migrate(isolated, migrationDirectory)).toEqual(["0020"]);
      expect(
        (await isolated.query("SELECT * FROM scenario_contexts ORDER BY id"))
          .rows,
      ).toEqual(historyBefore);
      await insertContext("deepseek-v4-pro/u5W");
      await expect(insertContext("deepseek-v4-pro/u5X")).rejects.toMatchObject({
        code: "23514",
      });
      expect(await migrate(isolated, migrationDirectory)).toEqual([]);
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
      await rm(migrationDirectory, { recursive: true, force: true });
    }
  });
});
