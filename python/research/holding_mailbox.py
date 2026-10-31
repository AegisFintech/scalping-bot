"""Fixed-task research mailboxes; intake is idempotent, provider claims never replay."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal

from pydantic import Field, model_validator

from python.research import holding_attestation as scorer
from python.research import holding_task as task
from python.research.codex_loop import StrictModel, timestamp
from python.research.experiment_registry import Registry, read
from python.research.isolated_worker import WorkerTrust, bundle_digest
from python.research.learning_archive import bounded, immutable, unique
from python.research.learning_evidence import MAX_BYTES, encoded
from python.research.observation_cycle import sha
from python.research.source_verifier import SourceReceipt, VerifiedCandidate

ARCHIVE = (
    "registration.json",
    "input.json",
    "result.bin",
    "experiment-finding.json",
    "remote-receipt.json",
    "experiment-closed.json",
)
MAX_TRANSFER = 2 * MAX_BYTES + 524288
MAX_SMALL = 160000


def archive(job: Path) -> dict[str, str]:
    return {
        name: bounded(job / name, MAX_BYTES if name == "input.json" else MAX_SMALL).hex()
        for name in ARCHIVE
    }


def unpack(value: dict[str, str], destination: Path) -> None:
    if set(value) != set(ARCHIVE):
        raise ValueError("HOLDING_ARCHIVE_FIELDS")
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ARCHIVE:
        maximum = MAX_BYTES if name == "input.json" else MAX_SMALL
        raw = value[name]
        if len(raw) > maximum * 2 or not re.fullmatch(r"(?:[a-f0-9]{2})*", raw):
            raise ValueError("HOLDING_ARCHIVE_ENCODING")
        path = destination / name
        data = bytes.fromhex(raw)
        if path.exists():
            if bounded(path, maximum) != data:
                raise ValueError("HOLDING_ARCHIVE_CONFLICT")
        else:
            from python.research.learning_archive import atomic_bytes

            atomic_bytes(path, data, replace=False)


class Generation(StrictModel):
    version: Literal["holding-generation-request-1.0"]
    task: Literal["recorded-holding-payoff-1.0"]
    baseCommit: str = Field(pattern=r"^[a-f0-9]{40}$")
    experiment: dict[str, str]

    @model_validator(mode="after")
    def binding(self) -> Generation:
        with TemporaryDirectory() as directory:
            unpack(self.experiment, Path(directory))
            task.evidence(Path(directory))
        return self


class Scoring(StrictModel):
    version: Literal["holding-scoring-request-1.0"]
    task: Literal["recorded-holding-payoff-1.0"]
    source: SourceReceipt
    facts: dict[str, Any]
    files: dict[str, str]
    inputHex: str = Field(pattern=r"^(?:[a-f0-9]{2})*$", max_length=2 * MAX_BYTES)

    def data(self) -> bytes:
        raw = bytes.fromhex(self.inputHex)
        value = json.loads(raw, object_pairs_hook=unique)
        if (
            set(value) != {"module", "cases"}
            or value["module"] != task.MODULE
            or len(value["cases"]) != 28
            or value["cases"][0] != self.facts["rows"]
        ):
            raise ValueError("HOLDING_SCORING_CHALLENGES")
        return raw

    def verified(self) -> VerifiedCandidate:
        if set(self.files) != {task.MODULE, task.NOTE}:
            raise ValueError("HOLDING_SCORING_FILES")
        if any(
            len(v) > 32768 or not re.fullmatch(r"(?:[a-f0-9]{2})*", v) for v in self.files.values()
        ):
            raise ValueError("HOLDING_SCORING_ENCODING")
        files = {name: bytes.fromhex(raw) for name, raw in self.files.items()}
        draft = task.Draft(
            task=task.TASK,
            baseCommit=self.source.baseCommit,
            resultSha256=self.facts["resultSha256"],
            findingSha256=self.facts["findingSha256"],
            code=files[task.MODULE].decode(),
            rationale="Protected parent binding",
        )
        if (
            task.candidate_files(draft, self.facts, draft.baseCommit) != files
            or bundle_digest(files) != self.source.bundleSha256
        ):
            raise ValueError("HOLDING_SCORING_BINDING")
        return VerifiedCandidate(self.source, files)

    @model_validator(mode="after")
    def binding(self) -> Scoring:
        self.verified()
        self.data()
        return self


class Mailbox(Registry):
    """Each provisioned receiver accepts exactly one role, never caller-selected commands."""

    def __init__(self, root: Path, kind: Literal["generation", "scoring"]):
        if kind not in {"generation", "scoring"}:
            raise ValueError("HOLDING_MAILBOX_ROLE")
        super().__init__(root)
        self.kind = kind

    def validate(self, value: Any) -> Generation | Scoring:
        return (
            Generation.model_validate(value)
            if self.kind == "generation"
            else Scoring.model_validate(value)
        )

    def submit(self, raw: bytes) -> dict[str, Any]:
        if len(raw) > MAX_TRANSFER:
            raise ValueError("HOLDING_MAILBOX_INPUT_LIMIT")
        value = self.validate(json.loads(raw, object_pairs_hook=unique))
        canonical = encoded(value.model_dump())
        key = sha(canonical)
        with self.locked():
            job = self.directory(key)
            if not job.exists():
                if (
                    sum(
                        p.is_dir() and bool(re.fullmatch(r"[a-f0-9]{64}", p.name))
                        for p in self.root.iterdir()
                    )
                    >= 4
                ):
                    raise ValueError("HOLDING_MAILBOX_TASK_BUDGET")
                job.mkdir(mode=0o700)
            path = job / "request.json"
            if path.exists():
                if bounded(path, MAX_TRANSFER) != canonical:
                    raise ValueError("HOLDING_MAILBOX_CONFLICT")
            else:
                immutable(path, value.model_dump())
        return self.query(key)

    def query(self, key: str) -> dict[str, Any]:
        job = self.directory(key)
        if not (job / "request.json").exists():
            return {"job": key, "status": "NOT_RECEIVED"}
        if not (job / "receipt.json").exists():
            return {"job": key, "status": "QUEUED_OR_UNKNOWN"}
        receipt = read(job / "receipt.json", MAX_TRANSFER)
        if receipt["job"] != key or receipt["requestSha256"] != sha(
            bounded(job / "request.json", MAX_TRANSFER)
        ):
            raise ValueError("HOLDING_MAILBOX_RECEIPT_BINDING")
        return dict(receipt)

    def work(
        self,
        *,
        invoke: Callable[[str, Path], bytes] | None = None,
        trust: WorkerTrust | None = None,
        oracle: str | None = None,
    ) -> dict[str, Any]:
        # Serialize execution separately so the forced receiver can still acknowledge intake.
        import fcntl

        path = self.root / "worker.lock"
        if path.is_symlink():
            raise ValueError("HOLDING_MAILBOX_LOCK")
        with path.open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for job in sorted(self.root.iterdir()):
                if (
                    job.is_symlink()
                    or not job.is_dir()
                    or not re.fullmatch(r"[a-f0-9]{64}", job.name)
                    or (job / "receipt.json").exists()
                ):
                    continue
                raw = bounded(job / "request.json", MAX_TRANSFER)
                if sha(raw) != job.name:
                    raise ValueError("HOLDING_MAILBOX_IDENTITY")
                value = self.validate(json.loads(raw, object_pairs_hook=unique))
                artifacts: dict[str, str] = {}
                if isinstance(value, Generation):
                    if invoke is None:
                        raise ValueError("HOLDING_GENERATOR_UNAVAILABLE")
                    unpack(value.experiment, job / "experiment")
                    outcome = task.generate(
                        self.root / "attempts", job / "experiment", value.baseCommit, invoke
                    )
                    if outcome.get("job"):
                        attempt = Registry(self.root / "attempts").directory(outcome["job"])
                        for name in (
                            "binding.json",
                            "request.json",
                            "claim.json",
                            "response.json",
                            "draft.json",
                            "rejected.json",
                        ):
                            if (attempt / name).exists():
                                artifacts[name] = bounded(attempt / name, MAX_SMALL).hex()
                else:
                    if trust is None or oracle is None:
                        raise ValueError("HOLDING_SCORER_UNAVAILABLE")
                    destination = job / "attestation"
                    destination.mkdir(mode=0o700, exist_ok=True)
                    from python.research.learning_archive import atomic_bytes

                    input_path = destination / "input.json"
                    if input_path.exists():
                        if bounded(input_path, MAX_BYTES) != value.data():
                            raise ValueError("HOLDING_SCORING_INPUT_CHANGED")
                    else:
                        atomic_bytes(input_path, value.data(), replace=False)
                    outcome = scorer.attest(
                        value.verified(),
                        value.facts,
                        value.facts["rows"],
                        trust,
                        job / "attestation",
                        oracle,
                    )
                    for name in (
                        "binding.json",
                        "input.json",
                        "claim.json",
                        "output.json",
                        "attestation.json",
                    ):
                        if (job / "attestation" / name).exists():
                            artifacts[name] = bounded(job / "attestation" / name, MAX_BYTES).hex()
                result = {
                    "job": job.name,
                    "requestSha256": sha(raw),
                    "status": outcome["status"],
                    "outcome": outcome,
                    "artifacts": artifacts,
                }
                if len(encoded(result)) > MAX_TRANSFER:
                    raise ValueError("HOLDING_MAILBOX_OUTPUT_LIMIT")
                immutable(job / "receipt.json", result)
                return result
        return {"status": "IDLE"}


def discover(root: Path) -> dict[str, Any]:
    """Newest complete closed-row window, irrespective of its outcome sign."""
    paths = sorted(root.glob("*/*/experiment-closed.json"))
    if len(paths) > 1000:
        raise ValueError("HOLDING_DISCOVERY_CAPACITY")
    eligible = []
    invalid = 0
    for path in paths:
        try:
            facts, rows = task.evidence(path.parent)
            if rows:
                packet = read(path.parent / "input.json", MAX_BYTES)
                eligible.append((timestamp(packet["until"]), facts["trialId"], path.parent))
        except (ValueError, OSError, KeyError, TypeError):
            invalid += 1
    if not eligible:
        return {"status": "NO_CLOSED_ROWS", "invalidArchives": invalid}
    _, trial, job = max(eligible)
    return {
        "status": "ELIGIBLE",
        "trialId": trial,
        "experiment": archive(job),
        "invalidArchives": invalid,
    }
