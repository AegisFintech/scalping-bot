import { expect, it, vi } from "vitest";
import { waitForSession } from "../../apps/execution-service/src/session-startup.js";

it("survives repeated failures with capped backoff then returns fresh evidence", async () => {
  const read = vi.fn(async () => {
    await Promise.resolve();
    if (read.mock.calls.length < 9) throw new Error("unavailable");
    return { state: "fresh" };
  });
  const waits: number[] = [];
  const result = await waitForSession({
    read,
    signal: new AbortController().signal,
    observe: () => undefined,
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  expect(result).toEqual({ state: "fresh" });
  expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

it("shutdown during recovery prevents further startup requests", async () => {
  const abort = new AbortController();
  const read = vi.fn(async () => {
    await Promise.resolve();
    throw new Error("unavailable");
  });
  expect(
    await waitForSession({
      read,
      signal: abort.signal,
      observe: () => undefined,
      wait: async () => {
        await Promise.resolve();
        abort.abort();
        throw new Error("aborted");
      },
    }),
  ).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
});
