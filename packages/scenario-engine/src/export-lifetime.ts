/** The existing bounded-expiry replay cannot honestly evaluate persistent orders. */
export function datedEvaluationPlans<
  T extends {
    available: Date;
    expires: Date | null;
    time_in_force: "GTD" | "GTC";
  },
>(rows: readonly T[]): T[] {
  for (const row of rows) {
    if (row.time_in_force === "GTC")
      throw new Error("EVALUATION_GTC_NOT_SUPPORTED");
    if (
      row.time_in_force !== "GTD" ||
      !(row.expires instanceof Date) ||
      !Number.isFinite(row.expires.getTime())
    )
      throw new Error("EVALUATION_LIFETIME_INVALID");
  }
  return rows.filter(
    (row) => row.expires !== null && row.available < row.expires,
  );
}
