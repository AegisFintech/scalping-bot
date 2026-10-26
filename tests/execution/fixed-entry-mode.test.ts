import { randomUUID } from "node:crypto";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { EntryModeStore } from "../../apps/execution-service/src/entry-mode-store.js";

function fixture(mode = "OCO_STOP_LIMIT") {
  const query = vi.fn().mockResolvedValue({
    rowCount: 1,
    rows: [{ entry_mode: mode, revision: randomUUID() }],
  });
  return {
    query,
    store: new EntryModeStore({ query } as unknown as pg.Pool, {
      accountId: "fixture",
      symbolId: "fixture",
      mode: "demo",
    }),
  };
}
describe("fixed trend-direction admission", () => {
  it("admits the persisted single STOP_LIMIT revision", async () => {
    const { store } = fixture();
    expect((await store.readForAdmission()).mode).toBe("OCO_STOP_LIMIT");
  });
  it.each(["SINGLE_LIMIT", "OCO_LIMIT", "SINGLE_STOP_LIMIT"])(
    "withholds new %s admission without rewriting historical selection",
    async (mode) => {
      const { store, query } = fixture(mode);
      await expect(store.readForAdmission()).rejects.toThrow(
        "FIXED_OCO_STOP_LIMIT_MODE_REQUIRED",
      );
      expect((await store.read()).mode).toBe(mode);
      expect(
        query.mock.calls.every(
          ([sql]) => typeof sql === "string" && sql.startsWith("SELECT"),
        ),
      ).toBe(true);
    },
  );
  it("does not guess a mode on database failure or a missing row", async () => {
    const { store, query } = fixture();
    query.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(store.readForAdmission()).rejects.toThrow(
      "storage unavailable",
    );
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(store.readForAdmission()).rejects.toThrow(
      "ENTRY_MODE_UNAVAILABLE",
    );
  });
  it("initializes new scopes as STOP_LIMIT without overwriting an existing revision", async () => {
    const { store, query } = fixture();
    await store.initialize();
    expect(query.mock.calls[0]?.[0]).toContain("'OCO_STOP_LIMIT'");
    expect(query.mock.calls[0]?.[0]).toContain(
      "ON CONFLICT(account_id,symbol_id,environment) DO NOTHING",
    );
  });
});
