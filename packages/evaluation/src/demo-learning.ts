import { Decimal } from "decimal.js";
import { signedDecimal } from "../../risk-engine/src/decimal.js";

/** Observations only: never imported by trading admission or provider dispatch. */
export interface LearningRow {
  direction: "LONG" | "SHORT";
  opened_at: string;
  closed_at: string;
  net: string;
  fees: string;
  risk_budget: string | null;
  model_level: string | null;
  effective_entry: string | null;
  ema_alignment: string | null;
  close_evidence: readonly {
    gross: string | null;
    swap: string | null;
    commission: string | null;
    conversion: string | null;
    order_type: number | null;
  }[];
}

export function learningWindow(args: readonly string[]) {
  const [release, from, until] = args;
  const validTime = (value: string | undefined): value is string => {
    if (
      value === undefined ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    )
      return false;
    const time = Date.parse(value);
    const normalized = value.includes(".")
      ? value
      : value.replace("Z", ".000Z");
    return Number.isFinite(time) && new Date(time).toISOString() === normalized;
  };
  if (
    args.length !== 3 ||
    release === undefined ||
    !/^0\.3\.0-fade-limit\.[123]$/.test(release) ||
    !validTime(from) ||
    !validTime(until) ||
    Date.parse(from) >= Date.parse(until)
  ) {
    throw new Error("LEARNING_WINDOW_INVALID");
  }
  return { release, from, until };
}

function money(value: string): Decimal {
  return signedDecimal(value, "LEARNING_DECIMAL_INVALID");
}

function text(value: Decimal): string {
  return value.toDecimalPlaces(10).toFixed();
}

export function learningObservation(row: LearningRow) {
  const net = money(row.net);
  const fees = money(row.fees);
  const opened = Date.parse(row.opened_at);
  const closed = Date.parse(row.closed_at);
  if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened)
    throw new Error("LEARNING_TIME_INVALID");
  if (row.direction !== "LONG" && row.direction !== "SHORT")
    throw new Error("LEARNING_DIRECTION_INVALID");
  const budget = row.risk_budget === null ? null : money(row.risk_budget);
  if (budget !== null && budget.lte(0))
    throw new Error("LEARNING_RISK_BUDGET_INVALID");
  const model = row.model_level === null ? null : money(row.model_level);
  const entry =
    row.effective_entry === null ? null : money(row.effective_entry);
  if (model?.lte(0) || entry?.lte(0)) throw new Error("LEARNING_ENTRY_INVALID");
  const close =
    row.close_evidence.length === 1 ? row.close_evidence[0] : undefined;
  const complete =
    close !== undefined &&
    close.gross !== null &&
    close.swap !== null &&
    close.commission !== null &&
    close.conversion !== null;
  const components = complete
    ? {
        gross: text(money(close.gross!)),
        swap: text(money(close.swap!)),
        commission: text(money(close.commission!)),
        conversion: text(money(close.conversion!)),
      }
    : null;
  const reconciled =
    components !== null &&
    money(components.swap)
      .plus(components.commission)
      .plus(components.conversion)
      .eq(fees) &&
    money(components.gross).plus(fees).eq(net);
  return {
    direction: row.direction,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    holdingSeconds: (closed - opened) / 1000,
    netPnl: text(net),
    signedCosts: text(fees),
    grossPnl: text(net.minus(fees)),
    // Allocation is NOT actual filled-position stop risk or realized reward/risk.
    approvedLegBudget: budget === null ? null : text(budget),
    netOverApprovedLegBudget: budget === null ? null : text(net.div(budget)),
    modelLevel: model === null ? null : text(model),
    effectiveEntry: entry === null ? null : text(entry),
    entryDisplacement:
      model === null || entry === null ? null : text(entry.minus(model)),
    entryEmaAlignment: ["BULLISH", "BEARISH", "FLAT"].includes(
      row.ema_alignment ?? "",
    )
      ? row.ema_alignment
      : "UNKNOWN",
    closeEvidenceStatus: reconciled
      ? "MATCHED"
      : row.close_evidence.length === 0
        ? "MISSING"
        : "AMBIGUOUS_OR_MISMATCHED",
    costComponents: reconciled ? components : null,
    // cTrader type 4 combines SL/TP: do not infer which from profit sign.
    exitMechanism:
      reconciled && close?.order_type === 4
        ? "NATIVE_PROTECTION"
        : reconciled && close?.order_type === 1
          ? "MARKET_CLOSE"
          : "UNKNOWN",
  };
}

export function summarizeLearning(rows: readonly LearningRow[]) {
  const observations = rows.map(learningObservation);
  const sorted = [...observations].sort(
    (a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt),
  );
  let total = new Decimal(0),
    gains = new Decimal(0),
    losses = new Decimal(0);
  let peak = new Decimal(0),
    drawdown = new Decimal(0),
    signedCosts = new Decimal(0);
  let largestWinner = new Decimal(0);
  for (const row of sorted) {
    const value = money(row.netPnl);
    total = total.plus(value);
    signedCosts = signedCosts.plus(row.signedCosts);
    if (value.gt(0)) gains = gains.plus(value);
    if (value.lt(0)) losses = losses.minus(value);
    largestWinner = Decimal.max(largestWinner, value);
    peak = Decimal.max(peak, total);
    drawdown = Decimal.max(drawdown, peak.minus(total));
  }
  return {
    trades: rows.length,
    wins: observations.filter((r) => money(r.netPnl).gt(0)).length,
    netPnl: text(total),
    signedCosts: text(signedCosts),
    grossPnl: text(total.minus(signedCosts)),
    meanNetPnl: rows.length === 0 ? null : text(total.div(rows.length)),
    profitFactor: losses.isZero() ? null : text(gains.div(losses)),
    closedTradeDrawdown: text(drawdown),
    largestWinner: text(largestWinner),
    netExcludingLargestWinner: text(total.minus(largestWinner)),
    matchedCloseEvidence: observations.filter(
      (r) => r.closeEvidenceStatus === "MATCHED",
    ).length,
    missingRiskBudget: observations.filter((r) => r.approvedLegBudget === null)
      .length,
    unknownEntryCondition: observations.filter(
      (r) => r.entryEmaAlignment === "UNKNOWN",
    ).length,
    displacedEntries: observations.filter(
      (r) =>
        r.entryDisplacement !== null && !money(r.entryDisplacement).isZero(),
    ).length,
    observations,
  };
}
