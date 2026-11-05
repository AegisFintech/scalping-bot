"""Retain actual completed demo allocations; never advance, restart or trade."""

from __future__ import annotations

import argparse
import json
import shutil
import urllib.request
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel, timestamp
from python.research.demo_trial_status import (
    TrendTrialStatus,
    TrialReview,
    TrialRow,
    TrialStatus,
    status_reader,
)
from python.research.learning_archive import atomic_bytes, bounded, immutable, unique
from python.research.learning_evidence import Digest, Instant, encoded

FAILURE_REASONS = {
    "WITNESS_STORAGE_RESERVE",
    "WITNESS_STORAGE_CAPACITY",
    "WITNESS_CONTROLLER_STALE",
    "WITNESS_STATUS_OVERSIZED",
    "WITNESS_UNAVAILABLE",
}

ROOT = Path("/var/lib/scalper-demo-trial-witness")
RESTART = Path("/etc/scalper-demo-trials/restart-proof.json")


class WitnessStatus(StrictModel):
    schemaVersion: Literal["demo-trial-witness-status-1.0"]
    checkedAt: Instant
    sourceSha256: Digest | None
    retainedCompletedAllocations: Annotated[int, Field(strict=True, ge=0, le=512)]
    windowFilledCompletedAllocations: Annotated[int, Field(strict=True, ge=0, le=26)]
    windowDistinctFilledProfilesWithNextAction: Annotated[int, Field(strict=True, ge=0, le=26)]
    actualRestartRecorded: bool
    actualRestartProofBound: bool
    engineeringMilestoneObserved: bool
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]
    economicQualification: Literal[False]

    @model_validator(mode="after")
    def milestone(self) -> WitnessStatus:
        if (
            self.engineeringMilestoneObserved
            != (
                self.windowDistinctFilledProfilesWithNextAction >= 2
                and self.actualRestartProofBound
            )
            or self.windowDistinctFilledProfilesWithNextAction
            > self.windowFilledCompletedAllocations
            or (self.actualRestartProofBound and not self.actualRestartRecorded)
        ):
            raise ValueError("WITNESS_MILESTONE_CONTRADICTION")
        return self


def read_status(now: datetime, path: Path = ROOT / "status.json") -> dict[str, Any] | None:
    try:
        raw = json.loads(bounded(path, 8192))
        if (
            set(raw) == {"checkedAt", "available", "reason"}
            and raw["available"] is False
            and raw["reason"] in FAILURE_REASONS
        ):
            if not isinstance(raw["checkedAt"], str):
                return None
            if -5 <= (now - timestamp(raw["checkedAt"])).total_seconds() <= 180:
                return {"checkedAt": raw["checkedAt"], "available": False, "reason": raw["reason"]}
            return None
        value = WitnessStatus.model_validate(raw)
        if not -5 <= (now - timestamp(value.checkedAt)).total_seconds() <= 180:
            return None
        return value.model_dump(mode="json")
    except (OSError, ValueError, TypeError, KeyError):
        return None


class Completion(StrictModel):
    schemaVersion: Literal["demo-trial-completion-witness-1.0"]
    trialId: Annotated[str, Field(pattern=r"^[a-f0-9-]{36}$")]
    profileId: Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]{1,31}$")]
    profileSha256: Digest
    sourceSha256: Digest
    catalogueSha256: Digest
    cycle: Annotated[int, Field(strict=True, ge=0)]
    ordinal: Annotated[int, Field(strict=True, ge=0, le=12)]
    registeredAt: Instant
    startsAt: Instant
    completedAt: Instant
    entryFillEvents: Annotated[int, Field(strict=True, ge=0)]
    closedPositions: Annotated[int, Field(strict=True, ge=0)]
    proposals: Annotated[int, Field(strict=True, ge=0)]
    providerClaims: Annotated[int, Field(strict=True, ge=0)]
    provenZeroFillGroups: None = None
    nonfillBasis: Literal["UNAVAILABLE_IN_FROZEN_CONTROLLER_CONTRACT"] = (
        "UNAVAILABLE_IN_FROZEN_CONTROLLER_CONTRACT"
    )
    review: TrialReview
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]
    economicQualification: Literal[False]

    @model_validator(mode="after")
    def chronology(self) -> Completion:
        if (
            not timestamp(self.registeredAt)
            < timestamp(self.startsAt)
            <= timestamp(self.completedAt)
        ):
            raise ValueError("WITNESS_COMPLETION_CLOCK")
        if self.review.closedPositions != self.closedPositions or (
            self.closedPositions > 0
            and (not self.entryFillEvents or self.review.observedNet is None)
        ):
            raise ValueError("WITNESS_COMPLETION_COUNTS")
        return self


class RestartProof(StrictModel):
    schemaVersion: Literal["demo-trial-restart-proof-1.0"]
    sourceSha256: Digest
    trialId: Annotated[str, Field(pattern=r"^[a-f0-9-]{36}$")]
    beforePid: Annotated[int, Field(strict=True, gt=0)]
    afterPid: Annotated[int, Field(strict=True, gt=0)]
    beforeAt: Instant
    afterAt: Instant
    originalTrialHeadRetained: Literal[True]
    originalGroupIdentitiesRetained: Literal[True]
    noShutdownCancellation: Literal[True]
    uniqueContextClaimsVerified: Literal[True]
    oldPidExited: Literal[True]
    brokerAuthority: Literal[False]

    @model_validator(mode="after")
    def actual_restart(self) -> RestartProof:
        if self.beforePid == self.afterPid or timestamp(self.beforeAt) >= timestamp(self.afterAt):
            raise ValueError("WITNESS_RESTART_INVALID")
        return self


def restart(path: Path, now: datetime) -> RestartProof | None:
    if not path.exists():
        return None
    stat = path.lstat()
    if path.is_symlink() or not path.is_file() or stat.st_uid != 0 or stat.st_mode & 0o022:
        raise ValueError("WITNESS_RESTART_PROTECTION_INVALID")
    proof = RestartProof.model_validate_json(bounded(path, 8192))
    if timestamp(proof.afterAt) > now:
        raise ValueError("WITNESS_RESTART_FUTURE")
    return proof


def receipt(row: TrialRow) -> dict[str, Any]:
    if row.state != "COMPLETED" or row.review is None or row.completed_at is None:
        raise ValueError("WITNESS_COMPLETION_MISSING")
    if (
        row.completed_at < row.starts_at
        or row.review.closedPositions != row.closes
        or (row.closes > 0 and (row.realized_net is None or row.review.observedNet is None))
        or (
            row.realized_net is not None
            and row.review.observedNet is not None
            and Decimal(row.realized_net) != Decimal(row.review.observedNet)
        )
    ):
        raise ValueError("WITNESS_COMPLETION_CONTRADICTION")
    value = {
        "schemaVersion": "demo-trial-completion-witness-1.0",
        "trialId": row.id,
        "profileId": row.profile_id,
        "profileSha256": row.profile_sha256,
        "sourceSha256": row.source_sha256,
        "catalogueSha256": row.catalogue_sha256,
        "cycle": row.cycle,
        "ordinal": row.ordinal,
        "registeredAt": row.registered_at.isoformat(),
        "startsAt": row.starts_at.isoformat(),
        "completedAt": row.completed_at.isoformat(),
        "entryFillEvents": row.entry_fill_events,
        "closedPositions": row.closes,
        "proposals": row.proposals,
        "providerClaims": row.provider_claims,
        # This review was frozen by the database at completion, before late provider receipts.
        "review": row.review.model_dump(mode="json"),
        "brokerAuthority": False,
        "promotionAuthority": False,
        "economicQualification": False,
    }
    return Completion.model_validate(value).model_dump(mode="json")


def retain(
    status: TrialStatus | TrendTrialStatus, root: Path, now: datetime, proof: RestartProof | None
) -> dict[str, Any]:
    verified = status.controllerVerifiedAt
    if verified is None or not -5 <= (now - verified).total_seconds() <= 30:
        raise ValueError("WITNESS_CONTROLLER_STALE")
    if root.is_symlink() or not root.is_dir():
        raise ValueError("WITNESS_DIRECTORY_INVALID")
    if shutil.disk_usage(root).free < 2 * 1024**3:
        raise ValueError("WITNESS_STORAGE_RESERVE")
    files = list(root.iterdir())
    if any(p.is_symlink() or not p.is_file() for p in files):
        raise ValueError("WITNESS_DIRECTORY_ENTRY_INVALID")
    if len(files) > 512 or sum(p.stat().st_size for p in files) > 4 * 1024**2:
        raise ValueError("WITNESS_STORAGE_CAPACITY")
    current = []
    for row in status.trials:
        if row.state == "COMPLETED" and row.retirement_reason != "SOURCE_HANDOVER":
            if row.completed_at is None or row.completed_at > now:
                raise ValueError("WITNESS_COMPLETION_FUTURE")
            current.append(receipt(row))
    additions = [r for r in current if not (root / f"trial-{r['trialId']}.json").exists()]
    if (
        len(files) + len(additions) > 512
        or sum(p.stat().st_size for p in files) + sum(len(encoded(r)) for r in additions)
        > 4 * 1024**2
    ):
        raise ValueError("WITNESS_STORAGE_CAPACITY")
    if shutil.disk_usage(root).free < 2 * 1024**3 + sum(2 * len(encoded(r)) for r in additions):
        raise ValueError("WITNESS_STORAGE_RESERVE")
    for r in current:
        immutable(root / f"trial-{r['trialId']}.json", r)
    retained = []
    for path in root.glob("trial-*.json"):
        value = Completion.model_validate(
            json.loads(bounded(path, 16384), object_pairs_hook=unique)
        ).model_dump(mode="json")
        if path.name != f"trial-{value['trialId']}.json":
            raise ValueError("WITNESS_ARCHIVE_INVALID")
        retained.append(value)
    # Archived files retain history; only freshly re-read controller evidence may
    # establish the engineering milestone. Archive edits cannot manufacture it.
    filled = [r for r in current if r["entryFillEvents"] > 0 and r["closedPositions"] > 0]
    source = status.trials[0].source_sha256 if status.trials else None
    filled = [r for r in filled if r["sourceSha256"] == source]
    next_links = []
    for r in filled:
        slots = 4 if r["profileId"].startswith("TREND_") else 13
        following = (r["cycle"] + (r["ordinal"] == slots - 1), (r["ordinal"] + 1) % slots)
        successors = [
            t
            for t in status.trials
            if (t.cycle, t.ordinal) == following
            and t.source_sha256 == r["sourceSha256"]
            and t.catalogue_sha256 == r["catalogueSha256"]
            and t.profile_id == r["review"]["nextProfileId"]
            and t.registered_at >= timestamp(r["completedAt"])
        ]
        if successors:
            next_links.append(r)
    distinct = len({r["profileSha256"] for r in next_links})
    restart_bound = proof is not None and any(
        r["trialId"] == proof.trialId
        and r["sourceSha256"] == proof.sourceSha256
        and timestamp(r["startsAt"]) <= timestamp(proof.beforeAt)
        and timestamp(proof.afterAt) <= timestamp(r["completedAt"])
        for r in filled
    )
    return WitnessStatus.model_validate(
        {
            "schemaVersion": "demo-trial-witness-status-1.0",
            "checkedAt": now.isoformat(),
            "sourceSha256": source,
            "retainedCompletedAllocations": len(retained),
            "windowFilledCompletedAllocations": len(filled),
            "windowDistinctFilledProfilesWithNextAction": distinct,
            "actualRestartRecorded": proof is not None and proof.sourceSha256 == source,
            "actualRestartProofBound": restart_bound,
            "engineeringMilestoneObserved": distinct >= 2 and restart_bound,
            "brokerAuthority": False,
            "promotionAuthority": False,
            "economicQualification": False,
        }
    ).model_dump(mode="json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    now = datetime.now(UTC)
    try:
        with urllib.request.urlopen("http://127.0.0.1:8080/v1/demo-trials", timeout=3) as response:
            raw = response.read(131073)
        if len(raw) > 131072:
            raise ValueError("WITNESS_STATUS_OVERSIZED")
        status = status_reader.validate_json(raw)
        value = retain(status, args.root, now, restart(RESTART, now))
    except (OSError, ValueError, KeyError, TypeError) as error:
        reason = str(error) if str(error) in FAILURE_REASONS else "WITNESS_UNAVAILABLE"
        value = {"checkedAt": now.isoformat(), "available": False, "reason": reason}
    atomic_bytes(args.root / "status.json", encoded(value), replace=True)


if __name__ == "__main__":
    main()
