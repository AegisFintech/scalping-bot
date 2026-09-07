import type { Candle, TechnicalZone } from "../../contracts/src/index.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { decimal, isTickAligned } from "../../risk-engine/src/decimal.js";

export const SCENARIO_POLICY = Object.freeze({
  version: "chart-scenarios-v1",
  planLifetimeMs: 300_000,
  pendingLifetimeMs: 60_000,
  maximumHoldingMs: 600_000,
  confirmationCandles: 2,
});

export interface ScenarioPlan {
  readonly schema_version: "scenario-1.0";
  readonly analysis_id: string;
  readonly symbol: string;
  readonly captured_at: string;
  readonly valid_until: string;
  readonly decision_zone: TechnicalZone;
  readonly rebound_resistance: TechnicalZone;
  readonly recovery_above: string;
  readonly recovery_targets: readonly [string, string];
  readonly bearish_below: string;
  readonly extension_below: string;
  readonly extension_targets: readonly [string, string];
  readonly broader_resistance: readonly TechnicalZone[];
}

export function time(value: string): number {
  const n = Date.parse(value);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isSafeInteger(n) || n < 0)
    throw new Error("SCENARIO_TIME_INVALID");
  return n;
}

const validator = new ModelResponseValidator<ScenarioPlan>(
  "schemas/scenario-plan-1.0.json",
);

export function validatePlan(
  raw: string,
  context: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    availableAt: string;
    tickSize: string;
  },
): ScenarioPlan {
  const parsed = validator.parse(raw);
  if (!parsed.accepted || parsed.response === null)
    throw new Error(parsed.reasonCodes[0] ?? "SCENARIO_SCHEMA_INVALID");
  const p = parsed.response;
  const capture = time(context.capturedAt),
    available = time(context.availableAt);
  if (
    p.analysis_id !== context.analysisId ||
    p.symbol !== context.symbol ||
    time(p.captured_at) !== capture ||
    available < capture ||
    time(p.valid_until) !== capture + SCENARIO_POLICY.planLifetimeMs ||
    available >= time(p.valid_until)
  )
    throw new Error("SCENARIO_IDENTITY_OR_VALIDITY_INVALID");
  const tick = decimal(context.tickSize);
  const zones = [
    p.decision_zone,
    p.rebound_resistance,
    ...p.broader_resistance,
  ];
  const prices = [
    p.recovery_above,
    p.bearish_below,
    p.extension_below,
    ...p.recovery_targets,
    ...p.extension_targets,
    ...zones.flatMap((z) => [z.lower, z.upper]),
  ];
  if (
    tick.lte(0) ||
    prices.some((v) => decimal(v).lte(0) || !isTickAligned(decimal(v), tick)) ||
    zones.some((z) => !decimal(z.lower).lt(decimal(z.upper)))
  )
    throw new Error("SCENARIO_PRICE_GEOMETRY_INVALID");
  if (
    !decimal(p.bearish_below).eq(p.decision_zone.lower) ||
    decimal(p.decision_zone.upper).gt(p.rebound_resistance.lower) ||
    !decimal(p.recovery_above).eq(p.rebound_resistance.upper) ||
    !decimal(p.recovery_targets[0]).gt(p.recovery_above) ||
    !decimal(p.recovery_targets[1]).gt(p.recovery_targets[0]) ||
    !decimal(p.extension_below).lt(p.bearish_below) ||
    !decimal(p.extension_targets[0]).lt(p.extension_below) ||
    !decimal(p.extension_targets[1]).lt(p.extension_targets[0]) ||
    p.broader_resistance.some(
      (z, i) =>
        decimal(z.lower).lt(p.recovery_above) ||
        (i > 0 && decimal(z.lower).lt(p.broader_resistance[i - 1]!.upper)),
    )
  )
    throw new Error("SCENARIO_LEVEL_ORDER_INVALID");
  return p;
}

export function validateCandle(
  bar: Candle,
  now: number,
  timeframeMs = 60_000,
  allowSessionGap = false,
): void {
  const start = time(bar.startTime),
    end = time(bar.endTime);
  const o = decimal(bar.open),
    h = decimal(bar.high),
    l = decimal(bar.low),
    c = decimal(bar.close);
  if (
    !bar.complete ||
    (bar.qualityFlags.length > 0 &&
      !(
        allowSessionGap &&
        bar.qualityFlags.length === 1 &&
        bar.qualityFlags[0] === "BROKER_SESSION_GAP_BEFORE"
      )) ||
    start % timeframeMs !== 0 ||
    end - start !== timeframeMs ||
    end > now ||
    l.lte(0) ||
    l.gt(o) ||
    l.gt(c) ||
    h.lt(o) ||
    h.lt(c) ||
    h.lt(l)
  )
    throw new Error("SCENARIO_CANDLE_INVALID");
}
