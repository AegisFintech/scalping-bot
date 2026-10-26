import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";
import { FlightQuoteBuffer } from "../../apps/market-data-service/src/flight-quote-buffer.js";
it("validates bounded observed quote batches with explicit null times, not arbitrary payloads", () => {
  const ajv = new Ajv2020({ strict: true });
  const addFormats = formatsModule.default as unknown as (a: Ajv2020) => void;
  addFormats(ajv);
  const check = ajv.compile(
    JSON.parse(
      readFileSync("schemas/flight-quote-batch-1.0.json", "utf8"),
    ) as AnySchema,
  );
  const buffer = new FlightQuoteBuffer("XAUUSD");
  buffer.observe({
    kind: "RECONNECT",
    symbolName: null,
    bid: null,
    ask: null,
    sourceTime: null,
    receivedAt: "2026-10-26T00:00:00Z",
    bidUpdated: false,
    askUpdated: false,
  });
  const batch = buffer.read(0);
  expect(check(batch)).toBe(true);
  expect(check({ ...batch, rawBrokerPayload: {} })).toBe(false);
  expect(check({ ...batch, events: Array(2049).fill(batch.events[0]) })).toBe(
    false,
  );
  expect(
    check({
      ...batch,
      events: [{ ...batch.events[0], sourceTime: "yesterday" }],
    }),
  ).toBe(false);
});
