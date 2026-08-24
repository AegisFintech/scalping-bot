import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import {
  CTraderPayload,
  parseEnvelope,
  type CTraderEnvelope,
} from "./protocol.js";

interface PendingRequest {
  readonly expectedPayloadTypes: ReadonlySet<number>;
  readonly resolve: (message: CTraderEnvelope) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export interface CTraderTransportOptions {
  readonly host: string;
  readonly port?: number;
  readonly requestTimeoutMs?: number;
  readonly reconnectMinMs?: number;
  readonly reconnectMaxMs?: number;
  readonly random?: () => number;
  readonly socketFactory?: (url: string) => WebSocket;
}

export type MessageHandler = (message: CTraderEnvelope) => void;

export class CTraderJsonTransport {
  readonly #options: CTraderTransportOptions;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #handlers = new Set<MessageHandler>();
  #socket: WebSocket | null = null;
  #connectPromise: Promise<void> | null = null;
  #heartbeat: NodeJS.Timeout | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #reconnectAttempt = 0;
  #explicitClose = false;
  #reconnectHandler: (() => Promise<void>) | null = null;
  #historicalNextAt = 0;
  #regularNextAt = 0;

  constructor(options: CTraderTransportOptions) {
    this.#options = options;
  }

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  onMessage(handler: MessageHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  setReconnectHandler(handler: () => Promise<void>): void {
    this.#reconnectHandler = handler;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.#connectPromise !== null) return this.#connectPromise;
    this.#explicitClose = false;
    this.#connectPromise = this.#open();
    try {
      await this.#connectPromise;
      this.#reconnectAttempt = 0;
    } finally {
      this.#connectPromise = null;
    }
  }

  async #open(): Promise<void> {
    const url = `wss://${this.#options.host}:${this.#options.port ?? 5036}`;
    const socket = (
      this.#options.socketFactory ??
      ((target) => new WebSocket(target, { maxPayload: 4 * 1024 * 1024 }))
    )(url);
    this.#socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        socket.off("error", onError);
        resolve();
      };
      const onError = (error: Error): void => {
        socket.off("open", onOpen);
        reject(error);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });
    socket.on("message", (data: RawData) => this.#receive(data));
    socket.on("close", () => this.#closed());
    socket.on("error", () => undefined);
    this.#heartbeat = setInterval(() => {
      if (this.connected) {
        try {
          this.send(CTraderPayload.HEARTBEAT_EVENT, {}, randomUUID());
        } catch {
          // The close handler owns reconnect; a heartbeat race must not crash the process.
        }
      }
    }, 10_000);
    this.#heartbeat.unref();
  }

  async close(): Promise<void> {
    this.#explicitClose = true;
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    if (this.#heartbeat !== null) clearInterval(this.#heartbeat);
    this.#rejectPending(new Error("CTRADER_TRANSPORT_CLOSED"));
    const socket = this.#socket;
    this.#socket = null;
    if (socket === null || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close(1000, "shutdown");
      setTimeout(resolve, 2_000).unref();
    });
  }

  async request(
    payloadType: number,
    payload: Record<string, unknown>,
    expectedPayloadTypes: readonly number[],
  ): Promise<CTraderEnvelope> {
    await this.#rateLimit(payloadType === CTraderPayload.GET_TRENDBARS_REQ);
    const clientMsgId = randomUUID();
    return new Promise<CTraderEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(clientMsgId);
        reject(new Error(`CTRADER_REQUEST_TIMEOUT:${payloadType}`));
      }, this.#options.requestTimeoutMs ?? 10_000);
      this.#pending.set(clientMsgId, {
        expectedPayloadTypes: new Set(expectedPayloadTypes),
        resolve,
        reject,
        timeout,
      });
      try {
        this.send(payloadType, payload, clientMsgId);
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(clientMsgId);
        reject(
          error instanceof Error ? error : new Error("CTRADER_SEND_FAILED"),
        );
      }
    });
  }

  send(
    payloadType: number,
    payload: Record<string, unknown>,
    clientMsgId: string,
  ): void {
    if (!this.connected || this.#socket === null)
      throw new Error("CTRADER_NOT_CONNECTED");
    this.#socket.send(JSON.stringify({ clientMsgId, payloadType, payload }));
  }

  async #rateLimit(historical: boolean): Promise<void> {
    const now = Date.now();
    const next = historical ? this.#historicalNextAt : this.#regularNextAt;
    if (next > now)
      await new Promise((resolve) => setTimeout(resolve, next - now));
    if (historical) this.#historicalNextAt = Math.max(now, next) + 200;
    else this.#regularNextAt = Math.max(now, next) + 20;
  }

  #receive(data: RawData): void {
    let message: CTraderEnvelope;
    try {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString("utf8")
          : data.toString("utf8");
      message = parseEnvelope(text);
    } catch {
      return;
    }
    if (message.clientMsgId !== undefined) {
      const pending = this.#pending.get(message.clientMsgId);
      if (pending !== undefined) {
        clearTimeout(pending.timeout);
        this.#pending.delete(message.clientMsgId);
        if (
          message.payloadType === CTraderPayload.ERROR_RES ||
          message.payloadType === CTraderPayload.ORDER_ERROR_EVENT
        ) {
          pending.reject(new Error("CTRADER_REQUEST_REJECTED"));
        } else if (!pending.expectedPayloadTypes.has(message.payloadType)) {
          pending.reject(
            new Error(`CTRADER_RESPONSE_TYPE_MISMATCH:${message.payloadType}`),
          );
        } else {
          pending.resolve(message);
        }
      }
    }
    for (const handler of this.#handlers) handler(message);
  }

  #closed(): void {
    this.#socket = null;
    if (this.#heartbeat !== null) clearInterval(this.#heartbeat);
    this.#rejectPending(
      new Error("CTRADER_CONNECTION_LOST_RECONCILIATION_REQUIRED"),
    );
    if (this.#explicitClose || this.#reconnectTimer !== null) return;
    const minimum = this.#options.reconnectMinMs ?? 1_000;
    const maximum = this.#options.reconnectMaxMs ?? 30_000;
    const exponential = Math.min(
      maximum,
      minimum * 2 ** this.#reconnectAttempt++,
    );
    const jitter = 0.5 + (this.#options.random ?? Math.random)();
    this.#reconnectTimer = setTimeout(
      () => {
        this.#reconnectTimer = null;
        void this.connect()
          .then(() => this.#reconnectHandler?.())
          .catch(() => {
            const socket = this.#socket;
            if (socket !== null && socket.readyState !== WebSocket.CLOSED)
              socket.terminate();
            else this.#closed();
          });
      },
      Math.round(exponential * jitter),
    );
    this.#reconnectTimer.unref();
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
