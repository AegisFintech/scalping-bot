import type { DiagnosticRow } from "../../packages/evaluation/src/trading-diagnostics.js";
import type { CostPayoffRow } from "../../packages/evaluation/src/cost-payoff-audit.js";
const row: DiagnosticRow = {
  direction: "LONG",
  opened_at: "2026-10-02T01:00:00Z",
  closed_at: "2026-10-02T02:00:00Z",
  intent_at: "2026-10-02T00:59:00Z",
  decided_at: "2026-10-02T00:58:00Z",
  net: "-12",
  fees: "-2",
  risk_budget: "5",
  model_level: "100",
  effective_entry: "101",
  ema_alignment: null,
  equity: "1000",
  expected_volume: "2",
  fills: [
    { price: "101", volume: "1" },
    { price: "103", volume: "1" },
  ],
  protection: { samples: 1, verified: 1, missingStop: 0 },
  close_evidence: [
    {
      gross: "-10",
      swap: "0",
      commission: "-2",
      conversion: "0",
      order_type: 4,
    },
  ],
};
export const auditRow: CostPayoffRow = {
  ...row,
  intended_stop: "99",
  intended_target: "102",
  fee_evidence: [
    {
      validated_at: row.decided_at!,
      estimate: {
        side: "BUY",
        entry_price: "101",
        take_profit: "102",
        volume: "2",
        gross_profit: "4",
        opening_commission: "0.9",
        closing_commission: "1.0",
        pnl_conversion_fee: "0",
        total_estimated_fees: "1.9",
        expected_net_profit: "2.1",
      },
    },
  ],
};
export { row };
