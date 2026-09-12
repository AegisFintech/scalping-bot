import { describe, expect, it, vi } from "vitest";
import {
  BrokerSessionGate,
  SESSION_REFRESH_MS,
} from "../../packages/market-data-client/src/session-gate.js";
import {
  MarketDataHttpClient,
  validateMarketSession,
} from "../../packages/market-data-client/src/client.js";
import {
  isBrokerSessionOpen,
  weeklyTradingSchedule,
} from "../../packages/ctrader-client/src/trading-schedule.js";
import { marketSession } from "../helpers/market-session.js";

describe("broker session gate", () => {
  it("closes exactly on the boundary despite an otherwise fresh cached schedule, then reopens automatically", async () => {
    let now = Date.parse("2026-09-11T20:59:59Z");
    const read = vi.fn(() =>
      Promise.resolve(marketSession(new Date(now).toISOString())),
    );
    const gate = new BrokerSessionGate("XAUUSD", read, () => now);
    expect((await gate.check()).state).toBe("OPEN");
    now += 1000;
    expect((await gate.check()).state).toBe("CLOSED");
    await expect(gate.requireOpen()).rejects.toThrow("MARKET_SESSION_CLOSED");
    expect(read).toHaveBeenCalledTimes(1);
    now = Date.parse("2026-09-13T21:59:59Z");
    expect((await gate.check()).state).toBe("CLOSED");
    now += 1000;
    await expect(gate.requireOpen()).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("deduplicates concurrent refreshes, rejects a failed refresh and retries automatically without retaining old OPEN evidence", async () => {
    let now = Date.parse("2026-09-11T12:00:00Z");
    const read = vi.fn(() =>
      Promise.resolve(marketSession(new Date(now).toISOString())),
    );
    const gate = new BrokerSessionGate("XAUUSD", read, () => now);
    expect(
      (await Promise.all(Array.from({ length: 20 }, () => gate.check()))).every(
        (s) => s.state === "OPEN",
      ),
    ).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    now += SESSION_REFRESH_MS;
    read.mockRejectedValueOnce(new Error("unavailable"));
    expect((await gate.check()).state).toBe("UNAVAILABLE");
    await gate.check();
    expect(read).toHaveBeenCalledTimes(2);
    now += SESSION_REFRESH_MS;
    expect((await gate.check()).state).toBe("OPEN");
    expect(read).toHaveBeenCalledTimes(3);
  });
  it.each([-30_000, 1])(
    "rejects stale or future metadata timestamp offset %i",
    async (offset) => {
      const now = Date.parse("2026-09-11T12:00:00Z");
      const gate = new BrokerSessionGate(
        "XAUUSD",
        () =>
          Promise.resolve(marketSession(new Date(now + offset).toISOString())),
        () => now,
      );
      await expect(gate.requireOpen()).rejects.toThrow(
        "MARKET_SESSION_UNAVAILABLE",
      );
    },
  );
  it("rechecks the calendar after restart without requiring quotes", () => {
    const now = Date.parse("2026-09-12T12:00:00Z");
    const initial = marketSession(new Date(now).toISOString());
    const read = vi.fn(() => Promise.reject(new Error("not used")));
    expect(
      new BrokerSessionGate("XAUUSD", read, () => now, initial).status.state,
    ).toBe("CLOSED");
    expect(
      new BrokerSessionGate("XAUUSD", read, () => now, initial).status.state,
    ).toBe("CLOSED");
    expect(read).not.toHaveBeenCalled();
  });
  it("fails closed for wrong symbol, extra fields, invalid timezone and overlapping intervals", async () => {
    const original = marketSession();
    const invalid = [
      { ...original, metadata: { ...original.metadata, symbolName: "OTHER" } },
      { ...original, permission: true },
      {
        ...original,
        schedule: { ...original.schedule, timeZone: "Invalid/Zone" },
      },
      {
        ...original,
        schedule: {
          ...original.schedule,
          intervals: [
            { startSecond: 0, endSecond: 120 },
            { startSecond: 60, endSecond: 180 },
          ],
        },
      },
    ];
    for (const value of invalid) {
      expect(() => validateMarketSession(value, "XAUUSD")).toThrow();
      const gate = new BrokerSessionGate(
        "XAUUSD",
        () => Promise.resolve(value),
        () => Date.parse(original.metadata.metadataTime),
      );
      expect((await gate.check()).state).toBe("UNAVAILABLE");
    }
  });
  it("respects broker holidays with their own timezone and recurrence", () => {
    const base = marketSession().schedule;
    const schedule = weeklyTradingSchedule(base.timeZone, base.intervals, [
      {
        holidayDate: Math.floor(Date.parse("2026-09-11T00:00:00Z") / 86400000),
        isRecurring: true,
        startSecond: 12 * 3600,
        endSecond: 13 * 3600,
        timeZone: "Asia/Singapore",
      },
    ]);
    expect(
      isBrokerSessionOpen(new Date("2026-09-11T03:59:59Z"), schedule),
    ).toBe(true);
    expect(
      isBrokerSessionOpen(new Date("2026-09-11T04:00:00Z"), schedule),
    ).toBe(false);
    expect(
      isBrokerSessionOpen(new Date("2026-09-11T05:00:00Z"), schedule),
    ).toBe(true);
    const always = weeklyTradingSchedule(
      "UTC",
      [{ startSecond: 0, endSecond: 604800 }],
      schedule.holidays,
    );
    expect(isBrokerSessionOpen(new Date("2027-09-11T04:00:00Z"), always)).toBe(
      false,
    );
  });
  it("uses the broker timezone across both DST transitions and repeated local hours", () => {
    const schedule = weeklyTradingSchedule("America/New_York", [
      { startSecond: 5400, endSecond: 9000 },
    ]);
    for (const at of [
      "2026-11-01T05:30:00Z",
      "2026-11-01T06:30:00Z",
      "2026-03-08T06:59:59Z",
    ])
      expect(isBrokerSessionOpen(new Date(at), schedule)).toBe(true);
    for (const at of ["2026-11-01T07:30:00Z", "2026-03-08T07:00:00Z"])
      expect(isBrokerSessionOpen(new Date(at), schedule)).toBe(false);
  });
  it("validates the independent HTTP contract and rejects unavailable session responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(marketSession()))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const client = new MarketDataHttpClient({
      baseUrl: "http://127.0.0.1:8081",
      fetchImpl,
      maxRetries: 0,
    });
    expect(await client.session("XAUUSD")).toEqual(marketSession());
    await expect(client.session("XAUUSD")).rejects.toThrow(
      "MARKET_SESSION_UNAVAILABLE",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
