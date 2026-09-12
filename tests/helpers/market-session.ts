import type {
  MarketSessionSnapshot,
  MarketSessionStatus,
} from "../../packages/contracts/src/index.js";

export function marketSession(
  at = "2026-09-11T20:59:59.000Z",
): MarketSessionSnapshot {
  return {
    schemaVersion: "1.0",
    metadata: {
      symbolId: "7",
      symbolName: "XAUUSD",
      digits: 2,
      pipPosition: 2,
      pipSize: "0.01",
      tickSize: "0.01",
      tickValue: "0.0001",
      baseAsset: "XAU",
      quoteAsset: "USD",
      accountAsset: "USD",
      quoteToAccountConversionRate: "1",
      contractSize: "100",
      volumeScale: "0.01",
      minVolume: "100",
      maxVolume: "1000000",
      volumeStep: "100",
      minStopDistance: "0",
      commission: {
        type: "USD_PER_MILLION_USD",
        rate: "30",
        minimum: "0",
        minimumType: "QUOTE_CURRENCY",
        minimumAsset: "USD",
        pnlConversionFeeRate: "0",
      },
      metadataTime: at,
    },
    schedule: {
      timeZone: "UTC",
      intervals: [{ startSecond: 79200, endSecond: 507600 }],
      holidays: [],
    },
  };
}

export function sessionStatus(
  state: MarketSessionStatus["state"],
): MarketSessionStatus {
  return {
    state,
    checkedAt: new Date().toISOString(),
    scheduleFetchedAt: new Date().toISOString(),
    reasonCode:
      state === "OPEN"
        ? null
        : state === "CLOSED"
          ? "MARKET_SESSION_CLOSED"
          : "MARKET_SESSION_UNAVAILABLE",
  };
}
