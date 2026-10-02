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
const previousExitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/review");
  process.argv = [
    "node",
    "review",
    "0.3.0-fade-limit.3",
    "2026-09-25T00:00:00Z",
    "2026-10-02T00:00:00Z",
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
  process.exitCode = previousExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("opens a bounded read-only snapshot, rolls back, and exports no IDs", async () => {
  await import("../../scripts/review-demo-learning.js");
  const sql = db.query.mock.calls.map(([q]) => q as string);
  expect(sql[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  expect(sql.at(-1)).toBe("ROLLBACK");
  expect(sql.some((q) => /\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/.test(q))).toBe(
    false,
  );
  expect(sql.join("\n")).toContain("statement_timeout = '15s'");
  expect(sql.join("\n")).toContain("LIMIT 10001");
  expect(db.end).toHaveBeenCalledOnce();
  const report = JSON.parse(
    vi.mocked(console.log).mock.calls[0]?.[0] as string,
  ) as {
    summary: { trades: number };
    providerCost: null;
  };
  expect(report.summary.trades).toBe(0);
  expect(report.providerCost).toBeNull();
});

it("refuses mixed scopes before reading outcomes", async () => {
  db.query.mockImplementation((sql: string) => ({
    rows: sql.includes("scopes") ? [{ scopes: "2" }] : [],
  }));
  await import("../../scripts/review-demo-learning.js");
  expect(console.error).toHaveBeenCalledWith("LEARNING_MULTIPLE_SCOPES");
  expect(console.log).not.toHaveBeenCalled();
  expect(
    db.query.mock.calls.some(([q]) => String(q).includes("LIMIT 10001")),
  ).toBe(false);
  expect(process.exitCode).toBe(1);
  expect(db.end).toHaveBeenCalledOnce();
});

it("does not log private database exceptions or produce a partial report", async () => {
  db.query.mockRejectedValueOnce(
    new Error("private database connection detail"),
  );
  await import("../../scripts/review-demo-learning.js");
  expect(console.error).toHaveBeenCalledWith(
    "LEARNING_REVIEW_FAILED: database read or evidence validation failed",
  );
  expect(console.log).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(db.end).toHaveBeenCalledOnce();
});

it("refuses an oversized window instead of silently truncating statistics", async () => {
  db.query.mockImplementation((sql: string) => ({
    rows: sql.includes("scopes")
      ? [{ scopes: "1" }]
      : sql.includes("LIMIT 10001")
        ? Array.from({ length: 10001 }, () => ({}))
        : [],
  }));
  await import("../../scripts/review-demo-learning.js");
  expect(console.error).toHaveBeenCalledWith("LEARNING_WINDOW_TOO_LARGE");
  expect(console.log).not.toHaveBeenCalled();
  expect(db.end).toHaveBeenCalledOnce();
});
