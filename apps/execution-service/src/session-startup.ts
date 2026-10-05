import { setTimeout as delay } from "node:timers/promises";

/** Keep transient session dependency failures inside one startup process. */
export async function waitForSession<T>(options: {
  read: () => Promise<T>;
  signal: AbortSignal;
  observe: (attempt: number, retryMs: number) => void;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<T | null> {
  let attempt = 0;
  while (!options.signal.aborted) {
    try {
      const value = await options.read();
      return options.signal.aborted ? null : value;
    } catch {
      if (options.signal.aborted) return null;
      const retryMs = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
      options.observe(attempt, retryMs);
      try {
        await (
          options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }))
        )(retryMs, options.signal);
      } catch (error) {
        if (options.signal.aborted) return null;
        throw error;
      }
    }
  }
  return null;
}
