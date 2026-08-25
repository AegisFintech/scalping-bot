import { createHash, randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";
import type pg from "pg";

import type {
  AnalyticsResponse,
  GatewayOrder,
  MarketSnapshot,
  ModelPromptArtifact,
  ModelResponse,
  OcoPlacementResult,
  ReconciliationSnapshot,
  TradingMode,
} from "../../../packages/contracts/src/index.js";
import { redact, type LogValue } from "../../../packages/logging/src/index.js";
import { canonical } from "../../../packages/risk-engine/src/decimal.js";
import type { DecisionTrail } from "./coordinator.js";
import type { OcoEvaluation } from "./oco-risk-evaluator.js";
import type { PaperPositionSummary } from "./paper-gateway.js";
import type { AnalysisTransition } from "./state-machine.js";

export interface PostgresDecisionTrailOptions {
  readonly pool: pg.Pool;
  readonly accountId: string;
  readonly symbolId: string;
  readonly strategyVersionId: string;
  readonly mode: TradingMode;
  readonly apiStyle: "responses" | "chat_completions";
  readonly model: string;
  readonly promptVersion: ModelPromptArtifact["version"];
  readonly schemaVersion: ModelResponse["schema_version"];
  readonly payloadMode: "full" | "compact";
  readonly instanceId: string;
  readonly environment: string;
}

function safeJson(value: unknown): string {
  return JSON.stringify(redact(value as LogValue));
}

function timeframeFeatures(
  response: AnalyticsResponse,
  timeframe: string,
): Record<string, unknown> {
  const timeframes = response.features.timeframes;
  if (
    timeframes === null ||
    typeof timeframes !== "object" ||
    Array.isArray(timeframes)
  )
    return {};
  const value = (timeframes as Record<string, unknown>)[timeframe];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function depthImbalance(
  snapshot: MarketSnapshot,
  count: number,
): string | null {
  const bid = snapshot.orderBook.bids
    .slice(0, count)
    .reduce((total, level) => total.plus(level.size), new Decimal(0));
  const ask = snapshot.orderBook.asks
    .slice(0, count)
    .reduce((total, level) => total.plus(level.size), new Decimal(0));
  const total = bid.plus(ask);
  return total.eq(0) ? null : canonical(bid.minus(ask).div(total));
}

export class PostgresDecisionTrail implements DecisionTrail {
  readonly #options: PostgresDecisionTrailOptions;
  readonly #candleSnapshots = new Map<string, string>();
  readonly #modelResponses = new Map<string, string>();
  #lastReconciliationFingerprint: string | null = null;

  constructor(options: PostgresDecisionTrailOptions) {
    this.#options = options;
  }

  async start(input: {
    readonly analysisId: string;
    readonly mode: string;
    readonly symbol: string;
  }): Promise<void> {
    if (input.mode !== this.#options.mode)
      throw new Error("TRAIL_MODE_MISMATCH");
    await this.#options.pool.query(
      `INSERT INTO analysis_runs
        (id, account_id, symbol_id, strategy_version_id, mode, state, analysis_time)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', now())`,
      [
        input.analysisId,
        this.#options.accountId,
        this.#options.symbolId,
        this.#options.strategyVersionId,
        input.mode,
      ],
    );
    await this.#audit(input.analysisId, "analysis_started", "accepted", null, {
      symbol: input.symbol,
    });
  }

  async transition(
    analysisId: string,
    transition: AnalysisTransition,
  ): Promise<void> {
    const terminal = transition.to === "REJECTED" ? transition.reasonCodes : [];
    await this.#options.pool.query(
      `UPDATE analysis_runs
       SET state = $2, rejection_reasons = CASE WHEN $2 = 'REJECTED' THEN $3::jsonb ELSE rejection_reasons END,
           updated_at = $4
       WHERE id = $1`,
      [
        analysisId,
        transition.to,
        JSON.stringify(terminal),
        transition.occurredAt,
      ],
    );
    await this.#audit(
      analysisId,
      "analysis_transition",
      transition.to.toLowerCase(),
      transition.reasonCodes[0] ?? null,
      {
        from: transition.from,
        to: transition.to,
        reason_codes: transition.reasonCodes,
      },
    );
  }

  async market(analysisId: string, snapshot: MarketSnapshot): Promise<void> {
    const candleSnapshotId = randomUUID();
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO candle_snapshots
          (id, account_id, symbol_id, analysis_time, server_time, received_at, max_skew_ms, complete)
         VALUES ($1, $2, $3, $4, $4, $5, $6, true)`,
        [
          candleSnapshotId,
          this.#options.accountId,
          this.#options.symbolId,
          snapshot.serverTime,
          snapshot.capturedAt,
          snapshot.observedSkewMs,
        ],
      );
      for (const series of snapshot.candles) {
        for (const candle of series.candles) {
          await client.query(
            `INSERT INTO candles
              (id, snapshot_id, timeframe, start_time, end_time, open, high, low, close, volume, complete, quality_flags)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
            [
              randomUUID(),
              candleSnapshotId,
              series.timeframe,
              candle.startTime,
              candle.endTime,
              candle.open,
              candle.high,
              candle.low,
              candle.close,
              candle.volume,
              candle.complete,
              JSON.stringify(candle.qualityFlags),
            ],
          );
        }
      }
      const orderBookId = await this.#persistOrderBook(
        client,
        candleSnapshotId,
        snapshot,
      );
      await client.query(
        `UPDATE analysis_runs
         SET candle_snapshot_id = $2, order_book_snapshot_id = $3, analysis_time = $4, updated_at = now()
         WHERE id = $1`,
        [analysisId, candleSnapshotId, orderBookId, snapshot.serverTime],
      );
      await client.query("COMMIT");
      this.#candleSnapshots.set(analysisId, candleSnapshotId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.#audit(
      analysisId,
      "market_snapshot_persisted",
      "accepted",
      null,
      {
        server_time: snapshot.serverTime,
        captured_at: snapshot.capturedAt,
        observed_skew_ms: snapshot.observedSkewMs,
        candle_counts: Object.fromEntries(
          snapshot.candles.map((series) => [
            series.timeframe,
            series.candles.length,
          ]),
        ),
        completed_candles_only: snapshot.candles.every((series) =>
          series.candles.every((candle) => candle.complete),
        ),
        order_book: {
          bid_levels: snapshot.orderBook.bids.length,
          ask_levels: snapshot.orderBook.asks.length,
          complete: snapshot.orderBook.complete,
          discontinuity: snapshot.orderBook.discontinuity,
          reconnect_sequence: snapshot.orderBook.reconnectSequence,
        },
      },
    );
  }

  async decisionMarket(
    analysisId: string,
    snapshot: MarketSnapshot,
  ): Promise<void> {
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      const analysis = await client.query<{
        candle_snapshot_id: string | null;
      }>(
        `SELECT candle_snapshot_id FROM analysis_runs WHERE id = $1 FOR UPDATE`,
        [analysisId],
      );
      const candleSnapshotId = analysis.rows[0]?.candle_snapshot_id;
      if (candleSnapshotId === null || candleSnapshotId === undefined) {
        throw new Error("TRAIL_CANDLE_SNAPSHOT_MISSING");
      }
      const orderBookId = await this.#persistOrderBook(
        client,
        candleSnapshotId,
        snapshot,
      );
      await client.query(
        `UPDATE analysis_runs
         SET order_book_snapshot_id = $2, updated_at = now()
         WHERE id = $1`,
        [analysisId, orderBookId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.#audit(
      analysisId,
      "decision_market_refreshed",
      "accepted",
      null,
      {
        server_time: snapshot.serverTime,
        captured_at: snapshot.capturedAt,
        observed_skew_ms: snapshot.observedSkewMs,
        quote: {
          source_time: snapshot.quote.sourceTime,
          received_at: snapshot.quote.receivedAt,
          bid: snapshot.quote.bid,
          ask: snapshot.quote.ask,
        },
        order_book: {
          source_time: snapshot.orderBook.sourceTime,
          received_at: snapshot.orderBook.receivedAt,
          bid_levels: snapshot.orderBook.bids.length,
          ask_levels: snapshot.orderBook.asks.length,
          complete: snapshot.orderBook.complete,
          discontinuity: snapshot.orderBook.discontinuity,
          reconnect_sequence: snapshot.orderBook.reconnectSequence,
        },
      },
    );
  }

  async analytics(
    analysisId: string,
    response: AnalyticsResponse,
  ): Promise<void> {
    const snapshotId = this.#candleSnapshots.get(analysisId);
    if (snapshotId === undefined)
      throw new Error("TRAIL_CANDLE_SNAPSHOT_MISSING");
    const m1 = timeframeFeatures(response, "M1");
    await this.#options.pool.query(
      `INSERT INTO indicator_snapshots
        (id, candle_snapshot_id, feature_version, generated_at, atr, ema_fast, ema_slow,
         features, acceptable, rejection_reasons)
       VALUES ($1, $2, '1.0', $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)`,
      [
        randomUUID(),
        snapshotId,
        response.generatedAt,
        typeof m1.atr === "string" ? m1.atr : null,
        typeof m1.ema_fast === "string" ? m1.ema_fast : null,
        typeof m1.ema_slow === "string" ? m1.ema_slow : null,
        safeJson(response.features),
        response.acceptable,
        JSON.stringify(response.rejectionReasons),
      ],
    );
    await this.#audit(
      analysisId,
      "analytics_completed",
      response.acceptable ? "accepted" : "rejected",
      response.rejectionReasons[0] ?? null,
      {
        feature_version: "1.0",
        generated_at: response.generatedAt,
        acceptable: response.acceptable,
        reason_codes: response.rejectionReasons,
        m1: {
          atr: typeof m1.atr === "string" ? m1.atr : null,
          ema_fast: typeof m1.ema_fast === "string" ? m1.ema_fast : null,
          ema_slow: typeof m1.ema_slow === "string" ? m1.ema_slow : null,
        },
        session_gap_counts: Object.fromEntries(
          ["M1", "M5", "M15"].map((timeframe) => {
            const features = timeframeFeatures(response, timeframe);
            return [timeframe, features.session_gap_count ?? null];
          }),
        ),
      },
    );
  }

  async model(
    analysisId: string,
    requestPayload: Readonly<Record<string, unknown>>,
    response: ModelResponse,
    rawResponse: string,
    promptArtifact: ModelPromptArtifact,
  ): Promise<void> {
    if (
      promptArtifact.version !== this.#options.promptVersion ||
      Buffer.byteLength(promptArtifact.content, "utf8") < 1 ||
      Buffer.byteLength(promptArtifact.content, "utf8") > 65_536 ||
      !/^[0-9a-f]{64}$/.test(promptArtifact.sha256) ||
      createHash("sha256").update(promptArtifact.content).digest("hex") !==
        promptArtifact.sha256
    ) {
      throw new Error("MODEL_PROMPT_ARTIFACT_INVALID");
    }
    const requestId = randomUUID();
    const responseId = randomUUID();
    const redactedRequest = safeJson(requestPayload);
    const redactedResponse = safeJson(response);
    const redactedRawValue = redact(rawResponse);
    const redactedRaw =
      typeof redactedRawValue === "string"
        ? redactedRawValue
        : "[REDACTED_INVALID_RAW]";
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO model_requests
          (id, analysis_id, request_id, api_style, model, prompt_version, schema_version,
           payload_mode, system_prompt, system_prompt_sha256, payload_redacted,
           payload_sha256, status, attempt_count, requested_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12,
                 'COMPLETED', 1, now(), now())`,
        [
          requestId,
          analysisId,
          requestId,
          this.#options.apiStyle,
          this.#options.model,
          this.#options.promptVersion,
          this.#options.schemaVersion,
          this.#options.payloadMode,
          promptArtifact.content,
          promptArtifact.sha256,
          redactedRequest,
          createHash("sha256").update(redactedRequest).digest("hex"),
        ],
      );
      await client.query(
        `INSERT INTO model_responses
          (id, model_request_id, status, raw_redacted, parsed_payload, received_at)
         VALUES ($1, $2, 'COMPLETED', $3, $4::jsonb, now())`,
        [responseId, requestId, redactedRaw, redactedResponse],
      );
      await client.query(
        "UPDATE analysis_runs SET valid_until = $2, updated_at = now() WHERE id = $1",
        [analysisId, response.valid_until],
      );
      await client.query("COMMIT");
      this.#modelResponses.set(analysisId, responseId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.#audit(analysisId, "model_completed", "accepted", null, {
      request_id: requestId,
      response_id: responseId,
      api_style: this.#options.apiStyle,
      model: this.#options.model,
      prompt_version: this.#options.promptVersion,
      schema_version: this.#options.schemaVersion,
      payload_mode: this.#options.payloadMode,
      proposal_type: "OCO",
      market_regime: response.market_regime,
      valid_until: response.valid_until,
      data_quality: response.data_quality,
      evidence_codes: response.evidence_codes,
      risk_flags: response.risk_flags,
    });
  }

  async validation(
    analysisId: string,
    stage: "SEMANTIC" | "RISK" | "LIVE_GATE",
    accepted: boolean,
    reasons: readonly string[],
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.#options.pool.query(
      `INSERT INTO validation_results
        (id, analysis_id, model_response_id, stage, accepted, reason_codes, details, validated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now())`,
      [
        randomUUID(),
        analysisId,
        this.#modelResponses.get(analysisId) ?? null,
        stage,
        accepted,
        JSON.stringify(reasons),
        safeJson(details),
      ],
    );
    await this.#audit(
      analysisId,
      "validation_completed",
      accepted ? "accepted" : "rejected",
      reasons[0] ?? null,
      { ...details, stage, reason_codes: reasons },
    );
  }

  async intent(analysisId: string, evaluation: OcoEvaluation): Promise<void> {
    if (
      !evaluation.approved ||
      evaluation.commands === null ||
      evaluation.risk === null
    ) {
      throw new Error("TRAIL_UNAPPROVED_INTENT_FORBIDDEN");
    }
    const [buyCommand, sellCommand] = evaluation.commands;
    const groupKey = createHash("sha256")
      .update(
        [buyCommand.idempotencyKey, sellCommand.idempotencyKey]
          .sort()
          .join(":"),
      )
      .digest("hex");
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      for (const [side, decision, command] of [
        ["BUY", evaluation.risk.buy, buyCommand],
        ["SELL", evaluation.risk.sell, sellCommand],
      ] as const) {
        await client.query(
          `INSERT INTO risk_decisions
            (id, analysis_id, side, approved, equity, risk_percent, risk_budget, entry_price,
             stop_loss, stop_distance, raw_volume, normalized_volume, estimated_margin,
             reason_codes, decided_at)
           VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   '[]'::jsonb, now())`,
          [
            randomUUID(),
            analysisId,
            side,
            evaluation.equity,
            evaluation.perLegRiskPercent,
            decision.riskBudget,
            command.entryPrice,
            command.stopLoss,
            canonical(
              new Decimal(command.entryPrice).minus(command.stopLoss).abs(),
            ),
            decision.rawVolume,
            decision.normalizedVolume,
            decision.estimatedMargin,
          ],
        );
      }
      await client.query(
        `INSERT INTO order_groups (id, analysis_id, idempotency_key, mode, state, expires_at)
         VALUES ($1, $2, $3, $4, 'INTENT_RECORDED', $5)`,
        [
          buyCommand.orderGroupId,
          analysisId,
          groupKey,
          this.#options.mode,
          buyCommand.expiresAt,
        ],
      );
      for (const command of evaluation.commands) {
        await client.query(
          `INSERT INTO orders
            (id, account_id, order_group_id, side, order_type, state, client_order_id, strategy_owned,
             strategy_label, idempotency_key, entry_price, stop_loss, take_profit,
             requested_volume, normalized_volume, expires_at)
           VALUES ($1, $2, $3, $4, 'STOP', 'INTENT', $5, true, $6, $7, $8, $9, $10, $11, $11, $12)`,
          [
            randomUUID(),
            this.#options.accountId,
            command.orderGroupId,
            command.side,
            command.clientOrderId,
            command.strategyLabel,
            command.idempotencyKey,
            command.entryPrice,
            command.stopLoss,
            command.takeProfit,
            command.volume,
            command.expiresAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.#audit(analysisId, "risk_intent_persisted", "accepted", null, {
      order_group_id: buyCommand.orderGroupId,
      per_leg_risk_percent: evaluation.perLegRiskPercent,
      commands: evaluation.commands.map((command) => ({
        side: command.side,
        entry_price: command.entryPrice,
        stop_loss: command.stopLoss,
        take_profit: command.takeProfit,
        normalized_volume: command.volume,
        expires_at: command.expiresAt,
      })),
    });
  }

  async placement(
    analysisId: string,
    result: OcoPlacementResult,
  ): Promise<void> {
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      for (const order of result.orders) {
        await client.query(
          `UPDATE orders
           SET broker_order_id = $2, state = $3, filled_volume = $4, updated_at = $5,
               submitted_at = COALESCE(submitted_at, $5), version = version + 1
           WHERE client_order_id = $1`,
          [
            order.clientOrderId,
            order.brokerOrderId,
            order.state,
            order.filledVolume,
            order.updatedAt,
          ],
        );
      }
      const groupState = result.orders.every(
        (order) => order.state === "REJECTED",
      )
        ? "FAILED"
        : result.orders.some((order) => order.state === "UNKNOWN")
          ? "RECONCILIATION_REQUIRED"
          : "ACTIVE";
      await client.query(
        "UPDATE order_groups SET state = $2, updated_at = now() WHERE id = $1",
        [result.orderGroupId, groupState],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.#audit(analysisId, "oco_placement_completed", "accepted", null, {
      order_group_id: result.orderGroupId,
      idempotent_replay: result.idempotentReplay,
      orders: result.orders.map((order) => ({
        state: order.state,
        filled_volume: order.filledVolume,
        updated_at: order.updatedAt,
      })),
    });
  }

  async reconciliation(snapshot: ReconciliationSnapshot): Promise<void> {
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      for (const order of snapshot.orders) {
        if (order.clientOrderId.startsWith("manual:")) continue;
        await client.query(
          `UPDATE orders
           SET broker_order_id = COALESCE($2, broker_order_id), state = $3,
               filled_volume = $4, updated_at = $5, version = version + 1
           WHERE client_order_id = $1`,
          [
            order.clientOrderId,
            order.brokerOrderId,
            order.state,
            order.filledVolume,
            order.updatedAt,
          ],
        );
      }
      const touchedClientOrderIds = snapshot.orders
        .filter((order) => !order.clientOrderId.startsWith("manual:"))
        .map((order) => order.clientOrderId);
      if (touchedClientOrderIds.length > 0) {
        await client.query(
          `UPDATE order_groups og
           SET state = CASE
             WHEN EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                           AND o.state IN ('PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN'))
               THEN 'RECONCILIATION_REQUIRED'
             WHEN EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id AND o.state = 'FILLED')
              AND EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                           AND o.state IN ('INTENT','SUBMITTING','PENDING'))
               THEN 'RECONCILIATION_REQUIRED'
             WHEN EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id AND o.state = 'FILLED')
               THEN 'POSITION_OPEN'
             WHEN NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                              AND o.state IN ('INTENT','SUBMITTING','PENDING'))
              AND EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id AND o.state = 'EXPIRED')
               THEN 'EXPIRED'
             WHEN NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                              AND o.state IN ('INTENT','SUBMITTING','PENDING'))
               THEN 'FAILED'
             ELSE 'ACTIVE'
           END,
           updated_at = now()
           WHERE og.state NOT IN ('CLOSED', 'EXPIRED', 'FAILED')
             AND EXISTS (
               SELECT 1 FROM orders o
               WHERE o.order_group_id = og.id
                 AND o.client_order_id = ANY($1::text[])
             )`,
          [touchedClientOrderIds],
        );
      }
      if (!snapshot.certain) {
        await client.query(
          `UPDATE order_groups og
           SET state = 'RECONCILIATION_REQUIRED', updated_at = now()
           WHERE og.state NOT IN ('CLOSED', 'EXPIRED', 'FAILED')
             AND EXISTS (
               SELECT 1 FROM orders o
               WHERE o.order_group_id = og.id
                 AND o.client_order_id = ANY($1::text[])
             )`,
          [touchedClientOrderIds],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const stateCounts = Object.fromEntries(
      [...new Set(snapshot.orders.map((order) => order.state))]
        .sort()
        .map((state) => [
          state,
          snapshot.orders.filter((order) => order.state === state).length,
        ]),
    );
    const summary = {
      certain: snapshot.certain,
      reason_codes: snapshot.reasonCodes,
      strategy_order_count: snapshot.orders.filter(
        (order) =>
          order.reasonCode !== "DEMO_MANUAL_ORDER_BLOCKING" &&
          !order.clientOrderId.startsWith("manual:"),
      ).length,
      manual_order_count: snapshot.orders.filter(
        (order) =>
          order.reasonCode === "DEMO_MANUAL_ORDER_BLOCKING" ||
          order.clientOrderId.startsWith("manual:"),
      ).length,
      relevant_position_count: snapshot.relevantPositionCount,
      order_state_counts: stateCounts,
    };
    const fingerprint = createHash("sha256")
      .update(safeJson(summary))
      .digest("hex");
    if (fingerprint !== this.#lastReconciliationFingerprint) {
      await this.#audit(
        null,
        "reconciliation_completed",
        snapshot.certain ? "accepted" : "rejected",
        snapshot.reasonCodes[0] ?? null,
        summary,
      );
      this.#lastReconciliationFingerprint = fingerprint;
    }
  }

  async paperState(
    updates: readonly GatewayOrder[],
    positions: readonly PaperPositionSummary[],
  ): Promise<void> {
    await this.reconciliation({
      asOf: new Date().toISOString(),
      certain: !positions.some((position) => position.state === "UNKNOWN"),
      reasonCodes: [],
      orders: updates,
      relevantPositionCount: positions.filter(
        (position) => position.state !== "CLOSED",
      ).length,
    });
    for (const position of positions) {
      const order = await this.#options.pool.query<{
        order_id: string;
        order_group_id: string;
        analysis_id: string;
        model: string | null;
        strategy_version: string;
        parsed_payload: unknown;
      }>(
        `SELECT o.id AS order_id, o.order_group_id, og.analysis_id,
                mq.model, sv.version AS strategy_version, mr.parsed_payload
         FROM orders o
         JOIN order_groups og ON og.id = o.order_group_id
         JOIN analysis_runs ar ON ar.id = og.analysis_id
         JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
         LEFT JOIN model_requests mq ON mq.analysis_id = ar.id
         LEFT JOIN model_responses mr ON mr.model_request_id = mq.id
         WHERE o.client_order_id = $1
         ORDER BY mr.received_at DESC NULLS LAST
         LIMIT 1`,
        [position.clientOrderId],
      );
      const info = order.rows[0];
      if (info === undefined) throw new Error("PAPER_POSITION_ORDER_MISSING");
      const positionId = randomUUID();
      const brokerPositionId = `paper:${position.clientOrderId}`;
      const stored = await this.#options.pool.query<{ id: string }>(
        `INSERT INTO positions
          (id, account_id, symbol_id, order_group_id, broker_position_id, side, state,
           strategy_owned, volume, entry_price, stop_loss, take_profit, unrealized_pnl,
           opened_at, closed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, 0,
                 $12, $13, $14)
         ON CONFLICT (broker_position_id) WHERE broker_position_id IS NOT NULL
         DO UPDATE SET state = EXCLUDED.state, volume = EXCLUDED.volume,
           entry_price = EXCLUDED.entry_price, stop_loss = EXCLUDED.stop_loss,
           take_profit = EXCLUDED.take_profit, closed_at = EXCLUDED.closed_at,
           updated_at = EXCLUDED.updated_at,
           reconciliation_version = positions.reconciliation_version + 1
         RETURNING id`,
        [
          positionId,
          this.#options.accountId,
          this.#options.symbolId,
          info.order_group_id,
          brokerPositionId,
          position.side,
          position.state,
          position.volume,
          position.entryPrice,
          position.stopLoss,
          position.takeProfit,
          position.openedAt,
          position.state === "CLOSED" ? position.updatedAt : null,
          position.updatedAt,
        ],
      );
      const storedPositionId = stored.rows[0]?.id;
      if (storedPositionId === undefined)
        throw new Error("PAPER_POSITION_PERSIST_FAILED");
      await this.#options.pool.query(
        `INSERT INTO fills
          (id, order_id, broker_event_key, price, volume, occurred_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (broker_event_key) DO NOTHING`,
        [
          randomUUID(),
          info.order_id,
          `paper-fill:${position.clientOrderId}:${position.openedAt}`,
          position.entryPrice,
          position.volume,
          position.openedAt,
        ],
      );
      await this.#options.pool.query(
        "UPDATE order_groups SET state = $2, updated_at = $3 WHERE id = $1",
        [
          info.order_group_id,
          position.state === "CLOSED"
            ? "CLOSED"
            : position.state === "UNKNOWN"
              ? "RECONCILIATION_REQUIRED"
              : "POSITION_OPEN",
          position.updatedAt,
        ],
      );
      if (position.state === "CLOSED") {
        const payload =
          info.parsed_payload !== null &&
          typeof info.parsed_payload === "object" &&
          !Array.isArray(info.parsed_payload)
            ? (info.parsed_payload as Record<string, unknown>)
            : {};
        const confidenceValue =
          payload.confidence !== null &&
          typeof payload.confidence === "object" &&
          !Array.isArray(payload.confidence)
            ? Number((payload.confidence as Record<string, unknown>).overall)
            : 0;
        const confidenceBucket =
          confidenceValue >= 75
            ? "HIGH"
            : confidenceValue >= 50
              ? "MEDIUM"
              : "LOW";
        const setupTags = Array.isArray(payload.setup_tags)
          ? payload.setup_tags
          : [];
        const marketRegime =
          typeof payload.market_regime === "string"
            ? payload.market_regime
            : "UNCERTAIN";
        await this.#options.pool.query(
          `INSERT INTO trades
            (id, order_group_id, position_id, mode, direction, setup_tags, market_regime,
             confidence_bucket, realized_pnl, fees, opened_at, closed_at, model_version,
             prompt_version, schema_version, strategy_version)
           VALUES ($1, $2, $3, 'paper', $4, $5::jsonb, $6, $7, $8, 0, $9, $10,
                   $11, $12, $13, $14)
           ON CONFLICT (order_group_id)
           DO UPDATE SET realized_pnl = EXCLUDED.realized_pnl,
             closed_at = EXCLUDED.closed_at`,
          [
            randomUUID(),
            info.order_group_id,
            storedPositionId,
            position.side === "BUY" ? "LONG" : "SHORT",
            safeJson(setupTags),
            marketRegime,
            confidenceBucket,
            position.realizedPnl,
            position.openedAt,
            position.updatedAt,
            info.model ?? "unconfigured",
            this.#options.promptVersion,
            this.#options.schemaVersion,
            info.strategy_version,
          ],
        );
      }
    }
  }

  async #persistOrderBook(
    client: pg.PoolClient,
    candleSnapshotId: string,
    snapshot: MarketSnapshot,
  ): Promise<string> {
    const orderBookId = randomUUID();
    const bid = snapshot.orderBook.bids[0]?.price ?? null;
    const ask = snapshot.orderBook.asks[0]?.price ?? null;
    const spread =
      bid === null || ask === null
        ? null
        : canonical(new Decimal(ask).minus(bid));
    const weightedMid =
      bid === null || ask === null
        ? null
        : canonical(new Decimal(bid).plus(ask).div(2));
    const bestBidSize = snapshot.orderBook.bids[0]?.size;
    const bestAskSize = snapshot.orderBook.asks[0]?.size;
    const topSize =
      bestBidSize === undefined || bestAskSize === undefined
        ? new Decimal(0)
        : new Decimal(bestBidSize).plus(bestAskSize);
    const microprice =
      bid === null ||
      ask === null ||
      bestBidSize === undefined ||
      bestAskSize === undefined ||
      topSize.eq(0)
        ? null
        : canonical(
            new Decimal(ask)
              .mul(bestBidSize)
              .plus(new Decimal(bid).mul(bestAskSize))
              .div(topSize),
          );
    const age =
      Date.parse(snapshot.serverTime) -
      Date.parse(snapshot.orderBook.sourceTime);
    await client.query(
      `INSERT INTO order_book_snapshots
        (id, account_id, symbol_id, candle_snapshot_id, source_time, received_at, age_ms,
         bid, ask, spread, weighted_mid, microprice, imbalance_top5, imbalance_top10,
         imbalance_top20, complete, discontinuity, reconnect_sequence, aggregates)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19::jsonb)`,
      [
        orderBookId,
        this.#options.accountId,
        this.#options.symbolId,
        candleSnapshotId,
        snapshot.orderBook.sourceTime,
        snapshot.orderBook.receivedAt,
        Math.max(0, age),
        bid,
        ask,
        spread,
        weightedMid,
        microprice,
        depthImbalance(snapshot, 5),
        depthImbalance(snapshot, 10),
        depthImbalance(snapshot, 20),
        snapshot.orderBook.complete,
        snapshot.orderBook.discontinuity,
        snapshot.orderBook.reconnectSequence,
        safeJson({ windows: snapshot.orderBook.aggregates }),
      ],
    );
    for (const [side, levels] of [
      ["BID", snapshot.orderBook.bids],
      ["ASK", snapshot.orderBook.asks],
    ] as const) {
      for (const [index, level] of levels.entries()) {
        await client.query(
          `INSERT INTO order_book_levels (id, snapshot_id, side, level_index, price, size)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), orderBookId, side, index + 1, level.price, level.size],
        );
      }
    }
    return orderBookId;
  }

  async #audit(
    analysisId: string | null,
    eventName: string,
    outcome: string,
    reasonCode: string | null,
    details: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.#options.pool.query(
      `INSERT INTO audit_events
        (id, occurred_at, severity, service, instance_id, environment, trading_mode,
         analysis_id, event_name, outcome, reason_code, schema_version, model_version, details)
       VALUES ($1, now(), 'info', 'execution-service', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        randomUUID(),
        this.#options.instanceId,
        this.#options.environment,
        this.#options.mode,
        analysisId,
        eventName,
        outcome,
        reasonCode,
        this.#options.schemaVersion,
        this.#options.model,
        safeJson(details),
      ],
    );
  }
}
