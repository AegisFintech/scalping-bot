import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  createPool,
  databaseConnectionString,
  migrate,
} from "../../packages/database/src/index.js";
import { DailyRiskStore } from "../../apps/execution-service/src/daily-risk-store.js";
import { PostgresAutomaticAnalysisSchedule } from "../../apps/execution-service/src/automatic-analysis-schedule.js";
import { normalizeDemoExecution } from "../../apps/execution-service/src/demo-execution.js";
import { PostgresDemoExecutionStore } from "../../apps/execution-service/src/demo-execution-store.js";
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
    schema_version: "2.0",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: "2026-08-24T00:00:00.000Z",
    valid_until: validUntil,
    market_regime: "UNCERTAIN",
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
      tickSize: "0.01",
      tickValue: "0.01",
      contractSize: "100",
      volumeScale: "0.01",
      minVolume: "100",
      maxVolume: "100000",
      volumeStep: "100",
      minStopDistance: "0.1",
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
  databaseTest("applies all migrations in an isolated schema", async () => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({
      connectionString: databaseConnectionString(connectionString as string),
      ssl: { rejectUnauthorized: true },
    });
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
      ]);
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
      await expect(
        risk.initializeReconciledBaseline(baselineInput),
      ).rejects.toThrow("DAILY_RISK_BASELINE_ALREADY_EXISTS");

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
        schemaVersion: "2.0",
        payloadMode: "compact",
        instanceId: "integration-instance",
        environment: "test",
      });
      await trail.market(
        analysisId,
        decisionSnapshot("2026-08-24T00:00:00.000Z"),
      );
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
      const refreshedMarket = await isolated.query<{
        candle_snapshot_id: string;
        order_book_snapshot_id: string;
        source_time: Date;
        order_book_count: string;
        refresh_audit_count: string;
      }>(
        `SELECT ar.candle_snapshot_id, ar.order_book_snapshot_id,
                obs.source_time,
                (SELECT count(*)::text FROM order_book_snapshots
                 WHERE candle_snapshot_id = ar.candle_snapshot_id) AS order_book_count,
                (SELECT count(*)::text FROM audit_events
                 WHERE analysis_id = ar.id
                   AND event_name = 'decision_market_refreshed') AS refresh_audit_count
         FROM analysis_runs ar
         JOIN order_book_snapshots obs ON obs.id = ar.order_book_snapshot_id
         WHERE ar.id = $1`,
        [analysisId],
      );
      expect(refreshedMarket.rows[0]).toMatchObject({
        candle_snapshot_id: initialMarketIds.rows[0]?.candle_snapshot_id,
        source_time: new Date("2026-08-24T00:00:10.000Z"),
        order_book_count: "2",
        refresh_audit_count: "1",
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
        ),
      ).resolves.toBeUndefined();
      const modelTrail = await isolated.query<{
        id_matches_request_id: boolean;
        requests: string;
        responses: string;
        valid_until: Date | null;
        authorization: string;
        system_prompt: string;
        system_prompt_sha256: string;
      }>(
        `SELECT mr.id::text = mr.request_id AS id_matches_request_id,
                (SELECT count(*)::text FROM model_requests WHERE analysis_id = $1) AS requests,
                (SELECT count(*)::text FROM model_responses mres
                 JOIN model_requests mreq ON mreq.id = mres.model_request_id
                 WHERE mreq.analysis_id = $1) AS responses,
                ar.valid_until,
                mr.payload_redacted ->> 'authorization' AS authorization,
                mr.system_prompt, mr.system_prompt_sha256
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
      });
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
      const accepted = normalizeDemoExecution(
        await eventFixture("demo-order-accepted-v1.json"),
        { symbolId: "7" },
      );
      expect(accepted).not.toBeNull();
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
      await expect(store.persist(partial!)).resolves.toEqual({
        certain: true,
        reasonCodes: [],
      });
      await isolated.query(
        `UPDATE orders SET state = 'CANCELLED', updated_at = now()
         WHERE account_id = $1 AND client_order_id = $2`,
        [demoAccountId, "cas-sell-22222222222222222222222"],
      );
      const closedRaw = await eventFixture("demo-position-closed-v1.json");
      const closed = normalizeDemoExecution(closedRaw, { symbolId: "7" });
      expect(closed).not.toBeNull();
      await expect(store.persist(closed!)).resolves.toEqual({
        certain: true,
        reasonCodes: [],
      });
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
        schema_version: "2.0",
        strategy_version: `integration-${strategyVersionId}`,
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
      );
      await maintenance.expireAndReconcile();
      const terminalAnalysis = await isolated.query<{ state: string }>(
        "SELECT state FROM analysis_runs WHERE id = $1",
        [analysisId],
      );
      expect(terminalAnalysis.rows[0]?.state).toBe("EXPIRED");
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });

  databaseTest("upgrades 0005 safely through 0009", async () => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const migrationDirectory = await mkdtemp(
      path.join(os.tmpdir(), "ctrader-migrations-"),
    );
    const admin = new pg.Pool({
      connectionString: databaseConnectionString(connectionString as string),
      ssl: { rejectUnauthorized: true },
    });
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
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
      await rm(migrationDirectory, { recursive: true, force: true });
    }
  });
});
