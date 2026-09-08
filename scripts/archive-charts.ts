import { transitionCharts } from "../packages/database/src/chart-archive.js";
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createPool } from "../packages/database/src/index.js";
import { readChart, writeChart } from "../packages/database/src/chart-store.js";

// Preparation is read-only in PostgreSQL. Relocation/restore require explicit
// operator review, an unchanged manifest, verified bytes and conditional updates.
const args = process.argv.slice(2);
const mode = args[0] ?? "prepare";
const manifestPath = ".runtime/backups/issue-079/chart-manifest.json";
const validMode = ["prepare", "relocate", "restore"].includes(mode);
if (
  !validMode ||
  args.length > 2 ||
  (mode !== "prepare" && args[1] !== "--operator-reviewed")
)
  throw new Error(
    "CHART_ARCHIVE_ARGUMENTS:prepare|relocate|restore; transitions require --operator-reviewed",
  );
const pool = createPool({
  connectionString: process.env.DATABASE_URL ?? "",
  poolMax: 1,
});
type Entry = { id: string; digest: string; bytes: number };
try {
  if (mode === "prepare") {
    await pool.query("SET default_transaction_read_only = on");
    const entries: Entry[] = [];
    let cursor = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const rows = (
        await pool.query<{
          id: string;
          image_sha256: string;
          image_bytes: Buffer | null;
        }>(
          `SELECT id::text, image_sha256, image_bytes FROM analysis_chart_artifacts
         WHERE id > $1 ORDER BY id LIMIT 100`,
          [cursor],
        )
      ).rows;
      if (!rows.length) break;
      for (const row of rows) {
        const bytes = row.image_bytes ?? (await readChart(row.image_sha256));
        await writeChart(bytes, row.image_sha256);
        entries.push({
          id: row.id,
          digest: row.image_sha256,
          bytes: bytes.length,
        });
        cursor = row.id;
      }
    }
    const totalBytes = entries.reduce((sum, row) => sum + row.bytes, 0);
    const manifest = JSON.stringify({
      version: 1,
      preparedAt: new Date().toISOString(),
      totalBytes,
      entries,
    });
    await mkdir(".runtime/backups/issue-079", { recursive: true, mode: 0o700 });
    await writeFile(manifestPath, manifest + "\n", { mode: 0o600, flag: "wx" });
    console.log(
      JSON.stringify({
        mode,
        rows: entries.length,
        totalBytes,
        manifestSha256: createHash("sha256")
          .update(manifest + "\n")
          .digest("hex"),
        databaseChanged: false,
      }),
    );
  } else {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      version: number;
      totalBytes: number;
      entries: Entry[];
    };
    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.entries) ||
      manifest.entries.some(
        (e) =>
          !/^[0-9a-f-]{36}$/.test(e.id) ||
          !/^[0-9a-f]{64}$/.test(e.digest) ||
          !Number.isSafeInteger(e.bytes),
      ) ||
      new Set(manifest.entries.map((e) => e.id)).size !==
        manifest.entries.length
    )
      throw new Error("CHART_MANIFEST_INVALID");
    // Verify the entire archive before the first database transition.
    let total = 0;
    for (const row of manifest.entries) {
      const bytes = await readChart(row.digest);
      if (bytes.length !== row.bytes)
        throw new Error("CHART_ARCHIVE_SIZE_MISMATCH");
      total += bytes.length;
    }
    if (total !== manifest.totalBytes)
      throw new Error("CHART_MANIFEST_TOTAL_INVALID");
    const changed = await transitionCharts(
      pool,
      manifest.entries,
      mode as "relocate" | "restore",
    );
    console.log(
      JSON.stringify({ mode, verified: manifest.entries.length, changed }),
    );
  }
} catch {
  console.error(
    "CHART_ARCHIVE_FAILED: inspect protected storage and database availability; no secrets logged",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
