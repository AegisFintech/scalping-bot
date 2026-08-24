import path from "node:path";
import process from "node:process";

import "dotenv/config";

import { appliedMigrations, createPool, migrate } from "./index.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "migrate" && command !== "status") {
    throw new Error("usage: database cli migrate|status");
  }
  const pool = createPool({
    connectionString: process.env.DATABASE_URL ?? "",
    poolMin: Number(process.env.DATABASE_POOL_MIN ?? "1"),
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? "10"),
    sslMode:
      process.env.DATABASE_SSL_MODE === "disable" ? "disable" : "require",
  });
  try {
    if (command === "migrate") {
      const versions = await migrate(pool, path.resolve("migrations"));
      process.stdout.write(
        `applied migrations: ${versions.join(", ") || "none"}\n`,
      );
    } else {
      const records = await appliedMigrations(pool);
      process.stdout.write(
        `${records.map((record) => record.version).join("\n")}\n`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "unknown database error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
