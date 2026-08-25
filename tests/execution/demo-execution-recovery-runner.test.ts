import { describe, expect, it, vi } from "vitest";

import { DemoExecutionRecoveryRunner } from "../../apps/execution-service/src/demo-execution-recovery-runner.js";

describe("periodic demo execution recovery", () => {
  it("runs once per cadence and permits an explicit synchronization refresh", async () => {
    let now = 10_000;
    const recover = vi.fn().mockResolvedValue({
      certain: true,
      reasonCodes: [],
    });
    const runner = new DemoExecutionRecoveryRunner({
      recover,
      intervalMs: 15_000,
      now: () => now,
    });

    await expect(runner.run()).resolves.toEqual({
      certain: true,
      reasonCodes: [],
    });
    now += 14_999;
    await runner.run();
    expect(recover).toHaveBeenCalledTimes(1);

    await runner.run(true);
    expect(recover).toHaveBeenCalledTimes(2);
    now += 15_000;
    await runner.run();
    expect(recover).toHaveBeenCalledTimes(3);
  });

  it("serializes concurrent timer and synchronization attempts", async () => {
    let release!: (value: { certain: boolean; reasonCodes: string[] }) => void;
    const recover = vi.fn(
      () =>
        new Promise<{ certain: boolean; reasonCodes: string[] }>((resolve) => {
          release = resolve;
        }),
    );
    const runner = new DemoExecutionRecoveryRunner({
      recover,
      intervalMs: 15_000,
      now: () => 10_000,
    });

    const scheduled = runner.run();
    const synchronized = runner.run(true);
    await Promise.resolve();
    expect(recover).toHaveBeenCalledTimes(1);
    release({ certain: true, reasonCodes: [] });

    await expect(scheduled).resolves.toEqual({
      certain: true,
      reasonCodes: [],
    });
    await expect(synchronized).resolves.toEqual({
      certain: true,
      reasonCodes: [],
    });
    await expect(runner.settled()).resolves.toEqual({
      certain: true,
      reasonCodes: [],
    });
  });

  it("fails closed on a thrown recovery and validates its cadence", async () => {
    const runner = new DemoExecutionRecoveryRunner({
      recover: vi.fn().mockImplementation(() => {
        throw new Error("private broker detail");
      }),
      intervalMs: 15_000,
      now: () => 10_000,
    });
    await expect(runner.run()).resolves.toEqual({
      certain: false,
      reasonCodes: ["DEMO_EXECUTION_RECOVERY_RUN_FAILED"],
    });

    const invalidClock = new DemoExecutionRecoveryRunner({
      recover: vi.fn(),
      intervalMs: 15_000,
      now: () => Number.NaN,
    });
    await expect(invalidClock.run()).resolves.toEqual({
      certain: false,
      reasonCodes: ["DEMO_EXECUTION_RECOVERY_CLOCK_INVALID"],
    });
    expect(invalidClock.result).toEqual({
      certain: false,
      reasonCodes: ["DEMO_EXECUTION_RECOVERY_CLOCK_INVALID"],
    });

    expect(
      () =>
        new DemoExecutionRecoveryRunner({
          recover: vi.fn(),
          intervalMs: 4_999,
        }),
    ).toThrow("DEMO_EXECUTION_RECOVERY_INTERVAL_INVALID");
    expect(
      () =>
        new DemoExecutionRecoveryRunner({
          recover: vi.fn(),
          intervalMs: 300_001,
        }),
    ).toThrow("DEMO_EXECUTION_RECOVERY_INTERVAL_INVALID");
  });
});
