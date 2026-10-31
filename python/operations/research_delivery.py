"""Whitelisted read-only delivery lineage. Fresh metadata grants no execution authority."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, Any, Literal

from pydantic import Field

from python.research import holding_task as task
from python.research.codex_loop import StrictModel, timestamp
from python.research.experiment_registry import Registry, read
from python.research.holding_mailbox import Generation, unpack
from python.research.learning_archive import atomic_bytes, bounded
from python.research.learning_evidence import Digest, Instant, encoded
from python.research.publisher_policy import GitId

GENERATION = Path("/var/lib/scalper-candidate-observation/status.json")
REVIEW = Path("/var/lib/scalper-review-observation/status.json")
Code = Annotated[str, Field(pattern=r"^[A-Z_]{1,100}$")]


class Origin(StrictModel):
    trialId: Digest
    resultSha256: Digest
    findingSha256: Digest
    question: Annotated[str, Field(max_length=600)]
    start: Instant
    until: Instant
    recordedClosedRows: Annotated[int, Field(ge=0, le=100000)]


class GenerationHealth(StrictModel):
    version: Literal["research-generation-health-1.0"]
    checkedAt: Instant
    status: Code
    phase: Code | None
    reason: Code | None
    job: Digest | None
    baseCommit: GitId | None
    publicationSha256: Digest | None
    origin: Origin | None
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]


class ReviewOutcome(StrictModel):
    pullRequest: Annotated[int, Field(ge=1, le=999999999)]
    status: Code
    reason: Code | None = None
    publicationSha256: Digest | None = None
    headCommit: GitId | None = None
    mergeCommit: GitId | None = None


class ReviewHealth(StrictModel):
    version: Literal["research-review-health-1.0"]
    checkedAt: Instant
    status: Code
    reason: Code | None
    recent: Annotated[list[ReviewOutcome], Field(max_length=4)]
    lastTerminal: ReviewOutcome | None
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]


class DeliveryHealth(StrictModel):
    version: Literal["research-delivery-health-1.0"]
    checkedAt: Instant
    generation: GenerationHealth | None
    review: ReviewHealth | None
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]


def publish(path: Path, value: StrictModel) -> None:
    atomic_bytes(path, encoded(value.model_dump()), replace=True)
    path.chmod(0o644)


def generation(root: Path, status: dict[str, Any]) -> GenerationHealth:
    state = read(root / "state.json") if (root / "state.json").exists() else {}
    job = status.get("job", state.get("job"))
    origin = None
    if job:
        directory = Registry(root).directory(job)
        request = Generation.model_validate(
            read(directory / "request.json", 2 * 8 * 1024**2 + 524288)
        )
        with TemporaryDirectory() as temporary:
            unpack(request.experiment, Path(temporary))
            facts, rows = task.evidence(Path(temporary))
        packet = json.loads(bytes.fromhex(request.experiment["input.json"]))
        origin = Origin(
            trialId=facts["trialId"],
            resultSha256=facts["resultSha256"],
            findingSha256=facts["findingSha256"],
            question=facts["question"][:600],
            start=packet["start"],
            until=packet["until"],
            recordedClosedRows=len(rows),
        )
    return GenerationHealth(
        version="research-generation-health-1.0",
        checkedAt=status["checkedAt"],
        status=status["status"],
        phase=status.get("phase", state.get("phase")),
        reason=status.get("reason"),
        job=job,
        baseCommit=status.get("baseCommit", state.get("baseCommit")),
        publicationSha256=status.get("publicationSha256", state.get("publicationSha256")),
        origin=origin,
        brokerAuthority=False,
        promotionAuthority=False,
    )


def review(status: dict[str, Any]) -> ReviewHealth:
    return ReviewHealth(
        version="research-review-health-1.0",
        checkedAt=status["checkedAt"],
        status=status["status"],
        reason=status.get("reason"),
        recent=status.get("recent", []),
        lastTerminal=status.get("lastTerminal"),
        brokerAuthority=False,
        promotionAuthority=False,
    )


def load(path: Path, kind: type[GenerationHealth] | type[ReviewHealth], now: datetime) -> Any:
    try:
        value = kind.model_validate_json(bounded(path, 65536))
        if (
            not now - timedelta(seconds=300)
            <= timestamp(value.checkedAt)
            <= now + timedelta(seconds=5)
        ):
            raise ValueError("DELIVERY_STALE")
        return value
    except (OSError, ValueError):
        return None


def view(value: DeliveryHealth, now: datetime) -> dict[str, Any]:
    result = value.model_dump()
    for key in ("generation", "review"):
        item = result[key]
        if item and not now - timedelta(seconds=300) <= timestamp(
            item["checkedAt"]
        ) <= now + timedelta(seconds=5):
            result[key] = None
    candidate, reviews = result["generation"], result["review"]
    outcome = None
    if candidate and reviews and candidate["publicationSha256"]:
        choices = [*reviews["recent"], reviews["lastTerminal"]]
        matches = [
            r for r in choices if r and r["publicationSha256"] == candidate["publicationSha256"]
        ]
        if matches:
            outcome = matches[-1]
    result["matchedOutcome"] = outcome
    result["observedAt"] = now.isoformat()
    return result
