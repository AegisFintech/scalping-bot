import { readFileSync } from "node:fs";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/open-position-monitor-1.1.json", "utf8"),
  ) as AnySchema,
);

const available = {
  status: "AVAILABLE",
  executionState: "NORMAL",
  side: "BUY",
  accountCurrency: "USD",
  bid: "4641.2",
  ask: "4641.4",
  markPrice: "4641.2",
  grossUnrealizedPnl: "3.2",
  netUnrealizedPnl: "2.75",
  recordedCommission: "-0.3",
  quoteSourceTime: "2026-08-25T04:00:00.000Z",
  quoteReceivedAt: "2026-08-25T04:00:00.050Z",
  pnlCapturedAt: "2026-08-25T04:00:00.060Z",
};

describe("open position monitor schema", () => {
  it("accepts each bounded monitor state", () => {
    expect(validate({ status: "NONE" })).toBe(true);
    expect(
      validate({
        status: "UNAVAILABLE",
        reasonCode: "MARKET_QUOTE_UNAVAILABLE",
      }),
    ).toBe(true);
    expect(validate(available)).toBe(true);
    expect(
      validate({
        ...available,
        executionState: "RECONCILIATION_REQUIRED",
      }),
    ).toBe(true);
  });

  it("rejects identifiers, malformed decimals, and incomplete evidence", () => {
    expect(validate({ ...available, brokerPositionId: "7788" })).toBe(false);
    expect(validate({ ...available, netUnrealizedPnl: "NaN" })).toBe(false);
    expect(validate({ ...available, executionState: "ACTIVE" })).toBe(false);
    const incomplete: Record<string, unknown> = { ...available };
    Reflect.deleteProperty(incomplete, "pnlCapturedAt");
    expect(validate(incomplete)).toBe(false);
  });
});
