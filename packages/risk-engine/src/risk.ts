import { Decimal } from "decimal.js";

import type {
  DecimalString,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import { canonical, decimal, signedDecimal } from "./decimal.js";
import { stopCostReserve } from "./commission.js";

export interface PositionRiskInput {
  readonly equity: DecimalString;
  readonly availableMargin: DecimalString;
  readonly baseRiskPercent: DecimalString;
  readonly maxRiskPercent: DecimalString;
  readonly entryPrice: DecimalString;
  readonly stopLoss: DecimalString;
  readonly estimatedMarginPerVolume: DecimalString;
  readonly currentMargin: DecimalString;
  readonly maxMarginUsagePercent: DecimalString;
  readonly maxPositionNotional: DecimalString | null;
  readonly metadata: SymbolMetadata;
  readonly adverseSlippagePoints?: DecimalString;
}

export interface PositionRiskDecision {
  readonly approved: boolean;
  readonly reasonCodes: readonly string[];
  readonly riskBudget: DecimalString | null;
  readonly rawVolume: DecimalString | null;
  readonly normalizedVolume: DecimalString | null;
  readonly maximumLoss: DecimalString | null;
  readonly estimatedMargin: DecimalString | null;
}

export interface MinimumVolumeStopConstraintInput {
  readonly equity: DecimalString;
  readonly setupRiskPercent: DecimalString;
  readonly maxRiskPercent: DecimalString;
  readonly metadata: SymbolMetadata;
}

export interface MinimumVolumeStopConstraint {
  readonly approved: boolean;
  readonly reasonCodes: readonly string[];
  readonly maxStopDistance: DecimalString | null;
}

export function maximumAffordableStopDistance(
  input: MinimumVolumeStopConstraintInput,
): MinimumVolumeStopConstraint {
  try {
    const equity = decimal(input.equity);
    const setupRisk = decimal(input.setupRiskPercent);
    const configuredMax = decimal(input.maxRiskPercent);
    const tickSize = decimal(input.metadata.tickSize, "RISK_TICK_SIZE_INVALID");
    const tickValue = decimal(
      input.metadata.tickValue,
      "RISK_TICK_VALUE_INVALID",
    );
    const minVolume = decimal(
      input.metadata.minVolume,
      "RISK_VOLUME_METADATA_INVALID",
    );
    if (equity.lte(0)) throw new Error("RISK_EQUITY_INVALID");
    if (
      setupRisk.lte(0) ||
      setupRisk.gt(configuredMax) ||
      configuredMax.gt(5)
    ) {
      throw new Error("RISK_PERCENT_INVALID");
    }
    if ([tickSize, tickValue, minVolume].some((value) => value.lte(0))) {
      throw new Error("RISK_METADATA_INVALID");
    }
    const perLegRiskBudget = equity.mul(setupRisk).div(200);
    const lossPerTickAtMinimumVolume = tickValue.mul(minVolume);
    const affordableTicks = perLegRiskBudget
      .div(lossPerTickAtMinimumVolume)
      .floor();
    if (affordableTicks.lt(1)) {
      return {
        approved: false,
        reasonCodes: ["RISK_MIN_VOLUME_UNAFFORDABLE"],
        maxStopDistance: null,
      };
    }
    return {
      approved: true,
      reasonCodes: [],
      maxStopDistance: canonical(tickSize.mul(affordableTicks)),
    };
  } catch (error) {
    return {
      approved: false,
      reasonCodes: [
        error instanceof Error ? error.message : "RISK_INPUT_INVALID",
      ],
      maxStopDistance: null,
    };
  }
}

function reject(...reasonCodes: string[]): PositionRiskDecision {
  return {
    approved: false,
    reasonCodes,
    riskBudget: null,
    rawVolume: null,
    normalizedVolume: null,
    maximumLoss: null,
    estimatedMargin: null,
  };
}

export function sizePosition(input: PositionRiskInput): PositionRiskDecision {
  try {
    const equity = decimal(input.equity);
    const availableMargin = decimal(input.availableMargin);
    const baseRisk = decimal(input.baseRiskPercent);
    const configuredMax = decimal(input.maxRiskPercent);
    if (equity.lte(0)) return reject("RISK_EQUITY_INVALID");
    if (baseRisk.lte(0) || baseRisk.gt(configuredMax) || configuredMax.gt(5))
      return reject("RISK_PERCENT_INVALID");
    const entry = decimal(input.entryPrice);
    const stop = decimal(input.stopLoss);
    const tickSize = decimal(input.metadata.tickSize, "RISK_TICK_SIZE_INVALID");
    const tickValue = decimal(
      input.metadata.tickValue,
      "RISK_TICK_VALUE_INVALID",
    );
    const minVolume = decimal(
      input.metadata.minVolume,
      "RISK_VOLUME_METADATA_INVALID",
    );
    const maxVolume = decimal(
      input.metadata.maxVolume,
      "RISK_VOLUME_METADATA_INVALID",
    );
    const volumeStep = decimal(
      input.metadata.volumeStep,
      "RISK_VOLUME_METADATA_INVALID",
    );
    const contractSize = decimal(
      input.metadata.contractSize,
      "RISK_CONTRACT_SIZE_INVALID",
    );
    const volumeScale = decimal(
      input.metadata.volumeScale,
      "RISK_VOLUME_SCALE_INVALID",
    );
    if (
      [
        tickSize,
        tickValue,
        minVolume,
        maxVolume,
        volumeStep,
        contractSize,
        volumeScale,
      ].some((item) => item.lte(0))
    ) {
      return reject("RISK_METADATA_INVALID");
    }
    const conversion = decimal(
      input.metadata.quoteToAccountConversionRate,
      "RISK_CURRENCY_CONVERSION_INVALID",
    );
    if (conversion.lte(0) || maxVolume.lt(minVolume))
      return reject("RISK_METADATA_INVALID");
    const stopDistance = entry.minus(stop).abs();
    if (stopDistance.lte(0) || !stopDistance.div(tickSize).isInteger())
      return reject("RISK_STOP_DISTANCE_INVALID");
    const riskBudget = equity.mul(baseRisk).div(100);
    const lossPerVolume = stopDistance.div(tickSize).mul(tickValue);
    if (lossPerVolume.lte(0)) return reject("RISK_TICK_VALUE_INVALID");
    const rawVolume = riskBudget.div(lossPerVolume);
    if (rawVolume.lt(minVolume)) return reject("RISK_VOLUME_BELOW_MIN");
    const steps = rawVolume.minus(minVolume).div(volumeStep).floor();
    const maximumAligned = minVolume.plus(
      maxVolume.minus(minVolume).div(volumeStep).floor().mul(volumeStep),
    );
    let normalized = Decimal.min(
      minVolume.plus(steps.mul(volumeStep)),
      maximumAligned,
    );
    if (input.maxPositionNotional !== null) {
      const maxNotional = decimal(input.maxPositionNotional);
      const rawNotionalVolume = maxNotional.div(
        entry.mul(volumeScale).mul(conversion),
      );
      if (rawNotionalVolume.lt(minVolume))
        return reject("RISK_NOTIONAL_EXCEEDED");
      const notionalSteps = rawNotionalVolume
        .minus(minVolume)
        .div(volumeStep)
        .floor();
      const notionalVolume = Decimal.min(
        minVolume.plus(notionalSteps.mul(volumeStep)),
        maximumAligned,
      );
      normalized = Decimal.min(normalized, notionalVolume);
    }
    if (normalized.gt(rawVolume) || normalized.lt(minVolume))
      return reject("RISK_VOLUME_NORMALIZATION_INVALID");
    const totalLoss = (volume: Decimal): Decimal =>
      volume.mul(lossPerVolume).plus(
        stopCostReserve({
          metadata: input.metadata,
          entryPrice: input.entryPrice,
          stopLoss: input.stopLoss,
          volume: canonical(volume),
          adverseSlippagePoints: input.adverseSlippagePoints ?? "10",
        }),
      );
    // Fees may have a minimum. Binary search the monotone cost-inclusive loss on
    // the native volume grid; rounding up to broker minimum is never allowed.
    if (totalLoss(minVolume).gt(riskBudget))
      return reject("RISK_COSTS_VOLUME_BELOW_MIN");
    let low = new Decimal(0);
    let high = normalized.minus(minVolume).div(volumeStep).floor();
    while (low.lt(high)) {
      const mid = low.plus(high).plus(1).div(2).floor();
      if (totalLoss(minVolume.plus(mid.mul(volumeStep))).lte(riskBudget))
        low = mid;
      else high = mid.minus(1);
    }
    normalized = minVolume.plus(low.mul(volumeStep));
    const maximumLoss = totalLoss(normalized);
    if (maximumLoss.gt(riskBudget)) return reject("RISK_BUDGET_EXCEEDED");
    const estimatedMargin = normalized.mul(
      decimal(input.estimatedMarginPerVolume),
    );
    if (estimatedMargin.lte(0) || availableMargin.lt(0))
      return reject("RISK_MARGIN_INVALID");
    if (estimatedMargin.gt(availableMargin))
      return reject("RISK_MARGIN_INSUFFICIENT");
    const totalMargin = estimatedMargin.plus(decimal(input.currentMargin));
    if (
      totalMargin.div(equity).mul(100).gt(decimal(input.maxMarginUsagePercent))
    )
      return reject("RISK_MARGIN_USAGE_EXCEEDED");
    if (
      input.maxPositionNotional !== null &&
      entry
        .mul(normalized)
        .mul(volumeScale)
        .mul(conversion)
        .gt(decimal(input.maxPositionNotional))
    )
      return reject("RISK_NOTIONAL_EXCEEDED");
    return {
      approved: true,
      reasonCodes: [],
      riskBudget: canonical(riskBudget),
      rawVolume: canonical(rawVolume),
      normalizedVolume: canonical(normalized),
      maximumLoss: canonical(maximumLoss),
      estimatedMargin: canonical(estimatedMargin),
    };
  } catch (error) {
    return reject(
      error instanceof Error ? error.message : "RISK_INPUT_INVALID",
    );
  }
}

export interface OcoRiskInput {
  readonly buy: PositionRiskInput;
  readonly sell: PositionRiskInput;
  /** Total setup risk shared conservatively across both race-exposed legs. */
  readonly setupRiskPercent: DecimalString;
}

export interface OcoRiskDecision {
  readonly approved: boolean;
  readonly reasonCodes: readonly string[];
  readonly buy: PositionRiskDecision;
  readonly sell: PositionRiskDecision;
  readonly combinedMaximumLoss: DecimalString | null;
}

export function sizeOcoPair(input: OcoRiskInput): OcoRiskDecision {
  try {
    const setupRisk = decimal(input.setupRiskPercent);
    if (setupRisk.lte(0) || setupRisk.gt(5))
      throw new Error("OCO_RISK_PERCENT_INVALID");
    const perLegRisk = canonical(setupRisk.div(2));
    const buy = sizePosition({ ...input.buy, baseRiskPercent: perLegRisk });
    const sell = sizePosition({ ...input.sell, baseRiskPercent: perLegRisk });
    const reasons = [
      ...buy.reasonCodes.map((reason) => `BUY_${reason}`),
      ...sell.reasonCodes.map((reason) => `SELL_${reason}`),
    ];
    if (
      !buy.approved ||
      !sell.approved ||
      buy.maximumLoss === null ||
      sell.maximumLoss === null
    ) {
      return {
        approved: false,
        reasonCodes: reasons,
        buy,
        sell,
        combinedMaximumLoss: null,
      };
    }
    const combined = decimal(buy.maximumLoss).plus(decimal(sell.maximumLoss));
    const equity = Decimal.min(
      decimal(input.buy.equity),
      decimal(input.sell.equity),
    );
    const setupBudget = equity.mul(setupRisk).div(100);
    if (combined.gt(setupBudget)) reasons.push("OCO_COMBINED_RISK_EXCEEDED");
    const combinedMargin = decimal(buy.estimatedMargin!).plus(
      decimal(sell.estimatedMargin!),
    );
    if (
      combinedMargin.gt(
        Decimal.min(
          decimal(input.buy.availableMargin),
          decimal(input.sell.availableMargin),
        ),
      )
    )
      reasons.push("OCO_COMBINED_MARGIN_INSUFFICIENT");
    if (
      combinedMargin
        .plus(
          Decimal.max(
            decimal(input.buy.currentMargin),
            decimal(input.sell.currentMargin),
          ),
        )
        .div(equity)
        .mul(100)
        .gt(
          Decimal.min(
            decimal(input.buy.maxMarginUsagePercent),
            decimal(input.sell.maxMarginUsagePercent),
          ),
        )
    )
      reasons.push("OCO_COMBINED_MARGIN_USAGE_EXCEEDED");
    return {
      approved: reasons.length === 0,
      reasonCodes: reasons,
      buy,
      sell,
      combinedMaximumLoss: canonical(combined),
    };
  } catch (error) {
    const rejected = reject("OCO_RISK_INPUT_INVALID");
    return {
      approved: false,
      reasonCodes: [
        error instanceof Error ? error.message : "OCO_RISK_INPUT_INVALID",
      ],
      buy: rejected,
      sell: rejected,
      combinedMaximumLoss: null,
    };
  }
}

export interface DailyLossInput {
  readonly baselineEquity: DecimalString;
  readonly currentEquity: DecimalString;
  readonly netFlows: DecimalString;
  readonly thresholdPercent: DecimalString;
}

export function dailyLoss(input: DailyLossInput): {
  readonly lockedOut: boolean;
  readonly lossPercent: string;
  readonly reasonCode: string | null;
} {
  try {
    const baseline = decimal(input.baselineEquity);
    if (baseline.lte(0))
      return {
        lockedOut: true,
        lossPercent: "0",
        reasonCode: "DAILY_BASELINE_INVALID",
      };
    const adjustedBaseline = baseline.plus(signedDecimal(input.netFlows));
    const loss = Decimal.max(
      0,
      adjustedBaseline.minus(decimal(input.currentEquity)),
    );
    const percent = loss
      .div(baseline)
      .mul(100)
      .toDecimalPlaces(8, Decimal.ROUND_UP);
    const threshold = decimal(input.thresholdPercent);
    return {
      lockedOut: percent.gte(threshold),
      lossPercent: canonical(percent),
      reasonCode: percent.gte(threshold) ? "DAILY_LOSS_LOCKOUT" : null,
    };
  } catch {
    return {
      lockedOut: true,
      lossPercent: "0",
      reasonCode: "DAILY_STATE_INVALID",
    };
  }
}
