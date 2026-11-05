"""Version-bound trend experiment metadata; deterministic execution owns geometry."""

from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path
from typing import Any, Literal, cast
from uuid import UUID

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel, encoded, timestamp


class TrendProfile(StrictModel):
    id: Literal["TREND_BREAKOUT", "TREND_CONFIRMED", "TREND_RETEST"]
    proposalSource: Literal["CODEX"]
    entryStyle: Literal["BREAKOUT", "CONFIRMED_BREAKOUT", "RETEST_LIMIT"]
    rangeBars: Literal[5]
    targetDistance: Literal["STRUCTURAL"]
    stopBufferTicks: Literal[0]
    pendingSeconds: Literal[60]
    entryRangePoints: Literal[0, 30]
    baseExitReservePoints: Literal[65]
    stressExitReservePoints: Literal[65]
    minimumNetRewardRisk: Literal["1"]

    def digest(self) -> str:
        return sha256(encoded(self.model_dump(exclude={"id"}))).hexdigest()


def catalogue() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[2]
    return cast(
        dict[str, Any],
        json.loads((root / "packages/config/src/trend-retest-catalogue.json").read_bytes()),
    )


class TrendBinding(StrictModel):
    trialId: str
    profileId: str
    profileSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    catalogueSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    strategyVersion: Literal["0.11.0-trend-retest.1-codex.1"]
    sourceSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    registeredAt: str
    startsAt: str

    @model_validator(mode="after")
    def registered(self) -> TrendBinding:
        if (
            str(UUID(self.trialId)) != self.trialId
            or not timestamp(self.registeredAt) < timestamp(self.startsAt)
            or self.profile().digest() != self.profileSha256
            or sha256(encoded(catalogue())).hexdigest() != self.catalogueSha256
        ):
            raise ValueError("CODEX_TREND_BINDING_INVALID")
        return self

    def profile(self) -> TrendProfile:
        profiles = [TrendProfile.model_validate(p) for p in catalogue()["profiles"]]
        found = next((p for p in profiles if p.id == self.profileId), None)
        if found is None:
            raise ValueError("CODEX_TREND_PROFILE_INVALID")
        return found
