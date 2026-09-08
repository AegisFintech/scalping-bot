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

describe("broker-declared holiday overrides", () => {
  const intervals = [
    { startSecond: 64920, endSecond: 147540 },
    { startSecond: 151320, endSecond: 233940 },
    { startSecond: 237720, endSecond: 320340 },
    { startSecond: 324120, endSecond: 406740 },
    { startSecond: 410520, endSecond: 493020 },
  ];
  const holiday = {
    holidayDate: 20703,
    isRecurring: false,
    startSecond: 77340,
    endSecond: 86399,
    timeZone: "Europe/Minsk",
  };
  it("accepts the observed Labor Day closure in its own timezone while rejecting missing open-session bars", () => {
    const schedule = weeklyTradingSchedule("America/New_York", intervals, [
      holiday,
    ]);
    const bars = [
      candle("2026-09-07T18:28:00Z"),
      candle("2026-09-07T22:02:00Z"),
    ];
    expect(
      markBrokerSessionGaps(bars, 60000, schedule)[1]?.qualityFlags,
    ).toContain(BROKER_SESSION_GAP_BEFORE);
    expect(
      markBrokerSessionGaps(
        bars,
        60000,
        weeklyTradingSchedule("America/New_York", intervals),
      )[1]?.qualityFlags,
    ).toEqual([]);
    expect(
      markBrokerSessionGaps(
        [candle("2026-09-07T18:27:00Z"), bars[1]!],
        60000,
        schedule,
      )[1]?.qualityFlags,
    ).toEqual([]);
  });
  it("only repeats a holiday when the broker explicitly marks it recurring", () => {
    const bars = [
      candle("2027-09-07T18:28:00Z"),
      candle("2027-09-07T22:02:00Z"),
    ];
    expect(
      markBrokerSessionGaps(
        bars,
        60000,
        weeklyTradingSchedule("America/New_York", intervals, [holiday]),
      )[1]?.qualityFlags,
    ).toEqual([]);
    expect(
      markBrokerSessionGaps(
        bars,
        60000,
        weeklyTradingSchedule("America/New_York", intervals, [
          { ...holiday, isRecurring: true },
        ]),
      )[1]?.qualityFlags,
    ).toContain(BROKER_SESSION_GAP_BEFORE);
  });
  it("detects a short open interval between holiday boundaries and rejects malformed overrides", () => {
    const base = { ...holiday, timeZone: "UTC" };
    const schedule = weeklyTradingSchedule(
      "UTC",
      [{ startSecond: 0, endSecond: 604800 }],
      [
        { ...base, startSecond: 0, endSecond: 43215 },
        { ...base, startSecond: 43230, endSecond: 86400 },
      ],
    );
    expect(
      markBrokerSessionGaps(
        [candle("2026-09-07T11:59:00Z"), candle("2026-09-07T12:01:00Z")],
        60000,
        schedule,
      )[1]?.qualityFlags,
    ).toEqual([]);
    for (const patch of [
      { holidayDate: -1 },
      { holidayDate: 1.5 },
      { startSecond: 86400 },
      { endSecond: 86401 },
      { timeZone: "bad/timezone" },
    ])
      expect(() =>
        weeklyTradingSchedule("UTC", intervals, [{ ...holiday, ...patch }]),
      ).toThrow(/CTRADER_HOLIDAY/);
  });
});
