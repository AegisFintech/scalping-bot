import { Decimal } from "decimal.js";
import type {
  ModelResponse,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import type { EntryPairPlan } from "./entry-plan.js";
import { minimumFeeBufferedTarget } from "../../risk-engine/src/commission.js";
import { canonical, decimal } from "../../risk-engine/src/decimal.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { time, type ScenarioPlan } from "./plan.js";

const validator = new ModelResponseValidator("schemas/model-response-2.1.json");

/** Pure candidate construction. Account sizing and every placement gate stay downstream. */
export function scenarioOco(
  plan: ScenarioPlan | EntryPairPlan,
  payload: Readonly<Record<string, unknown>>,
  metadata?: SymbolMetadata,
): ModelResponse {
  const c = payload.execution_constraints as Record<string, unknown>;
  const price = (key: string) => {
    if (typeof c[key] !== "string")
      throw new Error("SCENARIO_EXECUTION_CONSTRAINT_INVALID");
    return decimal(c[key]);
  };
  const now = time(String(payload.server_time));
  const preferred = time(String(c.preferred_expires_at));
  const minimum = c.order_expiry_min_seconds;
  const maximum = c.order_expiry_max_seconds;
  if (
    typeof minimum !== "number" ||
    !Number.isSafeInteger(minimum) ||
    minimum < 60 ||
    typeof maximum !== "number" ||
    !Number.isSafeInteger(maximum) ||
    maximum < minimum ||
    preferred - now < minimum * 1000 ||
    preferred - now > maximum * 1000
  )
    throw new Error("SCENARIO_EXECUTION_CONSTRAINT_INVALID");
  const expiry = Math.min(preferred, time(plan.valid_until));
  if (expiry - now < minimum * 1000) throw new Error("SCENARIO_WAIT_REFRESH");
  const expires = new Date(expiry).toISOString();
  const tick = price("tick_size");
  // Thresholds are immutable; a crossed map waits for the next bounded refresh.
  const entries = plan.schema_version === "entry-pair-1.0";
  if (
    !entries &&
    (price("current_ask").gte(plan.recovery_above) ||
      price("current_bid").lte(plan.bearish_below))
  )
    throw new Error("SCENARIO_WAIT_PRICE_RETURN");
  const buy = entries
    ? decimal(plan.buy_stop)
    : Decimal.max(
        decimal(plan.recovery_above).plus(tick),
        price("buy_preferred_entry_minimum"),
      );
  const sell = entries
    ? decimal(plan.sell_stop)
    : Decimal.min(
        decimal(plan.bearish_below).minus(tick),
        price("sell_preferred_entry_maximum"),
      );
  if (
    !entries &&
    (buy.gt(price("buy_entry_maximum")) || sell.lt(price("sell_entry_minimum")))
  )
    throw new Error("SCENARIO_WAIT_ENTRY_DISTANCE");
  let reward = Decimal.max(
    price("minimum_fee_buffered_take_profit_distance"),
    price("minimum_stop_distance").div(2),
  )
    .div(tick)
    .ceil()
    .mul(tick);
  if (entries) {
    if (metadata === undefined)
      throw new Error("SCENARIO_ENTRY_METADATA_MISSING");
    const pip = decimal(metadata.pipSize);
    const targets = (["BUY", "SELL"] as const).map((side) => {
      const entry = side === "BUY" ? buy : sell;
      const result = minimumFeeBufferedTarget({
        side,
        entryPrice: canonical(entry),
        volume: metadata.minVolume,
        minimumTakeProfitDistance: canonical(
          price("minimum_stop_distance").div(2).div(pip).ceil().mul(pip),
        ),
        maximumTakeProfitDistance: canonical(
          price("maximum_stop_distance").div(2).div(pip).floor().mul(pip),
        ),
        minimumExpectedNetToFeesRatio: "1",
        metadata,
      });
      if (!result.approved || result.evidence === null)
        throw new Error(result.reasonCodes[0] ?? "SCENARIO_ENTRY_FEES_INVALID");
      return decimal(result.evidence.take_profit).minus(entry).abs();
    });
    reward = Decimal.max(...targets);
  }
  const risk = reward.mul(2);
  if (
    risk.gt(price("maximum_stop_distance")) ||
    (!entries &&
      (buy.plus(reward).gt(plan.recovery_targets[0]) ||
        // extension_below is a continuation trigger, not a downside target.
        // Match the buy leg: cost-buffered TP must stay before the first real target.
        sell.minus(reward).lt(plan.extension_targets[0])))
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
      decision_zone: entries
        ? { lower: canonical(sell), upper: canonical(buy) }
        : plan.decision_zone,
      resistance_zones: [
        entries
          ? { lower: canonical(buy), upper: canonical(buy.plus(tick)) }
          : plan.rebound_resistance,
      ],
      support_zones: [
        entries
          ? { lower: canonical(sell.minus(tick)), upper: canonical(sell) }
          : { lower: plan.extension_below, upper: plan.bearish_below },
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
      ...(entries
        ? { lower: canonical(sell), upper: canonical(buy) }
        : plan.decision_zone),
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
    setup_tags: [entries ? "DIRECT_ENTRY_PAIR_OCO" : "REUSABLE_SCENARIO_OCO"],
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
