import { setTimeout as delay } from "node:timers/promises";

export interface DatabaseAvailability {
  readonly state: "ready" | "waiting";
  readonly reason: "DATABASE_COMPUTE_QUOTA" | "DATABASE_UNAVAILABLE" | null;
  readonly retryInMs: number;
  readonly observedAt: string;
}

/** Startup only: no broker clients exist until the database probe succeeds. */
export async function waitForDatabase(options: {
  probe: () => Promise<unknown>;
  observe: (status: DatabaseAvailability) => Promise<void>;
  signal: AbortSignal;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<boolean> {
  let attempt = 0;
  while (!options.signal.aborted) {
    try {
      await options.probe();
    } catch (error) {
      if (options.signal.aborted) return false;
      const quota =
        error instanceof Error &&
        "code" in error &&
        error.code === "53000" &&
        error.message.includes("compute time quota");
      const retryInMs = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
      await options.observe({
        state: "waiting",
        reason: quota ? "DATABASE_COMPUTE_QUOTA" : "DATABASE_UNAVAILABLE",
        retryInMs,
        observedAt: new Date().toISOString(),
      });
      try {
        await (
          options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }))
        )(retryInMs, options.signal);
      } catch (waitError) {
        if (options.signal.aborted) return false;
        throw waitError;
      }
      continue;
    }
    if (options.signal.aborted) return false;
    await options.observe({
      state: "ready",
      reason: null,
      retryInMs: 0,
      observedAt: new Date().toISOString(),
    });
    return true;
  }
  return false;
}
