"""Freeze exploratory jobs from closed reviews; never execute or promote them.

Only the trusted coordinator owns this archive. Hashes bind bytes, not the
identity or truthfulness of an untrusted caller. Worker admission is separate.
"""

from __future__ import annotations

import fcntl
import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import Field

from python.research.codex_loop import StrictModel, timestamp
from python.research.isolated_worker import bundle_digest
from python.research.learning_archive import (
    atomic_bytes,
    bounded,
    immutable,
    parse,
    sync_directory,
    unique,
)
from python.research.learning_evidence import MAX_BYTES, Digest, Instant, Name, encoded
from python.research.observation_cycle import Interpretation, sha

MAX_TRIALS: Literal[4] = 4
MAX_QUESTIONS = 1000
Text = Annotated[str, Field(min_length=1, max_length=1200)]


class Method(StrictModel):
    """A proposed method, not an assertion that code implements it correctly."""

    methodId: Name
    hypothesis: Text
    baseline: Text
    measurement: Text
    falsification: Text
    runtimeSha256: Digest
    costPolicy: Literal["RECORDED_SIGNED_COSTS_ONLY_UNKNOWN_COUNTERFACTUALS_NULL"]
    cohortPolicy: Literal["ALL_ROWS_RETAIN_OPEN_GAP_PARTIAL_NONFILL_AND_CARRY_IN"]
    dataUse: Literal["RETROSPECTIVE_EXPLORATORY_NOT_PROSPECTIVE"]


class Registration(StrictModel):
    schemaVersion: Literal["research-experiment-registration-1.0"]
    sourceId: Name
    questionId: Digest
    trialId: Digest
    question: Text
    requiredEvidence: Text
    originatingFalsification: Text
    findingSha256: Digest
    planId: Digest
    packetSha256: Digest
    codeBundleSha256: Digest
    method: Method
    registeredAt: Instant
    maxTrialsPerExactQuestion: Literal[4]
    counterfactualCosts: None
    executionAuthority: Literal[False]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]


class Outcome(StrictModel):
    """Retained worker observation only. Independent interpretation comes later."""

    trialId: Digest
    claimSha256: Digest
    resultSha256: Digest
    kind: Literal["POSITIVE", "NEGATIVE", "INCONCLUSIVE", "REJECTED", "FAILED", "OPEN", "GAP"]
    recordedAt: Instant
    independentValidation: Literal[False]
    counterfactualNet: None
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]


def read(path: Path, maximum: int = 32768) -> Any:
    return json.loads(bounded(path, maximum), object_pairs_hook=unique)


def closed_review(job: Path, now: datetime) -> tuple[dict[str, Any], Interpretation, bytes, bytes]:
    """Bind a real completed review, its exact response and the whole input packet."""
    plan = read(job / "plan.json")
    finding_raw = bounded(job / "finding.json", 32768)
    finding = json.loads(finding_raw, object_pairs_hook=unique)
    response = bounded(job / "response.json", 8192)
    answer = Interpretation.model_validate(read(job / "response.json", 8192))
    raw = bounded(job / "input.json", MAX_BYTES)
    packet = parse(raw, sha(raw))
    key = sha(encoded({"sourceId": packet.sourceId, "start": packet.start, "until": packet.until}))
    closure = read(job / "closed.json")
    if (
        plan["id"] != key
        or plan["sourceId"] != packet.sourceId
        or plan["packetSha256"] != sha(raw)
        or plan["diagnosticSha256"] != answer.diagnosticSha256
        or sha(bounded(job / "diagnostic.json", MAX_BYTES)) != answer.diagnosticSha256
        or finding["planId"] != key
        or finding["responseSha256"] != sha(response)
        or finding["interpretation"] != answer.model_dump()
        or closure != {"planId": key, "findingSha256": sha(encoded(finding)), "status": "CLOSED"}
        or read(job / "claim.json")["planId"] != key
        or not timestamp(packet.until)
        <= timestamp(packet.exportedAt)
        <= timestamp(finding["recordedAt"])
        <= now
    ):
        raise ValueError("RESEARCH_REGISTRATION_REVIEW_BINDING")
    return plan, answer, raw, finding_raw


class Registry:
    def __init__(self, root: Path):
        if any(p.is_symlink() for p in (root, *root.parents)):
            raise ValueError("RESEARCH_REGISTRY_PATH_INVALID")
        root.mkdir(parents=True, mode=0o700, exist_ok=True)
        sync_directory(root.parent)
        self.root = root

    @contextmanager
    def locked(self) -> Iterator[None]:
        path = self.root / ".lock"
        if path.is_symlink():
            raise ValueError("RESEARCH_REGISTRY_PATH_INVALID")
        with path.open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield

    def directory(self, *parts: str) -> Path:
        path = self.root
        for part in parts:
            if not re.fullmatch(r"[0-9a-f]{64}", part):
                raise ValueError("RESEARCH_REGISTRY_ID_INVALID")
            path /= part
            if path.is_symlink():
                raise ValueError("RESEARCH_REGISTRY_PATH_INVALID")
        return path

    def register(
        self, review: Path, method: Method, code: dict[str, bytes], now: datetime
    ) -> Registration:
        plan, answer, raw, finding_raw = closed_review(review, now)
        code_sha = bundle_digest(code)
        question = " ".join(answer.nextQuestion.casefold().split())
        question_id = sha(encoded([plan["sourceId"], question]))
        trial_id = sha(encoded([question_id, sha(raw), code_sha, method.model_dump()]))
        with self.locked():
            group = self.directory(question_id)
            if not group.exists():
                if sum(p.is_dir() for p in self.root.iterdir()) >= MAX_QUESTIONS:
                    raise ValueError("RESEARCH_REGISTRY_QUESTION_CAPACITY")
                group.mkdir(mode=0o700)
                sync_directory(self.root)
            immutable(group / "question.json", {"sourceId": plan["sourceId"], "question": question})
            # Keep each occurrence: exact duplicate questions are deduplicated, not hidden.
            immutable(
                group / ("occurrence-" + sha(finding_raw) + ".json"),
                {
                    "findingSha256": sha(finding_raw),
                    "planId": plan["id"],
                    "packetSha256": sha(raw),
                },
            )
            job = self.directory(question_id, trial_id)
            # Count reserved directories too: interrupted/unknown/negative trials consume budget.
            if not job.exists():
                if sum(p.is_dir() for p in group.iterdir()) >= MAX_TRIALS:
                    raise ValueError("RESEARCH_REGISTRY_TRIAL_BUDGET")
                job.mkdir(mode=0o700)
                sync_directory(group)
            # Keep the first provenance on retries, including interrupted registration.
            atomic_bytes(job / "input.json", raw, replace=False)
            immutable(
                job / "code.json", {name: content.hex() for name, content in sorted(code.items())}
            )
            if not (job / "finding.json").exists():
                atomic_bytes(job / "finding.json", finding_raw, replace=False)
            original_raw = bounded(job / "finding.json", 32768)
            original = json.loads(original_raw, object_pairs_hook=unique)
            origin_receipt = read(group / ("occurrence-" + sha(original_raw) + ".json"))
            if original["planId"] != plan["id"] or origin_receipt != {
                "findingSha256": sha(original_raw),
                "planId": plan["id"],
                "packetSha256": sha(raw),
            }:
                raise ValueError("RESEARCH_REGISTRY_ORIGIN_BINDING")
            original_answer = Interpretation.model_validate(original["interpretation"])
            registration_path = job / "registration.json"
            if not registration_path.exists():
                value = Registration(
                    schemaVersion="research-experiment-registration-1.0",
                    sourceId=plan["sourceId"],
                    questionId=question_id,
                    trialId=trial_id,
                    question=original_answer.nextQuestion,
                    requiredEvidence=original_answer.requiredEvidence,
                    originatingFalsification=original_answer.falsificationTest,
                    findingSha256=sha(original_raw),
                    planId=original["planId"],
                    packetSha256=sha(raw),
                    codeBundleSha256=code_sha,
                    method=method,
                    registeredAt=now.isoformat(),
                    maxTrialsPerExactQuestion=MAX_TRIALS,
                    counterfactualCosts=None,
                    executionAuthority=False,
                    brokerAuthority=False,
                    promotionAuthority=False,
                )
                immutable(registration_path, value.model_dump())
            _, value = self.load(question_id, trial_id)
            return value

    def load(self, question: str, trial: str) -> tuple[Path, Registration]:
        job = self.directory(question, trial)
        value = Registration.model_validate(read(job / "registration.json"))
        code = {
            name: bytes.fromhex(raw)
            for name, raw in read(job / "code.json", 3 * 1024 * 1024).items()
        }
        raw = bounded(job / "input.json", MAX_BYTES)
        packet = parse(raw, sha(raw))
        finding = read(job / "finding.json")
        answer = Interpretation.model_validate(finding["interpretation"])
        if (
            question != sha(encoded([value.sourceId, " ".join(value.question.casefold().split())]))
            or value.question != answer.nextQuestion
            or value.requiredEvidence != answer.requiredEvidence
            or value.originatingFalsification != answer.falsificationTest
            or value.planId != finding["planId"]
            or timestamp(value.registeredAt) < timestamp(finding["recordedAt"])
            or value.questionId != question
            or value.trialId != trial
            or value.sourceId != packet.sourceId
            or value.packetSha256 != sha(raw)
            or value.codeBundleSha256 != bundle_digest(code)
            or value.findingSha256 != sha(bounded(job / "finding.json", 32768))
            or trial
            != sha(encoded([question, sha(raw), value.codeBundleSha256, value.method.model_dump()]))
        ):
            raise ValueError("RESEARCH_REGISTRY_FROZEN_BYTES_CHANGED")
        return job, value

    def claim(self, question: str, trial: str, now: datetime) -> dict[str, Any] | None:
        """One local dispatch claim. Existing claims never grant permission to replay."""
        with self.locked():
            job, value = self.load(question, trial)
            if (job / "claim.json").exists():
                return None
            if timestamp(value.registeredAt) > now:
                raise ValueError("RESEARCH_REGISTRY_CLAIM_CLOCK")
            claim = {
                "trialId": trial,
                "registrationSha256": sha(encoded(value.model_dump())),
                "claimedAt": now.isoformat(),
            }
            immutable(job / "claim.json", claim)
            return claim

    def retain(self, question: str, outcome: Outcome, raw: bytes) -> None:
        """Retain every terminal or censored result without claiming independent truth."""
        if len(raw) > 65536 or sha(raw) != outcome.resultSha256:
            raise ValueError("RESEARCH_REGISTRY_RESULT_INVALID")
        with self.locked():
            job, value = self.load(question, outcome.trialId)
            claim = read(job / "claim.json")
            if (
                outcome.claimSha256 != sha(encoded(claim))
                or claim["trialId"] != value.trialId
                or claim["registrationSha256"] != sha(encoded(value.model_dump()))
                or timestamp(outcome.recordedAt) < timestamp(claim["claimedAt"])
            ):
                raise ValueError("RESEARCH_REGISTRY_RESULT_BINDING")
            atomic_bytes(job / "result.bin", raw, replace=False)
            immutable(job / "outcome.json", outcome.model_dump())

    def status(self, question: str, trial: str) -> dict[str, Any]:
        with self.locked():
            job, value = self.load(question, trial)
            state = "REGISTERED_UNQUALIFIED"
            if (job / "claim.json").exists():
                state = "CLAIMED_OUTCOME_UNKNOWN"
            if (job / "outcome.json").exists():
                outcome = Outcome.model_validate(read(job / "outcome.json"))
                claim = read(job / "claim.json")
                if (
                    outcome.trialId != trial
                    or claim["trialId"] != trial
                    or claim["registrationSha256"] != sha(encoded(value.model_dump()))
                    or timestamp(outcome.recordedAt) < timestamp(claim["claimedAt"])
                    or outcome.claimSha256 != sha(encoded(claim))
                    or outcome.resultSha256 != sha(bounded(job / "result.bin", 65536))
                ):
                    raise ValueError("RESEARCH_REGISTRY_RESULT_BINDING")
                state = "RECORDED_UNVERIFIED_" + outcome.kind
            return {
                "trialId": value.trialId,
                "status": state,
                "questionOccurrences": sum(1 for _ in job.parent.glob("occurrence-*.json")),
                "reservedTrials": sum(p.is_dir() for p in job.parent.iterdir()),
                "executionAuthority": False,
                "promotionAuthority": False,
            }
