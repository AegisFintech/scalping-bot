"""Content-addressed external observations, separate from accounts and autonomous findings."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel
from python.research.learning_evidence import (
    MAX_BYTES,
    Digest,
    Instant,
    LearningEvidence,
    Name,
    encoded,
)

FAMILIES = ("contexts", "analyses", "setups", "flight")
MAX_INDEX_BYTES = 8 * 1024 * 1024


class Pointer(StrictModel):
    revisionSha256: Digest
    contentSha256: Digest
    snapshotAt: Instant


class ArchiveIndex(StrictModel):
    schemaVersion: Literal["scalper-learning-archive-1.0"]
    sourceId: Name
    symbol: Name
    latest: dict[str, Pointer] = Field(max_length=50_000)
    packets: dict[Digest, Instant] = Field(max_length=10_000)
    autonomousFinding: Literal[False]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]

    @model_validator(mode="after")
    def keys(self) -> ArchiveIndex:
        if any(
            not re.fullmatch(r"(contexts|analyses|setups|flight):[a-f0-9]{24}", k)
            for k in self.latest
        ):
            raise ValueError("LEARNING_INDEX_KEY_INVALID")
        return self


def bounded(path: Path, maximum: int) -> bytes:
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file():
        raise ValueError("LEARNING_ARCHIVE_FILE_INVALID")
    with path.open("rb") as f:
        raw = f.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError("LEARNING_ARCHIVE_BYTE_LIMIT")
    return raw


def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("LEARNING_JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def parse(raw: bytes, expected: str) -> LearningEvidence:
    if (
        len(raw) > MAX_BYTES
        or not re.fullmatch(r"[a-f0-9]{64}", expected)
        or hashlib.sha256(raw).hexdigest() != expected
    ):
        raise ValueError("LEARNING_PACKET_HASH_MISMATCH")
    return LearningEvidence.model_validate(json.loads(raw, object_pairs_hook=unique))


def immutable(path: Path, value: Any) -> None:
    raw = encoded(value)
    if path.exists():
        if bounded(path, MAX_BYTES) != raw:
            raise ValueError("LEARNING_ARCHIVE_CONTENT_CONFLICT")
        sync_directory(path.parent)
    else:
        atomic_bytes(path, raw, replace=False)


def sync_directory(path: Path) -> None:
    directory = os.open(path, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def atomic_bytes(path: Path, raw: bytes, *, replace: bool) -> None:
    # Observations can retry after interruption; partial bytes never occupy a digest path.
    descriptor, name = tempfile.mkstemp(prefix=".learning-staging-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if bounded(path, MAX_BYTES) != raw:
                    raise ValueError("LEARNING_ARCHIVE_CONTENT_CONFLICT") from None
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def durable_json(path: Path, value: Any) -> None:
    atomic_bytes(path, encoded(value), replace=True)


class ResearchArchive:
    def __init__(self, root: Path):
        if any(p.is_symlink() for p in (root, *root.parents)):
            raise ValueError("LEARNING_ARCHIVE_ROOT_INVALID")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root = root

    def ingest(self, raw: bytes, expected: str, source: str) -> dict[str, Any]:
        evidence = parse(raw, expected)
        if evidence.sourceId != source:
            raise ValueError("LEARNING_SOURCE_MISMATCH")
        directory = self.root / source
        if directory.is_symlink():
            raise ValueError("LEARNING_ARCHIVE_ROOT_INVALID")
        directory.mkdir(mode=0o700, exist_ok=True)
        lock = directory / ".ingest.lock"
        if lock.is_symlink():
            raise ValueError("LEARNING_ARCHIVE_LOCK_INVALID")
        with lock.open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return self._ingest(directory, evidence, expected)

    def _ingest(self, directory: Path, evidence: LearningEvidence, packet: str) -> dict[str, Any]:
        path = directory / "index.json"
        index = (
            ArchiveIndex.model_validate_json(bounded(path, MAX_INDEX_BYTES))
            if path.exists()
            else ArchiveIndex(
                schemaVersion="scalper-learning-archive-1.0",
                sourceId=evidence.sourceId,
                symbol=evidence.symbol,
                latest={},
                packets={},
                autonomousFinding=False,
                brokerAuthority=False,
                promotionAuthority=False,
            )
        )
        if (index.sourceId, index.symbol) != (evidence.sourceId, evidence.symbol):
            raise ValueError("LEARNING_ARCHIVE_SCOPE_CONFLICT")
        records: dict[str, dict[str, Any]] = {}
        refs: dict[str, dict[str, str]] = {}
        changed = stale = 0
        for family in FAMILIES:
            for row in getattr(evidence, family):
                key = family + ":" + row.id
                value = row.model_dump()
                records[key] = value
                refs[key] = {"revisionSha256": row.revisionSha256}
                previous = index.latest.get(key)
                pointer = Pointer(
                    revisionSha256=row.revisionSha256,
                    contentSha256=hashlib.sha256(encoded(value)).hexdigest(),
                    snapshotAt=row.observedAt if family == "flight" else evidence.journalSnapshotAt,
                )
                if (
                    previous
                    and previous.snapshotAt == pointer.snapshotAt
                    and previous.revisionSha256 != pointer.revisionSha256
                ):
                    raise ValueError("LEARNING_SNAPSHOT_CONFLICT")
                if previous and previous.snapshotAt > pointer.snapshotAt:
                    stale += 1
                    continue
                changed += previous is None or previous.revisionSha256 != pointer.revisionSha256
                index.latest[key] = pointer
        index.packets[packet] = evidence.journalSnapshotAt
        # Validate capacity before publication; a full archive never prunes learning.
        index = ArchiveIndex.model_validate(index.model_dump())
        if len(encoded(index.model_dump())) > MAX_INDEX_BYTES:
            raise ValueError("LEARNING_ARCHIVE_CAPACITY")
        for name in ("records", "packets"):
            target = directory / name
            if target.is_symlink():
                raise ValueError("LEARNING_ARCHIVE_ROOT_INVALID")
            target.mkdir(mode=0o700, exist_ok=True)
        for key, value in records.items():
            # The full record digest includes the revision seal and all bounded observed fields.
            content = hashlib.sha256(encoded(value)).hexdigest()
            refs[key]["contentSha256"] = content
            immutable(directory / "records" / (content + ".json"), value)
        manifest = {
            **evidence.model_dump(exclude=set(FAMILIES)),
            "recordReferences": refs,
            "packetSha256": packet,
        }
        immutable(directory / "packets" / (packet + ".json"), manifest)
        durable_json(path, index.model_dump())
        return {
            "schemaVersion": "scalper-learning-import-1.0",
            "sourceId": evidence.sourceId,
            "packetSha256": packet,
            "recordCount": len(records),
            "changedRecords": changed,
            "staleRecordsNotPromoted": stale,
            "autonomousFinding": False,
            "brokerAuthority": False,
            "promotionAuthority": False,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--archive", type=Path, required=True)
    args = parser.parse_args()
    receipt = ResearchArchive(args.archive).ingest(
        bounded(args.input, MAX_BYTES), args.sha256, args.source
    )
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("LEARNING_IMPORT_FAILED", file=sys.stderr)
        raise SystemExit(1) from None
