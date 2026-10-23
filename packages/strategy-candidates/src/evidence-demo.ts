import { Decimal } from "decimal.js";
import type {
  MarketSnapshot,
  ModelResponse,
} from "../../contracts/src/index.js";
import {
  canonical,
  decimal,
  isTickAligned,
} from "../../risk-engine/src/index.js";

/** No indicator admission. Preserve the model's box; own broker-valid protection. */
export function evidenceDemoTransform(input: {
  snapshot: MarketSnapshot;
  response: ModelResponse;
  maximumStopDistance: string;
}) {
  const reject = (code: string) => ({
    accepted: false,
    response: null,
    reasonCodes: [code],
    details: { code },
  });
  try {
    const { snapshot } = input,
      result = structuredClone(input.response);
    const tick = decimal(snapshot.metadata.tickSize),
      pip = decimal(snapshot.metadata.pipSize);
    const buy = decimal(result.buy_stop.entry_price),
      sell = decimal(result.sell_stop.entry_price);
    const minimum = Decimal.max(
      decimal(snapshot.metadata.minStopDistance),
      tick.mul(5),
    );
    if (
      tick.lte(0) ||
      pip.lte(0) ||
      buy.lte(sell) ||
      ![buy, sell].every((v) => v.gt(0) && isTickAligned(v, tick))
    )
      return reject("EVIDENCE_BOX_INVALID");
    // Opposite boundary plus one tick establishes structural invalidation.
    // Project inward to broker pip distances; never widen to satisfy fees.
    const risk = buy.minus(sell).plus(tick).div(pip).floor().mul(pip);
    if (risk.lt(minimum) || risk.gt(decimal(input.maximumStopDistance)))
      return reject("EVIDENCE_PROTECTION_UNAFFORDABLE");
    for (const [leg, entry, direction] of [
      [result.buy_stop, buy, 1],
      [result.sell_stop, sell, -1],
    ] as const) {
      const stop = entry.minus(risk.mul(direction)),
        target = entry.plus(risk.mul(direction));
      if (
        stop.lte(0) ||
        target.lte(0) ||
        ![stop, target].every((v) => isTickAligned(v, tick))
      )
        return reject("EVIDENCE_PROTECTION_INVALID");
      Object.assign(leg, {
        stop_loss: canonical(stop),
        invalidation_price: canonical(stop),
        take_profit: canonical(target),
        risk_reward_ratio: "1",
      });
    }
    Object.assign(result.technical_map, {
      upside_targets: [result.buy_stop.take_profit],
      downside_targets: [result.sell_stop.take_profit],
    });
    Object.assign(result, {
      setup_tags: [
        ...result.setup_tags,
        result.setup_tags.some((t) => t.startsWith("DIRECTIONAL_"))
          ? "EVIDENCE_CODEX_SINGLE"
          : "EVIDENCE_CODEX_OCO",
      ],
    });
    return {
      accepted: true,
      response: result,
      reasonCodes: [],
      details: {
        code: "EVIDENCE_BOX_NATIVE_ONE_TO_ONE",
        stop_distance: canonical(risk),
      },
    };
  } catch {
    return reject("EVIDENCE_PROTECTION_INVALID");
  }
}
