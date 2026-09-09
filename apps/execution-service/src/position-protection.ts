import { Decimal } from "decimal.js";
import type { PositionProtection } from "../../../packages/contracts/src/position-protection.js";
import type { Quote } from "../../../packages/contracts/src/index.js";
import type {
  BrokerExecution,
  RawReconciliation,
} from "../../../packages/ctrader-client/src/client.js";
import {
  numberField,
  record,
  stringField,
} from "../../../packages/ctrader-client/src/protocol.js";

export interface ProtectionPosition {
  readonly id: string;
  readonly brokerPositionId: string;
  readonly side: "BUY" | "SELL";
  readonly volume: string;
  readonly entryPrice: string;
  readonly orderEntry: string;
  readonly orderStopLoss: string;
  readonly orderTakeProfit: string;
  readonly label: string;
  readonly repairAttempts: number;
  readonly commandAt: string | null;
  readonly closeRequestedAt: string | null;
}

export interface ProtectionSession {
  positions(): Promise<readonly ProtectionPosition[]>;
  observe(
    position: ProtectionPosition,
    observation: PositionProtection,
  ): Promise<void>;
  claimRepair(position: ProtectionPosition, at: string): Promise<boolean>;
  claimClose(
    position: ProtectionPosition,
    at: string,
    volume: string,
  ): Promise<boolean>;
  closeAcknowledged(
    position: ProtectionPosition,
    brokerOrderId: string,
  ): Promise<void>;
}
export interface ProtectionStore {
  exclusive(work: (session: ProtectionSession) => Promise<void>): Promise<void>;
}
export interface ProtectionClient {
  reconcileRaw(): Promise<RawReconciliation>;
  amendPositionProtection(
    positionId: string,
    symbol: string,
    stopLoss: string,
    takeProfit: string,
  ): Promise<BrokerExecution>;
  closePosition(positionId: string, volume: string): Promise<BrokerExecution>;
}
export interface ProtectionOptions {
  readonly store: ProtectionStore;
  readonly client: ProtectionClient;
  readonly symbolId: string;
  readonly symbol: string;
  readonly tickSize: string;
  readonly quote: () => Promise<Quote>;
  readonly pause: () => Promise<void>;
  readonly now?: () => Date;
}

function positive(value: unknown): Decimal {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+(?:\.\d+)?$/.test(String(value))
  )
    throw new Error("POSITION_PROTECTION_PRICE_INVALID");
  const result = new Decimal(value);
  if (!result.isFinite() || !result.gt(0))
    throw new Error("POSITION_PROTECTION_PRICE_INVALID");
  return result;
}
function fresh(value: string, now: Date): void {
  const age = now.getTime() - Date.parse(value);
  if (!Number.isFinite(age) || age < 0 || age > 2_000)
    throw new Error("POSITION_PROTECTION_OBSERVATION_STALE");
}

/** Restore approved distances from actual VWAP. Never widen existing protection. */
export function protectionPlan(
  position: ProtectionPosition,
  raw: Record<string, unknown>,
  symbolId: string,
  tickSize: string,
): {
  stopLoss: string | null;
  takeProfit: string | null;
  expectedStopLoss: string;
  expectedTakeProfit: string;
  volume: string;
  repair: boolean;
} {
  const trade = record(raw.tradeData);
  const volume = positive(stringField(trade, "volume"));
  const price = positive(raw.price);
  if (
    stringField(raw, "positionId") !== position.brokerPositionId ||
    stringField(trade, "symbolId") !== symbolId ||
    stringField(trade, "label") !== position.label ||
    !position.label.startsWith("ctrader-ai-scalper") ||
    numberField(trade, "tradeSide") !== (position.side === "BUY" ? 1 : 2) ||
    numberField(raw, "positionStatus") !== 1 ||
    !volume.isInteger() ||
    !volume.eq(position.volume) ||
    !price.eq(position.entryPrice)
  )
    throw new Error("POSITION_PROTECTION_OWNERSHIP_OR_STATE_MISMATCH");
  const tick = positive(tickSize);
  const buy = position.side === "BUY";
  const slDistance = buy
    ? positive(position.orderEntry).minus(positive(position.orderStopLoss))
    : positive(position.orderStopLoss).minus(positive(position.orderEntry));
  const tpDistance = buy
    ? positive(position.orderTakeProfit).minus(positive(position.orderEntry))
    : positive(position.orderEntry).minus(positive(position.orderTakeProfit));
  if (!slDistance.gt(0) || !tpDistance.gt(0))
    throw new Error("POSITION_PROTECTION_INTENT_INVALID");
  const actual = (value: unknown): Decimal | null => {
    if (value === undefined || value === null || value === 0 || value === "0")
      return null;
    const parsed = positive(value);
    if (!parsed.mod(tick).eq(0))
      throw new Error("POSITION_PROTECTION_PRECISION_INVALID");
    return parsed;
  };
  const sl = actual(raw.stopLoss),
    tp = actual(raw.takeProfit);
  const roundedSl = (buy ? price.minus(slDistance) : price.plus(slDistance))
    .div(tick)
    .toDecimalPlaces(0, buy ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR)
    .mul(tick);
  const roundedTp = (buy ? price.plus(tpDistance) : price.minus(tpDistance))
    .div(tick)
    .toDecimalPlaces(0, buy ? Decimal.ROUND_FLOOR : Decimal.ROUND_CEIL)
    .mul(tick);
  const expectedSl =
    sl === null
      ? roundedSl
      : buy
        ? Decimal.max(sl, roundedSl)
        : Decimal.min(sl, roundedSl);
  const expectedTp =
    tp === null
      ? roundedTp
      : buy
        ? Decimal.min(tp, roundedTp)
        : Decimal.max(tp, roundedTp);
  positive(expectedSl.toFixed());
  positive(expectedTp.toFixed());
  return {
    stopLoss: sl?.toFixed() ?? null,
    takeProfit: tp?.toFixed() ?? null,
    expectedStopLoss: expectedSl.toFixed(),
    expectedTakeProfit: expectedTp.toFixed(),
    volume: volume.toFixed(0),
    repair:
      sl === null || tp === null || !sl.eq(expectedSl) || !tp.eq(expectedTp),
  };
}

export class PositionProtectionMaintenance {
  constructor(private readonly options: ProtectionOptions) {}
  async run(): Promise<void> {
    await this.options.store.exclusive(async (session) => {
      const positions = await session.positions();
      // One malformed position must not starve another owned position of maintenance.
      const failures: unknown[] = [];
      for (const position of positions) {
        try {
          await this.maintain(session, position);
        } catch (error) {
          failures.push(error);
          await session.observe(position, {
            schemaVersion: "1.0",
            status: "UNCERTAIN",
            stopLoss: null,
            takeProfit: null,
            expectedStopLoss: null,
            expectedTakeProfit: null,
            observedAt: null,
            reasonCode: "POSITION_PROTECTION_UNAVAILABLE",
          });
        }
      }
      if (failures.length > 0)
        throw new Error("POSITION_PROTECTION_UNAVAILABLE");
    });
  }
  private async maintain(
    session: ProtectionSession,
    position: ProtectionPosition,
  ): Promise<void> {
    const now = () => this.options.now?.() ?? new Date();
    const snapshot = await this.options.client.reconcileRaw();
    fresh(snapshot.receivedAt, now());
    const matches = snapshot.positions.filter(
      (p) => stringField(p, "positionId") === position.brokerPositionId,
    );
    if (matches.length !== 1)
      throw new Error("POSITION_PROTECTION_RECONCILIATION_REQUIRED");
    const plan = protectionPlan(
      position,
      matches[0]!,
      this.options.symbolId,
      this.options.tickSize,
    );
    const observation: PositionProtection = {
      schemaVersion: "1.0",
      status: plan.repair ? "REPAIR_REQUIRED" : "VERIFIED",
      stopLoss: plan.stopLoss,
      takeProfit: plan.takeProfit,
      expectedStopLoss: plan.expectedStopLoss,
      expectedTakeProfit: plan.expectedTakeProfit,
      observedAt: snapshot.receivedAt,
      reasonCode: plan.repair
        ? "POSITION_PROTECTION_MISSING_OR_WIDE"
        : "POSITION_PROTECTION_CONFIRMED",
    };
    if (position.closeRequestedAt !== null) {
      await session.observe(position, {
        ...observation,
        status: "CLOSE_SENT",
        reasonCode: "POSITION_PROTECTION_CLOSE_AWAITING_DEAL",
      });
      await this.options.pause();
      return; // A timeout or restart never creates another close request.
    }
    await session.observe(position, observation);
    const quote = await this.options.quote();
    fresh(quote.sourceTime, now());
    fresh(quote.receivedAt, now());
    const bid = positive(quote.bid),
      ask = positive(quote.ask);
    if (ask.lt(bid)) throw new Error("POSITION_PROTECTION_QUOTE_INVALID");
    const buy = position.side === "BUY";
    const mark = buy ? bid : ask;
    const crossed = buy
      ? mark.lte(plan.expectedStopLoss) || mark.gte(plan.expectedTakeProfit)
      : mark.gte(plan.expectedStopLoss) || mark.lte(plan.expectedTakeProfit);
    if (!crossed && !plan.repair) return;
    if (
      position.commandAt !== null &&
      now().getTime() - Date.parse(position.commandAt) < 5_000
    )
      return;
    // Re-read immediately before any command, including a crossed-boundary fallback.
    const latest = await this.options.client.reconcileRaw();
    fresh(latest.receivedAt, now());
    const current = latest.positions.filter(
      (p) => stringField(p, "positionId") === position.brokerPositionId,
    );
    if (current.length !== 1)
      throw new Error("POSITION_PROTECTION_RECONCILIATION_REQUIRED");
    const confirmed = protectionPlan(
      position,
      current[0]!,
      this.options.symbolId,
      this.options.tickSize,
    );
    if (JSON.stringify(plan) !== JSON.stringify(confirmed)) return; // Re-plan changed protection on next tick.
    fresh(quote.sourceTime, now());
    fresh(quote.receivedAt, now());
    if (crossed || position.repairAttempts >= 2) {
      await this.options.pause();
      await session.observe(position, {
        ...observation,
        status: "CLOSE_REQUIRED",
        reasonCode: crossed
          ? "POSITION_PROTECTION_BOUNDARY_CROSSED"
          : "POSITION_PROTECTION_REPAIR_EXHAUSTED",
      });
      fresh(latest.receivedAt, now());
      fresh(quote.sourceTime, now());
      fresh(quote.receivedAt, now());
      if (
        !(await session.claimClose(
          position,
          now().toISOString(),
          confirmed.volume,
        ))
      )
        return;
      const result = await this.options.client.closePosition(
        position.brokerPositionId,
        confirmed.volume,
      );
      if (result.order !== null) {
        const brokerOrderId = stringField(result.order, "orderId");
        if (
          result.position !== null &&
          stringField(result.position, "positionId") !==
            position.brokerPositionId
        )
          throw new Error("POSITION_PROTECTION_CLOSE_ACK_MISMATCH");
        await session.closeAcknowledged(position, brokerOrderId);
      }
      return;
    }
    if (!(await session.claimRepair(position, now().toISOString()))) return;
    await this.options.client.amendPositionProtection(
      position.brokerPositionId,
      this.options.symbol,
      confirmed.expectedStopLoss,
      confirmed.expectedTakeProfit,
    );
    // The acknowledgement is not proof. Next independent tick verifies fresh broker state.
  }
}
