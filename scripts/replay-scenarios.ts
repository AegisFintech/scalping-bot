import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BASE_EXECUTION,
  ScenarioReplay,
  type ReplayInput,
  type ReplayEvent,
} from "../packages/scenario-engine/src/replay.js";

try {
  const [inputPath, outputPath, stress] = process.argv.slice(2);
  if (
    !inputPath ||
    !outputPath ||
    !outputPath.endsWith(".json") ||
    (stress !== undefined && stress !== "--stress") ||
    process.argv.length > 5
  )
    throw new Error("SCENARIO_REPLAY_ARGUMENTS_INVALID");
  if (statSync(inputPath).size > 16_000_000)
    throw new Error("SCENARIO_INPUT_OVERSIZED");
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as ReplayInput;
  if (!Array.isArray(input.events)) throw new Error("SCENARIO_EVENTS_REQUIRED");
  const execution =
    stress === "--stress"
      ? {
          ...BASE_EXECUTION,
          latencyMs: 1500,
          entrySlippageTicks: 4,
          exitSlippageTicks: 10,
        }
      : BASE_EXECUTION;
  const replay = new ScenarioReplay(input, execution);
  for (const event of input.events as readonly ReplayEvent[])
    replay.accept(event);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(replay.report(), null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      completed: true,
      label: input.label,
      brokerConnected: false,
      closedTrades: replay.trades.length,
      economicEvidence: replay.report().economicEvidence,
    }),
  );
} catch {
  // Paths, malformed input and transport-like strings never reach diagnostics.
  console.error(
    JSON.stringify({
      completed: false,
      reason: "SCENARIO_REPLAY_FAILED",
      brokerConnected: false,
    }),
  );
  process.exitCode = 1;
}
