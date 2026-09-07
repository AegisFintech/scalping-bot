import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { OpenAiCompatibleClient } from "../packages/ai-client/src/client.js";
import type { AnalysisChartArtifact } from "../packages/contracts/src/index.js";

// Read-only, paid inference benchmark. No execution imports or broker commands.
const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath)
  throw new Error("BENCHMARK_INPUT_OUTPUT_REQUIRED");
const inputs = JSON.parse(readFileSync(inputPath, "utf8")) as {
  payload: Record<string, unknown>;
  chart: AnalysisChartArtifact;
}[];
if (inputs.length < 1 || inputs.length > 10)
  throw new Error("BENCHMARK_COUNT_INVALID");
const results: Record<string, unknown>[] = [];
for (const [index, input] of inputs.entries()) {
  for (const profile of ["chart", "structured"] as const) {
    const client = new OpenAiCompatibleClient({
      baseUrl: process.env.AI_BASE_URL ?? "",
      apiKey: process.env.AI_API_KEY ?? "",
      model: "gpt-6-astra/u64",
      apiStyle: "responses",
      schemaPath: "schemas/model-response-2.1.json",
      systemPromptPath: "prompts/system-v16.md",
      promptVersion: "system-v16",
      inputProfile: profile,
      timeoutMs: 45_000,
      maxRetries: 0,
    });
    const started = Date.now();
    try {
      const result = await client.analyze({
        analysisId: String(input.payload.analysis_id),
        symbol: String(input.payload.symbol),
        payload: input.payload,
        chart: input.chart,
      });
      results.push({
        index,
        profile,
        schemaValid: true,
        latencyMs: result.latencyMs,
        ...result.telemetry,
        response: result.response,
      });
      console.log(
        JSON.stringify({
          index,
          profile,
          schemaValid: true,
          latencyMs: result.latencyMs,
          ...result.telemetry,
        }),
      );
    } catch (error) {
      const reason =
        error instanceof Error && /^[A-Z0-9_:]+$/.test(error.message)
          ? error.message
          : "BENCHMARK_PROVIDER_FAILED";
      results.push({
        index,
        profile,
        schemaValid: false,
        latencyMs: Date.now() - started,
        reason,
      });
      console.log(JSON.stringify(results.at(-1)));
    }
    writeFileSync(
      outputPath,
      JSON.stringify(
        {
          label: "HISTORICAL_INPUT_COMPATIBILITY_NOT_STRATEGY_PERFORMANCE",
          results,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
}
