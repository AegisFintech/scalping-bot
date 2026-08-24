export type AnalysisState =
  | "PENDING"
  | "COLLECTING"
  | "FEATURED"
  | "MODEL_PENDING"
  | "VALIDATING"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED";

const TRANSITIONS: Readonly<Record<AnalysisState, readonly AnalysisState[]>> = {
  PENDING: ["COLLECTING", "REJECTED"],
  COLLECTING: ["FEATURED", "REJECTED"],
  FEATURED: ["MODEL_PENDING", "REJECTED"],
  MODEL_PENDING: ["VALIDATING", "REJECTED"],
  VALIDATING: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["EXPIRED"],
  REJECTED: [],
  EXPIRED: [],
};

export interface AnalysisTransition {
  readonly from: AnalysisState;
  readonly to: AnalysisState;
  readonly occurredAt: string;
  readonly reasonCodes: readonly string[];
}

export class AnalysisStateMachine {
  #state: AnalysisState = "PENDING";
  readonly #history: AnalysisTransition[] = [];

  get state(): AnalysisState {
    return this.#state;
  }

  get history(): readonly AnalysisTransition[] {
    return [...this.#history];
  }

  transition(
    to: AnalysisState,
    reasonCodes: readonly string[] = [],
    now = new Date(),
  ): AnalysisTransition {
    if (!TRANSITIONS[this.#state].includes(to))
      throw new Error(`ANALYSIS_TRANSITION_INVALID:${this.#state}:${to}`);
    if (to === "REJECTED" && reasonCodes.length === 0)
      throw new Error("ANALYSIS_REJECTION_REASON_REQUIRED");
    const event = {
      from: this.#state,
      to,
      occurredAt: now.toISOString(),
      reasonCodes: [...new Set(reasonCodes)].sort(),
    };
    this.#state = to;
    this.#history.push(event);
    return event;
  }
}
