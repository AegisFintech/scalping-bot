import type { DemoExecutionPersistenceResult } from "./demo-execution.js";

export interface DemoExecutionRecoveryRunnerOptions {
  readonly recover: () => Promise<DemoExecutionPersistenceResult>;
  readonly intervalMs: number;
  readonly now?: () => number;
}

const INITIAL_RESULT: DemoExecutionPersistenceResult = {
  certain: false,
  reasonCodes: ["DEMO_EXECUTION_RECOVERY_NOT_RUN"],
};

export class DemoExecutionRecoveryRunner {
  readonly #options: DemoExecutionRecoveryRunnerOptions;
  #inFlight: Promise<DemoExecutionPersistenceResult> | null = null;
  #nextEligibleAt = 0;
  #result: DemoExecutionPersistenceResult = INITIAL_RESULT;
  #attemptCount = 0;

  constructor(options: DemoExecutionRecoveryRunnerOptions) {
    if (
      !Number.isSafeInteger(options.intervalMs) ||
      options.intervalMs < 5_000 ||
      options.intervalMs > 300_000
    ) {
      throw new Error("DEMO_EXECUTION_RECOVERY_INTERVAL_INVALID");
    }
    this.#options = options;
  }

  get result(): DemoExecutionPersistenceResult {
    return this.#result;
  }

  get attemptCount(): number {
    return this.#attemptCount;
  }

  run(force = false): Promise<DemoExecutionPersistenceResult> {
    if (this.#inFlight !== null) return this.#inFlight;
    const now = this.#options.now?.() ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      this.#result = {
        certain: false,
        reasonCodes: ["DEMO_EXECUTION_RECOVERY_CLOCK_INVALID"],
      };
      return Promise.resolve(this.#result);
    }
    if (!force && now < this.#nextEligibleAt)
      return Promise.resolve(this.#result);

    const nextEligibleAt = now + this.#options.intervalMs;
    if (!Number.isSafeInteger(nextEligibleAt)) {
      this.#result = {
        certain: false,
        reasonCodes: ["DEMO_EXECUTION_RECOVERY_CLOCK_INVALID"],
      };
      return Promise.resolve(this.#result);
    }
    this.#nextEligibleAt = nextEligibleAt;
    this.#attemptCount += 1;
    const attempt = Promise.resolve()
      .then(() => this.#options.recover())
      .catch((): DemoExecutionPersistenceResult => ({
        certain: false,
        reasonCodes: ["DEMO_EXECUTION_RECOVERY_RUN_FAILED"],
      }))
      .then((result) => {
        this.#result = result;
        return result;
      })
      .finally(() => {
        if (this.#inFlight === attempt) this.#inFlight = null;
      });
    this.#inFlight = attempt;
    return attempt;
  }

  async settled(): Promise<DemoExecutionPersistenceResult> {
    return this.#inFlight === null ? this.#result : this.#inFlight;
  }
}
