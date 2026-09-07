import { describe, expect, it, vi } from "vitest";
import { IndependentMaintenance } from "../../apps/execution-service/src/independent-maintenance.js";

describe("model-independent maintenance", () => {
  it("continues expiry/reconciliation while an analysis promise is unresolved", async () => {
    let resolveModel: (() => void) | undefined;
    let analysisCompleted = false;
    const model = new Promise<void>((resolve) => {
      resolveModel = resolve;
    }).then(() => {
      analysisCompleted = true;
    });
    const work = vi.fn().mockResolvedValue(undefined);
    const maintenance = new IndependentMaintenance(work);
    await maintenance.run();
    await maintenance.run();
    expect(work).toHaveBeenCalledTimes(2);
    expect(analysisCompleted).toBe(false);
    resolveModel?.();
    await model;
    expect(analysisCompleted).toBe(true);
  });
  it("serializes overlapping ticks and recovers after a failed pass", async () => {
    let release: (() => void) | undefined;
    const work = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("DISCONNECTED"))
      .mockResolvedValue(undefined);
    const maintenance = new IndependentMaintenance(work);
    const first = maintenance.run();
    const second = maintenance.run();
    expect(work).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all([first, second]);
    await expect(maintenance.run()).rejects.toThrow("DISCONNECTED");
    await expect(maintenance.run()).resolves.toBeUndefined();
  });
});
