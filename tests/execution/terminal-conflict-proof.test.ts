import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { BrokerExecution } from "../../packages/ctrader-client/src/client.js";
import { normalizeDemoExecution } from "../../apps/execution-service/src/demo-execution.js";
import {
  terminalVariantEligibility,
  verifyTerminalHistory,
} from "../../apps/execution-service/src/terminal-conflict-proof.js";

async function fixture() {
  const raw = JSON.parse(
    await readFile(
      "tests/fixtures/ctrader/demo-position-closed-v1.json",
      "utf8",
    ),
  ) as BrokerExecution;
  const original = normalizeDemoExecution(raw, { symbolId: "7" })!;
  const changed = structuredClone(raw);
  changed.position!.takeProfit = 2030;
  const variant = normalizeDemoExecution(changed, { symbolId: "7" })!;
  const variants = [
    {
      id: "original",
      payload: original,
      source: "ORIGINAL_JOURNAL",
      originalMappingState: "MAPPED",
      originalReasonCodes: [],
    },
    {
      id: "variant",
      payload: variant,
      source: "BROKER_CALLBACK",
      originalMappingState: "MAPPED",
      originalReasonCodes: [],
    },
  ];
  const orders = {
    receivedAt: raw.receivedAt,
    hasMore: false,
    orders: [raw.order!],
  };
  const deals = {
    receivedAt: raw.receivedAt,
    hasMore: false,
    deals: [raw.deal!],
  };
  return {
    raw,
    original,
    variant,
    variants,
    orders,
    deals,
    now: new Date(raw.receivedAt),
  };
}

describe("terminal conflict financial attestation (no execution authority)", () => {
  it("accepts only retained context-only variants and independently matching history", async () => {
    const f = await fixture();
    expect(terminalVariantEligibility(f.original, f.variants)).toBeNull();
    const result = verifyTerminalHistory(
      f.original,
      f.orders,
      f.deals,
      "7",
      f.now,
    );
    expect(result.reason).toBeNull();
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects legacy missing variants and an already-conflicted original snapshot", async () => {
    const f = await fixture();
    expect(terminalVariantEligibility(f.original, [])).toBe(
      "DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED",
    );
    f.variants[0]!.originalMappingState = "CONFLICT";
    expect(terminalVariantEligibility(f.original, f.variants)).toBe(
      "DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED",
    );
  });
  it.each([
    "grossProfit",
    "commission",
    "swap",
    "balance",
    "pnlConversionFee",
    "closedVolume",
    "entryPrice",
    "quoteToDepositConversionRate",
    "balanceVersion",
  ] as const)("rejects a changed %s in a retained variant", async (key) => {
    const f = await fixture();
    const bad = {
      ...f.variant,
      closeDetail: { ...f.variant.closeDetail!, [key]: "999" },
    };
    f.variants[1]!.payload = bad;
    expect(terminalVariantEligibility(f.original, f.variants)).toBe(
      "DEMO_TERMINAL_VARIANT_FACT_CONFLICT",
    );
  });
  it("rejects partial history, duplicate deals, stale replies and missing monetary fields", async () => {
    const f = await fixture();
    expect(
      verifyTerminalHistory(
        f.original,
        { ...f.orders, hasMore: true },
        f.deals,
        "7",
        f.now,
      ).reason,
    ).toBe("DEMO_TERMINAL_HISTORY_INCOMPLETE");
    expect(
      verifyTerminalHistory(
        f.original,
        f.orders,
        { ...f.deals, deals: [...f.deals.deals, ...f.deals.deals] },
        "7",
        f.now,
      ).reason,
    ).toBe("DEMO_TERMINAL_HISTORY_AMBIGUOUS");
    expect(
      verifyTerminalHistory(
        f.original,
        f.orders,
        f.deals,
        "7",
        new Date(f.now.getTime() + 31_000),
      ).reason,
    ).toBe("DEMO_TERMINAL_HISTORY_STALE");
    delete (f.deals.deals[0]!.closePositionDetail as Record<string, unknown>)
      .pnlConversionFee;
    expect(
      verifyTerminalHistory(f.original, f.orders, f.deals, "7", f.now).reason,
    ).toBe("DEMO_TERMINAL_HISTORY_COST_EVIDENCE_MISSING");
  });
  it.each([
    "executionPrice",
    "executionTimestamp",
    "filledVolume",
    "commission",
    "positionId",
    "orderId",
    "dealStatus",
    "volume",
  ])("rejects conflicting historical %s", async (key) => {
    const f = await fixture();
    f.deals.deals[0]![key] = "999";
    expect(
      verifyTerminalHistory(f.original, f.orders, f.deals, "7", f.now).reason,
    ).not.toBeNull();
  });
});
