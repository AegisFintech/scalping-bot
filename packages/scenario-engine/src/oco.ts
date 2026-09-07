import { Decimal } from "decimal.js";
import type { ModelResponse } from "../../contracts/src/index.js";
import { canonical, decimal } from "../../risk-engine/src/decimal.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { time, type ScenarioPlan } from "./plan.js";

const validator = new ModelResponseValidator("schemas/model-response-2.1.json");

/** Pure candidate construction. Account sizing and every placement gate stay downstream. */
export function scenarioOco(
  plan: ScenarioPlan,
  payload: Readonly<Record<string, unknown>>,
): ModelResponse {
  const c = payload.execution_constraints as Record<string, unknown>;
  const price = (key: string) => {
    if (typeof c[key] !== "string")
      throw new Error("SCENARIO_EXECUTION_CONSTRAINT_INVALID");
    return decimal(c[key]);
  };
  const now = time(String(payload.server_time));
  const expires = String(c.preferred_expires_at);
  if (time(expires) > time(plan.valid_until) || time(expires) - now < 60_000)
    throw new Error("SCENARIO_WAIT_REFRESH");
  const tick = price("tick_size");
  // Thresholds are immutable; a crossed map waits for the next bounded refresh.
  if (
    price("current_ask").gte(plan.recovery_above) ||
    price("current_bid").lte(plan.bearish_below)
  )
    throw new Error("SCENARIO_WAIT_PRICE_RETURN");
  const buy = Decimal.max(
    decimal(plan.recovery_above).plus(tick),
    price("buy_preferred_entry_minimum"),
  );
  const sell = Decimal.min(
    decimal(plan.bearish_below).minus(tick),
    price("sell_preferred_entry_maximum"),
  );
  if (
    buy.gt(price("buy_entry_maximum")) ||
    sell.lt(price("sell_entry_minimum"))
  )
    throw new Error("SCENARIO_WAIT_ENTRY_DISTANCE");
  const reward = Decimal.max(
    price("minimum_fee_buffered_take_profit_distance"),
    price("minimum_stop_distance").div(2),
  )
    .div(tick)
    .ceil()
    .mul(tick);
  const risk = reward.mul(2);
  if (
    risk.gt(price("maximum_stop_distance")) ||
    buy.plus(reward).gt(plan.recovery_targets[0]) ||
    sell.minus(reward).lt(plan.extension_below)
  )
    throw new Error("SCENARIO_WAIT_NET_REWARD");
  const leg = (entry: Decimal, direction: number) => ({
    trigger_price: canonical(entry),
    entry_price: canonical(entry),
    stop_loss: canonical(entry.minus(risk.mul(direction))),
    take_profit: canonical(entry.plus(reward.mul(direction))),
    invalidation_price: canonical(entry.minus(risk.mul(direction))),
    risk_reward_ratio: "0.5",
    expires_at: expires,
  });
  const performance = payload.performance as {
    performance_adjustment?: ModelResponse["performance_adjustment"];
  };
  const adjustment = performance.performance_adjustment;
  const response: ModelResponse = {
    schema_version: "2.1",
    analysis_id: String(payload.analysis_id),
    symbol: plan.symbol,
    generated_at: String(payload.server_time),
    valid_until: expires,
    market_regime: "UNCERTAIN",
    technical_map: {
      decision_zone: plan.decision_zone,
      resistance_zones: [plan.rebound_resistance],
      support_zones: [
        { lower: plan.extension_below, upper: plan.bearish_below },
      ],
      bullish_confirmation: {
        price: canonical(buy),
        condition_code: "BUFFERED_BREAKOUT_ABOVE_RESISTANCE",
      },
      bearish_confirmation: {
        price: canonical(sell),
        condition_code: "BUFFERED_BREAKDOWN_BELOW_SUPPORT",
      },
      upside_targets: [canonical(buy.plus(reward))],
      downside_targets: [canonical(sell.minus(reward))],
    },
    waiting_area: {
      ...plan.decision_zone,
      description_code: "IMMEDIATE_DECISION_ZONE",
    },
    buy_stop: leg(buy, 1),
    sell_stop: leg(sell, -1),
    confidence: {
      overall: 0,
      buy: 0,
      sell: 0,
      original_overall: 0,
      original_buy: 0,
      original_sell: 0,
    },
    setup_tags: ["REUSABLE_SCENARIO_OCO"],
    evidence_codes: ["DETERMINISTIC_PLAN_DERIVATION"],
    risk_flags: [],
    // Analytics also carries sample size/decay diagnostics. Project only the
    // execution contract's fields; its strict schema and semantic check remain intact.
    performance_adjustment:
      adjustment == null
        ? {
            applied: false,
            confidence_delta: 0,
            reason_codes: [],
          }
        : {
            applied: adjustment.applied,
            confidence_delta: adjustment.confidence_delta,
            reason_codes: adjustment.reason_codes,
          },
    data_quality: { warnings: [] },
  };
  if (!validator.parse(JSON.stringify(response)).accepted)
    throw new Error("SCENARIO_DERIVED_SCHEMA_INVALID");
  return response;
}
