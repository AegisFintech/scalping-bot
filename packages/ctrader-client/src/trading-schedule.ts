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
  readonly holidays: readonly TradingHoliday[];
}

export interface TradingHoliday {
  readonly holidayDate: number;
  readonly isRecurring: boolean;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly timeZone: string;
}

// Bound the cache; broker timezones are validated before use.
const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(at: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 100) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  return formatter.formatToParts(at);
}

function weekSecond(at: Date, timeZone: string): number {
  const parts = localParts(at, timeZone);
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
  holidays: readonly TradingHoliday[] = [],
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
  if (holidays.length > 366) throw new Error("CTRADER_HOLIDAYS_INVALID");
  for (const holiday of holidays) {
    if (
      !Number.isSafeInteger(holiday.holidayDate) ||
      holiday.holidayDate < 0 ||
      holiday.holidayDate > 100000 ||
      typeof holiday.isRecurring !== "boolean" ||
      !Number.isSafeInteger(holiday.startSecond) ||
      !Number.isSafeInteger(holiday.endSecond) ||
      holiday.startSecond < 0 ||
      holiday.endSecond > DAY_SECONDS ||
      holiday.startSecond >= holiday.endSecond ||
      typeof holiday.timeZone !== "string" ||
      holiday.timeZone.length < 1 ||
      holiday.timeZone.length > 100 ||
      holiday.timeZone.trim() !== holiday.timeZone
    )
      throw new Error("CTRADER_HOLIDAY_INVALID");
    try {
      localParts(new Date(0), holiday.timeZone);
    } catch {
      throw new Error("CTRADER_HOLIDAY_TIMEZONE_INVALID");
    }
  }
  return {
    timeZone,
    intervals: ordered,
    holidays: holidays.map((h) => ({ ...h })),
  };
}

export function isBrokerSessionOpen(
  at: Date,
  schedule: WeeklyTradingSchedule,
): boolean {
  if (!Number.isSafeInteger(at.getTime()) || at.getTime() < 0)
    throw new Error("CTRADER_SCHEDULE_CLOCK_INVALID");
  const second = weekSecond(at, schedule.timeZone);
  for (const holiday of schedule.holidays) {
    const parts = localParts(at, holiday.timeZone);
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)!.value;
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    const declared = new Date(holiday.holidayDate * DAY_SECONDS * 1000)
      .toISOString()
      .slice(0, 10);
    const dateMatches = holiday.isRecurring
      ? date.slice(5) === declared.slice(5)
      : date === declared;
    const daySecond =
      Number(part("hour")) * 3600 +
      Number(part("minute")) * 60 +
      Number(part("second"));
    if (
      dateMatches &&
      daySecond >= holiday.startSecond &&
      daySecond < holiday.endSecond
    )
      return false;
  }
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
  // Inspect every possible session/holiday edge within each minute too. This
  // catches sub-minute open intervals between overrides instead of hiding them.
  const offsets = [
    ...new Set([
      0,
      59999,
      ...[...schedule.intervals, ...schedule.holidays]
        .flatMap((i) => [i.startSecond, i.endSecond])
        .flatMap((second) => [
          (second % 60) * 1000,
          ((second % 60) * 1000 + 59999) % 60000,
        ]),
    ]),
  ];
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
      for (const offset of offsets) {
        if (
          cursor + offset < currentStart &&
          isBrokerSessionOpen(new Date(cursor + offset), schedule)
        )
          return candle;
      }
    }
    if (isBrokerSessionOpen(new Date(currentStart - 1), schedule))
      return candle;
    return {
      ...candle,
      qualityFlags: [
        ...new Set([...candle.qualityFlags, BROKER_SESSION_GAP_BEFORE]),
      ],
    };
  });
}
