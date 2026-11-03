"""Finite prospective DEMO hypotheses. Loading definitions never authorizes orders."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel
from python.research.learning_evidence import encoded


class Profile(StrictModel):
    id: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,31}$")
    proposalSource: Literal["CODEX", "LOCAL_RANGE"]
    rangeBars: Literal[3, 5]
    targetDistance: Literal["0.4", "0.6", "1"]
    stopBufferTicks: Literal[0, 5, 10]
    pendingSeconds: Literal[60, 180]
    entryRangePoints: Literal[10, 30]
    baseExitReservePoints: Literal[5]
    stressExitReservePoints: Literal[65]

    def digest(self) -> str:
        # ID is not a strategy difference; identical settings are replications.
        return sha256(encoded(self.model_dump(exclude={"id"}))).hexdigest()


class Batch(StrictModel):
    id: Literal["ENTRY", "TP", "SL", "TTL", "RANGE"]
    profiles: list[str] = Field(min_length=2, max_length=6)


class Catalogue(StrictModel):
    schemaVersion: Literal["demo-trial-catalogue-1.0"]
    status: Literal["EXPERIMENTAL_NOT_CHAMPION"]
    maximumCloses: Literal[20]
    maximumMarketOpenSeconds: Literal[3600]
    stopAnchorBars: Literal[5]
    m5TrendCloses: Literal[3]
    entryBufferTicks: Literal[1]
    maximumStopDistance: Literal["7"]
    setupRiskPercentCeiling: Literal["5"]
    singleLegRiskPercentCeiling: Literal["2.5"]
    profiles: list[Profile] = Field(min_length=3, max_length=16)
    batches: list[Batch] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def finite(self) -> Catalogue:
        profiles = {p.id: p for p in self.profiles}
        if len(profiles) != len(self.profiles) or len({p.digest() for p in self.profiles}) != len(
            profiles
        ):
            raise ValueError("DEMO_CATALOGUE_DUPLICATE")
        if [b.id for b in self.batches] != ["ENTRY", "TP", "SL", "TTL", "RANGE"]:
            raise ValueError("DEMO_CATALOGUE_BATCH_ORDER")
        keys = {
            "ENTRY": {"proposalSource", "rangeBars"},
            "TP": {"targetDistance"},
            "SL": {"stopBufferTicks"},
            "TTL": {"pendingSeconds"},
            "RANGE": {"entryRangePoints"},
        }
        used: set[str] = set()
        for batch in self.batches:
            if (
                len(set(batch.profiles)) != len(batch.profiles)
                or not set(batch.profiles) <= profiles.keys()
            ):
                raise ValueError("DEMO_CATALOGUE_REFERENCES")
            baseline = profiles[batch.profiles[0]].model_dump(exclude={"id"})
            for key in batch.profiles:
                value = profiles[key].model_dump(exclude={"id"})
                if any(value[k] != baseline[k] for k in baseline.keys() - keys[batch.id]):
                    raise ValueError("DEMO_CATALOGUE_MULTIPLE_DIMENSIONS")
            used.update(batch.profiles)
        if used != profiles.keys():
            raise ValueError("DEMO_CATALOGUE_UNUSED_PROFILE")
        return self


def load() -> Catalogue:
    root = Path(__file__).resolve().parents[2]
    return Catalogue.model_validate_json(
        (root / "packages/config/src/demo-trial-catalogue.json").read_bytes()
    )
