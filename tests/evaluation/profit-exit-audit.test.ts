import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import {
  profitExitAudit,
  profitExitWindow,
  type ProfitExitAuditRow,
} from "../../packages/evaluation/src/profit-exit-audit.js";
const row: ProfitExitAuditRow = {
  claimed_at: "2026-10-27T02:26:51.454Z",
  quote_at: "2026-10-27T02:26:50.970Z",
  quote_gross: "90.65",
  required_net: "12.25",
  execution_reserve: "12.25",
  claimed_volume: "24500",
  closed_volume: "24500",
  actual_gross: "44.10",
  fees: "-59.02",
  net: "-14.92",
  closed_at: "2026-10-27T02:26:51.824Z",
  exact_close_match: true,
};
it("reproduces the actual fee-inclusive loss and quote-to-fill gap without a profit claim", () => {
  const r = profitExitAudit([row]);
  expect(r.exactBotCloseNet).toBe("-14.92");
  expect(r.observations[0]).toMatchObject({
    adversePrice: "0.19",
    allowancePrice: "0.05",
    quoteToCloseMs: 854,
    guaranteedProfit: false,
  });
  expect(r.counterfactualNet).toBeNull();
  expect(r.executionAuthority).toBe(false);
});
it("keeps unmatched/native races, partial closes and open outcomes censored", () => {
  const r = profitExitAudit([
    { ...row, exact_close_match: false },
    { ...row, closed_volume: "100" },
    { ...row, net: null, closed_at: null },
  ]);
  expect(r.claims).toBe(3);
  expect(r.exactBotCloses).toBe(0);
  expect(r.exactBotCloseNet).toBeNull();
  expect(
    r.observations.every(
      (x) => x.adversePrice === null && x.quoteToCloseMs === null,
    ),
  ).toBe(true);
});
it("rejects invalid decimal evidence and time inversion", () => {
  expect(() => profitExitAudit([{ ...row, quote_gross: "NaN" }])).toThrow();
  expect(() =>
    profitExitAudit([{ ...row, closed_at: "2026-10-27T02:26:49Z" }]),
  ).toThrow();
});

it("bounds explicit demo source and time scope without changing the historical replay contract", () => {
  const args = [
    "0.7.2-quick-oco.1-codex.1",
    "2026-10-26T00:00:00Z",
    "2026-10-27T00:00:00Z",
  ];
  expect(profitExitWindow(args).release).toBe(args[0]);
  expect(() => profitExitWindow(["unknown", ...args.slice(1)])).toThrow();
  expect(() =>
    profitExitWindow([args[0]!, args[1]!, "2027-01-01T00:00:00Z"]),
  ).toThrow();
  expect(() => profitExitWindow([args[0]!, args[2]!, args[1]!])).toThrow();
});

it("validates the audit schema and rejects invented execution authority", () => {
  const check = new Ajv2020({ strict: true }).compile(
    JSON.parse(readFileSync("schemas/profit-exit-audit-1.0.json", "utf8")),
  );
  const r = profitExitAudit([row, { ...row, exact_close_match: false }]);
  expect(check(r)).toBe(true);
  expect(
    check({
      ...r,
      release: "0.7.2-quick-oco.1-codex.1",
      from: "2026-10-26T00:00:00Z",
      until: "2026-10-27T03:10:00Z",
    }),
  ).toBe(true);
  expect(check({ ...r, executionAuthority: true })).toBe(false);
});
