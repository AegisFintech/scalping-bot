import { Decimal } from "decimal.js";

export const CTraderPayload = {
  HEARTBEAT_EVENT: 51,
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  NEW_ORDER_REQ: 2106,
  CANCEL_ORDER_REQ: 2108,
  ASSET_LIST_REQ: 2112,
  ASSET_LIST_RES: 2113,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  TRADER_REQ: 2121,
  TRADER_RES: 2122,
  RECONCILE_REQ: 2124,
  RECONCILE_RES: 2125,
  EXECUTION_EVENT: 2126,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SUBSCRIBE_SPOTS_RES: 2128,
  SPOT_EVENT: 2131,
  ORDER_ERROR_EVENT: 2132,
  DEAL_LIST_REQ: 2133,
  DEAL_LIST_RES: 2134,
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
  EXPECTED_MARGIN_REQ: 2139,
  EXPECTED_MARGIN_RES: 2140,
  ERROR_RES: 2142,
  CASH_FLOW_HISTORY_LIST_REQ: 2143,
  CASH_FLOW_HISTORY_LIST_RES: 2144,
  GET_ACCOUNTS_REQ: 2149,
  GET_ACCOUNTS_RES: 2150,
  DEPTH_EVENT: 2155,
  SUBSCRIBE_DEPTH_REQ: 2156,
  SUBSCRIBE_DEPTH_RES: 2157,
  REFRESH_TOKEN_REQ: 2173,
  REFRESH_TOKEN_RES: 2174,
  ORDER_LIST_REQ: 2175,
  ORDER_LIST_RES: 2176,
  POSITION_UNREALIZED_PNL_REQ: 2187,
  POSITION_UNREALIZED_PNL_RES: 2188,
} as const;

export interface CTraderEnvelope {
  readonly clientMsgId?: string;
  readonly payloadType: number;
  readonly payload: Record<string, unknown>;
}

export function parseEnvelope(raw: string): CTraderEnvelope {
  const parsed: unknown = JSON.parse(raw);
  const object = record(parsed, "CTRADER_ENVELOPE_INVALID");
  const payloadType = numberField(object, "payloadType");
  const payload = record(object.payload ?? {}, "CTRADER_PAYLOAD_INVALID");
  const clientMsgId = optionalStringField(object, "clientMsgId");
  return clientMsgId === undefined
    ? { payloadType, payload }
    : { clientMsgId, payloadType, payload };
}

export function record(
  value: unknown,
  reason = "CTRADER_OBJECT_INVALID",
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(reason);
  return value as Record<string, unknown>;
}

export function recordsField(
  object: Record<string, unknown>,
  key: string,
): readonly Record<string, unknown>[] {
  const value = object[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => record(item));
}

export function stringField(
  object: Record<string, unknown>,
  key: string,
): string {
  const value = object[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return value.toString();
  throw new Error(`CTRADER_FIELD_INVALID:${key}`);
}

export function optionalStringField(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  if (value === undefined || value === null) return undefined;
  return stringField(object, key);
}

export function numberField(
  object: Record<string, unknown>,
  key: string,
): number {
  const value = object[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`CTRADER_FIELD_INVALID:${key}`);
}

export function optionalNumberField(
  object: Record<string, unknown>,
  key: string,
): number | undefined {
  if (object[key] === undefined || object[key] === null) return undefined;
  return numberField(object, key);
}

export function booleanField(
  object: Record<string, unknown>,
  key: string,
): boolean {
  const value = object[key];
  if (typeof value !== "boolean")
    throw new Error(`CTRADER_FIELD_INVALID:${key}`);
  return value;
}

export function protocolPrice(value: unknown): Decimal {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^-?\d+$/.test(String(value))
  ) {
    throw new Error("CTRADER_RELATIVE_PRICE_INVALID");
  }
  return new Decimal(String(value)).div(100_000);
}

export function protocolVolume(value: unknown): Decimal {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value))
  ) {
    throw new Error("CTRADER_VOLUME_INVALID");
  }
  return new Decimal(String(value));
}

export function protocolInteger(value: string, reason: string): number {
  if (!/^\d+$/.test(value)) throw new Error(reason);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(reason);
  return parsed;
}

export function exactProtocolDouble(value: string, digits: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("CTRADER_PRICE_DOUBLE_INVALID");
  const roundTrip = new Decimal(parsed.toFixed(digits));
  if (!roundTrip.eq(new Decimal(value)))
    throw new Error("CTRADER_PRICE_PRECISION_LOSS");
  return parsed;
}
