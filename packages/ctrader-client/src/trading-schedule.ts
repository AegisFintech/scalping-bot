import type { Candle } from "../../contracts/src/index.js";

export const BROKER_SESSION_GAP_BEFORE = "BROKER_SESSION_GAP_BEFORE";

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;
const MINUTE_MS = 60_000;
const MAX_TRUSTED_SESSION_GAP_MS = 14 * DAY_SECONDS * 1_000;
const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface WeeklyTradingInterval {
  readonly startSecond: number;
  readonly endSecond: number;
}

export interface WeeklyTradingSchedule {
  readonly timeZone: string;
  readonly intervals: readonly WeeklyTradingInterval[];
}

function weekSecond(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((part) => part.type === type)?.value;
  const weekday = WEEKDAYS[value("weekday") ?? ""];
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  const second = Number(value("second"));
  if (
    weekday === undefined ||
    !Number.isSafeInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isSafeInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !Number.isSafeInteger(second) ||
    second < 0 ||
    second > 59
  ) {
    throw new Error("CTRADER_SCHEDULE_LOCAL_TIME_INVALID");
  }
  return weekday * DAY_SECONDS + hour * 3_600 + minute * 60 + second;
}

export function weeklyTradingSchedule(
  timeZone: string,
  intervals: readonly WeeklyTradingInterval[],
): WeeklyTradingSchedule {
  if (
    timeZone.length < 1 ||
    timeZone.length > 100 ||
    timeZone.trim() !== timeZone
  )
    throw new Error("CTRADER_SCHEDULE_TIMEZONE_INVALID");
  try {
    weekSecond(new Date("2026-01-04T00:00:00.000Z"), timeZone);
  } catch {
    throw new Error("CTRADER_SCHEDULE_TIMEZONE_INVALID");
  }
  if (intervals.length < 1 || intervals.length > 100)
    throw new Error("CTRADER_SCHEDULE_INTERVALS_INVALID");
  const ordered = intervals
    .map((interval) => ({ ...interval }))
    .sort((left, right) => left.startSecond - right.startSecond);
  for (const [index, interval] of ordered.entries()) {
    if (
      !Number.isSafeInteger(interval.startSecond) ||
      !Number.isSafeInteger(interval.endSecond) ||
      interval.startSecond < 0 ||
      interval.endSecond > WEEK_SECONDS ||
      interval.endSecond - interval.startSecond < 60
    ) {
      throw new Error("CTRADER_SCHEDULE_INTERVAL_INVALID");
    }
    const previous = ordered[index - 1];
    if (previous !== undefined && previous.endSecond > interval.startSecond)
      throw new Error("CTRADER_SCHEDULE_INTERVAL_OVERLAP");
  }
  return { timeZone, intervals: ordered };
}

function isOpen(at: Date, schedule: WeeklyTradingSchedule): boolean {
  const second = weekSecond(at, schedule.timeZone);
  return schedule.intervals.some(
    (interval) => second >= interval.startSecond && second < interval.endSecond,
  );
}

export function markBrokerSessionGaps(
  candles: readonly Candle[],
  timeframeMs: number,
  schedule: WeeklyTradingSchedule,
): readonly Candle[] {
  if (
    !Number.isSafeInteger(timeframeMs) ||
    timeframeMs < MINUTE_MS ||
    timeframeMs % MINUTE_MS !== 0
  )
    throw new Error("CTRADER_SCHEDULE_TIMEFRAME_INVALID");
  return candles.map((candle, index) => {
    const previous = candles[index - 1];
    if (previous === undefined) return candle;
    const previousEnd = Date.parse(previous.endTime);
    const currentStart = Date.parse(candle.startTime);
    const difference = currentStart - previousEnd;
    if (
      !Number.isFinite(previousEnd) ||
      !Number.isFinite(currentStart) ||
      difference <= 0 ||
      difference % timeframeMs !== 0 ||
      difference > MAX_TRUSTED_SESSION_GAP_MS
    ) {
      return candle;
    }
    // A gap is trusted only when every missing bar boundary is outside the
    // exact broker schedule. A no-tick interval while the session is open is
    // intentionally left unmarked so analytics rejects it.
    for (let cursor = previousEnd; cursor < currentStart; cursor += MINUTE_MS) {
      if (isOpen(new Date(cursor), schedule)) return candle;
    }
    if (isOpen(new Date(currentStart - 1), schedule)) return candle;
    return {
      ...candle,
      qualityFlags: [
        ...new Set([...candle.qualityFlags, BROKER_SESSION_GAP_BEFORE]),
      ],
    };
  });
}
