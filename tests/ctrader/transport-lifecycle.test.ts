import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";
import { CTraderPayload } from "../../packages/ctrader-client/src/protocol.js";

class Socket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  sent: { payloadType: number; clientMsgId: string }[] = [];
  delayedClose = false;
  terminated = false;
  open() {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }
  send(raw: string) {
    const message = JSON.parse(raw) as {
      payloadType: number;
      clientMsgId: string;
    };
    this.sent.push(message);
  }
  close() {
    if (!this.delayedClose) {
      this.readyState = WebSocket.CLOSED;
      this.emit("close");
    }
  }
  terminate() {
    this.terminated = true;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
  reply(index = 0) {
    this.emit(
      "message",
      Buffer.from(
        JSON.stringify({ ...this.sent[index], payloadType: 1, payload: {} }),
      ),
    );
  }
}
function fixture(requestTimeoutMs = 1000) {
  const sockets: Socket[] = [];
  const transport = new CTraderJsonTransport({
    host: "invalid.test",
    requestTimeoutMs,
    handshakeTimeoutMs: 50,
    reconnectMinMs: 10000,
    reconnectMaxMs: 10000,
    socketFactory: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  const connect = async () => {
    const pending = transport.connect();
    sockets.at(-1)!.open();
    await pending;
  };
  const request = (type: number = CTraderPayload.SYMBOLS_LIST_REQ) =>
    transport
      .request(type, {}, [1])
      .catch((error: unknown) => (error as Error).message);
  return { transport, sockets, connect, request };
}
afterEach(() => vi.useRealTimers());
describe("connection-bound cTrader work", () => {
  it("rejects queued work on explicit close and never sends it on a new socket", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.connect();
    const first = f.request();
    await vi.advanceTimersByTimeAsync(0);
    const queued = f.request(CTraderPayload.NEW_ORDER_REQ);
    await f.transport.close();
    await f.connect();
    await vi.advanceTimersByTimeAsync(30);
    expect(await first).toBe("CTRADER_TRANSPORT_CLOSED");
    expect(await queued).toBe("CTRADER_TRANSPORT_CLOSED");
    expect(f.sockets[1]!.sent).toHaveLength(0);
    await f.transport.close();
  });
  it("rejects queued and dispatched work on involuntary disconnect", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.connect();
    const first = f.request();
    await vi.advanceTimersByTimeAsync(0);
    const queued = f.request();
    f.sockets[0]!.terminate();
    await f.connect();
    await vi.advanceTimersByTimeAsync(30);
    expect(await first).toBe("CTRADER_CONNECTION_LOST_RECONCILIATION_REQUIRED");
    expect(await queued).toBe(
      "CTRADER_CONNECTION_LOST_RECONCILIATION_REQUIRED",
    );
    expect(f.sockets[1]!.sent).toHaveLength(0);
    await f.transport.close();
  });
  it("starts the deadline before admission and never sends expired queued commands", async () => {
    vi.useFakeTimers();
    const f = fixture(20);
    await f.connect();
    const first = f.request();
    await vi.advanceTimersByTimeAsync(0);
    const queued = f.request(CTraderPayload.NEW_ORDER_REQ);
    await vi.advanceTimersByTimeAsync(30);
    expect(await first).toContain("CTRADER_REQUEST_TIMEOUT");
    expect(await queued).toContain("CTRADER_REQUEST_TIMEOUT");
    expect(f.sockets[0]!.sent).toHaveLength(1);
    await f.transport.close();
  });
  it("ignores delayed old closes and responses while new requests remain pending", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.connect();
    const old = f.sockets[0]!;
    old.delayedClose = true;
    const closed = f.transport.close();
    await vi.advanceTimersByTimeAsync(2000);
    await closed;
    await f.connect();
    const request = f.request();
    await vi.advanceTimersByTimeAsync(0);
    let completed = false;
    void request.then(() => {
      completed = true;
    });
    old.emit("close");
    old.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          ...f.sockets[1]!.sent[0],
          payloadType: 1,
          payload: {},
        }),
      ),
    );
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(f.transport.connected).toBe(true);
    f.sockets[1]!.reply();
    expect(await request).toEqual(expect.objectContaining({ payloadType: 1 }));
    await f.transport.close();
  });
  it("bounds silent handshakes, terminates them, and permits later recovery", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const connecting = f.transport
      .connect()
      .catch((e: unknown) => (e as Error).message);
    await vi.advanceTimersByTimeAsync(50);
    expect(await connecting).toBe("CTRADER_CONNECT_TIMEOUT");
    expect(f.sockets[0]!.terminated).toBe(true);
    f.sockets[0]!.open();
    expect(f.transport.connected).toBe(false);
    await f.connect();
    expect(f.transport.connected).toBe(true);
    await f.transport.close();
  });
  it("settles close-before-open and shutdown during handshake", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const connecting = f.transport
      .connect()
      .catch((e: unknown) => (e as Error).message);
    f.sockets[0]!.terminate();
    expect(await connecting).toMatch(
      /CTRADER_(TRANSPORT_CLOSED|CONNECT_CLOSED)/,
    );
    const second = f.transport
      .connect()
      .catch((e: unknown) => (e as Error).message);
    await f.transport.close();
    expect(await second).toBe("CTRADER_TRANSPORT_CLOSED");
    expect(f.sockets[1]!.terminated).toBe(true);
    await f.connect();
    await f.transport.close();
  });
  it("does not replay a broker-rejected command and rejects waiting work during cooldown", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.connect();
    const first = f.request();
    await vi.advanceTimersByTimeAsync(0);
    const queued = f.request(CTraderPayload.NEW_ORDER_REQ);
    f.sockets[0]!.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          ...f.sockets[0]!.sent[0],
          payloadType: CTraderPayload.ERROR_RES,
          payload: { errorCode: "RATE_LIMIT" },
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(30);
    expect(await first).toBe("CTRADER_REQUEST_REJECTED");
    expect(await queued).toBe("CTRADER_RATE_LIMIT_COOLDOWN");
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.sockets[0]!.sent).toHaveLength(1);
    await f.transport.close();
  });
});
