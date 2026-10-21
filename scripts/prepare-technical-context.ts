import { readFile, writeFile, stat } from "node:fs/promises";
import { TechnicalContextHttpClient } from "../packages/analytics-client/src/technical-context.js";
import { ModelResponseValidator } from "../packages/risk-engine/src/model-validator.js";
import type {
  TechnicalContextRequest,
  TechnicalContextRequestV11,
} from "../packages/contracts/src/technical-context.js";

// Existing saved request -> typed local HTTP -> exclusive private candidate file.
// No credential loading, collection loop, model call, order dispatch or promotion.
try {
  const [source, destination, baseUrl = "http://127.0.0.1:8091"] =
    process.argv.slice(2);
  if (
    source === undefined ||
    destination === undefined ||
    process.argv.length > 5
  )
    throw new Error("TECHNICAL_CONTEXT_USAGE");
  if ((await stat(source)).size > 1_048_576)
    throw new Error("TECHNICAL_CONTEXT_INPUT_TOO_LARGE");
  const raw = await readFile(source, "utf8");
  const document: unknown = JSON.parse(raw);
  const localClock =
    document !== null &&
    typeof document === "object" &&
    "schemaVersion" in document &&
    document.schemaVersion === "technical-context-request-1.1";
  const validated = new ModelResponseValidator<
    TechnicalContextRequest | TechnicalContextRequestV11
  >(
    localClock
      ? "schemas/technical-context-request-1.1.json"
      : "schemas/technical-context-request-1.0.json",
  ).parse(raw);
  if (!validated.accepted || validated.response === null)
    throw new Error("TECHNICAL_CONTEXT_INPUT_INVALID");
  const result = await new TechnicalContextHttpClient(baseUrl).prepare(
    validated.response,
  );
  await writeFile(destination, JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: result.acceptable ? "CANDIDATE_PREPARED" : "CONTEXT_REJECTED",
      executionAuthority: false,
      reasons: result.reasons,
    }),
  );
  if (!result.acceptable) process.exitCode = 1;
} catch {
  console.error(
    "TECHNICAL_CONTEXT_PREPARATION_FAILED: verify input, local candidate service and an unused output path",
  );
  process.exitCode = 2;
}
