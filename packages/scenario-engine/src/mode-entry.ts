import {
  bindDirectionalDecision,
  validateDirectionalPlan,
  type DirectionalEntryPlan,
} from "./directional-entry.js";
export interface ModeEntryPlan extends Omit<
  DirectionalEntryPlan,
  "schema_version"
> {
  readonly schema_version: "entry-modes-1.0";
}
export function bindModeDecision(
  raw: string,
  context: Parameters<typeof bindDirectionalDecision>[1],
) {
  const p = bindDirectionalDecision(raw, context);
  return p.schema_version === "entry-wait-1.0"
    ? p
    : { ...p, schema_version: "entry-modes-1.0" as const };
}
export function validateModePlan(
  raw: string,
  context: Parameters<typeof validateDirectionalPlan>[1],
): ModeEntryPlan {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (value.schema_version !== "entry-modes-1.0")
    throw new Error("ENTRY_MODE_CONTEXT_INVALID");
  const p = validateDirectionalPlan(
    JSON.stringify({ ...value, schema_version: "entry-direction-1.0" }),
    context,
  );
  return { ...p, schema_version: "entry-modes-1.0" };
}
