import { describe, expect, it } from "vitest";

import { databaseConnectionString } from "../../packages/database/src/index.js";

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
});
