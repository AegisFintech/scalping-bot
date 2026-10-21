import type {
  Candle,
  CandleSeries,
  Timeframe,
} from "../../contracts/src/index.js";
import {
  markBrokerSessionGaps,
  type WeeklyTradingSchedule,
} from "../../ctrader-client/src/trading-schedule.js";

export const TECHNICAL_HISTORY_COUNTS = Object.freeze({
  M1: 720,
  M5: 576,
  M15: 480,
});
const PERIOD = { M1: 60_000, M5: 300_000, M15: 900_000 };
type FetchPage = (
  timeframe: Timeframe,
  count: number,
  toTimestampMs: number,
) => Promise<readonly Candle[]>;

/** Candidate-only cache. Caller supplies one symbol/connection scope and verified schedule. */
export class CandidateHistoryCache {
  readonly #cache = new Map<Timeframe, readonly Candle[]>();
  #tail: Promise<unknown> = Promise.resolve();
  #generation = 0;
  #scheduleKey = "";
  constructor(private readonly fetchPage: FetchPage) {}
  reset(): void {
    this.#generation++;
    this.#cache.clear();
  }

  read(
    serverTime: string,
    schedule: WeeklyTradingSchedule,
  ): Promise<readonly CandleSeries[]> {
    const generation = this.#generation;
    const task = this.#tail
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.#generation)
          throw new Error("CANDIDATE_HISTORY_GENERATION_CHANGED");
        try {
          const scheduleKey = JSON.stringify(schedule);
          if (scheduleKey !== this.#scheduleKey) {
            this.#cache.clear();
            this.#scheduleKey = scheduleKey;
          }
          const result: CandleSeries[] = [];
          const server = Date.parse(serverTime);
          if (!Number.isFinite(server))
            throw new Error("CANDIDATE_HISTORY_TIME_INVALID");
          for (const timeframe of ["M15", "M5", "M1"] as const) {
            const period = PERIOD[timeframe];
            const boundary = Math.floor(server / period) * period;
            const target = TECHNICAL_HISTORY_COUNTS[timeframe];
            const prior = this.#cache.get(timeframe) ?? [];
            const lastEnd = prior.at(-1)?.endTime;
            if (lastEnd !== undefined && Date.parse(lastEnd) > boundary)
              throw new Error("CANDIDATE_HISTORY_CLOCK_REGRESSION");
            if (lastEnd !== undefined && Date.parse(lastEnd) === boundary) {
              result.push({ timeframe, candles: prior });
              continue;
            }
            const needed =
              lastEnd === undefined
                ? target
                : Math.min(
                    target,
                    Math.ceil((boundary - Date.parse(lastEnd)) / period) + 1,
                  );
            const collected: Candle[] = [];
            let until = boundary;
            for (let page = 0; collected.length < needed && page < 8; page++) {
              const count = Math.min(180, needed - collected.length);
              const chunk = await this.fetchPage(timeframe, count, until);
              if (generation !== this.#generation)
                throw new Error("CANDIDATE_HISTORY_GENERATION_CHANGED");
              if (chunk.length !== count)
                throw new Error("CANDIDATE_HISTORY_INSUFFICIENT");
              let previous = -Infinity;
              for (const c of chunk) {
                const start = Date.parse(c.startTime),
                  end = Date.parse(c.endTime);
                if (
                  !c.complete ||
                  !Number.isFinite(start) ||
                  !Number.isFinite(end) ||
                  start <= previous ||
                  end - start !== period ||
                  end > until ||
                  c.qualityFlags.some((f) => f !== "BROKER_SESSION_GAP_BEFORE")
                )
                  throw new Error("CANDIDATE_HISTORY_PAGE_INVALID");
                previous = start;
              }
              const oldest = chunk[0];
              if (oldest === undefined || Date.parse(oldest.startTime) >= until)
                throw new Error("CANDIDATE_HISTORY_NO_PROGRESS");
              until = Date.parse(oldest.startTime);
              collected.unshift(...chunk);
            }
            if (collected.length !== needed)
              throw new Error("CANDIDATE_HISTORY_PAGE_LIMIT");
            const byTime = new Map(prior.map((c) => [c.startTime, c]));
            for (const c of collected) {
              const old = byTime.get(c.startTime);
              if (
                old !== undefined &&
                ["open", "high", "low", "close", "volume"].some(
                  (k) => old[k as keyof Candle] !== c[k as keyof Candle],
                )
              )
                throw new Error("CANDIDATE_HISTORY_CONFLICT");
              byTime.set(c.startTime, c);
            }
            const raw = [...byTime.values()]
              .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
              .slice(-target)
              .map((c) => ({ ...c, qualityFlags: [] }));
            const candles = Object.freeze(
              markBrokerSessionGaps(raw, period, schedule).map((c) =>
                Object.freeze({
                  ...c,
                  qualityFlags: Object.freeze([...c.qualityFlags]),
                }),
              ),
            );
            if (
              candles.length !== target ||
              Date.parse(candles.at(-1)?.endTime ?? "") !== boundary
            )
              throw new Error("CANDIDATE_HISTORY_INSUFFICIENT");
            for (let i = 1; i < candles.length; i++) {
              const current = candles[i],
                previous = candles[i - 1];
              if (
                current !== undefined &&
                previous !== undefined &&
                current.startTime !== previous.endTime &&
                !current.qualityFlags.includes("BROKER_SESSION_GAP_BEFORE")
              )
                throw new Error("CANDIDATE_HISTORY_UNVERIFIED_GAP");
            }
            this.#cache.set(timeframe, candles);
            result.push({ timeframe, candles });
          }
          return result;
        } catch (error) {
          this.#cache.clear();
          throw error;
        }
      });
    this.#tail = task;
    return task;
  }
}
