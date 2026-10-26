import { expect, it } from "vitest";
import { FlightQuoteBuffer } from "../../apps/market-data-service/src/flight-quote-buffer.js";
import type { FlightQuoteObservation } from "../../packages/contracts/src/flight-quotes.js";
const event: FlightQuoteObservation = {
  kind: "QUOTE",
  symbolName: "XAUUSD",
  bid: "4000",
  ask: "4000.01",
  sourceTime: "2026-10-26T00:00:00.000Z",
  receivedAt: "2026-10-26T00:00:00.001Z",
  bidUpdated: true,
  askUpdated: true,
};
it("preserves observed source/receive events and makes bounded overflow explicit", () => {
  const buffer = new FlightQuoteBuffer("XAUUSD", 3);
  buffer.observe({ ...event, symbolName: "OTHER" });
  expect(buffer.read(0).events).toHaveLength(0);
  for (let i = 0; i < 5; i++)
    buffer.observe({ ...event, bid: String(4000 + i) });
  const batch = buffer.read(1);
  expect(batch.gap).toBe(true);
  expect(batch.events.map((e) => e.sequence)).toEqual([3, 4, 5]);
  expect(batch.events[0]!.sourceTime).toBe(event.sourceTime);
  expect(batch.events[0]).not.toHaveProperty("symbolName");
  expect(buffer.read(5).events).toHaveLength(0);
  expect(buffer.read(6).gap).toBe(true);
  expect(() => buffer.read(-1)).toThrow("FLIGHT_QUOTE_CURSOR_INVALID");
  buffer.observe({
    ...event,
    kind: "RECONNECT",
    symbolName: null,
    bid: null,
    ask: null,
    sourceTime: null,
  });
  expect(buffer.read(5).events[0]!.kind).toBe("RECONNECT");
});
it("starts a distinct stream on restart and returns snapshots without shared mutable event objects", () => {
  const a = new FlightQuoteBuffer("XAUUSD"),
    b = new FlightQuoteBuffer("XAUUSD");
  expect(a.streamId).not.toBe(b.streamId);
  a.observe(event);
  const read = a.read(0);
  expect(read.events[0]).not.toBe(event);
  expect(() => new FlightQuoteBuffer("XAUUSD", 0)).toThrow(
    "FLIGHT_QUOTE_BUFFER_INVALID",
  );
});
