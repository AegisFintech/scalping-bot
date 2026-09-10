import { mkdir, rename, writeFile } from "node:fs/promises";
import { waitForDatabase } from "../../../packages/database/src/availability.js";
import type pg from "pg";

export async function databaseStartup(pool: pg.Pool): Promise<boolean> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    return await waitForDatabase({
      probe: () => pool.query("SELECT 1"),
      signal: controller.signal,
      observe: async (status) => {
        try {
          await mkdir(".runtime", { recursive: true, mode: 0o700 });
          await writeFile(
            ".runtime/database-status.json.tmp",
            JSON.stringify({ version: 1, ...status }),
            { mode: 0o600 },
          );
          await rename(
            ".runtime/database-status.json.tmp",
            ".runtime/database-status.json",
          );
        } catch {
          // Dashboard observations have no authority to block a healthy journal.
          process.stderr.write("DATABASE_STATUS_STORAGE_UNAVAILABLE\n");
        }
      },
    });
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
