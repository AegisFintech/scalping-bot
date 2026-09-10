import type pg from "pg";
import { writeFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { databaseStartup } from "../../apps/execution-service/src/database-startup.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => vi.restoreAllMocks());

it("does not make an observational status-file failure a trading blocker", async () => {
  vi.mocked(writeFile).mockRejectedValueOnce(new Error("private path"));
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const pool = { query: vi.fn().mockResolvedValue({}) } as unknown as pg.Pool;
  expect(await databaseStartup(pool)).toBe(true);
  expect(stderr).toHaveBeenCalledWith("DATABASE_STATUS_STORAGE_UNAVAILABLE\n");
});

it("does not authorize startup when interrupted during a failed database probe", async () => {
  const pool = {
    query: vi.fn(() => {
      process.emit("SIGINT");
      return Promise.reject(new Error("unavailable"));
    }),
  } as unknown as pg.Pool;
  expect(await databaseStartup(pool)).toBe(false);
});
