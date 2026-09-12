import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { marketSessionSchema } from "../../packages/market-data-client/src/client.js";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
import { marketSession } from "../helpers/market-session.js";
const validator = new ModelResponseValidator("schemas/market-session-1.0.json");
describe("market session contract", () => {
  it("keeps the published schema identical to the strict HTTP parser", () => {
    const schema = JSON.parse(
      readFileSync("schemas/market-session-1.0.json", "utf8"),
    ) as Record<string, unknown>;
    delete schema.title;
    expect(schema).toEqual(z.toJSONSchema(marketSessionSchema));
    expect(validator.parse(JSON.stringify(marketSession())).accepted).toBe(
      true,
    );
  });
  it.each([
    { schemaVersion: "2.0" },
    { extra: true },
    { schedule: null },
    { schedule: { timeZone: "UTC", intervals: [], holidays: [] } },
    { metadata: { ...marketSession().metadata, tickSize: 0.01 } },
    { metadata: { ...marketSession().metadata, metadataTime: "unknown" } },
    {
      schedule: {
        timeZone: "UTC",
        intervals: [{ startSecond: 0, endSecond: 604801 }],
        holidays: [],
      },
    },
  ])("rejects invalid or incomplete contract %j", (patch) => {
    expect(
      validator.parse(JSON.stringify({ ...marketSession(), ...patch }))
        .accepted,
    ).toBe(false);
  });
});
