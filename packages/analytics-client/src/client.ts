import { z } from "zod";
import { randomUUID } from "node:crypto";

import type {
  AnalyticsRequest,
  AnalyticsResponse,
  PerformanceOutcome,
  PerformanceSummary,
} from "../../contracts/src/index.js";

const analyticsResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    requestId: z.string().uuid(),
    analysisId: z.string().uuid(),
    generatedAt: z.string().datetime({ offset: true }),
    acceptable: z.boolean(),
    rejectionReasons: z.array(z.string().max(128)).max(64),
    features: z.record(z.string(), z.unknown()),
  })
  .strict();
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
