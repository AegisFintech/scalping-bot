import { Decimal } from "decimal.js";

export const DECIMAL_PATTERN = /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$/;
export const SIGNED_DECIMAL_PATTERN =
  /^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$/;

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -100,
  toExpPos: 100,
});

export function decimal(value: string, reason = "INVALID_DECIMAL"): Decimal {
  if (!DECIMAL_PATTERN.test(value)) throw new Error(reason);
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new Error(reason);
  return parsed;
}

export function signedDecimal(
  value: string,
  reason = "INVALID_SIGNED_DECIMAL",
): Decimal {
  if (!SIGNED_DECIMAL_PATTERN.test(value)) throw new Error(reason);
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new Error(reason);
  return parsed;
}

export function canonical(value: Decimal): string {
  const text = value.toFixed();
  if (!text.includes(".")) return text;
  return text.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function isTickAligned(value: Decimal, tickSize: Decimal): boolean {
  return tickSize.gt(0) && value.mod(tickSize).eq(0);
}
