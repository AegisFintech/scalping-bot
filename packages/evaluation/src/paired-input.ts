/** Read-only research projection. Nulls preserve missing evidence, not defaults. */
export interface PairedReplayLeg {
  side: "BUY" | "SELL";
  accepted: string | null;
  entry: string;
  sl: string;
  tp: string;
  volume: string;
  budget: string | null;
  equity: string | null;
  order_type: string | null;
  tif: string;
  fill: { time: string; price: string } | null;
}
export interface PairedReplayRow {
  created: Date;
  captured: Date | null;
  available: Date | null;
  valid_until: Date | null;
  submission_valid_until: Date | null;
  tick_size: string | null;
  model_buy: string | null;
  model_sell: string | null;
  model_schema: string | null;
  legs: PairedReplayLeg[];
}
