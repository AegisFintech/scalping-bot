import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import {
  resolveRuntimeEnvironment,
  POLICY_VERSION,
  OPERATOR_KEYS,
} from "../packages/config/src/policy.js";

// Read-only migration check. Reports key names, never values or endpoints.
const file = process.argv[2] ?? ".env";
try {
  resolveRuntimeEnvironment(parse(readFileSync(file)));
  console.log(
    JSON.stringify({
      valid: true,
      policy: POLICY_VERSION,
      normalSettings: OPERATOR_KEYS.length,
    }),
  );
} catch (error) {
  const reason =
    error instanceof Error && error.message.startsWith("CONFIG_")
      ? error.message
      : "CONFIG_FILE_UNAVAILABLE";
  console.log(JSON.stringify({ valid: false, reason }));
  process.exitCode = 1;
}
