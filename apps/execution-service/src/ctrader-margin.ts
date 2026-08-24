import type { CTraderClient } from "../../../packages/ctrader-client/src/client.js";
import type { MarginEstimator } from "./oco-risk-evaluator.js";

export class CTraderMarginEstimator implements MarginEstimator {
  readonly #client: CTraderClient;

  constructor(client: CTraderClient) {
    this.#client = client;
  }

  async estimate(
    symbolId: string,
    side: "BUY" | "SELL",
    volume: string,
  ): Promise<string> {
    const result = (await this.#client.expectedMargin(symbolId, [volume])).find(
      (item) => item.volume === volume,
    );
    if (result === undefined)
      throw new Error("CTRADER_MARGIN_ESTIMATE_MISSING");
    return side === "BUY" ? result.buyMargin : result.sellMargin;
  }
}
