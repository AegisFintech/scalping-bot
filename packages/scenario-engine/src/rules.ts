import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import type { Candle } from "../../contracts/src/index.js";
import { canonical, decimal } from "../../risk-engine/src/decimal.js";
import { time, type ScenarioPlan } from "./plan.js";

export interface ScenarioEntry {
  readonly key: string;
  readonly scenario: "RECOVERY_HOLD" | "FAILED_RECLAIM" | "DECLINE_EXTENSION";
  readonly side: "BUY" | "SELL";
  readonly entry: string;
  readonly stop: string;
  readonly target: string;
  readonly invalidation: string;
  readonly confirmedAt: string;
}

/** Both scenarios exist. Only an observed, completed-candle condition arms an entry. */
export function confirmedEntry(
  plan: ScenarioPlan,
  previous: Candle,
  latest: Candle,
  availableAt: number,
  tickSize: string,
): ScenarioEntry | null {
  if (
    time(previous.startTime) < availableAt ||
    time(latest.startTime) !== time(previous.endTime) ||
    time(latest.endTime) >= time(plan.valid_until)
  )
    return null;
  const tick = decimal(tickSize);
  let choice: Omit<ScenarioEntry, "key" | "confirmedAt"> | null = null;
  if (
    decimal(previous.close).gt(plan.recovery_above) &&
    decimal(latest.close).gt(plan.recovery_above)
  ) {
    choice = {
      scenario: "RECOVERY_HOLD",
      side: "BUY",
      entry: canonical(decimal(latest.high).plus(tick)),
      stop: canonical(
        Decimal.min(previous.low, latest.low, plan.recovery_above).minus(tick),
      ),
      target: plan.recovery_targets[0],
      invalidation: plan.recovery_above,
    };
  } else if (
    decimal(previous.close).lt(plan.bearish_below) &&
    decimal(latest.high).gte(plan.bearish_below) &&
    decimal(latest.close).lt(plan.bearish_below)
  ) {
    choice = {
      scenario: "FAILED_RECLAIM",
      side: "SELL",
      entry: canonical(decimal(latest.low).minus(tick)),
      stop: canonical(Decimal.max(latest.high, plan.bearish_below).plus(tick)),
      target: plan.extension_below,
      invalidation: plan.bearish_below,
    };
  } else if (
    decimal(previous.close).lt(plan.extension_below) &&
    decimal(latest.close).lt(plan.extension_below)
  ) {
    choice = {
      scenario: "DECLINE_EXTENSION",
      side: "SELL",
      entry: canonical(decimal(latest.low).minus(tick)),
      stop: canonical(
        Decimal.max(previous.high, latest.high, plan.extension_below).plus(
          tick,
        ),
      ),
      target: plan.extension_targets[0],
      invalidation: plan.extension_below,
    };
  }
  if (choice === null) return null;
  return {
    ...choice,
    confirmedAt: latest.endTime,
    key: createHash("sha256")
      .update([plan.analysis_id, choice.scenario, latest.endTime].join(":"))
      .digest("hex"),
  };
}

export function invalidated(entry: ScenarioEntry, close: string): boolean {
  return entry.side === "BUY"
    ? decimal(close).lte(entry.invalidation)
    : decimal(close).gte(entry.invalidation);
}
