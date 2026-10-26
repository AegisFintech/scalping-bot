import { Decimal } from "decimal.js";
import type {
  Quote,
  SymbolMetadata,
} from "../../../packages/contracts/src/index.js";
import {
  CODEX_STRATEGY_VERSION,
  QUICK_OCO,
} from "../../../packages/config/src/policy.js";
import { oneWayCommission } from "../../../packages/risk-engine/src/commission.js";
import type { ProtectionPosition } from "./position-protection.js";

export interface ProfitExitEvidence {
  readonly policy: "quick-profit-exit-v1";
  readonly quote: Quote;
  readonly metadataTime: string;
  readonly entry: string;
  readonly volume: string;
  readonly gross: string;
  readonly entryCommission: string;
  readonly modeledExitCommission: string;
  readonly swap: string;
  readonly conversionReserve: string;
  readonly executionReserve: string;
  readonly modeledNet: string;
  readonly requiredNet: string;
  readonly guaranteedProceeds: false;
}
function nonnegative(value: string): Decimal {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error("QUICK_PROFIT_COST_INVALID");
  return new Decimal(value);
}
/** New demo groups only. A quote opportunity is not a promised closing fill. */
export function quickProfitExit(input: {
  position: ProtectionPosition;
  quote: Quote;
  metadata: SymbolMetadata;
  raw: Record<string, unknown>;
  symbolId: string;
  now: Date;
}): ProfitExitEvidence | null {
  const { position: p, quote: q, metadata: m, raw, now } = input;
  if (
    p.strategyVersion !== CODEX_STRATEGY_VERSION ||
    p.entryCommission === undefined
  )
    return null;
  for (const [at, maximum] of [
    [q.sourceTime, 1000],
    [q.receivedAt, 1000],
    [m.metadataTime, 30_000],
  ] as const) {
    const age = now.getTime() - Date.parse(at);
    if (!Number.isFinite(age) || age < 0 || age > maximum) return null;
  }
  if (m.symbolId !== input.symbolId || m.symbolName !== "XAUUSD") return null;
  const entry = nonnegative(p.entryPrice),
    volume = nonnegative(p.volume),
    tick = nonnegative(m.tickSize);
  const bid = nonnegative(q.bid),
    ask = nonnegative(q.ask);
  if (
    !entry.gt(0) ||
    !volume.gt(0) ||
    !volume.isInteger() ||
    !tick.gt(0) ||
    !bid.gt(0) ||
    ask.lt(bid) ||
    !bid.mod(tick).eq(0) ||
    !ask.mod(tick).eq(0)
  )
    return null;
  if (typeof raw.swap !== "string" && typeof raw.swap !== "number") return null;
  if (
    (typeof raw.swap === "number" && !Number.isSafeInteger(raw.swap)) ||
    !/^-?\d+$/.test(String(raw.swap)) ||
    !Number.isSafeInteger(raw.moneyDigits) ||
    Number(raw.moneyDigits) < 0 ||
    Number(raw.moneyDigits) > 18
  )
    return null;
  // Positive swap is deliberately not used to manufacture a profit threshold.
  const swap = Decimal.min(
    0,
    new Decimal(String(raw.swap)).div(
      new Decimal(10).pow(Number(raw.moneyDigits)),
    ),
  );
  const opening = new Decimal(p.entryCommission);
  if (!opening.isFinite() || opening.gt(0)) return null;
  const mark = p.side === "BUY" ? bid : ask;
  const perPrice = nonnegative(m.tickValue).mul(volume).div(tick);
  if (!perPrice.gt(0)) return null;
  const reservePrice = tick.mul(QUICK_OCO.exitReservePoints);
  const bound = Decimal.max(entry, mark).plus(reservePrice);
  const openingCost = Decimal.max(
    opening.abs(),
    oneWayCommission(m, bound, volume),
  );
  const closingCost = oneWayCommission(m, bound, volume);
  const gross = mark
    .minus(entry)
    .mul(p.side === "BUY" ? 1 : -1)
    .mul(perPrice);
  const conversionRate = nonnegative(m.commission.pnlConversionFeeRate).div(
    100,
  );
  if (conversionRate.gte(1)) return null;
  const conversion = gross
    .abs()
    .plus(reservePrice.mul(perPrice))
    .mul(conversionRate);
  const executionReserve = reservePrice.mul(perPrice);
  const net = gross
    .minus(openingCost)
    .minus(closingCost)
    .plus(swap)
    .minus(conversion)
    .minus(executionReserve);
  const required = nonnegative(QUICK_OCO.earlyNetPrice).mul(perPrice);
  if (!net.gte(required)) return null;
  return {
    policy: "quick-profit-exit-v1",
    quote: q,
    metadataTime: m.metadataTime,
    entry: entry.toFixed(),
    volume: volume.toFixed(0),
    gross: gross.toFixed(),
    entryCommission: openingCost.neg().toFixed(),
    modeledExitCommission: closingCost.neg().toFixed(),
    swap: swap.toFixed(),
    conversionReserve: conversion.toFixed(),
    executionReserve: executionReserve.toFixed(),
    modeledNet: net.toFixed(),
    requiredNet: required.toFixed(),
    guaranteedProceeds: false,
  };
}
