import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";

import type { BrokerExecution } from "../../../packages/ctrader-client/src/client.js";
import { canonical } from "../../../packages/risk-engine/src/decimal.js";
import type { DemoExecutionEvent } from "./demo-execution.js";

type Field =
  | "stopPrice"
  | "slippageInPoints"
  | "timeInForce"
  | "expirationTimestamp"
  | "utcLastUpdateTimestamp";
export interface BrokerAcknowledgement {
  readonly schemaVersion: "broker-acknowledgement-1.0";
  readonly eventKey: string;
  readonly receivedAt: string;
  readonly brokerOrderType: 3 | 6;
  readonly stopPrice: string | null;
  readonly slippageInPoints: string | null;
  readonly timeInForce: number | null;
  readonly expirationTimestamp: string | null;
  readonly brokerUpdatedAt: string | null;
  readonly invalidFields: readonly Field[];
  readonly evidenceHash: string;
}

/** Capture only fields explicitly present on a validated live acceptance callback. */
export function projectBrokerAcknowledgement(
  raw: BrokerExecution,
  event: DemoExecutionEvent,
): BrokerAcknowledgement | null {
  if (
    raw.executionType !== 2 ||
    event.executionType !== 2 ||
    raw.order === null ||
    event.order?.state !== "PENDING" ||
    event.closingOrder ||
    ![3, 6].includes(event.brokerOrderType ?? 0)
  )
    return null;
  const order = raw.order;
  const invalidFields: Field[] = [];
  function number(field: Field, integer: boolean): string | null {
    const value = order[field];
    if (value === undefined || value === null) return null;
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      String(value).length > 64 ||
      !/^\d+(?:\.\d+)?$/.test(String(value)) ||
      (typeof value === "number" &&
        (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value))))
    ) {
      invalidFields.push(field);
      return null;
    }
    const parsed = new Decimal(String(value));
    if (
      !parsed.isFinite() ||
      parsed.lte(0) ||
      (integer && (!parsed.isInteger() || parsed.gt("9223372036854775807")))
    ) {
      invalidFields.push(field);
      return null;
    }
    const text = canonical(parsed);
    if (
      field === "stopPrice" &&
      !/^(?:0|[1-9][0-9]{0,19})(?:\.[0-9]{1,10})?$/.test(text)
    ) {
      invalidFields.push(field);
      return null;
    }
    return text;
  }
  function timestamp(
    field: "expirationTimestamp" | "utcLastUpdateTimestamp",
  ): string | null {
    const value = number(field, true);
    if (value === null) return null;
    const n = Number(value);
    const date = new Date(n);
    if (
      !Number.isSafeInteger(n) ||
      !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() > 9999
    ) {
      invalidFields.push(field);
      return null;
    }
    return date.toISOString();
  }
  const stopPrice = number("stopPrice", false);
  const slippageInPoints = number("slippageInPoints", true);
  const timeText = number("timeInForce", true);
  const timeInForce =
    timeText !== null && Number(timeText) <= 5 ? Number(timeText) : null;
  if (timeText !== null && timeInForce === null)
    invalidFields.push("timeInForce");
  const payload = {
    schemaVersion: "broker-acknowledgement-1.0" as const,
    eventKey: event.eventKey,
    receivedAt: event.receivedAt,
    brokerOrderType: event.brokerOrderType as 3 | 6,
    stopPrice,
    slippageInPoints,
    timeInForce,
    expirationTimestamp: timestamp("expirationTimestamp"),
    brokerUpdatedAt: timestamp("utcLastUpdateTimestamp"),
    invalidFields,
  };
  return {
    ...payload,
    evidenceHash: createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex"),
  };
}
