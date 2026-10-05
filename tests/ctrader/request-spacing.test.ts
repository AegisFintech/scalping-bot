import { afterEach, expect, it, vi } from "vitest";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";
import { CTraderPayload } from "../../packages/ctrader-client/src/protocol.js";

afterEach(() => vi.useRealTimers());

it.each([
  [CTraderPayload.SYMBOLS_LIST_REQ, 25],
  [CTraderPayload.GET_TRENDBARS_REQ, 210],
])(
  "spaces concurrent requests for payload %s",
  async (payloadType, spacing) => {
    vi.useFakeTimers();
    const transport = new CTraderJsonTransport({ host: "invalid.test" });
    const sent: number[] = [];
    vi.spyOn(transport, "send").mockImplementation(() => {
      sent.push(Date.now());
    });
    const requests = Array.from({ length: 10 }, () =>
      transport.request(payloadType, {}, [1]).catch(() => null),
    );
    await vi.advanceTimersByTimeAsync(spacing * 10);
    expect(sent).toHaveLength(10);
    for (let i = 1; i < sent.length; i++)
      expect(sent[i]! - sent[i - 1]!).toBeGreaterThanOrEqual(spacing);
    await transport.close();
    await Promise.all(requests);
  },
);
