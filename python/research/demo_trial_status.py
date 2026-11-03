"""Read-only finite-trial dashboard contract; no order or promotion authority."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from python.research.codex_loop import StrictModel
from python.research.demo_catalogue import Profile

Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Money = Annotated[str, Field(pattern=r"^-?[0-9]+(?:\.[0-9]+)?$")]
Count = Annotated[int, Field(strict=True, ge=0)]


class TrialReview(StrictModel):
    closedPositions: Count
    observedNet: Money | None
    interpretation: Literal[
        "NO_CLOSED_SAMPLE",
        "POSITIVE_OBSERVED_NET_UNQUALIFIED",
        "NONPOSITIVE_OBSERVED_NET_UNQUALIFIED",
    ]
    waits: Count
    failedProposals: Count
    incompleteContexts: Count
    nextProfileId: str


class ClockReceipt(StrictModel):
    from_: AwareDatetime = Field(alias="from")
    until: AwareDatetime
    reason: Literal[
        "CONTROLLER_RESUMED",
        "OBSERVATION_GAP",
        "SESSION_UNAVAILABLE_STARTED",
        "SESSION_UNAVAILABLE_ENDED",
    ]
    sessionState: Literal["OPEN", "CLOSED", "UNAVAILABLE"]
    creditedMilliseconds: Literal[0]


class TrialRow(StrictModel):
    id: Annotated[str, Field(pattern=r"^[a-f0-9-]{36}$")]
    profile_id: str
    profile_sha256: Hash
    catalogue_sha256: Hash
    source_sha256: Hash
    cycle: Count
    ordinal: Annotated[int, Field(strict=True, ge=0, le=12)]
    registered_at: AwareDatetime
    starts_at: AwareDatetime
    state: Literal["ACTIVE", "DRAINING", "COMPLETED"]
    market_open_ms: Annotated[str, Field(pattern=r"^[0-9]{1,7}$")]
    observed_at: AwareDatetime
    completed_at: AwareDatetime | None
    retirement_reason: str | None
    definition: Profile
    proposals: Count
    provider_claims: Count
    waits: Count
    entry_fill_events: Count
    closes: Count
    realized_net: Money | None
    review: TrialReview | None
    session_state: Literal["OPEN", "CLOSED", "UNAVAILABLE"]
    clock_receipts: Count
    last_clock_receipt: ClockReceipt | None

    @model_validator(mode="after")
    def consistent(self) -> TrialRow:
        if (
            self.definition.id != self.profile_id
            or self.definition.digest() != self.profile_sha256
            or self.starts_at <= self.registered_at
            or (self.state == "COMPLETED") != (self.completed_at is not None)
            or int(self.market_open_ms) > 3630000
        ):
            raise ValueError("DEMO_TRIAL_STATUS_INVALID")
        return self


class TrialStatus(StrictModel):
    schemaVersion: Literal["demo-trial-status-1.0"]
    observedAt: AwareDatetime
    controllerVerifiedAt: AwareDatetime | None
    reason: str | None
    experimental: Literal[True]
    nextProfileId: str
    nextAction: Literal[
        "WAIT_FOR_TERMINAL_PROOF_THEN_REGISTER_NEXT",
        "WAIT_FOR_CONTROLLER_OR_RECONCILIATION",
        "EVALUATE_FRESH_OPPORTUNITIES",
    ]
    netIncludesSignedFees: Literal[True]
    actualFutureCosts: None
    trials: Annotated[list[TrialRow], Field(max_length=26)]
