import { timingSafeEqual } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import type { RuntimeControlStore } from "../../../packages/database/src/runtime-controls.js";
import type { AnalysisCoordinator, CycleResult } from "./coordinator.js";
import type { OrderMaintenance } from "./order-maintenance.js";

export interface ExecutionStatus {
  readonly mode: string;
  readonly symbol: string;
  readonly accountType: string;
  readonly emergencyStopped: boolean;
  readonly pauseNewAnalyses: boolean;
  readonly automaticAnalysisEnabled: boolean;
  readonly automaticAnalysisCampaign: {
    readonly enabled: boolean;
    readonly limit: number | null;
    readonly completed: number | null;
    readonly remaining: number | null;
    readonly complete: boolean;
    readonly reasonCodes: readonly string[];
  };
  readonly aiCircuitOpenUntil: string | null;
  readonly tradingEnabled: boolean;
  readonly startupChecksPassed: boolean;
  readonly lastCycle: CycleResult | null;
  readonly reasonCodes: readonly string[];
}

export interface ExecutionServerOptions {
  readonly coordinator: AnalysisCoordinator;
  readonly maintenance: OrderMaintenance;
  readonly controls: RuntimeControlStore;
  readonly controlToken: string;
  readonly scope: string;
  readonly instanceId: string;
  readonly accountKey: string;
  readonly configHash: string;
  readonly mode: string;
  readonly status: () => Promise<ExecutionStatus>;
  readonly updateLastCycle: (result: CycleResult) => void;
  readonly initializeDailyRiskBaseline?: (input: {
    readonly actor: string;
    readonly reason: string;
  }) => Promise<{ readonly tradingDay: string; readonly timezone: string }>;
  readonly metrics?: () => Promise<string>;
}

function authorized(request: FastifyRequest, expected: string): boolean {
  if (expected.length < 24) return false;
  const supplied = request.headers["x-control-token"];
  if (typeof supplied !== "string") return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function auditFields(body: unknown): { actor: string; reason: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("CONTROL_BODY_INVALID");
  }
  const object = body as Record<string, unknown>;
  if (
    typeof object.actor !== "string" ||
    object.actor.length < 1 ||
    object.actor.length > 200
  ) {
    throw new Error("CONTROL_ACTOR_INVALID");
  }
  if (
    typeof object.reason !== "string" ||
    object.reason.length < 1 ||
    object.reason.length > 1000
  ) {
    throw new Error("CONTROL_REASON_INVALID");
  }
  return { actor: object.actor, reason: object.reason };
}

function publicErrorCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z0-9_:]{1,160}$/.test(error.message)
    ? error.message
    : fallback;
}

export function createExecutionServer(
  options: ExecutionServerOptions,
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 32_000, trustProxy: false });
  app.get("/health/live", () => ({ status: "alive" }));
  app.get("/health/ready", async (_request, reply) => {
    const status = await options.status();
    return status.startupChecksPassed
      ? reply.send({ status: "ready", trading_allowed: status.tradingEnabled })
      : reply
          .code(503)
          .send({ status: "not_ready", reason_codes: status.reasonCodes });
  });
  app.get("/v1/status", () => options.status());
  app.get("/metrics", async (_request, reply) => {
    if (options.metrics === undefined)
      return reply.code(404).send({ error: "METRICS_DISABLED" });
    return reply
      .type("text/plain; version=0.0.4")
      .send(await options.metrics());
  });

  app.post("/v1/cycle", async (request, reply) => {
    if (!authorized(request, options.controlToken))
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    const result = await options.coordinator.runOnce();
    options.updateLastCycle(result);
    return reply.send(result);
  });

  app.post<{ Body: { enabled?: unknown; actor?: unknown; reason?: unknown } }>(
    "/v1/controls/emergency-stop",
    async (request, reply) => {
      if (!authorized(request, options.controlToken))
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      const audit = auditFields(request.body);
      if (typeof request.body.enabled !== "boolean")
        return reply.code(400).send({ error: "CONTROL_ENABLED_INVALID" });
      await options.controls.setControl({
        key: "EMERGENCY_STOP",
        scope: options.scope,
        enabled: request.body.enabled,
        actor: audit.actor,
        reason: audit.reason,
      });
      let cleanup = "not_required";
      if (request.body.enabled) {
        try {
          await options.maintenance.cancelAll("DASHBOARD_EMERGENCY_STOP");
          cleanup = "reconciled";
        } catch {
          cleanup = "reconciliation_required";
        }
      }
      return reply.send({ accepted: true, cleanup });
    },
  );

  app.post<{ Body: { enabled?: unknown; actor?: unknown; reason?: unknown } }>(
    "/v1/controls/pause-analyses",
    async (request, reply) => {
      if (!authorized(request, options.controlToken))
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      const audit = auditFields(request.body);
      if (typeof request.body.enabled !== "boolean")
        return reply.code(400).send({ error: "CONTROL_ENABLED_INVALID" });
      await options.controls.setControl({
        key: "PAUSE_NEW_ANALYSES",
        scope: options.scope,
        enabled: request.body.enabled,
        actor: audit.actor,
        reason: audit.reason,
      });
      return reply.send({ accepted: true });
    },
  );

  app.post<{ Body: { actor?: unknown; reason?: unknown } }>(
    "/v1/controls/daily-risk-baseline",
    async (request, reply) => {
      if (!authorized(request, options.controlToken))
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      if (options.mode !== "demo")
        return reply.code(409).send({ error: "NOT_DEMO_MODE" });
      if (options.initializeDailyRiskBaseline === undefined)
        return reply
          .code(503)
          .send({ error: "BASELINE_INITIALIZER_UNAVAILABLE" });
      const audit = auditFields(request.body);
      try {
        const baseline = await options.initializeDailyRiskBaseline(audit);
        return reply.send({
          accepted: true,
          reconciliation: "certain",
          trading_day: baseline.tradingDay,
          timezone: baseline.timezone,
        });
      } catch (error) {
        return reply.code(409).send({
          accepted: false,
          error: publicErrorCode(
            error,
            "DAILY_RISK_BASELINE_INITIALIZATION_FAILED",
          ),
        });
      }
    },
  );

  app.post<{ Body: { actor?: unknown; reason?: unknown } }>(
    "/v1/controls/live-acknowledgement",
    async (request, reply) => {
      if (!authorized(request, options.controlToken))
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      if (options.mode !== "live")
        return reply.code(409).send({ error: "NOT_LIVE_MODE" });
      const audit = auditFields(request.body);
      await options.controls.setControl({
        key: "LIVE_DASHBOARD_ACK",
        scope: options.scope,
        enabled: true,
        value: {
          instance_id: options.instanceId,
          account_key: options.accountKey,
          config_hash: options.configHash,
        },
        actor: audit.actor,
        reason: audit.reason,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      return reply.send({ accepted: true, expires_in_seconds: 900 });
    },
  );

  app.post<{ Body: { actor?: unknown; reason?: unknown } }>(
    "/v1/controls/cancel-pending",
    async (request, reply) => {
      if (!authorized(request, options.controlToken))
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      const audit = auditFields(request.body);
      try {
        await options.maintenance.cancelAll(
          `DASHBOARD_CANCEL:${audit.reason.slice(0, 100)}`,
        );
        return reply.send({
          accepted: true,
          actor: audit.actor,
          reconciliation: "certain",
        });
      } catch {
        return reply
          .code(503)
          .send({ accepted: false, reconciliation: "required" });
      }
    },
  );
  return app;
}
