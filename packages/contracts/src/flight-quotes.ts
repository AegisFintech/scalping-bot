/** Observed quote updates, never a complete market tick tape or execution authority. */
export interface FlightQuoteObservation {
  readonly kind: "QUOTE" | "RECONNECT";
  readonly symbolName: string | null;
  readonly bid: string | null;
  readonly ask: string | null;
  readonly sourceTime: string | null;
  readonly receivedAt: string;
  readonly bidUpdated: boolean;
  readonly askUpdated: boolean;
}
export interface FlightQuoteEvent extends Omit<
  FlightQuoteObservation,
  "symbolName"
> {
  readonly sequence: number;
}
export interface FlightQuoteBatch {
  readonly schemaVersion: "1.0";
  readonly streamId: string;
  readonly firstSequence: number;
  readonly latestSequence: number;
  readonly gap: boolean;
  readonly events: readonly FlightQuoteEvent[];
}
