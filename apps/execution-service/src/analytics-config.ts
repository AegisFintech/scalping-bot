import type { Timeframe } from "../../../packages/contracts/src/index.js";

const DEFAULT_COMPACT_TAILS: Readonly<Record<Timeframe, number>> = {
  M1: 60,
  M5: 36,
  M15: 24,
};

function positiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`CONFIG_POSITIVE_INTEGER_INVALID:${name}`);
  }
  return value;
}

export function compactTailCounts(
  environment: NodeJS.ProcessEnv,
  collectedCounts: Readonly<Record<Timeframe, number>>,
): Readonly<Record<Timeframe, number>> {
  const configured = {
    M1: positiveInteger(
      environment,
      "MODEL_COMPACT_RAW_TAIL_1M",
      DEFAULT_COMPACT_TAILS.M1,
    ),
    M5: positiveInteger(
      environment,
      "MODEL_COMPACT_RAW_TAIL_5M",
      DEFAULT_COMPACT_TAILS.M5,
    ),
    M15: positiveInteger(
      environment,
      "MODEL_COMPACT_RAW_TAIL_15M",
      DEFAULT_COMPACT_TAILS.M15,
    ),
  };
  for (const timeframe of ["M1", "M5", "M15"] as const) {
    if (configured[timeframe] > collectedCounts[timeframe]) {
      throw new Error(`CONFIG_COMPACT_TAIL_EXCEEDS_HISTORY:${timeframe}`);
    }
  }
  return configured;
}
