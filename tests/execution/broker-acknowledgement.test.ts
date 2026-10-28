import { describe, expect, it, vi } from "vitest";
import { projectBrokerAcknowledgement } from "../../apps/execution-service/src/broker-acknowledgement.js";
import {
  DurableDemoExecutionRecorder,
  normalizeDemoExecution,
} from "../../apps/execution-service/src/demo-execution.js";
import type { BrokerExecution } from "../../packages/ctrader-client/src/client.js";

function callback(): BrokerExecution {
  return {
    executionType: 2,
    order: {
      orderId: "501",
      orderType: 6,
      orderStatus: 1,
      clientOrderId: "cas-buy-111111111111111111111111",
      tradeData: { symbolId: "7", volume: "100", tradeSide: 1 },
      utcLastUpdateTimestamp: 1787544000000,
      stopPrice: 4000.5,
      slippageInPoints: "30",
      timeInForce: 1,
      expirationTimestamp: "1787544300000",
    },
    position: null,
    deal: null,
    errorCode: null,
    receivedAt: "2026-08-24T04:00:00.100Z",
  };
}
function project(raw: BrokerExecution) {
  const event = normalizeDemoExecution(raw, { symbolId: "7" });
  expect(event).not.toBeNull();
  return projectBrokerAcknowledgement(raw, event!);
}

describe("prospective acknowledgement projection", () => {
  it("preserves optional broker fields and separate clocks without changing the event hash", () => {
    const raw = callback();
    const event = normalizeDemoExecution(raw, { symbolId: "7" })!;
    const result = projectBrokerAcknowledgement(raw, event)!;
    expect(result).toMatchObject({
      stopPrice: "4000.5",
      slippageInPoints: "30",
      timeInForce: 1,
      expirationTimestamp: "2026-08-24T04:05:00.000Z",
      brokerUpdatedAt: "2026-08-24T04:00:00.000Z",
      receivedAt: "2026-08-24T04:00:00.100Z",
      invalidFields: [],
    });
    const revised = { ...raw, order: { ...raw.order!, stopPrice: 4000.6 } };
    expect(normalizeDemoExecution(revised, { symbolId: "7" })!.eventKey).toBe(
      event.eventKey,
    );
    expect(project(revised)!.evidenceHash).not.toBe(result.evidenceHash);
  });
  it("does not infer omitted or invalid fields", () => {
    const raw = callback();
    raw.order!.slippageInPoints = "invalid";
    delete raw.order!.stopPrice;
    raw.order!.timeInForce = 9;
    raw.order!.expirationTimestamp = "9999999999999999999";
    expect(project(raw)).toMatchObject({
      stopPrice: null,
      slippageInPoints: null,
      timeInForce: null,
      expirationTimestamp: null,
      invalidFields: ["slippageInPoints", "timeInForce", "expirationTimestamp"],
    });
  });
  it("marks values outside the export contract unavailable without rejecting the callback", async () => {
    const raw = callback();
    raw.order!.stopPrice = "4000.12345678901";
    raw.order!.expirationTimestamp = "253402300800000";
    const result = project(raw)!;
    expect(result.stopPrice).toBeNull();
    expect(result.expirationTimestamp).toBeNull();
    expect(result.invalidFields).toEqual(["stopPrice", "expirationTimestamp"]);
    const persist = vi
      .fn()
      .mockResolvedValue({ certain: true, reasonCodes: [] });
    const recorder = new DurableDemoExecutionRecorder(
      {
        persist,
        readiness: () => Promise.resolve({ certain: true, reasonCodes: [] }),
      },
      { symbolId: "7" },
    );
    recorder.enqueue(raw);
    await expect(recorder.flush()).resolves.toEqual({
      certain: true,
      reasonCodes: [],
    });
    expect(persist).toHaveBeenCalledWith(
      expect.anything(),
      "BROKER_CALLBACK",
      expect.objectContaining({
        stopPrice: null,
        invalidFields: ["stopPrice", "expirationTimestamp"],
      }),
    );
  });
  it("sends the callback projection with the unchanged normalized event", async () => {
    const raw = callback();
    const persist = vi
      .fn()
      .mockResolvedValue({ certain: true, reasonCodes: [] });
    const recorder = new DurableDemoExecutionRecorder(
      {
        persist,
        readiness: () => Promise.resolve({ certain: true, reasonCodes: [] }),
      },
      { symbolId: "7" },
    );
    recorder.enqueue(raw);
    await expect(recorder.flush()).resolves.toEqual({
      certain: true,
      reasonCodes: [],
    });
    expect(persist).toHaveBeenCalledWith(
      normalizeDemoExecution(raw, { symbolId: "7" }),
      "BROKER_CALLBACK",
      expect.objectContaining({ stopPrice: "4000.5" }),
    );
  });
  it("does not capture a cancellation as an acceptance", () => {
    const raw = callback();
    const event = normalizeDemoExecution(raw, { symbolId: "7" })!;
    expect(
      projectBrokerAcknowledgement({ ...raw, executionType: 5 }, event),
    ).toBeNull();
  });
});
