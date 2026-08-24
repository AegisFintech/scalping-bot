import { describe, expect, it } from "vitest";

import { AnalysisStateMachine } from "../../apps/execution-service/src/state-machine.js";

describe("analysis state machine", () => {
  it("allows only explicit forward transitions", () => {
    const machine = new AnalysisStateMachine();
    machine.transition("COLLECTING");
    machine.transition("FEATURED");
    machine.transition("MODEL_PENDING");
    machine.transition("VALIDATING");
    machine.transition("ACCEPTED");
    machine.transition("EXPIRED");
    expect(machine.state).toBe("EXPIRED");
    expect(() => machine.transition("PENDING")).toThrow(
      "ANALYSIS_TRANSITION_INVALID",
    );
  });

  it("requires reason codes for rejection", () => {
    const machine = new AnalysisStateMachine();
    expect(() => machine.transition("REJECTED")).toThrow(
      "ANALYSIS_REJECTION_REASON_REQUIRED",
    );
  });
});
