"""Evidence-led execution research priorities; no trading or publication authority."""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from hashlib import sha256
from typing import Any, Literal

from pydantic import Field

from python.research.breakout_hypotheses import BreakoutMeasurement
from python.research.codex_loop import StrictModel, timestamp
from python.research.execution_funnel import ExecutionFunnel, Latency, latency
from python.research.learning_evidence import Digest, Instant, LearningEvidence, encoded


class HarnessAgenda(StrictModel):
    schemaVersion: Literal["execution-research-agenda-1.0"]
    packetSha256: Digest
    start: Instant
    until: Instant
    providerStates: dict[str, int]
    providerFailures: dict[str, int]
    completedFailures: int = Field(ge=0)
    incompleteContexts: int = Field(ge=0)
    waitChecks: int = Field(ge=0)
    exactlyLinkedWaitChecks: int = Field(ge=0)
    unavailableWaitLinks: int = Field(ge=0)
    captureToRequest: Latency
    entryAvailabilityRemaining: Latency
    stage: Literal[
        "WAIT_EVIDENCE", "MEASURE_ENTRY_PATHS", "REVIEW_EXECUTION", "REPAIR_OBSERVABILITY"
    ]
    questionId: Digest
    question: str
    requiredEvidence: str
    falsification: str
    nextAction: str
    engineeringPublication: Literal["EXISTING_INDEPENDENT_REVIEW_PIPELINE_ONLY"]
    economicActivation: Literal["SEPARATE_VERSIONED_REVIEW_REQUIRED"]
    economicQualification: Literal[False] = False
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False


def micros(delta: timedelta) -> str | None:
    return str(delta // timedelta(microseconds=1)) if delta >= timedelta(0) else None


def measure(
    packet: LearningEvidence,
    funnel: ExecutionFunnel,
    breakout: BreakoutMeasurement,
) -> HarnessAgenda:
    contexts = {c.id: c for c in packet.contexts}
    wait_checks = [a for a in packet.analyses if "SCENARIO_CODEX_WAIT" in a.reasonCodes]
    linked = sum(
        len(a.contextIds) == 1
        and a.contextIds[0] in contexts
        and contexts[a.contextIds[0]].decision == "WAIT"
        and contexts[a.contextIds[0]].availableAt is not None
        and timestamp(contexts[a.contextIds[0]].availableAt or "") <= timestamp(a.updatedAt)
        for a in wait_checks
    )
    durations = [
        micros(timestamp(c.requestedAt) - timestamp(c.capturedAt)) for c in packet.contexts
    ]
    remaining = [
        micros(timestamp(c.validUntil) - timestamp(c.availableAt))
        if c.availableAt is not None and c.clockStatus == "CAUSAL"
        else None
        for c in packet.contexts
        if c.decision in {"BUY", "SELL"}
    ]
    stage = "WAIT_EVIDENCE"
    question = "Which execution or entry hypothesis has enough new, attributable evidence?"
    evidence = "A fresh complete observation window with context and broker clocks."
    falsification = "Unavailable or stale evidence cannot establish absence of opportunities."
    action = "Wait for the normal observation timer; never force a provider call or order."
    if len(wait_checks) != linked:
        stage = "REPAIR_OBSERVABILITY"
        question = "Do new WAIT checks retain one exact consulted context?"
        evidence = "New-source durable context associations; old missing links remain unavailable."
        falsification = "One new-source WAIT with no unique causal link disproves complete tracing."
        action = "Collect the next normal source-matched window; do not infer legacy links."
    elif funnel.filledOrderRecords or funnel.orderRecords:
        stage = "REVIEW_EXECUTION"
        question = "Where do recorded proposals lose eligibility or execution quality?"
        evidence = (
            "All intents, mapped native acceptance, fills/nonfills, "
            "original protection, costs and gaps."
        )
        falsification = (
            "Unknown acceptance or counterfactual fills cannot substantiate a saved-loss claim."
        )
        action = (
            "Run the existing registered cost/clock audit and preserve "
            "negative and unknown results."
        )
    elif packet.contexts:
        stage = "MEASURE_ENTRY_PATHS"
        question = "Which fixed trend breakout definitions produce observable completed-bar events?"
        evidence = (
            "All three registered definitions, first availability, "
            "five future completed M1 bars, costs and censoring."
        )
        falsification = (
            "Sparse events, unavailable costs or incomplete paths "
            "cannot qualify an executable edge."
        )
        action = (
            "Collect and evaluate all fixed breakout hypotheses; compare event "
            "frequency and coverage before economic trials."
        )
    if breakout.packetSha256 != funnel.packetSha256:
        raise ValueError("HARNESS_PACKET_BINDING")
    value: dict[str, Any] = {
        "schemaVersion": "execution-research-agenda-1.0",
        "packetSha256": funnel.packetSha256,
        "start": packet.start,
        "until": packet.until,
        "providerStates": dict(Counter(c.state for c in packet.contexts)),
        "providerFailures": dict(Counter(c.failureCode for c in packet.contexts if c.failureCode)),
        "completedFailures": sum(
            c.state == "FAILED" and c.completedAt is not None for c in packet.contexts
        ),
        "incompleteContexts": sum(c.completedAt is None for c in packet.contexts),
        "waitChecks": len(wait_checks),
        "exactlyLinkedWaitChecks": linked,
        "unavailableWaitLinks": len(wait_checks) - linked,
        "captureToRequest": latency(durations),
        "entryAvailabilityRemaining": latency(remaining),
        "stage": stage,
        "questionId": sha256(encoded([stage, question])).hexdigest(),
        "question": question,
        "requiredEvidence": evidence,
        "falsification": falsification,
        "nextAction": action,
        "engineeringPublication": "EXISTING_INDEPENDENT_REVIEW_PIPELINE_ONLY",
        "economicActivation": "SEPARATE_VERSIONED_REVIEW_REQUIRED",
    }
    return HarnessAgenda.model_validate(value)


def model_summary(agenda: HarnessAgenda, breakout: BreakoutMeasurement) -> dict[str, Any]:
    """Bounded deterministic findings, including no-close windows and failure states."""
    return {
        "agenda": agenda.model_dump(),
        "breakout": breakout.model_dump(exclude={"rows"}),
        "interpretation": "FIXED_METHOD_DESCRIPTIVE_NOT_ECONOMIC_OR_NATURAL_CODE_MERGE_PROOF",
    }
