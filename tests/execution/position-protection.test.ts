import { describe, expect, it, vi } from "vitest";
import {
  PositionProtectionMaintenance,
  protectionPlan,
  type ProtectionPosition,
  type ProtectionSession,
  type ProtectionOptions,
} from "../../apps/execution-service/src/position-protection.js";
import type { PositionProtection } from "../../packages/contracts/src/position-protection.js";
const timestamp = "2026-09-09T06:21:14.000Z";
const local: ProtectionPosition = {
  id: "local",
  brokerPositionId: "801",
  side: "SELL",
  volume: "100",
  entryPrice: "4397.89",
  orderEntry: "4398.92",
  orderStopLoss: "4399.98",
  orderTakeProfit: "4398.39",
  label: "ctrader-ai-scalper:fixture",
  repairAttempts: 0,
  commandAt: null,
  closeRequestedAt: null,
};
const broker = () =>
  ({
    positionId: "801",
    positionStatus: 1,
    price: 4397.89,
    tradeData: {
      symbolId: "7",
      volume: "100",
      tradeSide: 2,
      label: local.label,
    },
  }) as Record<string, unknown>;
function fixture() {
  let clock = new Date(timestamp),
    position = { ...local };
  let raw = broker();
  const observations: PositionProtection[] = [];
  const session: ProtectionSession = {
    positions: () => Promise.resolve([position]),
    observe: (_p, o) => {
      observations.push(o);
      return Promise.resolve();
    },
    claimRepair: (_p, at) => {
      if (position.repairAttempts >= 2) return Promise.resolve(false);
      position = {
        ...position,
        repairAttempts: position.repairAttempts + 1,
        commandAt: at,
      };
      return Promise.resolve(true);
    },
  };
  const result = {
    executionType: 4,
    order: null,
    position: null,
    deal: null,
    errorCode: null,
    receivedAt: timestamp,
  };
  const client = {
    reconcileRaw: vi.fn(() =>
      Promise.resolve({
        receivedAt: clock.toISOString(),
        positions: [raw],
        orders: [],
      }),
    ),
    amendPositionProtection: vi.fn(() => Promise.resolve(result)),
  };
  const quote = vi.fn(() =>
    Promise.resolve({
      bid: "4397.60",
      ask: "4397.70",
      sourceTime: clock.toISOString(),
      receivedAt: clock.toISOString(),
    }),
  );
  const options: ProtectionOptions = {
    store: { exclusive: (work) => work(session) },
    client,
    symbol: "XAUUSD",
    symbolId: "7",
    tickSize: "0.01",
    quote,
    now: () => clock,
  };
  return {
    options,
    client,
    quote,
    observations,
    session,
    run: () => new PositionProtectionMaintenance(options).run(),
    advance: () => {
      clock = new Date(clock.getTime() + 6_000);
    },
    protect: () => {
      raw = { ...raw, stopLoss: 4398.95, takeProfit: 4397.36 };
    },
    replace: (value: Record<string, unknown>) => {
      raw = value;
    },
  };
}
describe("independent broker position protection", () => {
  it("anchors approved short distances to actual fill, preserving tighter protection", () => {
    expect(protectionPlan(local, broker(), "7", "0.01")).toMatchObject({
      expectedStopLoss: "4398.95",
      expectedTakeProfit: "4397.36",
      repair: true,
    });
    expect(
      protectionPlan(
        local,
        { ...broker(), stopLoss: 4398, takeProfit: 4397.5 },
        "7",
        "0.01",
      ),
    ).toMatchObject({
      expectedStopLoss: "4398",
      expectedTakeProfit: "4397.5",
      repair: false,
    });
  });
  it("rounds inward for a long with fractional VWAP", () => {
    const position = {
      ...local,
      side: "BUY" as const,
      entryPrice: "4400.005",
      orderEntry: "4400",
      orderStopLoss: "4398.94",
      orderTakeProfit: "4400.53",
    };
    const raw = {
      ...broker(),
      price: 4400.005,
      tradeData: { ...(broker().tradeData as object), tradeSide: 1 },
    };
    expect(protectionPlan(position, raw, "7", "0.01")).toMatchObject({
      expectedStopLoss: "4398.95",
      expectedTakeProfit: "4400.53",
    });
  });
  it.each([
    {
      ...broker(),
      tradeData: {
        symbolId: "7",
        volume: "100",
        tradeSide: 2,
        label: "manual",
      },
    },
    { ...broker(), price: 4397.8 },
    { ...broker(), positionStatus: 2 },
    { ...broker(), stopLoss: 4398.951 },
  ])("rejects uncertain ownership, fill or precision", (raw) =>
    expect(() => protectionPlan(local, raw, "7", "0.01")).toThrow(),
  );
  it("repairs missing SL/TP, and requires a later broker snapshot to call it verified", async () => {
    const f = fixture();
    await f.run();
    expect(f.client.amendPositionProtection).toHaveBeenCalledWith(
      "801",
      "XAUUSD",
      "4398.95",
      "4397.36",
    );
    expect(f.observations.at(-1)?.status).toBe("REPAIR_REQUIRED");
    f.protect();
    await f.run();
    expect(f.observations.at(-1)?.status).toBe("VERIFIED");
    expect(f.client.amendPositionProtection).toHaveBeenCalledTimes(1);
  });
  it("bounds failed repairs across restarts without closing or latching a pause", async () => {
    const f = fixture();
    f.client.amendPositionProtection.mockRejectedValue(
      new Error("broker fixture rejection"),
    );
    await expect(f.run()).rejects.toThrow("POSITION_PROTECTION_UNAVAILABLE");
    f.advance();
    await expect(f.run()).rejects.toThrow("POSITION_PROTECTION_UNAVAILABLE");
    f.advance();
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.observations.at(-1)).toMatchObject({
      status: "REPAIR_REQUIRED",
      reasonCode: "POSITION_PROTECTION_REPAIR_EXHAUSTED",
    });
    f.advance();
    await f.run();
    expect(f.client.amendPositionProtection).toHaveBeenCalledTimes(2);
    // Confirmed closure removes the position; failure must not survive into the next cycle.
    f.session.positions = () => Promise.resolve([]);
    await expect(f.run()).resolves.toBeUndefined();
  });
  it.each([
    ["SELL", "4397.20", "4397.36"], // TP reached
    ["SELL", "4398.90", "4398.95"], // SL reached
    ["BUY", "4407.58", "4407.68"], // Incident's verified TP
    ["BUY", "4405.99", "4406.09"], // Incident's verified SL
  ])(
    "leaves verified %s exits to the broker at bid=%s ask=%s",
    async (side, bid, ask) => {
      const f = fixture();
      f.protect();
      if (side === "BUY") {
        f.session.positions = () =>
          Promise.resolve([
            {
              ...local,
              side: "BUY",
              entryPrice: "4407.05",
              orderEntry: "4406.09",
              orderStopLoss: "4405.03",
              orderTakeProfit: "4406.62",
            },
          ]);
        f.replace({
          ...broker(),
          price: 4407.05,
          stopLoss: 4405.99,
          takeProfit: 4407.58,
          tradeData: { ...(broker().tradeData as object), tradeSide: 1 },
        });
      }
      f.quote.mockResolvedValue({
        bid,
        ask,
        sourceTime: timestamp,
        receivedAt: timestamp,
      });
      await expect(f.run()).resolves.toBeUndefined();
      expect(f.observations.at(-1)?.status).toBe("VERIFIED");
      expect(f.quote).not.toHaveBeenCalled();
      expect(f.client.amendPositionProtection).not.toHaveBeenCalled();
    },
  );
  it("keeps fresh broker protection verified when sampled quotes are unavailable", async () => {
    const f = fixture();
    f.protect();
    f.quote.mockRejectedValue(new Error("quote unavailable"));
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.observations.at(-1)?.status).toBe("VERIFIED");
    expect(f.quote).not.toHaveBeenCalled();
  });
  it("waits when a repair price is crossed and repairs when the price permits", async () => {
    const f = fixture();
    f.quote.mockResolvedValueOnce({
      bid: "4397.20",
      ask: "4397.36",
      sourceTime: timestamp,
      receivedAt: timestamp,
    });
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.observations.at(-1)).toMatchObject({
      status: "REPAIR_REQUIRED",
      reasonCode: "POSITION_PROTECTION_REPAIR_PRICE_CROSSED",
    });
    expect(f.client.amendPositionProtection).not.toHaveBeenCalled();
    expect((await f.session.positions())[0]?.repairAttempts).toBe(0);
    await f.run();
    expect(f.client.amendPositionProtection).toHaveBeenCalledTimes(1);
  });
  it("rejects stale quotes without dispatching protection commands", async () => {
    const f = fixture();
    f.quote.mockResolvedValue({
      bid: "4397.6",
      ask: "4397.7",
      sourceTime: "2026-09-09T06:21:00Z",
      receivedAt: timestamp,
    });
    await expect(f.run()).rejects.toThrow();
    expect(f.client.amendPositionProtection).not.toHaveBeenCalled();
  });
  it("requires the position to remain present on the late read", async () => {
    const f = fixture();
    f.client.reconcileRaw
      .mockResolvedValueOnce({
        receivedAt: timestamp,
        positions: [broker()],
        orders: [],
      })
      .mockResolvedValue({ receivedAt: timestamp, positions: [], orders: [] });
    await expect(f.run()).rejects.toThrow();
    expect(f.client.amendPositionProtection).not.toHaveBeenCalled();
  });
  it("observes a historical close claim without sending another command or pausing", async () => {
    const f = fixture();
    f.protect();
    f.session.positions = () =>
      Promise.resolve([{ ...local, closeRequestedAt: timestamp }]);
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.observations.at(-1)?.status).toBe("CLOSE_SENT");
    expect(f.client.amendPositionProtection).not.toHaveBeenCalled();
    expect(f.quote).not.toHaveBeenCalled();
  });
});
