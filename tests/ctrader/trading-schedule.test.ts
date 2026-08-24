import { describe, expect, it } from "vitest";

import type { Candle } from "../../packages/contracts/src/index.js";
import {
  BROKER_SESSION_GAP_BEFORE,
  markBrokerSessionGaps,
  weeklyTradingSchedule,
} from "../../packages/ctrader-client/src/trading-schedule.js";

const DAY = 24 * 60 * 60;

function candle(startTime: string): Candle {
  const start = Date.parse(startTime);
  return {
    startTime: new Date(start).toISOString(),
    endTime: new Date(start + 60_000).toISOString(),
    open: "2000",
    high: "2001",
    low: "1999",
    close: "2000",
    volume: "1",
    complete: true,
    qualityFlags: [],
  };
}

describe("cTrader weekly trading schedule", () => {
  const schedule = weeklyTradingSchedule("UTC", [
    { startSecond: 22 * 60 * 60, endSecond: 5 * DAY + 21 * 60 * 60 },
  ]);

  it("marks a gap wholly contained in the broker weekend closure", () => {
    const result = markBrokerSessionGaps(
      [candle("2026-08-21T20:59:00Z"), candle("2026-08-23T22:00:00Z")],
      60_000,
      schedule,
    );

    expect(result[0]?.qualityFlags).toEqual([]);
    expect(result[1]?.qualityFlags).toEqual([BROKER_SESSION_GAP_BEFORE]);
  });

  it("does not mark a missing no-tick bar during an open session", () => {
    const result = markBrokerSessionGaps(
      [candle("2026-08-24T11:59:00Z"), candle("2026-08-24T12:01:00Z")],
      60_000,
      schedule,
    );

    expect(result[1]?.qualityFlags).toEqual([]);
  });

  it("detects a short open interval between M5 boundaries", () => {
    const mondayNoon = DAY + 12 * 60 * 60;
    const brieflyOpen = weeklyTradingSchedule("UTC", [
      { startSecond: mondayNoon + 60, endSecond: mondayNoon + 120 },
    ]);
    const result = markBrokerSessionGaps(
      [candle("2026-08-24T11:59:00Z"), candle("2026-08-24T12:05:00Z")],
      5 * 60_000,
      brieflyOpen,
    );

    expect(result[1]?.qualityFlags).toEqual([]);
  });

  it("rejects overlapping, out-of-range, and unknown-timezone schedules", () => {
    expect(() =>
      weeklyTradingSchedule("UTC", [
        { startSecond: 100, endSecond: 200 },
        { startSecond: 150, endSecond: 300 },
      ]),
    ).toThrow("CTRADER_SCHEDULE_INTERVAL_OVERLAP");
    expect(() =>
      weeklyTradingSchedule("UTC", [{ startSecond: -1, endSecond: 100 }]),
    ).toThrow("CTRADER_SCHEDULE_INTERVAL_INVALID");
    expect(() =>
      weeklyTradingSchedule("UTC", [{ startSecond: 100, endSecond: 159 }]),
    ).toThrow("CTRADER_SCHEDULE_INTERVAL_INVALID");
    expect(() =>
      weeklyTradingSchedule("not/a-timezone", [
        { startSecond: 100, endSecond: 200 },
      ]),
    ).toThrow("CTRADER_SCHEDULE_TIMEZONE_INVALID");
    expect(() => markBrokerSessionGaps([], 30_000, schedule)).toThrow(
      "CTRADER_SCHEDULE_TIMEFRAME_INVALID",
    );
  });
});
