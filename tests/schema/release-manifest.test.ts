import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
const ajv = new Ajv2020({ strict: true });
ajv.addSchema(
  JSON.parse(
    readFileSync("schemas/qualification-report-1.0.json", "utf8"),
  ) as AnySchema,
);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/release-manifest-1.0.json", "utf8"),
  ) as AnySchema,
);
it("requires explicit runtime, qualification and asset fingerprints", () => {
  const hash = "a".repeat(64);
  const manifest = {
    manifestVersion: "1.0",
    runtimeLinks: {
      ".runtime": "/tmp/state/.runtime",
      logs: "/tmp/state/logs",
    },
    commit: "b".repeat(40),
    sourceSha256: hash,
    nodeVersion: process.version,
    nodeSha256: hash,
    qualification: {
      qualificationVersion: "1.0",
      qualified: false,
      sourceSha256: hash,
      nodeVersion: process.version,
      nodeSha256: hash,
      pythonSha256: hash,
      results: [],
    },
    files: { "file.json": { sha256: hash } },
  };
  expect(validate(manifest)).toBe(true);
  expect(validate({ ...manifest, nodeVersion: "v24.0.0" })).toBe(false);
  expect(
    validate({ ...manifest, files: { "file.json": { sha256: "unknown" } } }),
  ).toBe(false);
});
