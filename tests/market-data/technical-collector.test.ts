import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import type { Candle, Timeframe } from "../../packages/contracts/src/index.js";
import type { TechnicalContextRequest } from "../../packages/contracts/src/technical-context.js";
import { TechnicalContextCollector } from "../../packages/market-data-client/src/technical-collector.js";
import { metadata } from "../helpers/breakout-candidate.js";
const req = JSON.parse(
  readFileSync("tests/fixtures/technical-context/request.json", "utf8"),
) as TechnicalContextRequest;
const now = Date.parse(req.request.serverTime);
function fixture() {
  const calls: string[] = [];
  const reader = {
    discoverSymbol: vi.fn(() => Promise.resolve(metadata())),
    getTradingSchedule: vi.fn(() =>
      Promise.resolve({
        timeZone: "UTC",
        intervals: [{ startSecond: 0, endSecond: 604800 }],
        holidays: [],
      }),
    ),
    getServerTime: vi.fn(() => Promise.resolve(req.request.serverTime)),
    getCompletedCandles: vi.fn(
      (_symbol: string, tf: Timeframe, n: number, to?: number) => {
        calls.push("history");
        const step = { M1: 60000, M5: 300000, M15: 900000 }[tf];
        const boundary = to ?? now;
        return Promise.resolve(
          Array.from({ length: n }, (_, i): Candle => ({
            startTime: new Date(boundary - (n - i) * step).toISOString(),
            endTime: new Date(boundary - (n - i - 1) * step).toISOString(),
            open: "100",
            high: "102",
            low: "99",
            close: "101",
            volume: "1",
            complete: true,
            qualityFlags: [],
          })),
        );
      },
    ),
    getQuote: vi.fn(() => {
      calls.push("quote");
      return Promise.resolve(req.quote);
    }),
    getOrderBookSnapshot: vi.fn(() => {
      calls.push("book");
      return Promise.resolve(req.request.orderBook);
    }),
  };
  return { reader, calls };
}
describe("candidate collection", () => {
  it("reads history serially before fresh quotes/book and reuses only history", async () => {
    const { reader, calls } = fixture();
    const collector = new TechnicalContextCollector(reader, () => now);
    const a = await collector.collect(),
      b = await collector.collect();
    expect(a.request.candles.map((f) => f.candles.length)).toEqual([
      480, 576, 720,
    ]);
    expect(a.request.analysisId).not.toBe(b.request.analysisId);
    expect(reader.getCompletedCandles).toHaveBeenCalledTimes(11);
    expect(reader.getQuote).toHaveBeenCalledTimes(2);
    expect(calls.slice(-4)).toEqual(["quote", "book", "quote", "book"]);
    collector.reset();
    await collector.collect();
    expect(reader.getCompletedCandles).toHaveBeenCalledTimes(22);
  });
  it("does not emit a request after reset during a quote read", async () => {
    const { reader } = fixture();
    const collector = new TechnicalContextCollector(reader, () => now);
    reader.getQuote.mockImplementationOnce(() => {
      collector.reset();
      return Promise.resolve(req.quote);
    });
    await expect(collector.collect()).rejects.toThrow("GENERATION_CHANGED");
    expect(reader.getOrderBookSnapshot).not.toHaveBeenCalled();
  });
  it("withholds output on dependency failure and reacquires history", async () => {
    const { reader } = fixture();
    const collector = new TechnicalContextCollector(reader, () => now);
    reader.getQuote.mockRejectedValueOnce(new Error("unavailable"));
    await expect(collector.collect()).rejects.toThrow("unavailable");
    await collector.collect();
    expect(reader.getCompletedCandles).toHaveBeenCalledTimes(22);
  });
});
