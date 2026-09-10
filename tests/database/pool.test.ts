import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createPool,
  databaseConnectionString,
} from "../../packages/database/src/index.js";

describe("database connection configuration", () => {
  it("removes URL sslmode because Pool supplies strict TLS explicitly", () => {
    const normalized = new URL(
      databaseConnectionString(
        "postgresql://user:password@db.example.test/app?sslmode=require&application_name=test",
      ),
    );

    expect(normalized.searchParams.has("sslmode")).toBe(false);
    expect(normalized.searchParams.get("application_name")).toBe("test");
  });

  it("rejects non-PostgreSQL URLs", () => {
    expect(() => databaseConnectionString("https://db.example.test")).toThrow(
      "DATABASE_URL_PROTOCOL_INVALID",
    );
  });
  it("loads a local root CA while retaining strict verification and removing URL overrides", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "scalper-ca-"));
    try {
      const certificate =
        "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n";
      const file = path.join(folder, "root.crt");
      await writeFile(file, certificate);
      const url = new URL(
        "postgresql://user:password@localhost/db?sslmode=verify-full",
      );
      url.searchParams.set("sslrootcert", file);
      const pool = createPool({ connectionString: url.toString() });
      expect(pool).toHaveProperty("options.ssl", {
        rejectUnauthorized: true,
        ca: certificate,
      });
      expect(
        new URL(databaseConnectionString(url.toString())).searchParams.has(
          "sslrootcert",
        ),
      ).toBe(false);
      await pool.end();
      expect(() =>
        createPool({ connectionString: url.toString(), sslMode: "disable" }),
      ).toThrow("DATABASE_CA_CONFIGURATION_INVALID");
      await rm(file);
      expect(() => createPool({ connectionString: url.toString() })).toThrow(
        "DATABASE_CA_UNAVAILABLE",
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it("rejects client certificate URL overrides", () => {
    expect(() =>
      databaseConnectionString(
        "postgresql://localhost/db?sslkey=/tmp/private.key",
      ),
    ).toThrow("DATABASE_CLIENT_CERT_UNSUPPORTED");
  });
});
