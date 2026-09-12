import type {
  MarketSessionSnapshot,
  MarketSessionStatus,
} from "../../contracts/src/index.js";
import { isBrokerSessionOpen } from "../../ctrader-client/src/trading-schedule.js";
import { validateMarketSession } from "./client.js";

/** Short broker-metadata cache; session boundaries are reevaluated on every check. */
export const SESSION_REFRESH_MS = 30_000;

export class BrokerSessionGate {
  private cached: MarketSessionSnapshot | null;
  private pending: Promise<void> | null = null;
  private retryAt = 0;

  constructor(
    private readonly symbol: string,
    private readonly read: (symbol: string) => Promise<MarketSessionSnapshot>,
    private readonly now = Date.now,
    initial?: MarketSessionSnapshot,
  ) {
    this.cached =
      initial === undefined ? null : validateMarketSession(initial, symbol);
  }

  get status(): MarketSessionStatus {
    const now = this.now();
    const fetched =
      this.cached === null
        ? NaN
        : Date.parse(this.cached.metadata.metadataTime);
    const valid =
      Number.isSafeInteger(now) &&
      now >= fetched &&
      now - fetched < SESSION_REFRESH_MS;
    const base = {
      checkedAt: new Date(now).toISOString(),
      scheduleFetchedAt: this.cached?.metadata.metadataTime ?? null,
    };
    if (!valid || this.cached === null)
      return {
        ...base,
        state: "UNAVAILABLE",
        reasonCode: "MARKET_SESSION_UNAVAILABLE",
      };
    return isBrokerSessionOpen(new Date(now), this.cached.schedule)
      ? { ...base, state: "OPEN", reasonCode: null }
      : { ...base, state: "CLOSED", reasonCode: "MARKET_SESSION_CLOSED" };
  }

  async check(): Promise<MarketSessionStatus> {
    if (this.status.state === "UNAVAILABLE" && this.now() >= this.retryAt) {
      this.pending ??= this.read(this.symbol)
        .then((raw) => {
          const value = validateMarketSession(raw, this.symbol);
          const age = this.now() - Date.parse(value.metadata.metadataTime);
          if (age < 0 || age >= SESSION_REFRESH_MS)
            throw new Error("MARKET_SESSION_UNAVAILABLE");
          this.cached = value;
          this.retryAt = 0;
        })
        .catch(() => {
          this.cached = null;
          this.retryAt = this.now() + SESSION_REFRESH_MS;
        })
        .finally(() => {
          this.pending = null;
        });
      await this.pending;
    }
    return this.status;
  }

  async requireOpen(): Promise<void> {
    const status = await this.check();
    if (status.state !== "OPEN") throw new Error(status.reasonCode!);
  }
}
