import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import type {
  MarketSnapshot,
  PendingOrderCommand,
  AccountState,
} from "../../packages/contracts/src/index.js";
import {
  quickOcoTransform,
  quickOcoCost,
  quickOcoModeledCost,
  validateQuickOcoCommands,
} from "../../packages/strategy-candidates/src/quick-oco.js";
import {
  executionRiskPolicy,
  resolveRuntimeEnvironment,
} from "../../packages/config/src/policy.js";
import { loadExecutionConfig } from "../../apps/execution-service/src/config.js";
import { OcoRiskEvaluator } from "../../apps/execution-service/src/oco-risk-evaluator.js";
import { stopLimitProtectionFields } from "../../packages/ctrader-client/src/client.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
const m = metadata();
function proposal(maximumStopDistance = "100") {
  return quickOcoTransform({
    snapshot: { metadata: m } as MarketSnapshot,
    response: response(),
    maximumStopDistance,
  });
}
function commands(): PendingOrderCommand[] {
  const result = proposal();
  expect(result.accepted).toBe(true);
  return (["BUY", "SELL"] as const).map((side) => {
    const leg =
      side === "BUY" ? result.response!.buy_stop : result.response!.sell_stop;
    return {
      executionOrderType: "STOP_LIMIT",
      side,
      entryPrice: leg.entry_price,
      stopLoss: leg.stop_loss,
      takeProfit: leg.take_profit,
      volume: "10000",
      expiresAt: leg.expires_at,
      timeInForce: "GTC",
    } as PendingOrderCommand;
  });
}
describe("approved quick OCO economics", () => {
  it("preserves both Codex entries, unchanged7.00 native SL and cost-checked0.40 TP", () => {
    const r = proposal();
    expect(r.accepted).toBe(true);
    for (const [i, c] of commands().entries()) {
      expect(c.entryPrice).toBe(
        i === 0
          ? response().buy_stop.entry_price
          : response().sell_stop.entry_price,
      );
      const entry = new Decimal(c.entryPrice),
        target = new Decimal(c.takeProfit),
        distance = entry.minus(target).abs();
      expect(entry.minus(c.stopLoss).abs().eq("7")).toBe(true);
      expect(distance.div(m.pipSize).isInteger()).toBe(true);
      const cost = quickOcoCost(m, entry, target, new Decimal(c.volume));
      expect(cost.netPrice.gte(new Decimal(m.pipSize).mul("0.08"))).toBe(true);
      expect(
        new Decimal(cost.evidence.modeled_round_trip_commission).gt(7),
      ).toBe(true);
      expect(distance.eq("0.4")).toBe(true);
      expect(cost.evidence.execution_reserve_price).toBe("0.05");
      const native = stopLimitProtectionFields(c, m, "30");
      expect(native.relativeStopLoss).toBe(native.relativeTakeProfit * 17.5);
    }
    expect(validateQuickOcoCommands(commands(), m).approved).toBe(true);
  });
  it("rejects unaffordable/invalid geometry rather than moving entries or raising risk", () => {
    expect(proposal("0.1").accepted).toBe(false);
    const bad = response();
    Object.assign(bad.buy_stop, { entry_price: bad.sell_stop.entry_price });
    expect(
      quickOcoTransform({
        snapshot: { metadata: m } as MarketSnapshot,
        response: bad,
        maximumStopDistance: "100",
      }).accepted,
    ).toBe(false);
  });
  it("rechecks actual-volume commission and geometry against changed placement metadata", () => {
    const c = commands();
    expect(
      validateQuickOcoCommands(c, {
        ...m,
        commission: { ...m.commission, rate: "3000" },
      }).approved,
    ).toBe(false);
    expect(
      validateQuickOcoCommands(
        [{ ...c[0]!, stopLoss: c[0]!.entryPrice }, c[1]!],
        m,
      ).approved,
    ).toBe(false);
    expect(validateQuickOcoCommands([c[0]!], m).approved).toBe(false);
  });
  it("uses 5% only for explicit demo and preserves other modes and loss accounting", () => {
    for (const mode of [
      "demo",
      "paper",
      "live",
      "shadow",
      "replay",
      "backtest",
    ] as const) {
      const policy = executionRiskPolicy(mode),
        env = resolveRuntimeEnvironment({ TRADING_MODE: mode });
      expect(policy.setupRiskPercent).toBe(mode === "demo" ? "5" : "1");
      expect(loadExecutionConfig(env).baseRiskPercent).toBe(
        policy.setupRiskPercent,
      );
      expect(policy.dailyLossLimitPercent).toBe("5");
    }
    expect(() =>
      resolveRuntimeEnvironment({
        TRADING_MODE: "demo",
        BASE_RISK_PERCENT: "1",
      }),
    ).toThrow("CONFIG_POLICY_CONFLICT");
    expect(() =>
      resolveRuntimeEnvironment({
        TRADING_MODE: "live",
        BASE_RISK_PERCENT: "5",
      }),
    ).toThrow("CONFIG_POLICY_CONFLICT");
  });
  it("dynamically shares the 5% modeled loss budget and retains exposure/affordability gates", async () => {
    const r = proposal();
    let prior = new Decimal(Infinity);
    const evaluator = new OcoRiskEvaluator({
      operatorEntryModes: true,
      marginEstimator: {
        estimate: (_s, _d, v) =>
          Promise.resolve(new Decimal(v).mul("0.02").toFixed()),
      },
      baseRiskPercent: "5",
      maxRiskPercent: "5",
      maxMarginUsagePercent: "100",
      maxPositionNotional: null,
      strategyVersion: "fixture",
      executionOrderType: "STOP_LIMIT",
      adverseSlippagePoints: "65",
      timeInForce: "GTC",
    });
    for (const equity of ["100000", "50000"]) {
      const account = {
        certain: true,
        equity,
        balance: equity,
        availableMargin: equity,
        relevantPositionCount: 0,
        relevantPendingOrderCount: 0,
        hasPartialFill: false,
        hasCancellationPending: false,
      } as AccountState;
      const input = {
        response: r.response!,
        metadata: m,
        quote: {
          bid: "4443.4",
          ask: "4443.5",
          sourceTime: m.metadataTime,
          receivedAt: m.metadataTime,
        },
        account,
      };
      const actual = await evaluator.evaluate(input);
      expect(actual.approved).toBe(true);
      expect(actual.perLegRiskPercent).toBe("2.5");
      expect(
        new Decimal(actual.risk!.combinedMaximumLoss!).lte(
          new Decimal(equity).mul("0.05"),
        ),
      ).toBe(true);
      expect(new Decimal(actual.commands![0].volume).lt(prior)).toBe(true);
      prior = new Decimal(actual.commands![0].volume);
      expect(
        (
          await evaluator.evaluate({
            ...input,
            account: { ...account, certain: false },
          })
        ).approved,
      ).toBe(false);
      expect(
        (
          await evaluator.evaluate({
            ...input,
            account: { ...account, relevantPendingOrderCount: 1 },
          })
        ).approved,
      ).toBe(false);
      expect(
        (
          await evaluator.evaluate({
            ...input,
            account: { ...account, availableMargin: "0" },
          })
        ).approved,
      ).toBe(false);
    }
  });
});

it("reports fill-relative cost context without charging entry slippage again and refuses TP overrides", () => {
  const snapshot = { metadata: m, quote: { ask: "4000" } } as MarketSnapshot;
  expect(new Decimal(quickOcoModeledCost(snapshot)).lt(1)).toBe(true);
  const c = commands();
  const changed = c.map((x) => {
    const sign = x.side === "BUY" ? 1 : -1;
    return {
      ...x,
      takeProfit: new Decimal(x.entryPrice)
        .plus(new Decimal("0.8").mul(sign))
        .toFixed(),
      stopLoss: new Decimal(x.entryPrice)
        .minus(new Decimal("5.6").mul(sign))
        .toFixed(),
    };
  });
  expect(validateQuickOcoCommands(changed, m).approved).toBe(false);
});
