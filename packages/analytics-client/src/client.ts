import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  AnalyticsRequest,
  AnalyticsResponse,
  PerformanceOutcome,
  PerformanceSummary,
} from "../../contracts/src/index.js";

const chartSchema = z
  .object({
    rendererVersion: z.literal("completed-candles-ema-atr-v1"),
    mimeType: z.literal("image/png"),
    width: z.literal(1600),
    height: z.literal(1200),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    dataBase64: z
      .string()
      .min(12)
      .max(1_398_104)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    completedCandlesOnly: z.literal(true),
    candleCounts: z
      .object({
        M1: z.number().int().min(1).max(100),
        M5: z.number().int().min(1).max(100),
        M15: z.number().int().min(1).max(100),
      })
      .strict(),
    latestEndTimes: z
      .object({
        M1: z.string().datetime({ offset: true }),
        M5: z.string().datetime({ offset: true }),
        M15: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

const analyticsResponseSchema = z
  .object({
    schemaVersion: z.literal("1.1"),
    requestId: z.string().uuid(),
    analysisId: z.string().uuid(),
    generatedAt: z.string().datetime({ offset: true }),
    acceptable: z.boolean(),
    rejectionReasons: z.array(z.string().max(128)).max(64),
    features: z.record(z.string(), z.unknown()),
    chart: chartSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptable !== (value.chart !== null)) {
      context.addIssue({
        code: "custom",
        path: ["chart"],
        message: "accepted analytics must contain exactly one chart",
      });
    }
  });
const signedDecimal = z
  .string()
  .regex(/^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$/);
const nullableDecimal = signedDecimal.nullable();
const performanceSummarySchema = z
  .object({
    sample_size: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    win_rate: nullableDecimal,
    loss_rate: nullableDecimal,
    profit_factor: nullableDecimal,
    expectancy: nullableDecimal,
    average_win: nullableDecimal,
    average_loss: nullableDecimal,
    realized_pnl: signedDecimal,
    drawdown: signedDecimal,
    consecutive_wins: z.number().int().nonnegative(),
    consecutive_losses: z.number().int().nonnegative(),
  })
  .strict();

export interface AnalyticsClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class AnalyticsHttpClient {
  readonly #options: AnalyticsClientOptions;

  constructor(options: AnalyticsClientOptions) {
    const parsed = new URL(options.baseUrl);
    if (parsed.username || parsed.password)
      throw new Error("ANALYTICS_URL_CREDENTIALS_FORBIDDEN");
    this.#options = options;
  }

  async analyze(request: AnalyticsRequest): Promise<AnalyticsResponse> {
    const response = await (this.#options.fetchImpl ?? fetch)(
      new URL("/v1/analyze", this.#options.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": request.requestId,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 10_000),
      },
    );
    if (!response.ok)
      throw new Error(`ANALYTICS_HTTP_ERROR:${response.status}`);
    const parsed = analyticsResponseSchema.parse(await response.json());
    if (
      parsed.requestId !== request.requestId ||
      parsed.analysisId !== request.analysisId
    ) {
      throw new Error("ANALYTICS_RESPONSE_IDENTITY_MISMATCH");
    }
    if (parsed.chart !== null) {
      const bytes = Buffer.from(parsed.chart.dataBase64, "base64");
      if (
        bytes.length < 33 ||
        bytes.length > 1_048_576 ||
        bytes.toString("base64") !== parsed.chart.dataBase64 ||
        !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
        bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
        bytes.readUInt32BE(16) !== parsed.chart.width ||
        bytes.readUInt32BE(20) !== parsed.chart.height ||
        createHash("sha256").update(bytes).digest("hex") !== parsed.chart.sha256
      ) {
        throw new Error("ANALYTICS_CHART_INVALID");
      }
    }
    return parsed;
  }

  async summarizePerformance(
    outcomes: readonly PerformanceOutcome[],
  ): Promise<PerformanceSummary> {
    const requestId = randomUUID();
    const response = await (this.#options.fetchImpl ?? fetch)(
      new URL("/v1/performance", this.#options.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({ requestId, outcomes }),
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 10_000),
      },
    );
    if (!response.ok)
      throw new Error(`ANALYTICS_PERFORMANCE_HTTP_ERROR:${response.status}`);
    const parsed = z
      .object({
        requestId: z.string().uuid(),
        summary: performanceSummarySchema,
      })
      .strict()
      .parse(await response.json());
    if (parsed.requestId !== requestId)
      throw new Error("ANALYTICS_PERFORMANCE_IDENTITY_MISMATCH");
    return parsed.summary;
  }
}
