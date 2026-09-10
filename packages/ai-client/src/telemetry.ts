import { z } from "zod";

const count = z.number().int().nonnegative().max(1_000_000_000).nullable();
export const providerTelemetrySchema = z
  .object({
    requestedModel: z.string().regex(/^[a-zA-Z0-9._/:-]{1,128}$/),
    returnedModel: z
      .string()
      .regex(/^[a-zA-Z0-9._/:-]{1,128}$/)
      .nullable(),
    inputProfile: z.enum(["chart", "structured"]),
    requestBytes: z.number().int().nonnegative().max(5_600_000),
    responseBytes: z.number().int().nonnegative().max(1_048_576),
    inputTokens: count,
    outputTokens: count,
    totalTokens: count,
    costAmount: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$/)
      .nullable(),
    costCurrency: z.literal("USD").nullable(),
    costSource: z.enum(["unavailable", "provider"]),
  })
  .strict()
  .refine((v) =>
    v.costSource === "unavailable"
      ? v.costAmount === null && v.costCurrency === null
      : v.costAmount !== null && v.costCurrency !== null,
  );

export type ProviderTelemetry = z.infer<typeof providerTelemetrySchema>;

export function usageTelemetry(
  envelope: Record<string, unknown>,
): Pick<
  ProviderTelemetry,
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "costAmount"
  | "costCurrency"
  | "costSource"
> {
  const usage = envelope.usage;
  const record =
    typeof usage === "object" && usage !== null
      ? (usage as Record<string, unknown>)
      : {};
  const token = (value: unknown): number | null =>
    value === undefined ? null : count.parse(value);
  // No provider tariff/currency contract has been verified. Unknown cost is never zero.
  return {
    inputTokens: token(record.input_tokens ?? record.prompt_tokens),
    outputTokens: token(record.output_tokens ?? record.completion_tokens),
    totalTokens: token(record.total_tokens),
    costAmount: null,
    costCurrency: null,
    costSource: "unavailable",
  };
}

export async function boundedResponseText(
  response: Response,
  maximum = 1_048_576,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > maximum)
    throw new Error("AI_RESPONSE_OVERSIZED");
  if (!response.body) throw new Error("AI_RESPONSE_BODY_MISSING");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array))
        throw new Error("AI_RESPONSE_CHUNK_INVALID");
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error("AI_RESPONSE_OVERSIZED");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Safe usage evidence from a completed HTTP response whose proposal was rejected. */
export class ProviderFailure extends Error {
  readonly telemetry: ProviderTelemetry;
  declare readonly rawResponse?: string;
  constructor(
    reason: string,
    telemetry: ProviderTelemetry,
    rawResponse?: string,
  ) {
    super(
      /^[A-Z0-9_:]{1,160}$/.test(reason)
        ? reason
        : "AI_PROVIDER_INVALID_RESPONSE",
    );
    this.telemetry = providerTelemetrySchema.parse(telemetry);
    if (
      rawResponse !== undefined &&
      Buffer.byteLength(rawResponse) <= 4_000_000
    )
      Object.defineProperty(this, "rawResponse", {
        value: rawResponse,
        enumerable: false,
      });
  }
}
