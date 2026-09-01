import { Decimal } from "decimal.js";

import type {
  PendingOrderCommand,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import { canonical, decimal, isTickAligned } from "./decimal.js";

export interface CommissionCoverageEvidence {
  readonly side: "BUY" | "SELL";
  readonly entry_price: string;
  readonly take_profit: string;
  readonly volume: string;
  readonly pip_size: string;
  readonly take_profit_pips: string;
  readonly gross_profit: string;
  readonly opening_commission: string;
  readonly closing_commission: string;
  readonly pnl_conversion_fee: string;
  readonly total_estimated_fees: string;
  readonly expected_net_profit: string;
}

export interface CommissionCoverageResult {
  readonly approved: boolean;
  readonly reasonCodes: readonly string[];
  readonly evidence: CommissionCoverageEvidence | null;
}

function minimumCommissionInAccountCurrency(metadata: SymbolMetadata): Decimal {
  const minimum = decimal(
    metadata.commission.minimum,
    "COMMISSION_MINIMUM_INVALID",
  );
  if (minimum.eq(0)) return minimum;
  if (
    metadata.commission.minimumType === "QUOTE_CURRENCY" ||
    metadata.commission.minimumAsset === metadata.quoteAsset
  ) {
    return minimum.mul(
      decimal(
        metadata.quoteToAccountConversionRate,
        "COMMISSION_CURRENCY_CONVERSION_INVALID",
      ),
    );
  }
  if (metadata.commission.minimumAsset === metadata.accountAsset)
    return minimum;
  throw new Error("COMMISSION_MINIMUM_CURRENCY_UNSUPPORTED");
}

function oneWayCommission(
  metadata: SymbolMetadata,
  price: Decimal,
  volume: Decimal,
): Decimal {
  if (metadata.commission.type !== "USD_PER_MILLION_USD")
    throw new Error("COMMISSION_TYPE_UNSUPPORTED");
  if (metadata.quoteAsset !== "USD")
    throw new Error("COMMISSION_USD_NOTIONAL_CONVERSION_UNAVAILABLE");
  const volumeScale = decimal(
    metadata.volumeScale,
    "COMMISSION_VOLUME_SCALE_INVALID",
  );
  const quoteToAccount = decimal(
    metadata.quoteToAccountConversionRate,
    "COMMISSION_CURRENCY_CONVERSION_INVALID",
  );
  const rate = decimal(metadata.commission.rate, "COMMISSION_RATE_INVALID");
  if (
    price.lte(0) ||
    volume.lte(0) ||
    volumeScale.lte(0) ||
    quoteToAccount.lte(0) ||
    rate.lt(0)
  ) {
    throw new Error("COMMISSION_INPUT_INVALID");
  }
  const rateCommission = price
    .mul(volume)
    .mul(volumeScale)
    .mul(rate)
    .div(1_000_000)
    .mul(quoteToAccount);
  return Decimal.max(
    rateCommission,
    minimumCommissionInAccountCurrency(metadata),
  );
}

export function evaluateCommissionCoverage(input: {
  readonly side: "BUY" | "SELL";
  readonly entryPrice: string;
  readonly takeProfit: string;
  readonly volume: string;
  readonly metadata: SymbolMetadata;
}): CommissionCoverageResult {
  try {
    const entry = decimal(input.entryPrice);
    const target = decimal(input.takeProfit);
    const volume = decimal(input.volume);
    const tickSize = decimal(
      input.metadata.tickSize,
      "COMMISSION_TICK_SIZE_INVALID",
    );
    const pipSize = decimal(
      input.metadata.pipSize,
      "COMMISSION_PIP_SIZE_INVALID",
    );
    const tickValue = decimal(
      input.metadata.tickValue,
      "COMMISSION_TICK_VALUE_INVALID",
    );
    if (
      tickSize.lte(0) ||
      pipSize.lte(0) ||
      tickValue.lte(0) ||
      !pipSize.div(tickSize).isInteger() ||
      !isTickAligned(entry, tickSize) ||
      !isTickAligned(target, tickSize) ||
      (input.side === "BUY" && !target.gt(entry)) ||
      (input.side === "SELL" && !target.lt(entry))
    ) {
      throw new Error("COMMISSION_PRICE_GEOMETRY_INVALID");
    }
    const distance = target.minus(entry).abs();
    const takeProfitPips = distance.div(pipSize);
    if (!takeProfitPips.isInteger() || takeProfitPips.lt(1))
      throw new Error("COMMISSION_TAKE_PROFIT_PIPS_INVALID");
    const gross = distance.div(tickSize).mul(tickValue).mul(volume);
    const openingCommission = oneWayCommission(input.metadata, entry, volume);
    const closingCommission = oneWayCommission(input.metadata, target, volume);
    const conversionFee = gross
      .mul(
        decimal(
          input.metadata.commission.pnlConversionFeeRate,
          "COMMISSION_PNL_CONVERSION_FEE_INVALID",
        ),
      )
      .div(100);
    const totalFees = openingCommission
      .plus(closingCommission)
      .plus(conversionFee);
    const expectedNet = gross.minus(totalFees);
    const evidence: CommissionCoverageEvidence = {
      side: input.side,
      entry_price: input.entryPrice,
      take_profit: input.takeProfit,
      volume: input.volume,
      pip_size: canonical(pipSize),
      take_profit_pips: canonical(takeProfitPips),
      gross_profit: canonical(gross),
      opening_commission: canonical(openingCommission),
      closing_commission: canonical(closingCommission),
      pnl_conversion_fee: canonical(conversionFee),
      total_estimated_fees: canonical(totalFees),
      expected_net_profit: canonical(expectedNet),
    };
    return {
      approved: expectedNet.gt(0),
      reasonCodes: expectedNet.gt(0)
        ? []
        : [`${input.side}_TAKE_PROFIT_DOES_NOT_COVER_COMMISSION`],
      evidence,
    };
  } catch (error) {
    return {
      approved: false,
      reasonCodes: [
        error instanceof Error ? error.message : "COMMISSION_ESTIMATE_INVALID",
      ],
      evidence: null,
    };
  }
}

export function minimumCommissionPositiveTarget(input: {
  readonly side: "BUY" | "SELL";
  readonly entryPrice: string;
  readonly volume: string;
  readonly minimumTakeProfitDistance?: string;
  readonly maximumTakeProfitDistance: string;
  readonly metadata: SymbolMetadata;
}): CommissionCoverageResult {
  try {
    const entry = decimal(input.entryPrice);
    const pipSize = decimal(input.metadata.pipSize);
    const minimumDistance =
      input.minimumTakeProfitDistance === undefined
        ? pipSize
        : Decimal.max(pipSize, decimal(input.minimumTakeProfitDistance));
    const maximumDistance = decimal(input.maximumTakeProfitDistance);
    if (maximumDistance.lt(minimumDistance))
      throw new Error("COMMISSION_POSITIVE_TP_UNAVAILABLE");
    const minimumPips = minimumDistance.div(pipSize).ceil();
    const maximumPips = maximumDistance.div(pipSize).floor();
    if (
      !minimumPips.isInteger() ||
      !maximumPips.isInteger() ||
      maximumPips.gt(1_000_000)
    )
      throw new Error("COMMISSION_TP_SEARCH_RANGE_INVALID");
    for (
      let pipCount = minimumPips.toNumber();
      pipCount <= maximumPips.toNumber();
      pipCount += 1
    ) {
      const distance = pipSize.mul(pipCount);
      const target =
        input.side === "BUY" ? entry.plus(distance) : entry.minus(distance);
      if (target.lte(0)) break;
      const result = evaluateCommissionCoverage({
        side: input.side,
        entryPrice: input.entryPrice,
        takeProfit: canonical(target),
        volume: input.volume,
        metadata: input.metadata,
      });
      if (result.approved) return result;
      if (
        result.evidence === null ||
        result.reasonCodes.some(
          (reason) => !reason.endsWith("TAKE_PROFIT_DOES_NOT_COVER_COMMISSION"),
        )
      ) {
        return result;
      }
    }
    return {
      approved: false,
      reasonCodes: [`${input.side}_COMMISSION_POSITIVE_TP_UNAVAILABLE`],
      evidence: null,
    };
  } catch (error) {
    return {
      approved: false,
      reasonCodes: [
        error instanceof Error ? error.message : "COMMISSION_TP_SEARCH_INVALID",
      ],
      evidence: null,
    };
  }
}

export function validateCommandCommissionCoverage(
  commands: readonly [PendingOrderCommand, PendingOrderCommand],
  metadata: SymbolMetadata,
): {
  readonly approved: boolean;
  readonly reasonCodes: readonly string[];
  readonly evidence: readonly CommissionCoverageEvidence[];
} {
  const results = commands.map((command) =>
    evaluateCommissionCoverage({
      side: command.side,
      entryPrice: command.entryPrice,
      takeProfit: command.takeProfit,
      volume: command.volume,
      metadata,
    }),
  );
  return {
    approved: results.every((result) => result.approved),
    reasonCodes: [
      ...new Set(results.flatMap((result) => result.reasonCodes)),
    ].sort(),
    evidence: results.flatMap((result) =>
      result.evidence === null ? [] : [result.evidence],
    ),
  };
}
