export interface PerformanceSample {
  readonly won: boolean;
  readonly age: number;
}

export interface PerformanceAdjustment {
  readonly applied: boolean;
  readonly confidenceDelta: number;
  readonly effectiveSampleSize: number;
  readonly reasonCodes: readonly string[];
}

export function performanceAdjustment(
  samples: readonly PerformanceSample[],
  minimumSamples = 20,
  decay = 0.97,
): PerformanceAdjustment {
  if (samples.length < minimumSamples || decay <= 0 || decay > 1) {
    return {
      applied: false,
      confidenceDelta: 0,
      effectiveSampleSize: samples.length,
      reasonCodes: ["INSUFFICIENT_SETUP_SAMPLE"],
    };
  }
  let totalWeight = 0;
  let winWeight = 0;
  for (const sample of samples) {
    const weight = decay ** Math.max(0, sample.age);
    totalWeight += weight;
    if (sample.won) winWeight += weight;
  }
  const winRate = totalWeight > 0 ? winWeight / totalWeight : 0;
  if (winRate >= 0.5)
    return {
      applied: false,
      confidenceDelta: 0,
      effectiveSampleSize: totalWeight,
      reasonCodes: [],
    };
  const delta = -Math.min(25, Math.ceil((0.5 - winRate) * 50));
  return {
    applied: true,
    confidenceDelta: delta,
    effectiveSampleSize: totalWeight,
    reasonCodes: ["RECENT_SIMILAR_SETUP_UNDERPERFORMANCE"],
  };
}
