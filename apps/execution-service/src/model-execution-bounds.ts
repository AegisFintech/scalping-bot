import { Decimal } from "decimal.js";
import {
  canonical,
  decimal,
} from "../../../packages/risk-engine/src/decimal.js";

export interface ModelExecutionBounds {
  readonly buyEntryMinimum: string;
  readonly buyEntryMaximum: string;
  readonly sellEntryMinimum: string;
  readonly sellEntryMaximum: string;
  readonly buyPreferredEntryMinimum: string;
  readonly buyPreferredEntryMaximum: string;
  readonly sellPreferredEntryMinimum: string;
  readonly sellPreferredEntryMaximum: string;
  readonly entryLatencyBufferAtr: string;
  readonly preferredMaxEntryDistanceAtr: string;
  readonly minimumStopDistance: string;
  readonly maximumStopDistance: string;
  readonly preferredExpiresAt: string;
}

function floorToTick(value: Decimal, tickSize: Decimal): Decimal {
  return value.div(tickSize).floor().mul(tickSize);
}

function ceilToTick(value: Decimal, tickSize: Decimal): Decimal {
  return value.div(tickSize).ceil().mul(tickSize);
}

export function deriveModelExecutionBounds(input: {
  readonly entryPairMode?: boolean;
  readonly directionalEntryOnly?: boolean;
  readonly validateLimitSemantics?: boolean;
  readonly currentBid: string;
  readonly currentAsk: string;
  readonly tickSize: string;
  readonly minimumStopDistance: string;
  readonly atr: string;
  readonly maxEntryDistanceAtr: string;
  readonly entryLatencyBufferAtr: string;
  readonly preferredMaxEntryDistanceAtr: string;
  readonly maxStopDistanceAtr: string;
  readonly maxAffordableStopDistance: string;
  readonly serverTime: string;
  readonly preferredExpirySeconds: number;
}): ModelExecutionBounds {
  const bid = decimal(input.currentBid);
  const ask = decimal(input.currentAsk);
  const tickSize = decimal(input.tickSize);
  const minimumStopDistance = decimal(input.minimumStopDistance);
  if (input.entryPairMode) {
    const buy = canonical(ceilToTick(ask.plus(minimumStopDistance), tickSize));
    const sell = canonical(
      floorToTick(bid.minus(minimumStopDistance), tickSize),
    );
    return {
      buyEntryMinimum: buy,
      buyEntryMaximum: buy,
      sellEntryMinimum: sell,
      sellEntryMaximum: sell,
      buyPreferredEntryMinimum: buy,
      buyPreferredEntryMaximum: buy,
      sellPreferredEntryMinimum: sell,
      sellPreferredEntryMaximum: sell,
      entryLatencyBufferAtr: "0",
      preferredMaxEntryDistanceAtr: "0",
      minimumStopDistance: canonical(minimumStopDistance),
      maximumStopDistance: canonical(
        floorToTick(decimal(input.maxAffordableStopDistance), tickSize),
      ),
      preferredExpiresAt: new Date(
        Date.parse(input.serverTime) + input.preferredExpirySeconds * 1000,
      ).toISOString(),
    };
  }
  const atr = decimal(input.atr);
  const maximumEntryDistance = atr.mul(decimal(input.maxEntryDistanceAtr));
  const entryLatencyBufferAtr = decimal(input.entryLatencyBufferAtr);
  const entryLatencyBufferDistance = atr.mul(entryLatencyBufferAtr);
  const preferredMaxEntryDistanceAtr = decimal(
    input.preferredMaxEntryDistanceAtr,
  );
  const preferredMaximumDistance = atr.mul(preferredMaxEntryDistanceAtr);
  const maximumStopDistance = floorToTick(
    Decimal.min(
      atr.mul(decimal(input.maxStopDistanceAtr)),
      decimal(input.maxAffordableStopDistance),
    ),
    tickSize,
  );
  const buyEntryMinimum = ceilToTick(ask.plus(minimumStopDistance), tickSize);
  const buyEntryMaximum = floorToTick(ask.plus(maximumEntryDistance), tickSize);
  const sellEntryMinimum = ceilToTick(
    bid.minus(maximumEntryDistance),
    tickSize,
  );
  const sellEntryMaximum = floorToTick(
    bid.minus(minimumStopDistance),
    tickSize,
  );
  if (
    buyEntryMinimum.gt(buyEntryMaximum) ||
    sellEntryMinimum.gt(sellEntryMaximum)
  ) {
    throw new Error("MODEL_ENTRY_RANGE_UNSATISFIABLE");
  }
  const preferredMinimumDistance = Decimal.max(
    minimumStopDistance,
    entryLatencyBufferDistance,
  );
  const buyPreferredEntryMinimum = ceilToTick(
    ask.plus(preferredMinimumDistance),
    tickSize,
  );
  const buyPreferredEntryMaximum = floorToTick(
    ask.plus(preferredMaximumDistance),
    tickSize,
  );
  const sellPreferredEntryMinimum = ceilToTick(
    bid.minus(preferredMaximumDistance),
    tickSize,
  );
  const sellPreferredEntryMaximum = floorToTick(
    bid.minus(preferredMinimumDistance),
    tickSize,
  );
  if (
    buyPreferredEntryMinimum.gt(buyPreferredEntryMaximum) ||
    sellPreferredEntryMinimum.gt(sellPreferredEntryMaximum) ||
    buyPreferredEntryMinimum.lt(buyEntryMinimum) ||
    buyPreferredEntryMaximum.gt(buyEntryMaximum) ||
    sellPreferredEntryMinimum.lt(sellEntryMinimum) ||
    sellPreferredEntryMaximum.gt(sellEntryMaximum)
  ) {
    throw new Error("MODEL_PREFERRED_ENTRY_RANGE_UNSATISFIABLE");
  }
  const modelMinimumStopDistance = ceilToTick(minimumStopDistance, tickSize);
  if (maximumStopDistance.lt(modelMinimumStopDistance))
    throw new Error("MODEL_STOP_RANGE_UNSATISFIABLE");
  const serverTime = Date.parse(input.serverTime);
  if (
    !Number.isFinite(serverTime) ||
    serverTime < 0 ||
    !Number.isSafeInteger(input.preferredExpirySeconds) ||
    input.preferredExpirySeconds < 1
  ) {
    throw new Error("MODEL_EXPIRY_BOUND_INVALID");
  }
  const preferredExpiresAt = serverTime + input.preferredExpirySeconds * 1_000;
  if (!Number.isSafeInteger(preferredExpiresAt))
    throw new Error("MODEL_EXPIRY_BOUND_INVALID");
  return {
    buyEntryMinimum: canonical(buyEntryMinimum),
    buyEntryMaximum: canonical(buyEntryMaximum),
    sellEntryMinimum: canonical(sellEntryMinimum),
    sellEntryMaximum: canonical(sellEntryMaximum),
    buyPreferredEntryMinimum: canonical(buyPreferredEntryMinimum),
    buyPreferredEntryMaximum: canonical(buyPreferredEntryMaximum),
    sellPreferredEntryMinimum: canonical(sellPreferredEntryMinimum),
    sellPreferredEntryMaximum: canonical(sellPreferredEntryMaximum),
    entryLatencyBufferAtr: canonical(entryLatencyBufferAtr),
    preferredMaxEntryDistanceAtr: canonical(preferredMaxEntryDistanceAtr),
    minimumStopDistance: canonical(modelMinimumStopDistance),
    maximumStopDistance: canonical(maximumStopDistance),
    preferredExpiresAt: new Date(preferredExpiresAt).toISOString(),
  };
}

export function modelCallBudgetMs(input: {
  readonly brokerServerTime: string;
  readonly postModelReserveMs: number;
  readonly minimumModelBudgetMs: number;
}): number {
  const serverTime = Date.parse(input.brokerServerTime);
  if (
    !Number.isFinite(serverTime) ||
    !Number.isSafeInteger(input.postModelReserveMs) ||
    input.postModelReserveMs < 1_000 ||
    input.postModelReserveMs > 30_000 ||
    !Number.isSafeInteger(input.minimumModelBudgetMs) ||
    input.minimumModelBudgetMs < 1_000 ||
    input.minimumModelBudgetMs > 55_000
  ) {
    throw new Error("MODEL_DEADLINE_CONFIG_INVALID");
  }
  const nextM1Boundary = (Math.floor(serverTime / 60_000) + 1) * 60_000;
  const budget = nextM1Boundary - serverTime - input.postModelReserveMs;
  if (budget < input.minimumModelBudgetMs) {
    throw new Error("MODEL_DEADLINE_INSUFFICIENT");
  }
  return budget;
}
