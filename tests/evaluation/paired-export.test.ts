import { afterEach, beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("pg", () => ({
  default: {
    Client: class {
      connect = db.connect;
      query = db.query;
      end = db.end;
    },
  },
}));
const argv = process.argv;
const exit = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/research");
  process.argv = [
    "node",
    "export",
    "0.3.0-fade-limit.3",
    "2026-09-21T00:00:00Z",
    "2026-10-02T02:00:00Z",
  ];
  process.exitCode = 0;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.query.mockImplementation((sql: string) => ({
    rows: sql.includes("scopes") ? [{ scopes: "1" }] : [],
  }));
});
afterEach(() => {
  process.argv = argv;
  process.exitCode = exit;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("uses one bounded read-only snapshot and projects causal clocks without raw broker fields", async () => {
  await import("../../scripts/export-paired-replay.js");
  const sql = db.query.mock.calls.map(([q]) => String(q));
  expect(sql[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  expect(sql.at(-1)).toBe("ROLLBACK");
  expect(sql.join("\n")).toContain("LIMIT 1001");
  expect(sql.join("\n")).toContain("sc.available_at");
  expect(sql.join("\n")).toContain("rd.decided_at <= og.created_at");
  expect(sql.join("\n")).toContain("e.execution_type=2");
  expect(sql.join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/);
  const payload = JSON.parse(
    vi.mocked(console.log).mock.calls[0]?.[0] as string,
  ) as { economics: unknown; label: string };
  expect(payload.economics).toBeNull();
  expect(payload.label).toBe("PAIRED_REPLAY_INPUT_V1");
  expect(db.end).toHaveBeenCalledOnce();
});
it.each(["2", "NaN", "-1"])(
  "rejects ambiguous or invalid scopes (%s)",
  async (scopes) => {
    db.query.mockImplementation((sql: string) => ({
      rows: sql.includes("scopes") ? [{ scopes }] : [],
    }));
    await import("../../scripts/export-paired-replay.js");
    expect(console.error).toHaveBeenCalledWith("PAIRED_SINGLE_SCOPE_REQUIRED");
    expect(console.log).not.toHaveBeenCalled();
  },
);
it("exports an explicitly empty cohort rather than failing a closed-market window", async () => {
  db.query.mockImplementation((sql: string) => ({
    rows: sql.includes("scopes") ? [{ scopes: "0" }] : [],
  }));
  await import("../../scripts/export-paired-replay.js");
  expect(console.error).not.toHaveBeenCalled();
  const payload = JSON.parse(
    vi.mocked(console.log).mock.calls[0]?.[0] as string,
  ) as { setups: unknown[] };
  expect(payload.setups).toEqual([]);
});
it("rejects inconsistent empty-scope evidence", async () => {
  db.query.mockImplementation((sql: string) => ({
    rows: sql.includes("scopes")
      ? [{ scopes: "0" }]
      : sql.includes("LIMIT 1001")
        ? [{}]
        : [],
  }));
  await import("../../scripts/export-paired-replay.js");
  expect(console.error).toHaveBeenCalledWith("PAIRED_SINGLE_SCOPE_REQUIRED");
});
it("rejects oversized exports without a partial result", async () => {
  db.query.mockImplementation((sql: string) => ({
    rows: sql.includes("scopes")
      ? [{ scopes: "1" }]
      : sql.includes("LIMIT 1001")
        ? Array.from({ length: 1001 }, () => ({}))
        : [],
  }));
  await import("../../scripts/export-paired-replay.js");
  expect(console.error).toHaveBeenCalledWith("PAIRED_TOO_MANY_SETUPS");
  expect(console.log).not.toHaveBeenCalled();
});
it("rejects a broad window before database reads", async () => {
  process.argv[3] = "2026-08-01T00:00:00Z";
  await import("../../scripts/export-paired-replay.js");
  expect(console.error).toHaveBeenCalledWith("PAIRED_WINDOW_TOO_LARGE");
  expect(db.connect).not.toHaveBeenCalled();
});
it("redacts database errors", async () => {
  db.query.mockRejectedValueOnce(new Error("private connection details"));
  await import("../../scripts/export-paired-replay.js");
  expect(console.error).toHaveBeenCalledWith("PAIRED_EXPORT_FAILED");
  expect(console.log).not.toHaveBeenCalled();
});
