import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";
import {
  chainRecord,
  registration,
  summarizeOperational,
} from "../../packages/evaluation/src/operational-evidence.js";
const ajv = new Ajv2020({ strict: true });
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
addFormats(ajv);
const record = ajv.compile(
  JSON.parse(
    readFileSync("schemas/operational-evidence-record-1.0.json", "utf8"),
  ) as AnySchema,
);
const summary = ajv.compile(
  JSON.parse(
    readFileSync("schemas/operational-evidence-summary-1.0.json", "utf8"),
  ) as AnySchema,
);
const header = chainRecord(
  registration("0.3.0-fade-limit.3", 1, "2026-10-09T00:00:00.000Z"),
  null,
);
it("validates strict journal records and rejects unsupported identity or extra data", () => {
  expect(record(header)).toBe(true);
  expect(record({ ...header, accountId: "private-placeholder" })).toBe(false);
  expect(
    record({ ...header, payload: { ...header.payload, mode: "live" } }),
  ).toBe(false);
});
it("forbids authority and fabricated qualification evidence in summaries", () => {
  const report = summarizeOperational([header], "2026-10-09T01:00:00.000Z");
  expect(summary(report)).toBe(true);
  for (const change of [
    { qualification: "QUALIFIED" },
    { brokerCalendarVerifiedHours: 24 },
    { protectedCycles: 5 },
    { alertReceipt: true },
    { currentRestore: true },
    { brokerAuthority: true },
    { promotionAuthority: true },
  ])
    expect(summary({ ...report, ...change })).toBe(false);
});
