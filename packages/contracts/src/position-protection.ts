/** Broker observations, never inferred from entry-order protection. */
export interface PositionProtection {
  readonly schemaVersion: "1.0";
  readonly status:
    | "VERIFIED"
    | "REPAIR_REQUIRED"
    | "REPAIR_SENT"
    | "CLOSE_REQUIRED"
    | "CLOSE_SENT"
    | "UNCERTAIN";
  readonly stopLoss: string | null;
  readonly takeProfit: string | null;
  readonly expectedStopLoss: string | null;
  readonly expectedTakeProfit: string | null;
  readonly observedAt: string | null;
  readonly reasonCode: string;
}
