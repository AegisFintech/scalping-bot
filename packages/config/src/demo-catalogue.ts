import { createHash } from "node:crypto";
import definitions from "./demo-trial-catalogue.json" with { type: "json" };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  throw new Error("SCENARIO_DEMO_CANONICAL_INVALID");
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
export const catalogueSha256 = digest(definitions);
