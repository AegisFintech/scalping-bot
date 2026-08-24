import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DurableDemoExecutionRecorder,
  normalizeDemoExecution,
  type DemoExecutionEvent,
  type DemoExecutionStore,
} from "../../apps/execution-service/src/demo-execution.js";
import { demoExecutionReasonCodes } from "../../apps/execution-service/src/demo-execution-store.js";
import type { BrokerExecution } from "../../packages/ctrader-client/src/client.js";

async function fixture(name: string): Promise<BrokerExecution> {
  return JSON.parse(
    await readFile(path.resolve("tests", "fixtures", "ctrader", name), "utf8"),
  ) as BrokerExecution;
}

class MemoryStore implements DemoExecutionStore {
  readonly events: DemoExecutionEvent[] = [];
  result = { certain: true, reasonCodes: [] as readonly string[] };

  persist(event: DemoExecutionEvent): Promise<typeof this.result> {
    this.events.push(event);
    return Promise.resolve(this.result);
  }

  readiness(): Promise<typeof this.result> {
    return Promise.resolve(this.result);
  }
}

describe("cTrader demo execution normalization", () => {
  it("normalizes an accepted strategy order without broker money inference", async () => {
    const raw = await fixture("demo-order-accepted-v1.json");
    const event = normalizeDemoExecution(raw, { symbolId: "7" });
    expect(event).toMatchObject({
      schemaVersion: "1.1",
      executionType: 2,
      brokerOrderId: "501",
      brokerFillId: null,
      brokerOrderType: 3,
      closingOrder: false,
      occurredAt: "2026-08-24T04:00:00.000Z",
      order: {
        clientOrderId: "cas-buy-111111111111111111111111",
        state: "PENDING",
        filledVolume: "0",
      },
    });
    expect(event?.eventKey).toMatch(/^event:[0-9a-f]{64}$/);
  });

  it("retains a strategy-labelled acceptance without a client order ID", async () => {
    const raw = await fixture("demo-order-accepted-v1.json");
    const order = structuredClone(raw.order) as Record<string, unknown>;
    delete order.clientOrderId;

    const event = normalizeDemoExecution({ ...raw, order }, { symbolId: "7" });

    expect(event).toMatchObject({
      clientOrderId: null,
      brokerOrderId: "501",
      order: { clientOrderId: "", state: "PENDING" },
    });
  });

  it("ignores an unpriced position placeholder on pending order acceptance", async () => {
    const raw = await fixture("demo-order-accepted-v1.json");
    const position = {
      positionId: "801",
      positionStatus: 1,
      tradeData: {
        symbolId: "7",
        volume: "0",
        tradeSide: 1,
        label: "ctrader-ai-scalper:0.1.0",
      },
    };

    const event = normalizeDemoExecution(
      { ...raw, position },
      { symbolId: "7" },
    );

    expect(event).toMatchObject({
      executionType: 2,
      brokerOrderId: "501",
      brokerPositionId: "801",
      position: null,
      order: { state: "PENDING" },
    });
  });

  it("ignores an unpriced contextual position on cancellation", async () => {
    const raw = await fixture("demo-order-accepted-v1.json");
    const order = structuredClone(raw.order) as Record<string, unknown>;
    order.orderStatus = 5;
    const position = {
      positionId: "801",
      positionStatus: 1,
      tradeData: {
        symbolId: "7",
        volume: "100",
        tradeSide: 1,
        label: "ctrader-ai-scalper:0.1.0",
      },
    };

    const event = normalizeDemoExecution(
      { ...raw, executionType: 5, order, position },
      { symbolId: "7" },
    );

    expect(event).toMatchObject({
      executionType: 5,
      brokerPositionId: "801",
      position: null,
      order: { state: "CANCELLED" },
    });
  });

  it("still requires a priced position on a fill execution", async () => {
    const raw = await fixture("demo-order-filled-v1.json");
    const position = structuredClone(raw.position) as Record<string, unknown>;
    delete position.price;

    expect(() =>
      normalizeDemoExecution({ ...raw, position }, { symbolId: "7" }),
    ).toThrow("CTRADER_FIELD_INVALID:price");
  });

  it("normalizes a partial fill with broker-native volume and scaled commission", async () => {
    const raw = await fixture("demo-order-partial-fill-v1.json");
    const event = normalizeDemoExecution(raw, { symbolId: "7" });
    expect(event).toMatchObject({
      eventKey: "deal:901",
      brokerPositionId: "801",
      order: { state: "PARTIALLY_FILLED", filledVolume: "40" },
      position: { state: "OPEN", volume: "40", entryPrice: "2001.25" },
      fill: {
        brokerFillId: "901",
        price: "2001.25",
        volume: "40",
        commission: "-0.15",
      },
    });
  });

  it("normalizes signed scaled close-detail money and volume", async () => {
    const raw = await fixture("demo-order-filled-v1.json");
    const deal = structuredClone(raw.deal) as Record<string, unknown>;
    deal.closePositionDetail = {
      entryPrice: 2001.25,
      grossProfit: "1234",
      swap: "-10",
      commission: "-20",
      balance: "1001234",
      closedVolume: "100",
      balanceVersion: "42",
      moneyDigits: 2,
      pnlConversionFee: "-3",
      quoteToDepositConversionRate: 1,
    };
    const event = normalizeDemoExecution({ ...raw, deal }, { symbolId: "7" });
    expect(event?.closeDetail).toEqual({
      entryPrice: "2001.25",
      grossProfit: "12.34",
      swap: "-0.1",
      commission: "-0.2",
      pnlConversionFee: "-0.03",
      balance: "10012.34",
      closedVolume: "100",
      quoteToDepositConversionRate: "1",
      balanceVersion: "42",
    });
  });

  it("accepts complete broker-scaled close evidence for deterministic trade mapping", async () => {
    const raw = await fixture("demo-position-closed-v1.json");
    const event = normalizeDemoExecution(raw, { symbolId: "7" });
    expect(event).toMatchObject({
      eventKey: "deal:903",
      brokerOrderType: 4,
      closingOrder: true,
      order: { clientOrderId: "", state: "FILLED" },
      position: {
        brokerPositionId: "801",
        state: "CLOSED",
        side: "BUY",
        volume: "0",
        openedAt: "2026-08-24T04:01:00.000Z",
        closedAt: "2026-08-24T04:02:01.000Z",
      },
      closeDetail: {
        grossProfit: "10",
        swap: "-0.1",
        commission: "-0.2",
        pnlConversionFee: "-0.05",
        closedVolume: "100",
      },
    });
    expect(demoExecutionReasonCodes(event!)).toEqual([]);
  });

  it("holds a broker-created closing acceptance until its deal arrives", async () => {
    const raw = await fixture("demo-order-accepted-v1.json");
    const order = structuredClone(raw.order) as Record<string, unknown>;
    order.orderId = "601";
    order.orderType = 4;
    order.closingOrder = true;
    const position = {
      positionId: "801",
      positionStatus: 1,
      tradeData: {
        symbolId: "7",
        volume: "100",
        tradeSide: 1,
        label: "ctrader-ai-scalper:0.1.0",
      },
    };

    const event = normalizeDemoExecution(
      { ...raw, order, position },
      { symbolId: "7" },
    );

    expect(event).toMatchObject({
      brokerOrderId: "601",
      brokerPositionId: "801",
      brokerOrderType: 4,
      closingOrder: true,
      position: null,
    });
    expect(demoExecutionReasonCodes(event!)).toEqual([
      "DEMO_CLOSING_ORDER_AWAITING_DEAL",
    ]);
  });

  it("keeps missing or partial close evidence fail-closed", async () => {
    const raw = await fixture("demo-position-closed-v1.json");
    const missing = structuredClone(raw);
    delete (missing.deal as Record<string, unknown>).closePositionDetail;
    const missingEvent = normalizeDemoExecution(missing, { symbolId: "7" });
    expect(demoExecutionReasonCodes(missingEvent!)).toEqual([
      "DEMO_TRADE_OUTCOME_MISSING",
    ]);

    const partial = structuredClone(raw);
    (partial.position as Record<string, unknown>).positionStatus = 1;
    const partialEvent = normalizeDemoExecution(partial, { symbolId: "7" });
    expect(demoExecutionReasonCodes(partialEvent!)).toEqual([
      "DEMO_PARTIAL_CLOSE_RECONCILIATION_REQUIRED",
    ]);

    const volumeMissing = structuredClone(raw);
    delete (
      (volumeMissing.deal as Record<string, unknown>)
        .closePositionDetail as Record<string, unknown>
    ).closedVolume;
    const volumeMissingEvent = normalizeDemoExecution(volumeMissing, {
      symbolId: "7",
    });
    expect(demoExecutionReasonCodes(volumeMissingEvent!)).toEqual([
      "DEMO_TRADE_CLOSED_VOLUME_MISSING",
    ]);
  });

  it("rejects invalid close-detail volume", async () => {
    const raw = await fixture("demo-order-filled-v1.json");
    const deal = structuredClone(raw.deal) as Record<string, unknown>;
    deal.closePositionDetail = {
      entryPrice: 2001.25,
      grossProfit: "0",
      swap: "0",
      commission: "0",
      balance: "1000000",
      closedVolume: "-1",
      moneyDigits: 2,
    };
    expect(() =>
      normalizeDemoExecution({ ...raw, deal }, { symbolId: "7" }),
    ).toThrowError("CTRADER_CLOSE_VOLUME_INVALID");
  });

  it("rejects a fill event that omits its required deal", async () => {
    const raw = await fixture("demo-order-filled-v1.json");
    expect(() =>
      normalizeDemoExecution({ ...raw, deal: null }, { symbolId: "7" }),
    ).toThrowError("DEMO_EXECUTION_DEAL_MISSING");
  });

  it("rejects a strategy event for a different broker symbol", async () => {
    const raw = await fixture("demo-order-accepted-v1.json");
    expect(() => normalizeDemoExecution(raw, { symbolId: "8" })).toThrowError(
      "DEMO_EXECUTION_SYMBOL_MISMATCH",
    );
  });

  it("rejects an execution type that contradicts the broker order state", async () => {
    const raw = await fixture("demo-order-filled-v1.json");
    expect(() =>
      normalizeDemoExecution(
        { ...raw, executionType: 2, deal: null, position: null },
        { symbolId: "7" },
      ),
    ).toThrowError("DEMO_EXECUTION_ORDER_STATE_MISMATCH");
  });

  it("retains a partially filled cancellation for reconciliation", async () => {
    const raw = await fixture("demo-order-partial-fill-v1.json");
    const order = structuredClone(raw.order) as Record<string, unknown>;
    order.orderStatus = 5;
    const event = normalizeDemoExecution(
      {
        ...raw,
        executionType: 5,
        order,
        position: null,
        deal: null,
      },
      { symbolId: "7" },
    );
    expect(event?.order?.state).toBe("PARTIALLY_FILLED");
  });

  it("ignores events that are not strategy-owned", async () => {
    const raw = await fixture("demo-order-accepted-v1.json");
    const order = structuredClone(raw.order) as Record<string, unknown>;
    const data = order.tradeData as Record<string, unknown>;
    order.clientOrderId = "manual-order";
    data.label = "manual";
    expect(
      normalizeDemoExecution({ ...raw, order }, { symbolId: "7" }),
    ).toBeNull();
  });
});

describe("durable demo execution recorder", () => {
  it("serializes callback persistence before reporting certainty", async () => {
    const store = new MemoryStore();
    const recorder = new DurableDemoExecutionRecorder(store, { symbolId: "7" });
    recorder.enqueue(await fixture("demo-order-accepted-v1.json"));
    recorder.enqueue(await fixture("demo-order-filled-v1.json"));
    expect(store.events).toEqual([]);
    await expect(recorder.flush()).resolves.toEqual({
      certain: true,
      reasonCodes: [],
    });
    expect(store.events.map((event) => event.eventKey)).toEqual([
      expect.stringMatching(/^event:/),
      "deal:902",
    ]);
  });

  it("remains fail-closed after a persistence rejection", async () => {
    const store = new MemoryStore();
    store.result = {
      certain: false,
      reasonCodes: ["DEMO_EXECUTION_LOCAL_INTENT_NOT_FOUND"],
    };
    const recorder = new DurableDemoExecutionRecorder(store, { symbolId: "7" });
    recorder.enqueue(await fixture("demo-order-accepted-v1.json"));
    await expect(recorder.flush()).resolves.toEqual({
      certain: false,
      reasonCodes: ["DEMO_EXECUTION_LOCAL_INTENT_NOT_FOUND"],
    });
  });

  it("reports only a sanitized structural summary for normalization failure", async () => {
    const store = new MemoryStore();
    const onFailure = vi.fn();
    const recorder = new DurableDemoExecutionRecorder(store, {
      symbolId: "7",
      onFailure,
    });
    const raw = await fixture("demo-order-accepted-v1.json");
    const order = structuredClone(raw.order) as Record<string, unknown>;
    order.utcLastUpdateTimestamp = "invalid-secret-value";
    order.clientOrderId = "cas-buy-sensitive-identifier";
    (order.tradeData as Record<string, unknown>).label =
      "ctrader-ai-scalper:sensitive-label";

    recorder.enqueue({ ...raw, order });

    await expect(recorder.flush()).resolves.toEqual({
      certain: false,
      reasonCodes: ["CTRADER_FIELD_INVALID:utcLastUpdateTimestamp"],
    });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith({
      reasonCode: "CTRADER_FIELD_INVALID:utcLastUpdateTimestamp",
      stage: "NORMALIZE",
      executionType: 2,
      orderStatus: 1,
      hasOrder: true,
      hasPosition: false,
      hasDeal: false,
      hasClientOrderId: true,
      hasOrderLabel: true,
    });
    expect(JSON.stringify(onFailure.mock.calls)).not.toMatch(
      /sensitive-identifier|sensitive-label|invalid-secret-value/,
    );
    expect(store.events).toEqual([]);
  });

  it("maps an untrusted persistence error to a stable generic reason", async () => {
    const store = new MemoryStore();
    vi.spyOn(store, "persist").mockRejectedValue(
      new Error("database rejected value sensitive-row-identifier"),
    );
    const onFailure = vi.fn();
    const recorder = new DurableDemoExecutionRecorder(store, {
      symbolId: "7",
      onFailure,
    });
    recorder.enqueue(await fixture("demo-order-accepted-v1.json"));

    await expect(recorder.flush()).resolves.toEqual({
      certain: false,
      reasonCodes: ["DEMO_EXECUTION_PERSISTENCE_FAILED"],
    });
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "DEMO_EXECUTION_PERSISTENCE_FAILED",
        stage: "PERSIST",
      }),
    );
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(
      "sensitive-row-identifier",
    );
  });

  it("clears a persisted reason after the store reports it resolved", async () => {
    const store = new MemoryStore();
    const recorder = new DurableDemoExecutionRecorder(store, { symbolId: "7" });
    store.result = {
      certain: false,
      reasonCodes: ["DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED"],
    };
    recorder.enqueue(await fixture("demo-order-partial-fill-v1.json"));
    await expect(recorder.flush()).resolves.toEqual(store.result);

    store.result = { certain: true, reasonCodes: [] };
    recorder.enqueue(await fixture("demo-order-filled-v1.json"));
    await expect(recorder.flush()).resolves.toEqual(store.result);
  });
});
