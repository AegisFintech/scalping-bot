import { learningWindow } from "./demo-learning.js";
import type { PairedReplayRow, PairedReplayLeg } from "./paired-input.js";
export const FAST_EXIT_RELEASE = "0.3.0-fade-limit.3-codex.1";
export function fastExitWindow(args: readonly string[]) {
  if (args[0] !== FAST_EXIT_RELEASE) throw new Error("PAIRED_RELEASE_INVALID");
  const window = learningWindow(["0.3.0-fade-limit.3", ...args.slice(1)]);
  return { ...window, release: FAST_EXIT_RELEASE };
}
export interface FastExitLeg extends PairedReplayLeg {
  fill_count: number;
  cancelled_at: string | null;
  fee_evidence: {
    at: string;
    fees: string | null;
    gross: string | null;
    pips: string | null;
    pip_size: string | null;
    volume: string | null;
  }[];
}
export interface FastExitRow extends PairedReplayRow {
  legs: FastExitLeg[];
}
