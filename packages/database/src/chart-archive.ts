import type pg from "pg";
import { CHART_DIRECTORY, readChart } from "./chart-store.js";
export type ChartArchiveEntry = { id: string; digest: string; bytes: number };

/** Lossless, conditional and resumable; callers require operator review. */
export async function transitionCharts(
  pool: pg.Pool,
  entries: readonly ChartArchiveEntry[],
  mode: "relocate" | "restore",
  directory = CHART_DIRECTORY,
): Promise<number> {
  if (
    entries.some(
      (e) =>
        !/^[0-9a-f-]{36}$/.test(e.id) ||
        !/^[0-9a-f]{64}$/.test(e.digest) ||
        !Number.isSafeInteger(e.bytes),
    ) ||
    new Set(entries.map((e) => e.id)).size !== entries.length
  )
    throw new Error("CHART_MANIFEST_INVALID");
  for (const entry of entries) {
    if ((await readChart(entry.digest, directory)).length !== entry.bytes)
      throw new Error("CHART_ARCHIVE_SIZE_MISMATCH");
  }
  let changed = 0;
  for (const row of entries) {
    const bytes = await readChart(row.digest, directory);
    const result =
      mode === "relocate"
        ? await pool.query(
            `UPDATE analysis_chart_artifacts SET image_bytes = NULL, storage_kind = 'local_sha256'
         WHERE id = $1 AND image_sha256 = $2 AND storage_kind = 'database' AND image_bytes = $3`,
            [row.id, row.digest, bytes],
          )
        : await pool.query(
            `UPDATE analysis_chart_artifacts SET image_bytes = $3, storage_kind = 'database'
         WHERE id = $1 AND image_sha256 = $2 AND storage_kind = 'local_sha256' AND image_bytes IS NULL`,
            [row.id, row.digest, bytes],
          );
    if (!result.rowCount) {
      const existing = (
        await pool.query<{
          storage_kind: string;
          image_bytes: Buffer | null;
        }>(
          "SELECT storage_kind, image_bytes FROM analysis_chart_artifacts WHERE id = $1 AND image_sha256 = $2",
          [row.id, row.digest],
        )
      ).rows[0];
      const done =
        mode === "relocate"
          ? existing?.storage_kind === "local_sha256" &&
            existing.image_bytes === null
          : existing?.storage_kind === "database" &&
            existing.image_bytes?.equals(bytes);
      if (!done) throw new Error("CHART_TRANSITION_CONFLICT");
    }
    changed += result.rowCount ?? 0;
  }

  return changed;
}
