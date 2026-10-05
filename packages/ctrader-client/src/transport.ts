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

export interface CTraderErrorDetails {
  readonly payloadType: number;
  readonly code: string | null;
  readonly description: string | null;
}

export function isCTraderRateLimitDetails(
  details: CTraderErrorDetails,
): boolean {
  const text =
    `${details.code ?? ""} ${details.description ?? ""}`.toUpperCase();
  return /RATE.?LIMIT|TOO.?MANY|THROTTL/.test(text);
}

function safeText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = Array.from(String(value), (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ? " "
      : character,
  )
    .join("")
    .trim();
  return text.length === 0 ? null : text.slice(0, maximumLength);
}

function firstText(
  payload: Record<string, unknown>,
  keys: readonly string[],
  maximumLength: number,
): string | null {
  for (const key of keys) {
    const value = safeText(payload[key], maximumLength);
    if (value !== null) return value;
  }
  return null;
}

export class CTraderRequestRejectedError extends Error {
  readonly details: CTraderErrorDetails;

  constructor(payloadType: number, payload: Record<string, unknown>) {
    super("CTRADER_REQUEST_REJECTED");
    this.name = "CTraderRequestRejectedError";
    this.details = {
      payloadType,
      code: firstText(payload, ["errorCode", "code"], 160),
      description: firstText(
        payload,
        ["description", "errorMessage", "message"],
        500,
      ),
    };
  }
}

export function cTraderErrorDetails(
  error: unknown,
): CTraderErrorDetails | null {
  return error instanceof CTraderRequestRejectedError ? error.details : null;
}

export interface CTraderTransportOptions {
  readonly host: string;
  readonly port?: number;
  readonly requestTimeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
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
  #generation = 0;
  #cancelConnect: (() => void) | null = null;
  #connectPromise: Promise<void> | null = null;
  #heartbeat: NodeJS.Timeout | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #reconnectAttempt = 0;
  #explicitClose = false;
  #reconnectHandler: (() => Promise<void>) | null = null;
  #historicalNextAt = 0;
  #regularNextAt = 0;
  #rateLimitBlockedUntil = 0;
  #rateLimitBackoffMs = 1_000;
  #admission: Promise<void> = Promise.resolve();

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
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#explicitClose = false;
    const generation = ++this.#generation;
    const attempt = this.#open(generation);
    this.#connectPromise = attempt;
    try {
      await attempt;
      if (generation !== this.#generation || !this.connected)
        throw new Error("CTRADER_CONNECTION_LOST_RECONCILIATION_REQUIRED");
      this.#reconnectAttempt = 0;
    } finally {
      // An older attempt must not clear a newer connection's shared promise.
      if (this.#connectPromise === attempt) this.#connectPromise = null;
    }
  }

  async #open(generation: number): Promise<void> {
    const url = `wss://${this.#options.host}:${this.#options.port ?? 5036}`;
    const socket = (
      this.#options.socketFactory ??
      ((target) => new WebSocket(target, { maxPayload: 4 * 1024 * 1024 }))
    )(url);
    this.#socket = socket;
    const current = (): boolean =>
      this.#socket === socket && this.#generation === generation;
    // Install identity-bound callbacks before opening can complete or fail.
    socket.on("error", () => undefined);
    socket.on("message", (data: RawData) => {
      if (current() && this.connected) this.#receive(data);
    });
    socket.on("close", () => {
      if (current()) this.#closed();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error): void => {
          clearTimeout(timeout);
          socket.off("open", onOpen);
          socket.off("error", onError);
          socket.off("close", onClose);
          if (this.#cancelConnect === cancel) this.#cancelConnect = null;
          if (error) reject(error);
          else resolve();
        };
        const onOpen = (): void => finish();
        const onError = (): void => finish(new Error("CTRADER_CONNECT_FAILED"));
        const onClose = (): void => finish(new Error("CTRADER_CONNECT_CLOSED"));
        const cancel = (): void =>
          finish(new Error("CTRADER_TRANSPORT_CLOSED"));
        const timeout = setTimeout(
          () => finish(new Error("CTRADER_CONNECT_TIMEOUT")),
          this.#options.handshakeTimeoutMs ??
            this.#options.requestTimeoutMs ??
            10_000,
        );
        this.#cancelConnect = cancel;
        socket.once("open", onOpen);
        socket.once("error", onError);
        socket.once("close", onClose);
      });
      if (!current() || this.#explicitClose || !this.connected)
        throw new Error("CTRADER_CONNECTION_LOST_RECONCILIATION_REQUIRED");
    } catch (error) {
      if (current()) {
        this.#socket = null;
        ++this.#generation;
        this.#rejectPending(
          new Error("CTRADER_CONNECTION_LOST_RECONCILIATION_REQUIRED"),
        );
      }
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      throw error;
    }
    this.#heartbeat = setInterval(() => {
      if (current() && this.connected) {
        try {
          this.send(CTraderPayload.HEARTBEAT_EVENT, {}, randomUUID());
        } catch {
          // Disconnect owns recovery; never replay broker commands.
        }
      }
    }, 10_000);
    this.#heartbeat.unref();
  }

  async close(): Promise<void> {
    this.#explicitClose = true;
    ++this.#generation;
    this.#cancelConnect?.();
    this.#connectPromise = null;
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    if (this.#heartbeat !== null) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    this.#rejectPending(new Error("CTRADER_TRANSPORT_CLOSED"));
    const socket = this.#socket;
    this.#socket = null;
    if (socket === null || socket.readyState === WebSocket.CLOSED) return;
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
      return;
    }
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timeout);
        socket.off("close", finish);
        resolve();
      };
      const timeout = setTimeout(finish, 2_000);
      socket.once("close", finish);
      socket.close(1000, "shutdown");
    });
  }

  async request(
    payloadType: number,
    payload: Record<string, unknown>,
    expectedPayloadTypes: readonly number[],
  ): Promise<CTraderEnvelope> {
    const generation = this.#generation;
    const clientMsgId = randomUUID();
    // Register before pacing: close and deadline reject unsent queued work too.
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
      const valid = (): void => {
        if (!this.#pending.has(clientMsgId))
          throw new Error(`CTRADER_REQUEST_TIMEOUT:${payloadType}`);
        if (generation !== this.#generation)
          throw new Error("CTRADER_CONNECTION_LOST_RECONCILIATION_REQUIRED");
      };
      void this.#rateLimit(
        payloadType === CTraderPayload.GET_TRENDBARS_REQ ||
          payloadType === CTraderPayload.DEAL_LIST_REQ ||
          payloadType === CTraderPayload.CASH_FLOW_HISTORY_LIST_REQ ||
          payloadType === CTraderPayload.ORDER_LIST_REQ,
        valid,
      )
        .then(() => {
          valid();
          this.send(payloadType, payload, clientMsgId);
        })
        .catch((error: unknown) => {
          clearTimeout(timeout);
          this.#pending.delete(clientMsgId);
          reject(
            error instanceof Error ? error : new Error("CTRADER_SEND_FAILED"),
          );
        });
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

  async #rateLimit(historical: boolean, valid: () => void): Promise<void> {
    const admission = this.#admission.then(async () => {
      valid();
      // Reject locally during cooldown: never queue an order until its price
      // authorization may have expired, and never replay a rejected command.
      if (Date.now() < this.#rateLimitBlockedUntil)
        throw new Error("CTRADER_RATE_LIMIT_COOLDOWN");
      const next = historical ? this.#historicalNextAt : this.#regularNextAt;
      if (next > Date.now())
        await new Promise((resolve) => setTimeout(resolve, next - Date.now()));
      valid();
      // A broker response can extend the cooldown while admission is waiting.
      if (Date.now() < this.#rateLimitBlockedUntil)
        throw new Error("CTRADER_RATE_LIMIT_COOLDOWN");
      if (historical) this.#historicalNextAt = Date.now() + 210;
      else this.#regularNextAt = Date.now() + 25;
    });
    this.#admission = admission.catch(() => undefined);
    await admission;
  }

  #noteRateLimit(details: CTraderErrorDetails): void {
    if (!isCTraderRateLimitDetails(details)) return;
    const now = Date.now();
    this.#rateLimitBlockedUntil = Math.max(
      this.#rateLimitBlockedUntil,
      now + this.#rateLimitBackoffMs,
    );
    this.#rateLimitBackoffMs = Math.min(this.#rateLimitBackoffMs * 2, 30_000);
  }

  #noteSuccessfulRequest(): void {
    if (Date.now() >= this.#rateLimitBlockedUntil) {
      this.#rateLimitBlockedUntil = 0;
      this.#rateLimitBackoffMs = 1_000;
    }
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
          const error = new CTraderRequestRejectedError(
            message.payloadType,
            message.payload,
          );
          this.#noteRateLimit(error.details);
          pending.reject(error);
        } else if (!pending.expectedPayloadTypes.has(message.payloadType)) {
          pending.reject(
            new Error(`CTRADER_RESPONSE_TYPE_MISMATCH:${message.payloadType}`),
          );
        } else {
          this.#noteSuccessfulRequest();
          pending.resolve(message);
        }
      }
    }
    for (const handler of this.#handlers) handler(message);
  }

  #closed(): void {
    ++this.#generation;
    this.#cancelConnect?.();
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
    const generation = this.#generation;
    this.#reconnectTimer = setTimeout(
      () => {
        this.#reconnectTimer = null;
        if (generation !== this.#generation || this.#explicitClose) return;
        const attemptGeneration = generation + 1;
        void this.connect()
          .then(async () => {
            if (
              attemptGeneration === this.#generation &&
              this.connected &&
              !this.#explicitClose
            )
              await this.#reconnectHandler?.();
          })
          .catch(() => {
            // A failed old authentication continuation cannot terminate a new socket.
            if (this.#explicitClose || this.#generation > attemptGeneration + 1)
              return;
            const socket = this.#socket;
            if (socket !== null && this.#generation === attemptGeneration)
              socket.terminate();
            else if (socket === null) this.#closed();
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
