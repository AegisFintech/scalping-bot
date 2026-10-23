export const ENTRY_MODES = [
  "OCO_STOP_LIMIT",
  "OCO_LIMIT",
  "SINGLE_STOP_LIMIT",
  "SINGLE_LIMIT",
] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];
export interface EntryModeSelection {
  readonly mode: EntryMode;
  readonly revision: string;
}
export function isEntryMode(value: unknown): value is EntryMode {
  return (
    typeof value === "string" &&
    (ENTRY_MODES as readonly string[]).includes(value)
  );
}
export function entryModeProfile(mode: EntryMode): {
  single: boolean;
  limit: boolean;
  orderType: "LIMIT" | "STOP_LIMIT";
} {
  if (!isEntryMode(mode)) throw new Error("ENTRY_MODE_INVALID");
  return {
    single: mode.startsWith("SINGLE_"),
    limit: mode === "OCO_LIMIT" || mode === "SINGLE_LIMIT",
    orderType:
      mode === "OCO_LIMIT" || mode === "SINGLE_LIMIT" ? "LIMIT" : "STOP_LIMIT",
  };
}

export interface EntryModeStatus extends EntryModeSelection {
  readonly phase: "READY" | "ACTIVE" | "QUEUED" | "RESTARTING" | "UNVERIFIED";
  readonly activeMode: EntryMode | "LEGACY" | null;
}
export function entryModeStatus(
  selection: EntryModeSelection,
  setup: { status: string; executionMode?: string | null },
  running: EntryModeSelection | null,
): EntryModeStatus {
  const active = setup.status === "ACTIVE";
  const activeMode = active
    ? isEntryMode(setup.executionMode)
      ? setup.executionMode
      : "LEGACY"
    : null;
  return {
    ...selection,
    activeMode,
    phase:
      setup.status === "UNAVAILABLE"
        ? "UNVERIFIED"
        : active
          ? activeMode === selection.mode
            ? "ACTIVE"
            : "QUEUED"
          : running && running.revision !== selection.revision
            ? "RESTARTING"
            : "READY",
  };
}
