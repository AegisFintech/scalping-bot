import { randomUUID } from "node:crypto";
import type {
  FlightQuoteBatch,
  FlightQuoteEvent,
  FlightQuoteObservation,
} from "../../../packages/contracts/src/flight-quotes.js";
export class FlightQuoteBuffer {
  readonly streamId = randomUUID();
  #sequence = 0;
  #events: FlightQuoteEvent[] = [];
  constructor(
    readonly symbol: string,
    private readonly capacity = 8192,
  ) {
    if (
      !/^[A-Z0-9._-]{1,32}$/.test(symbol) ||
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      capacity > 8192
    )
      throw new Error("FLIGHT_QUOTE_BUFFER_INVALID");
  }
  observe(value: FlightQuoteObservation): void {
    if (value.kind !== "RECONNECT" && value.symbolName !== this.symbol) return;
    const { kind, bid, ask, sourceTime, receivedAt, bidUpdated, askUpdated } =
      value;
    const event = {
      kind,
      bid,
      ask,
      sourceTime,
      receivedAt,
      bidUpdated,
      askUpdated,
    };
    this.#events.push({ ...event, sequence: ++this.#sequence });
    if (this.#events.length > this.capacity)
      this.#events.splice(0, this.#events.length - this.capacity);
  }
  read(after: number): FlightQuoteBatch {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new Error("FLIGHT_QUOTE_CURSOR_INVALID");
    const first = this.#events[0]?.sequence ?? this.#sequence + 1;
    return {
      schemaVersion: "1.0",
      streamId: this.streamId,
      firstSequence: first,
      latestSequence: this.#sequence,
      gap: after > this.#sequence || (after !== 0 && after < first - 1),
      events: this.#events
        .filter((e) => e.sequence > after)
        .slice(0, 2048)
        .map((e) => ({ ...e })),
    };
  }
}
