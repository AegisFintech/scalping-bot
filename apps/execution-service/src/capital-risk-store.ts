import type pg from "pg";
import type { AccountState } from "../../../packages/contracts/src/index.js";
import {
  capitalRisk,
  type CapitalState,
} from "../../../packages/risk-engine/src/capital.js";

export class CapitalRiskStore {
  constructor(private readonly pool: pg.Pool) {}

  async reference(accountId: string): Promise<{ start: Date; equity: string }> {
    const result = await this.pool.query<{ start: Date; equity: string }>(
      `SELECT reconciled_at AS start, reference_equity::text AS equity FROM capital_risk_state WHERE account_id=$1`,
      [accountId],
    );
    if (result.rows[0]) return result.rows[0];
    // First deployment starts from a fresh reconciled observation; historical
    // unobserved intraday peaks are not invented. It never overwrites daily loss.
    return { start: new Date(), equity: "0" };
  }

  async reconcile(input: {
    accountId: string;
    account: AccountState;
    netFlowsSinceReference: string;
    dailyLossPercent: string;
    now: Date;
  }): Promise<CapitalState> {
    if (
      !input.account.certain ||
      !Number.isFinite(Date.parse(input.account.reconciledAt)) ||
      input.now.getTime() < Date.parse(input.account.reconciledAt) ||
      input.now.getTime() - Date.parse(input.account.reconciledAt) > 10_000
    )
      throw new Error("CAPITAL_ACCOUNT_STALE_OR_UNCERTAIN");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [input.accountId],
      );
      const rows = await client.query<{
        reference_equity: string;
        high_water_equity: string;
        adjusted_equity: string;
        cumulative_net_flows: string;
        drawdown_percent: string;
        risk_multiplier: CapitalState["riskMultiplier"];
        locked_out: boolean;
        observed_at: Date;
      }>("SELECT * FROM capital_risk_state WHERE account_id=$1 FOR UPDATE", [
        input.accountId,
      ]);
      const row = rows.rows[0];
      const observedAt = new Date(input.account.reconciledAt);
      if (row && observedAt.getTime() < row.observed_at.getTime())
        throw new Error("CAPITAL_OBSERVATION_REGRESSED");
      const previous: CapitalState | null = row
        ? {
            referenceEquity: row.reference_equity,
            highWaterEquity: row.high_water_equity,
            adjustedEquity: row.adjusted_equity,
            cumulativeNetFlows: row.cumulative_net_flows,
            drawdownPercent: row.drawdown_percent,
            riskMultiplier: row.risk_multiplier,
            lockedOut: row.locked_out,
          }
        : null;
      const state = capitalRisk({
        equity: input.account.equity,
        cumulativeNetFlows: previous ? input.netFlowsSinceReference : "0",
        dailyLossPercent: input.dailyLossPercent,
        previous,
        referenceEquity: input.account.equity,
        observedHighWater: previous?.highWaterEquity ?? input.account.equity,
      });
      await client.query(
        `INSERT INTO capital_risk_state (account_id,reference_equity,high_water_equity,adjusted_equity,cumulative_net_flows,drawdown_percent,risk_multiplier,locked_out,reconciled_at,observed_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)
        ON CONFLICT (account_id) DO UPDATE SET high_water_equity=EXCLUDED.high_water_equity,adjusted_equity=EXCLUDED.adjusted_equity,cumulative_net_flows=EXCLUDED.cumulative_net_flows,drawdown_percent=EXCLUDED.drawdown_percent,risk_multiplier=EXCLUDED.risk_multiplier,locked_out=capital_risk_state.locked_out OR EXCLUDED.locked_out,observed_at=EXCLUDED.observed_at,updated_at=EXCLUDED.updated_at`,
        [
          input.accountId,
          state.referenceEquity,
          state.highWaterEquity,
          state.adjustedEquity,
          state.cumulativeNetFlows,
          state.drawdownPercent,
          state.riskMultiplier,
          state.lockedOut,
          observedAt,
          input.now,
        ],
      );
      await client.query("COMMIT");
      return state;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
