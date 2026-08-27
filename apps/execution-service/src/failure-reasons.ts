const STABLE_REASON = /^[A-Z][A-Z0-9_]*(?::[A-Z0-9_.-]+)*$/;

export function stableFailureReason(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (
    error.message.includes("project size limit") ||
    error.message.includes("disk full") ||
    error.message.includes("No space left on device")
  ) {
    return "DATABASE_STORAGE_LIMIT_EXCEEDED";
  }
  return error.message.length <= 200 && STABLE_REASON.test(error.message)
    ? error.message
    : fallback;
}
