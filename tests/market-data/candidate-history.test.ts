import { describe, expect, it, vi } from "vitest";
import type { Candle, Timeframe } from "../../packages/contracts/src/index.js";
import { CandidateHistoryCache } from "../../packages/market-data-client/src/candidate-history.js";
import { weeklyTradingSchedule } from "../../packages/ctrader-client/src/trading-schedule.js";

const schedule = weeklyTradingSchedule(
  "UTC",
  [{ startSecond: 0, endSecond: 604800 }],
  [],
);
const now = Date.parse("2026-10-21T12:00:00Z");
const periods = { M1: 60_000, M5: 300_000, M15: 900_000 };
function page(tf: Timeframe, count: number, to: number): readonly Candle[] {
  const period = periods[tf];
  return Array.from({ length: count }, (_, i) => ({
    startTime: new Date(to - (count - i) * period).toISOString(),
    endTime: new Date(to - (count - i - 1) * period).toISOString(),
    open: "100",
    high: "102",
    low: "99",
    close: "101",
    volume: "1",
    complete: true,
    qualityFlags: [],
  }));
}

describe("isolated candidate history", () => {
  it("serializes all pages, caches same-boundary reads and incrementally updates", async () => {
    let active = 0,
      maxActive = 0;
    const fetchPage = vi.fn(
      async (tf: Timeframe, count: number, to: number) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;
        return page(tf, count, to);
      },
    );
    const cache = new CandidateHistoryCache(fetchPage);
    const [first, second] = await Promise.all([
      cache.read(new Date(now).toISOString(), schedule),
      cache.read(new Date(now).toISOString(), schedule),
    ]);
    expect(first.map((x) => x.candles.length)).toEqual([480, 576, 720]);
    expect(second).toEqual(first);
    expect(maxActive).toBe(1);
    expect(fetchPage).toHaveBeenCalledTimes(11);
    await cache.read(new Date(now + 60_000).toISOString(), schedule);
    expect(fetchPage).toHaveBeenCalledTimes(12);
    expect(fetchPage.mock.calls.at(-1)?.slice(0, 2)).toEqual(["M1", 2]);
    cache.reset();
    await cache.read(new Date(now + 60_000).toISOString(), schedule);
    expect(fetchPage).toHaveBeenCalledTimes(23);
  });
  it.each(["short", "forming", "duplicate", "future", "unknown_flag", "gap"])(
    "rejects %s evidence without stale cache fallback",
    async (fault) => {
      const fetchPage = vi.fn((tf: Timeframe, count: number, to: number) => {
        const bars = page(tf, count, to).map((c) => ({ ...c }));
        const first = bars[0];
        if (first === undefined) throw new Error("fixture");
        if (fault === "short") bars.pop();
        if (fault === "forming") first.complete = false;
        if (fault === "duplicate") bars[1] = first;
        if (fault === "future")
          first.endTime = new Date(to + 60_000).toISOString();
        if (fault === "unknown_flag") first.qualityFlags = ["UNVERIFIED"];
        if (fault === "gap") {
          const shifted = bars.map((c) => ({
            ...c,
            startTime: new Date(
              Date.parse(c.startTime) - periods[tf],
            ).toISOString(),
            endTime: new Date(
              Date.parse(c.endTime) - periods[tf],
            ).toISOString(),
          }));
          return Promise.resolve(shifted);
        }
        return Promise.resolve(bars);
      });
      await expect(
        new CandidateHistoryCache(fetchPage).read(
          new Date(now).toISOString(),
          schedule,
        ),
      ).rejects.toThrow("CANDIDATE_HISTORY_");
    },
  );
  it("invalidates queued and in-flight reads after connection reset", async () => {
    let resolve: ((value: readonly Candle[]) => void) | undefined;
    const fetchPage = vi.fn(
      () =>
        new Promise<readonly Candle[]>((r) => {
          resolve = r;
        }),
    );
    const cache = new CandidateHistoryCache(fetchPage);
    const a = cache.read(new Date(now).toISOString(), schedule),
      b = cache.read(new Date(now).toISOString(), schedule);
    const checks = [
      expect(a).rejects.toThrow("GENERATION_CHANGED"),
      expect(b).rejects.toThrow("GENERATION_CHANGED"),
    ];
    await Promise.resolve();
    await Promise.resolve();
    cache.reset();
    resolve?.(page("M15", 180, now));
    await Promise.all(checks);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it("rejects clock regression and reacquires after a failed page", async () => {
    const fetchPage = vi.fn((tf: Timeframe, n: number, to: number) =>
      Promise.resolve(page(tf, n, to)),
    );
    const cache = new CandidateHistoryCache(fetchPage);
    await cache.read(new Date(now).toISOString(), schedule);
    await expect(
      cache.read(new Date(now - 900_000).toISOString(), schedule),
    ).rejects.toThrow("CLOCK_REGRESSION");
    await cache.read(new Date(now).toISOString(), schedule);
    expect(fetchPage).toHaveBeenCalledTimes(22);
  });
});

it("rejects a revised completed overlap and cannot mutate cached bars", async () => {
  const fetchPage = vi.fn((tf: Timeframe, n: number, to: number) =>
    Promise.resolve(page(tf, n, to)),
  );
  const cache = new CandidateHistoryCache(fetchPage);
  const first = await cache.read(new Date(now).toISOString(), schedule);
  expect(Object.isFrozen(first[0]?.candles)).toBe(true);
  fetchPage.mockImplementationOnce((tf, n, to) =>
    Promise.resolve(
      page(tf, n, to).map((c, i) => (i === 0 ? { ...c, close: "100.5" } : c)),
    ),
  );
  await expect(
    cache.read(new Date(now + 60_000).toISOString(), schedule),
  ).rejects.toThrow("CONFLICT");
});
