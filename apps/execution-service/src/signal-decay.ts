import { Decimal } from "decimal.js";

import { canonical } from "../../../packages/risk-engine/src/index.js";

export interface SignalDecayObservation {
  readonly fillAgeSeconds: number;
  readonly netPnl: string;
  readonly fees: string;
}

export interface SignalDecayBucket {
  readonly label: string;
  readonly minimumAgeExclusive: number | null;
  readonly maximumAgeInclusive: number | null;
  readonly trades: number;
  readonly winsAfterFees: number;
  readonly winRate: string | null;
  readonly grossPnl: string;
  readonly fees: string;
  readonly netPnl: string;
}

const LIMITS = [30, 60, 90, 120, 180, 300, 600, 900] as const;

function bucketLabel(lower: number, upper: number | null): string {
  return upper === null
    ? `>${lower}s`
    : lower === 0
      ? `[0,${upper}]s`
      : `(${lower},${upper}]s`;
}

export function summarizeSignalDecay(
  observations: readonly SignalDecayObservation[],
): readonly SignalDecayBucket[] {
  for (const observation of observations) {
    if (
      !Number.isFinite(observation.fillAgeSeconds) ||
      observation.fillAgeSeconds < 0
    )
      throw new Error("SIGNAL_DECAY_FILL_AGE_INVALID");
    for (const value of [observation.netPnl, observation.fees]) {
      const parsed = new Decimal(value);
      if (!parsed.isFinite()) throw new Error("SIGNAL_DECAY_MONEY_INVALID");
    }
  }
  const ranges: Array<{ minimum: number; maximum: number | null }> = [
    ...LIMITS.map((maximum, index) => ({
      minimum: index === 0 ? 0 : (LIMITS[index - 1] ?? 0),
      maximum,
    })),
    { minimum: LIMITS.at(-1) ?? 900, maximum: null },
  ];
  return ranges.map(({ minimum, maximum }) => {
    const rows = observations.filter(
      ({ fillAgeSeconds }) =>
        fillAgeSeconds > (minimum === 0 ? -1 : minimum) &&
        (maximum === null || fillAgeSeconds <= maximum),
    );
    const net = rows.reduce((sum, row) => sum.plus(row.netPnl), new Decimal(0));
    const fees = rows.reduce((sum, row) => sum.plus(row.fees), new Decimal(0));
    const wins = rows.filter((row) => new Decimal(row.netPnl).gt(0)).length;
    return {
      label: bucketLabel(minimum, maximum),
      minimumAgeExclusive: minimum === 0 ? null : minimum,
      maximumAgeInclusive: maximum,
      trades: rows.length,
      winsAfterFees: wins,
      winRate:
        rows.length === 0
          ? null
          : canonical(
              new Decimal(wins)
                .div(rows.length)
                .toDecimalPlaces(10, Decimal.ROUND_DOWN),
            ),
      grossPnl: canonical(net.minus(fees)),
      fees: canonical(fees),
      netPnl: canonical(net),
    };
  });
}
