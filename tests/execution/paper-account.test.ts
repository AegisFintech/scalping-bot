import { describe, expect, it } from "vitest";

import { PaperAccountAdapter } from "../../apps/execution-service/src/paper-account.js";

describe("paper account", () => {
  it("applies simulated realized and unrealized P/L to reconciled state", async () => {
    const account = new PaperAccountAdapter({ equity: "10000" });
    account.update({
      realizedPnl: "-100",
      unrealizedPnl: "25",
      relevantPositionCount: 1,
      relevantPendingOrderCount: 0,
      hasPartialFill: false,
      certain: true,
    });
    await expect(account.reconcile()).resolves.toMatchObject({
      balance: "9900",
      equity: "9925",
      relevantPositionCount: 1,
    });
  });
});
