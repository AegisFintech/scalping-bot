import { describe, expect, it, vi } from "vitest";
import {
  waitForDatabase,
  type DatabaseAvailability,
} from "../../packages/database/src/availability.js";

describe("database startup recovery", () => {
  it("propagates status-storage failure without treating it as a database outage", async () => {
    const probe = vi.fn().mockResolvedValue({});
    const observe = vi.fn().mockRejectedValue(new Error("STORAGE_UNAVAILABLE"));
    await expect(
      waitForDatabase({ probe, observe, signal: new AbortController().signal }),
    ).rejects.toThrow("STORAGE_UNAVAILABLE");
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it("keeps broker startup waiting, reports a safe quota reason, and recovers", async () => {
    const quota = Object.assign(
      new Error("Your account or project has exceeded the compute time quota."),
      { code: "53000" },
    );
    const probe = vi
      .fn()
      .mockRejectedValueOnce(quota)
      .mockRejectedValueOnce(new Error("private driver details"))
      .mockResolvedValueOnce({});
    const statuses: DatabaseAvailability[] = [];
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(
      await waitForDatabase({
        probe,
        observe: (value) => {
          statuses.push(value);
          return Promise.resolve();
        },
        signal: new AbortController().signal,
        wait,
      }),
    ).toBe(true);
    expect(statuses.map((value) => value.reason)).toEqual([
      "DATABASE_COMPUTE_QUOTA",
      "DATABASE_UNAVAILABLE",
      null,
    ]);
    expect(wait.mock.calls.map((call) => Number(call[0]))).toEqual([
      1000, 2000,
    ]);
    expect(JSON.stringify(statuses)).not.toContain("private");
  });
  it("caps retries and stops without pretending the database is ready", async () => {
    const controller = new AbortController();
    const waits: number[] = [];
    const probe = vi.fn().mockRejectedValue(new Error("unavailable"));
    const result = await waitForDatabase({
      probe,
      observe: () => Promise.resolve(),
      signal: controller.signal,
      wait: (milliseconds) => {
        waits.push(milliseconds);
        if (waits.length === 8) controller.abort();
        return Promise.resolve();
      },
    });
    expect(result).toBe(false);
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(probe).toHaveBeenCalledTimes(8);
  });
});
