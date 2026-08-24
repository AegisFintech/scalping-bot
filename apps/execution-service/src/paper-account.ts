import { Decimal } from "decimal.js";

import type {
  AccountAdapter,
  AccountState,
} from "../../../packages/contracts/src/index.js";
import {
  canonical,
  decimal,
  signedDecimal,
} from "../../../packages/risk-engine/src/decimal.js";
import type { MarginEstimator } from "./oco-risk-evaluator.js";
import type { PaperAccountMark } from "./paper-gateway.js";

export class PaperAccountAdapter implements AccountAdapter {
  readonly #startingBalance: Decimal;
  readonly #startingAvailableMargin: Decimal;
  #mark: PaperAccountMark = {
    realizedPnl: "0",
    unrealizedPnl: "0",
    relevantPositionCount: 0,
    relevantPendingOrderCount: 0,
    hasPartialFill: false,
    certain: true,
  };

  constructor(input: {
    readonly equity: string;
    readonly balance?: string;
    readonly availableMargin?: string;
  }) {
    this.#startingBalance = decimal(input.balance ?? input.equity);
    this.#startingAvailableMargin = decimal(
      input.availableMargin ?? input.equity,
    );
    decimal(input.equity);
  }

  authenticate(): Promise<void> {
    return Promise.resolve();
  }

  update(mark: PaperAccountMark): void {
    this.#mark = mark;
  }

  reconcile(): Promise<AccountState> {
    const balance = this.#startingBalance.plus(
      signedDecimal(this.#mark.realizedPnl),
    );
    const equity = balance.plus(signedDecimal(this.#mark.unrealizedPnl));
    const availableMargin = Decimal.max(
      0,
      this.#startingAvailableMargin
        .plus(signedDecimal(this.#mark.realizedPnl))
        .plus(Decimal.min(0, signedDecimal(this.#mark.unrealizedPnl))),
    );
    return Promise.resolve({
      reconciledAt: new Date().toISOString(),
      certain: this.#mark.certain,
      equity: canonical(equity),
      balance: canonical(balance),
      availableMargin: canonical(availableMargin),
      relevantPositionCount: this.#mark.relevantPositionCount,
      relevantPendingOrderCount: this.#mark.relevantPendingOrderCount,
      hasPartialFill: this.#mark.hasPartialFill,
      hasCancellationPending: false,
      reasonCodes: this.#mark.certain ? [] : ["PAPER_ACCOUNT_STATE_UNCERTAIN"],
    });
  }
}

export class LinearMarginEstimator implements MarginEstimator {
  readonly #marginPerNativeVolume: Decimal;

  constructor(marginPerNativeVolume: string) {
    this.#marginPerNativeVolume = decimal(marginPerNativeVolume);
    if (this.#marginPerNativeVolume.lte(0))
      throw new Error("PAPER_MARGIN_RATE_INVALID");
  }

  estimate(
    _symbolId: string,
    _side: "BUY" | "SELL",
    volume: string,
  ): Promise<string> {
    return Promise.resolve(
      canonical(decimal(volume).mul(this.#marginPerNativeVolume)),
    );
  }
}
