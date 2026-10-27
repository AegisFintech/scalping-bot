import { Decimal } from "decimal.js";
import { signedDecimal } from "../../risk-engine/src/decimal.js";

/** Descriptive exact-deal audit only; no broker or strategy-promotion authority. */
export interface ProfitExitAuditRow {
  claimed_at: string;
  quote_at: string;
  quote_gross: string;
  required_net: string;
  execution_reserve: string;
  claimed_volume: string;
  closed_volume: string | null;
  actual_gross: string | null;
  fees: string | null;
  net: string | null;
  closed_at: string | null;
  exact_close_match: boolean;
}
export function profitExitAudit(rows: readonly ProfitExitAuditRow[]) {
  if (rows.length > 10000) throw new Error("PROFIT_AUDIT_TOO_LARGE");
  const observations = rows.map((r) => {
    const d = (s: string) => signedDecimal(s, "PROFIT_AUDIT_INVALID_DECIMAL");
    const claim = Date.parse(r.claimed_at),
      quote = Date.parse(r.quote_at);
    if (!Number.isFinite(claim) || !Number.isFinite(quote) || quote > claim)
      throw new Error("PROFIT_AUDIT_TIME_INVALID");
    // This audit is explicitly scoped to the immutable v1 0.05-price net floor.
    const perPrice = d(r.required_net).div("0.05");
    if (!perPrice.gt(0) || !d(r.claimed_volume).gt(0))
      throw new Error("PROFIT_AUDIT_VALUE_INVALID");
    const complete =
      r.exact_close_match &&
      r.closed_volume !== null &&
      d(r.closed_volume).eq(d(r.claimed_volume)) &&
      r.actual_gross !== null &&
      r.fees !== null &&
      r.net !== null &&
      r.closed_at !== null;
    const closed = r.closed_at === null ? null : Date.parse(r.closed_at);
    if (
      complete &&
      (closed === null || !Number.isFinite(closed) || closed < claim)
    )
      throw new Error("PROFIT_AUDIT_CLOSE_TIME_INVALID");
    return {
      claimedAt: r.claimed_at,
      attribution: complete ? "EXACT_BOT_CLOSE" : "UNATTRIBUTED_OR_INCOMPLETE",
      net: r.net,
      feePrice: complete ? d(r.fees!).abs().div(perPrice).toFixed() : null,
      adversePrice: complete
        ? d(r.quote_gross).minus(d(r.actual_gross!)).div(perPrice).toFixed()
        : null,
      allowancePrice: d(r.execution_reserve).div(perPrice).toFixed(),
      quoteToCloseMs: complete ? closed! - quote : null,
      guaranteedProfit: false,
    };
  });
  const matched = observations.filter(
    (r) => r.attribution === "EXACT_BOT_CLOSE",
  );
  return {
    schemaVersion: "profit-exit-audit-1.0",
    claims: rows.length,
    exactBotCloses: matched.length,
    unattributedOrIncomplete: rows.length - matched.length,
    exactBotCloseNet: matched.length
      ? matched.reduce((n, r) => n.plus(r.net!), new Decimal(0)).toFixed()
      : null,
    maximumObservedAdversePrice: matched.length
      ? Decimal.max(...matched.map((r) => r.adversePrice!)).toFixed()
      : null,
    observations,
    counterfactualNet: null,
    qualification: "DESCRIPTIVE_NOT_A_TAIL_BOUND_OR_STRATEGY_QUALIFICATION",
    executionAuthority: false,
  };
}

export function profitExitWindow(args: readonly string[]) {
  const [release, from, until] = args;
  const valid = (s: string | undefined): s is string => {
    if (
      s === undefined ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)
    )
      return false;
    const n = Date.parse(s);
    return (
      Number.isFinite(n) &&
      new Date(n).toISOString() ===
        (s.includes(".") ? s : s.replace("Z", ".000Z"))
    );
  };
  if (
    args.length !== 3 ||
    release === undefined ||
    !/^0\.7\.[23]-quick-oco\.1-codex\.1$/.test(release) ||
    !valid(from) ||
    !valid(until) ||
    Date.parse(until) <= Date.parse(from) ||
    Date.parse(until) - Date.parse(from) > 31 * 86400000
  )
    throw new Error("PROFIT_AUDIT_WINDOW_INVALID");
  return { release, from, until };
}
