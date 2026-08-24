import { createHash } from "node:crypto";

import pino, { type Logger } from "pino";

const SENSITIVE_KEY =
  /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|database[_-]?url|source[_-]?token|private[_-]?key)/i;
const SENSITIVE_QUERY_KEY =
  /(?:token|key|secret|password|authorization|signature)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CONNECTION_STRING =
  /\b(?:postgres(?:ql)?|redis|mongodb(?:\+srv)?):\/\/[^\s]+/gi;

export type LogValue =
  | null
  | boolean
  | number
  | string
  | readonly LogValue[]
  | { readonly [key: string]: LogValue };

export interface LogEvent {
  readonly event_name: string;
  readonly outcome: string;
  readonly reason_code?: string;
  readonly [key: string]: LogValue | undefined;
}

export function redactString(value: string): string {
  let output = value
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(CONNECTION_STRING, "[REDACTED_URL]");
  try {
    const parsed = new URL(output);
    if (parsed.username || parsed.password) {
      parsed.username = "[REDACTED]";
      parsed.password = "[REDACTED]";
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key))
        parsed.searchParams.set(key, "[REDACTED]");
    }
    output = parsed.toString();
  } catch {
    // Most log strings are not URLs.
  }
  return output;
}

export function redact(value: LogValue, key = ""): LogValue {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value))
    return (value as readonly LogValue[]).map((item) => redact(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redact(child, childKey),
      ]),
    );
  }
  return value;
}

export function pseudonym(value: string, salt: string): string {
  return createHash("sha256")
    .update(salt)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

export interface BetterStackOptions {
  readonly enabled: boolean;
  readonly ingestingHost: string;
  readonly sourceToken: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class BetterStackTransport {
  readonly #options: BetterStackOptions;

  constructor(options: BetterStackOptions) {
    this.#options = options;
  }

  get configured(): boolean {
    if (!this.#options.enabled) return false;
    try {
      return (
        new URL(this.#options.ingestingHost).protocol === "https:" &&
        this.#options.sourceToken.length > 0
      );
    } catch {
      return false;
    }
  }

  async send(event: LogValue): Promise<boolean> {
    if (!this.configured) return false;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.#options.timeoutMs ?? 5_000,
    );
    try {
      const fetchImpl = this.#options.fetchImpl ?? fetch;
      const response = await fetchImpl(this.#options.ingestingHost, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#options.sourceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(redact(event)),
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface LoggerOptions {
  readonly service: string;
  readonly instanceId: string;
  readonly environment: string;
  readonly tradingMode: string;
  readonly level?: string;
  readonly logFile?: string;
  readonly betterStack?: BetterStackTransport;
}

export class StructuredLogger {
  readonly #logger: Logger;
  readonly #remote: BetterStackTransport | undefined;
  readonly #base: Record<string, string>;

  constructor(options: LoggerOptions) {
    this.#base = {
      service: options.service,
      instance_id: options.instanceId,
      environment: options.environment,
      trading_mode: options.tradingMode,
    };
    const transport = options.logFile
      ? pino.transport({
          target: "pino-roll",
          options: {
            file: options.logFile,
            frequency: "daily",
            size: "20m",
            mkdir: true,
          },
        })
      : undefined;
    this.#logger = pino(
      { level: options.level ?? "info", base: this.#base },
      transport,
    );
    this.#remote = options.betterStack;
  }

  log(
    level: "debug" | "info" | "warn" | "error" | "fatal",
    event: LogEvent,
  ): void {
    const safe = redact(event as unknown as LogValue) as Record<
      string,
      unknown
    >;
    this.#logger[level](safe);
    if (this.#remote !== undefined) {
      void this.#remote.send({ ...this.#base, ...safe } as LogValue);
    }
  }
}
