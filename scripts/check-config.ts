import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import {
  resolveRuntimeEnvironment,
  POLICY_VERSION,
  OPERATOR_KEYS,
} from "../packages/config/src/policy.js";
import { loadExecutionConfig } from "../apps/execution-service/src/config.js";

// Read-only migration check. Reports key names, never values or endpoints.
const args = process.argv.slice(2);
const startup = args.includes("--startup");
const files = args.filter((arg) => !arg.startsWith("--"));
const file = files[0] ?? ".env";
try {
  if (
    files.length > 1 ||
    args.some((arg) => arg.startsWith("--") && arg !== "--startup")
  )
    throw new Error(
      "CONFIG_ARGUMENT_INVALID:use config:check -- [file] [--startup]",
    );
  const source = parse(readFileSync(file));
  const resolved = resolveRuntimeEnvironment(source);
  if (startup) loadExecutionConfig(resolved);
  console.log(
    JSON.stringify({
      valid: true,
      scope: startup ? "execution_configuration" : "policy_compatibility",
      policy: POLICY_VERSION,
      normalSettings: OPERATOR_KEYS.length,
      fileSettings: Object.keys(source).length,
      requestedModel: resolved.AI_MODEL,
      obsoleteSettings: Object.hasOwn(source, "ACCOUNT_EQUITY_FLOOR")
        ? ["ACCOUNT_EQUITY_FLOOR:ignored; remove this obsolete setting"]
        : [],
    }),
  );
} catch (error) {
  const reason =
    error instanceof Error && error.message.startsWith("CONFIG_")
      ? error.message
      : "CONFIG_FILE_UNAVAILABLE";
  console.log(
    JSON.stringify({
      valid: false,
      scope: startup ? "execution_configuration" : "policy_compatibility",
      reason,
    }),
  );
  process.exitCode = 1;
}
