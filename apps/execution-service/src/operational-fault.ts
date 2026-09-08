import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { stableFailureReason } from "./failure-reasons.js";

type Fault = { reasonCode: string; failedAt: string; retryAt: string };
/** Analysis backoff/status only. Protective maintenance never consults this gate. */
export class OperationalFault {
  #fault: Fault | null = null;
  constructor(
    readonly file: string,
    readonly now: () => number = Date.now,
  ) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (parsed !== null) {
        const value = parsed as Fault;
        if (
          !/^[A-Z][A-Z0-9_]{1,150}$/.test(value.reasonCode) ||
          !Number.isFinite(Date.parse(value.failedAt)) ||
          !Number.isFinite(Date.parse(value.retryAt))
        )
          throw new Error("OPERATIONAL_FAULT_STATE_INVALID");
        this.#fault = value;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.fail(new Error("OPERATIONAL_FAULT_STATE_UNAVAILABLE"));
    }
  }
  get snapshot(): Fault | null {
    return this.#fault;
  }
  get canRetry(): boolean {
    return (
      this.#fault === null || this.now() >= Date.parse(this.#fault.retryAt)
    );
  }
  fail(error: unknown): void {
    this.#fault = {
      reasonCode: stableFailureReason(error, "SCHEDULER_FAILED"),
      failedAt: new Date(this.now()).toISOString(),
      retryAt: new Date(this.now() + 60_000).toISOString(),
    };
    this.#persist();
  }
  recovered(): void {
    if (this.#fault === null) return;
    this.#fault = null;
    this.#persist();
  }
  #persist(): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, JSON.stringify(this.#fault), {
        mode: 0o600,
        flush: true,
      });
      renameSync(temp, this.file);
      const directory = openSync(path.dirname(this.file), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch {
      this.#fault = {
        reasonCode: "OPERATIONAL_FAULT_STATE_UNAVAILABLE",
        failedAt: new Date(this.now()).toISOString(),
        retryAt: new Date(this.now() + 60_000).toISOString(),
      };
    }
  }
}
