import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

export * from "./runtime-controls.js";
export * from "./registry.js";

const { Pool } = pg;
const MIGRATION_LOCK = 4_287_319_004;

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly poolMin?: number;
  readonly poolMax?: number;
  readonly sslMode?: "require" | "disable";
}

export interface MigrationRecord {
  readonly version: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export function databaseConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
      throw new Error("DATABASE_URL_PROTOCOL_INVALID");
    // TLS is configured explicitly on pg.Pool below. Removing sslmode avoids
    // inheriting pg/libpq compatibility semantics that change between majors.
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "DATABASE_URL_PROTOCOL_INVALID"
    )
      throw error;
    throw new Error("DATABASE_URL_INVALID", { cause: error });
  }
}

export function createPool(options: DatabaseOptions): pg.Pool {
  if (!options.connectionString) {
    throw new Error("DATABASE_URL_REQUIRED");
  }
  return new Pool({
    connectionString: databaseConnectionString(options.connectionString),
    min: options.poolMin ?? 1,
    max: options.poolMax ?? 10,
    ssl: options.sslMode === "disable" ? false : { rejectUnauthorized: true },
    application_name: "ctrader-ai-scalper",
  });
}

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

export async function migrationFiles(
  directory: string,
): Promise<readonly string[]> {
  return (await readdir(directory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));
}

export async function appliedMigrations(
  pool: pg.Pool,
): Promise<readonly MigrationRecord[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const result = await pool.query<{
    version: string;
    checksum: string;
    applied_at: Date;
  }>(
    "SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version",
  );
  return result.rows.map((row) => ({
    version: row.version,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
}

export async function migrate(
  pool: pg.Pool,
  directory: string,
): Promise<readonly string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations",
    );
    const known = new Map(
      existing.rows.map((row) => [row.version, row.checksum]),
    );
    for (const file of await migrationFiles(directory)) {
      const version = file.slice(0, 4);
      const sql = await readFile(path.join(directory, file), "utf8");
      const sqlChecksum = checksum(sql);
      const oldChecksum = known.get(version);
      if (oldChecksum !== undefined) {
        if (oldChecksum !== sqlChecksum) {
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${version}`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [version, sqlChecksum],
        );
        await client.query("COMMIT");
        applied.push(version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK])
      .catch(() => undefined);
    client.release();
  }
  return applied;
}
