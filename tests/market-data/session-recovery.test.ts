import { expect, it, vi } from "vitest";
import { SessionRecovery } from "../../apps/market-data-service/src/session-recovery.js";

it("bounds reconnection pressure and requires a successful probe for recovery", async () => {
  let now = 0;
  let healthy = false;
  const reconnect = vi.fn(() => Promise.resolve());
  const observe = vi.fn();
  const recovery = new SessionRecovery({
    probe: async () => {
      await Promise.resolve();
      if (!healthy) throw new Error("rejected");
    },
    reconnect,
    observe,
    now: () => now,
  });
  await recovery.check();
  await recovery.check();
  expect(reconnect).not.toHaveBeenCalled();
  await recovery.check();
  expect(reconnect).toHaveBeenCalledTimes(1);
  await recovery.check();
  expect(reconnect).toHaveBeenCalledTimes(1);
  now = 60_000;
  await recovery.check();
  expect(reconnect).toHaveBeenCalledTimes(2);
  healthy = true;
  await recovery.check();
  expect(observe).toHaveBeenCalledWith("MARKET_SESSION_RECOVERED", 5);
});

it("deduplicates concurrent probes and contains reconnect failures", async () => {
  const reconnect = vi.fn(async () => {
    await Promise.resolve();
    throw new Error("offline");
  });
  const probe = vi.fn(async () => {
    await Promise.resolve();
    throw new Error("unavailable");
  });
  const recovery = new SessionRecovery({
    probe,
    reconnect,
    observe: () => undefined,
  });
  await Promise.all([recovery.check(), recovery.check(), recovery.check()]);
  expect(probe).toHaveBeenCalledTimes(1);
  await recovery.check();
  await expect(recovery.check()).resolves.toBeUndefined();
  expect(reconnect).toHaveBeenCalledTimes(1);
  await recovery.drain();
  expect(probe).toHaveBeenCalledTimes(3);
});
