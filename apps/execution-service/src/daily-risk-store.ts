import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { AccountState } from "../../../packages/contracts/src/index.js";
import { dailyLoss } from "../../../packages/risk-engine/src/risk.js";
import {
  canonical,
  decimal,
  signedDecimal,
} from "../../../packages/risk-engine/src/decimal.js";

export function tradingDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  if (
    value.year === undefined ||
    value.month === undefined ||
    value.day === undefined
  ) {
    throw new Error("DAILY_RISK_TIMEZONE_INVALID");
  }
  return `${value.year}-${value.month}-${value.day}`;
}

export function tradingDayStart(now: Date, timeZone: string): Date {
  const target = tradingDay(now, timeZone);
  const [year, month, day] = target.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("DAILY_RISK_TIMEZONE_INVALID");
  }
  let low = Date.UTC(year, month - 1, day) - 36 * 60 * 60 * 1_000;
  let high = Date.UTC(year, month - 1, day) + 36 * 60 * 60 * 1_000;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (tradingDay(new Date(middle), timeZone) < target) low = middle;
    else high = middle;
  }
  const result = new Date(high);
  if (tradingDay(result, timeZone) !== target || result > now) {
    throw new Error("DAILY_RISK_DAY_START_INVALID");
  }
  return result;
}

export function assertReconciledBaselineEvidence(input: {
  readonly brokerDealCount: number;
  readonly brokerPositionCount: number;
  readonly brokerOrderCount: number;
  readonly externalFlowOperationCount: number;
}): void {
  for (const count of [
    input.brokerDealCount,
    input.brokerPositionCount,
    input.brokerOrderCount,
    input.externalFlowOperationCount,
  ]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("DAILY_RISK_BASELINE_EVIDENCE_INVALID");
    }
  }
  if (
    input.brokerDealCount !== 0 ||
    input.brokerPositionCount !== 0 ||
    input.brokerOrderCount !== 0
  ) {
    throw new Error("DAILY_RISK_BASELINE_BROKER_ACTIVITY_PRESENT");
  }
}

export class DailyRiskStore {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async initializeReconciledBaseline(input: {
    readonly accountId: string;
    readonly account: AccountState;
    readonly timezone: string;
    readonly netFlows: string;
    readonly brokerDealCount: number;
    readonly brokerPositionCount: number;
    readonly brokerOrderCount: number;
    readonly externalFlowOperationCount: number;
    readonly actor: string;
    readonly reason: string;
    readonly instanceId: string;
    readonly environment: string;
    readonly tradingMode: "demo";
    readonly accountKey: string;
    readonly symbol: string;
    readonly now?: Date;
  }): Promise<{ readonly tradingDay: string; readonly timezone: string }> {
    if (!input.account.certain) throw new Error("DAILY_RISK_ACCOUNT_UNCERTAIN");
    assertReconciledBaselineEvidence(input);
    const now = input.now ?? new Date();
    const day = tradingDay(now, input.timezone);
    const baseline = canonical(
      decimal(input.account.equity).minus(signedDecimal(input.netFlows)),
    );
    if (decimal(baseline).lte(0))
      throw new Error("DAILY_RISK_BASELINE_INVALID");
    const unrealized = canonical(
      decimal(input.account.equity).minus(decimal(input.account.balance)),
    );
    const realized = canonical(
      decimal(input.account.balance)
        .minus(decimal(baseline))
        .minus(signedDecimal(input.netFlows)),
    );
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const existing = await client.query(
        `SELECT 1 FROM daily_risk_state
         WHERE account_id = $1 AND trading_day = $2 AND timezone = $3
         FOR UPDATE`,
        [input.accountId, day, input.timezone],
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new Error("DAILY_RISK_BASELINE_ALREADY_EXISTS");
      }
      await client.query(
        `INSERT INTO daily_risk_state
          (id, account_id, trading_day, timezone, baseline_equity, current_equity,
           net_flows, realized_pnl, unrealized_pnl, loss_percent, locked_out,
           lockout_reason, locked_at, reconciled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, false, NULL, NULL, $10)`,
        [
          randomUUID(),
          input.accountId,
          day,
          input.timezone,
          baseline,
          input.account.equity,
          input.netFlows,
          realized,
          unrealized,
          now,
        ],
      );
      await client.query(
        `INSERT INTO audit_events
          (id, occurred_at, severity, service, instance_id, environment, trading_mode,
           symbol, account_key, event_name, outcome, reason_code, details)
         VALUES ($1, $2, 'warn', 'execution-service', $3, $4, $5, $6, $7,
                 'daily_risk_baseline_initialized', 'success',
                 'OPERATOR_RECONCILED_BASELINE', $8::jsonb)`,
        [
          randomUUID(),
          now,
          input.instanceId,
          input.environment,
          input.tradingMode,
          input.symbol,
          input.accountKey,
          JSON.stringify({
            trading_day: day,
            timezone: input.timezone,
            actor: input.actor,
            reason: input.reason,
            broker_deal_count: input.brokerDealCount,
            broker_position_count: input.brokerPositionCount,
            broker_order_count: input.brokerOrderCount,
            external_flow_operation_count: input.externalFlowOperationCount,
          }),
        ],
      );
      await client.query("COMMIT");
      return { tradingDay: day, timezone: input.timezone };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcile(input: {
    readonly accountId: string;
    readonly account: AccountState;
    readonly timezone: string;
    readonly thresholdPercent: string;
    readonly includeUnrealized: boolean;
    readonly netFlows: string;
    readonly allowBaselineBootstrap: boolean;
    readonly baselineCaptureGraceSeconds: number;
    readonly now?: Date;
  }): Promise<{ readonly lockedOut: boolean; readonly lossPercent: string }> {
    if (!input.account.certain) throw new Error("DAILY_RISK_ACCOUNT_UNCERTAIN");
    const now = input.now ?? new Date();
    const day = tradingDay(now, input.timezone);
    const dayStart = tradingDayStart(now, input.timezone);
    const existing = await this.#pool.query<{
      baseline_equity: string;
      locked_out: boolean;
    }>(
      `SELECT baseline_equity::text, locked_out
       FROM daily_risk_state WHERE account_id = $1 AND trading_day = $2 AND timezone = $3`,
      [input.accountId, day, input.timezone],
    );
    const currentEquity = input.includeUnrealized
      ? input.account.equity
      : input.account.balance;
    let baseline = existing.rows[0]?.baseline_equity;
    if (baseline === undefined) {
      const withinGrace =
        now.getTime() - dayStart.getTime() <=
        input.baselineCaptureGraceSeconds * 1_000;
      if (!input.allowBaselineBootstrap && !withinGrace) {
        throw new Error("DAILY_RISK_BASELINE_UNAVAILABLE");
      }
      baseline = canonical(
        decimal(currentEquity).minus(signedDecimal(input.netFlows)),
      );
      if (decimal(baseline).lte(0))
        throw new Error("DAILY_RISK_BASELINE_INVALID");
    }
    const result = dailyLoss({
      baselineEquity: baseline,
      currentEquity,
      netFlows: input.netFlows,
      thresholdPercent: input.thresholdPercent,
    });
    const locked = (existing.rows[0]?.locked_out ?? false) || result.lockedOut;
    const unrealized = decimal(input.account.equity).minus(
      decimal(input.account.balance),
    );
    await this.#pool.query(
      `INSERT INTO daily_risk_state
        (id, account_id, trading_day, timezone, baseline_equity, current_equity,
         net_flows, realized_pnl, unrealized_pnl, loss_percent, locked_out, lockout_reason,
         locked_at, reconciled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               CASE WHEN $11 THEN now() ELSE NULL END, now())
       ON CONFLICT (account_id, trading_day, timezone)
       DO UPDATE SET current_equity = EXCLUDED.current_equity,
         realized_pnl = EXCLUDED.realized_pnl,
         unrealized_pnl = EXCLUDED.unrealized_pnl,
         net_flows = EXCLUDED.net_flows,
         loss_percent = EXCLUDED.loss_percent,
         locked_out = daily_risk_state.locked_out OR EXCLUDED.locked_out,
         lockout_reason = CASE
           WHEN daily_risk_state.locked_out OR EXCLUDED.locked_out THEN 'DAILY_LOSS_LOCKOUT'
           ELSE NULL END,
         locked_at = CASE
           WHEN (daily_risk_state.locked_out OR EXCLUDED.locked_out)
             THEN COALESCE(daily_risk_state.locked_at, now())
           ELSE NULL END,
         reconciled_at = now(), updated_at = now()`,
      [
        randomUUID(),
        input.accountId,
        day,
        input.timezone,
        baseline,
        currentEquity,
        input.netFlows,
        canonical(
          decimal(input.account.balance)
            .minus(decimal(baseline))
            .minus(signedDecimal(input.netFlows)),
        ),
        canonical(unrealized),
        result.lossPercent,
        locked,
        locked ? "DAILY_LOSS_LOCKOUT" : null,
      ],
    );
    return { lockedOut: locked, lossPercent: result.lossPercent };
  }
}
