"""Registered bounded breakout observation; SELECT-only, no model or broker commands."""

from __future__ import annotations

import argparse
import fcntl
import gzip
import io
import json
import os
import re
import shutil
import sys
import zlib
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from importlib.metadata import distributions
from pathlib import Path
from typing import Any, Final, Literal

from pydantic import Field, model_validator

from python.research.breakout_hypotheses import CANDIDATES, BreakoutMeasurement, measure
from python.research.codex_loop import StrictModel, timestamp
from python.research.isolated_worker import trusted_path
from python.research.learning_archive import (
    atomic_bytes,
    bounded,
    durable_json,
    immutable,
    parse,
    unique,
)
from python.research.learning_evidence import MAX_BYTES, Digest, Instant, LearningEvidence, encoded

RELEASE: Final = "0.9.0-cost-balanced.1-codex.2"
MAX_STORAGE = 256 * 1024 * 1024


class Registration(StrictModel):
    schemaVersion: Literal["breakout-observer-registration-1.1"]
    registeredAt: Instant
    start: Instant
    until: Instant
    sourceFiles: dict[str, Digest] = Field(max_length=300)
    pythonSha256: Digest
    packagesSha256: Digest
    release: Literal["0.9.0-cost-balanced.1-codex.2"]
    sourceId: Literal["scalper-epoch314"] = "scalper-epoch314"
    definitions: Literal["FIVE_M1_RANGE_ONE_TICK_BUFFER_M5_THREE_CLOSE_DIRECTION_FIVE_FUTURE_M1"]
    exitReference: Literal[
        "OPPOSITE_RANGE_PLUS_TICK_TARGET_STOP_DISTANCE_PLUS_TWICE_RECORDED_COST_MAX_SEVEN"
    ] = "OPPOSITE_RANGE_PLUS_TICK_TARGET_STOP_DISTANCE_PLUS_TWICE_RECORDED_COST_MAX_SEVEN"
    candidates: list[Literal["RANGE_BREAK", "BAR_CONFIRM", "BREAK_RETEST"]]
    counterfactualFill: None = None
    counterfactualNet: None = None
    economicQualification: Literal[False] = False
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False

    @model_validator(mode="after")
    def future(self) -> Registration:
        start, until = timestamp(self.start), timestamp(self.until)
        if (
            not timestamp(self.registeredAt) < start < until
            or until - start > timedelta(days=7)
            or any(t.minute % 30 or t.second or t.microsecond for t in (start, until))
            or not {
                "python/operations/breakout_observer.py",
                "python/research/breakout_hypotheses.py",
                "requirements.lock",
                "packages/config/src/policy.ts",
            }.issubset(self.sourceFiles)
            or any(name.startswith("/") or ".." in name.split("/") for name in self.sourceFiles)
            or self.candidates != list(CANDIDATES)
        ):
            raise ValueError("BREAKOUT_REGISTRATION_INVALID")
        return self


def source_hashes(root: Path | None = None) -> dict[str, str]:
    root = root or Path(__file__).resolve().parents[2]
    names = sorted(str(p.relative_to(root)) for p in (root / "python").rglob("*.py"))
    return {
        name: sha256((root / name).read_bytes()).hexdigest()
        for name in [*names, "packages/config/src/policy.ts", "requirements.lock"]
    }


def runtime_hashes(root: Path | None = None) -> dict[str, str]:
    environment = root / ".venv" if root is not None else None
    installed = (
        [
            d
            for site in (environment / "lib").glob("python*/site-packages")
            for d in distributions(path=[str(site)])
        ]
        if environment is not None
        else list(distributions())
    )
    packages = sorted((d.metadata["Name"], d.version) for d in installed)
    if not packages or len(packages) > 300:
        raise ValueError("BREAKOUT_RUNTIME_PACKAGES")
    executable = environment / "bin/python" if environment is not None else Path(sys.executable)
    return {
        "pythonSha256": sha256(executable.resolve(strict=True).read_bytes()).hexdigest(),
        "packagesSha256": sha256(encoded(packages)).hexdigest(),
    }


def register(destination: Path, start: datetime, until: datetime, now: datetime) -> Registration:
    runtime = runtime_hashes()
    value = Registration(
        schemaVersion="breakout-observer-registration-1.1",
        registeredAt=now.isoformat(),
        start=start.isoformat(),
        until=until.isoformat(),
        sourceFiles=source_hashes(),
        pythonSha256=runtime["pythonSha256"],
        packagesSha256=runtime["packagesSha256"],
        release=RELEASE,
        definitions="FIVE_M1_RANGE_ONE_TICK_BUFFER_M5_THREE_CLOSE_DIRECTION_FIVE_FUTURE_M1",
        candidates=["RANGE_BREAK", "BAR_CONFIRM", "BREAK_RETEST"],
    )
    immutable(destination, value.model_dump())
    destination.chmod(0o444)
    return value


def export_window(start: datetime, until: datetime) -> bytes:
    import psycopg
    from psycopg.rows import dict_row

    from python.operations.export_learning_evidence import export

    with psycopg.connect(
        os.environ["DATABASE_URL"],
        autocommit=True,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on -c statement_timeout=10000",
    ) as connection:
        packet = export(
            connection,
            os.environ["ACCOUNT_KEY_HASH"],
            os.environ.get("TRADING_SYMBOL", "XAUUSD"),
            "scalper-epoch314",
            start,
            until,
            flight_directory=Path("/var/lib/scalper-flight/recordings"),
        )
    return encoded(packet.model_dump())


def validate_packet(
    packet: LearningEvidence, registration: Registration, start: datetime, end: datetime
) -> None:
    if packet.sourceId != registration.sourceId or packet.symbol != "XAUUSD":
        raise ValueError("BREAKOUT_PACKET_SCOPE")
    if (timestamp(packet.start), timestamp(packet.until)) != (start, end):
        raise ValueError("BREAKOUT_WINDOW_MISMATCH")
    if any(
        c.originRelease != registration.release
        for c in packet.contexts
        if start <= timestamp(c.requestedAt) < end
        or (c.availableAt is not None and start <= timestamp(c.availableAt) < end)
    ):
        raise ValueError("BREAKOUT_RELEASE_DRIFT")


def collect(
    root: Path,
    registration: Registration,
    now: datetime,
    *,
    export: Callable[[datetime, datetime], bytes] = export_window,
) -> dict[str, Any]:
    if root.is_symlink():
        raise ValueError("BREAKOUT_ROOT_SYMLINK")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = root / ".lock"
    if lock.is_symlink():
        raise ValueError("BREAKOUT_LOCK_SYMLINK")
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result: dict[str, Any] = {
            "checkedAt": now.isoformat(),
            "registrationSha256": sha256(encoded(registration.model_dump())).hexdigest(),
            "status": "WAITING_WINDOW",
            "brokerAuthority": False,
            "economicQualification": False,
        }
        if source_hashes() != registration.sourceFiles:
            result["status"] = "SOURCE_DRIFT"
        elif runtime_hashes() != {
            "pythonSha256": registration.pythonSha256,
            "packagesSha256": registration.packagesSha256,
        }:
            result["status"] = "RUNTIME_DRIFT"
        else:
            files = list(root.glob("*"))
            if (
                len(files) > 5000
                or sum(p.stat().st_size for p in files if p.is_file()) > MAX_STORAGE
                or shutil.disk_usage(root).free < 2 * 1024 * 1024 * 1024
            ):
                raise ValueError("BREAKOUT_STORAGE_CAPACITY")
            start = timestamp(registration.start)
            until = timestamp(registration.until)
            while start < until:
                end = start + timedelta(minutes=30)
                prefix = root / start.strftime("window-%Y%m%dT%H%M")
                report = prefix.with_suffix(".report.json")
                input_path = prefix.with_suffix(".input.json.gz")
                if not report.exists():
                    if now < end + timedelta(minutes=5):
                        break
                    claim = prefix.with_suffix(".capture.json")
                    used = sum(p.stat().st_size for p in root.glob("*") if p.is_file())
                    if input_path.exists():
                        raw = decompress(input_path)
                    else:
                        if claim.exists():
                            raise ValueError("BREAKOUT_INPUT_EXPORT_UNKNOWN")
                        # Reserve maximum input/report bytes before claiming an export.
                        if used + 2 * MAX_BYTES + 81920 > MAX_STORAGE:
                            raise ValueError("BREAKOUT_STORAGE_CAPACITY")
                        immutable(
                            claim,
                            {
                                **result,
                                "windowStart": start.isoformat(),
                                "windowUntil": end.isoformat(),
                            },
                        )
                        claim.chmod(0o400)
                        raw = export(start, end)
                        if len(raw) > MAX_BYTES:
                            raise ValueError("BREAKOUT_INPUT_LIMIT")
                        atomic_bytes(input_path, gzip.compress(raw, mtime=0), replace=False)
                        input_path.chmod(0o400)
                    digest = sha256(raw).hexdigest()
                    packet = parse(raw, digest)
                    validate_packet(packet, registration, start, end)
                    measured = measure(packet, digest)
                    output = {
                        "registrationSha256": result["registrationSha256"],
                        "inputCompression": "GZIP_ORIGINAL_PACKET_BYTES",
                        "measurement": measured.model_dump(),
                        "scope": "REGISTERED_FUTURE_COLLECTION_NOT_EXECUTION_QUALIFICATION",
                    }
                    used = sum(p.stat().st_size for p in root.glob("*") if p.is_file())
                    output_size = len(encoded(output))
                    if output_size > MAX_BYTES or used + output_size + 16384 > MAX_STORAGE:
                        raise ValueError("BREAKOUT_STORAGE_CAPACITY")
                    immutable(
                        report,
                        output,
                    )
                    report.chmod(0o400)
                    result.update(
                        status="RECORDED",
                        windowStart=start.isoformat(),
                        windowUntil=end.isoformat(),
                        reportSha256=sha256(bounded(report, MAX_BYTES)).hexdigest(),
                    )
                    break
                start = end
            else:
                result["status"] = "COLLECTION_COMPLETE_NOT_QUALIFIED"
        durable_json(root / "status.json", result)
        return result


def decompress(path: Path) -> bytes:
    with gzip.GzipFile(fileobj=io.BytesIO(bounded(path, MAX_BYTES + 65536))) as handle:
        raw = handle.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("BREAKOUT_DECOMPRESSED_LIMIT")
    return raw


def failure(
    root: Path, registration: Registration, now: datetime, error: Exception
) -> dict[str, Any]:
    code = str(error)
    if not re.fullmatch(r"(?:BREAKOUT|LEARNING)_[A-Z0-9_]{1,96}", code):
        code = "BREAKOUT_COLLECTOR_READ_FAILURE"
    result = {
        "checkedAt": now.isoformat(),
        "registrationSha256": sha256(encoded(registration.model_dump())).hexdigest(),
        "status": code,
        "brokerAuthority": False,
        "economicQualification": False,
    }
    durable_json(root / "status.json", result)
    return result


def read_status(registration_path: Path, root: Path, source: Path, now: datetime) -> dict[str, Any]:
    """Bounded local evidence; no model, SSH, database or broker reads."""
    try:
        trusted_path(registration_path.resolve(strict=True))
        trusted_path(source.resolve(strict=True))
        raw = bounded(registration_path, 32768)
        reg = Registration.model_validate_json(raw)
        if source_hashes(source.resolve(strict=True)) != reg.sourceFiles:
            raise ValueError("BREAKOUT_SOURCE_DRIFT")
        if runtime_hashes(source.resolve(strict=True)) != {
            "pythonSha256": reg.pythonSha256,
            "packagesSha256": reg.packagesSha256,
        }:
            raise ValueError("BREAKOUT_RUNTIME_DRIFT")
        state = json.loads(bounded(root / "status.json", 8192), object_pairs_hook=unique)
        if state["registrationSha256"] != sha256(raw).hexdigest():
            raise ValueError("BREAKOUT_STATUS_BINDING")
        checked = timestamp(state["checkedAt"])
        if checked > now + timedelta(seconds=5):
            raise ValueError("BREAKOUT_STATUS_FUTURE")
        reports = sorted(root.glob("*.report.json"))
        files = list(root.glob("*"))
        if len(files) > 5000:
            raise ValueError("BREAKOUT_STORAGE_CAPACITY")
        latest = None
        if reports:
            report = json.loads(bounded(reports[-1], MAX_BYTES), object_pairs_hook=unique)
            if report["registrationSha256"] != sha256(raw).hexdigest():
                raise ValueError("BREAKOUT_REPORT_BINDING")
            measured = BreakoutMeasurement.model_validate(report["measurement"])
            original = decompress(
                reports[-1].with_name(reports[-1].name.replace(".report.json", ".input.json.gz"))
            )
            if sha256(original).hexdigest() != measured.packetSha256:
                raise ValueError("BREAKOUT_INPUT_BINDING")
            if (
                not timestamp(reg.start)
                <= timestamp(measured.start)
                < timestamp(measured.until)
                <= timestamp(reg.until)
            ):
                raise ValueError("BREAKOUT_REPORT_WINDOW")
            start, end = timestamp(measured.start), timestamp(measured.until)
            if end - start != timedelta(minutes=30) or reports[-1].name != start.strftime(
                "window-%Y%m%dT%H%M.report.json"
            ):
                raise ValueError("BREAKOUT_REPORT_WINDOW")
            packet = parse(original, measured.packetSha256)
            validate_packet(packet, reg, start, end)
            if measure(packet, measured.packetSha256) != measured:
                raise ValueError("BREAKOUT_REPORT_RECOMPUTATION")
            latest = {
                "until": measured.until,
                "origins": measured.availabilityWindowContexts,
                "counts": measured.counts,
                "levelCounts": measured.levelCounts,
            }
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,99}", state["status"]):
            raise ValueError("BREAKOUT_STATUS_CODE")
        return {
            "readState": "STALE" if now - checked > timedelta(minutes=35) else "CURRENT",
            "status": state["status"],
            "checkedAt": state["checkedAt"],
            "start": reg.start,
            "until": reg.until,
            "release": reg.release,
            "sourceId": reg.sourceId,
            "registrationSha256": sha256(raw).hexdigest(),
            "ageSeconds": max(0, int((now - checked).total_seconds())),
            "retainedWindows": len(reports),
            "expectedWindows": int(
                (timestamp(reg.until) - timestamp(reg.start)) // timedelta(minutes=30)
            ),
            "storageBytes": sum(p.stat().st_size for p in files if p.is_file()),
            "storageLimitBytes": MAX_STORAGE,
            "freeBytes": shutil.disk_usage(root).free,
            "latest": latest,
            "economicQualification": False,
        }
    except (OSError, ValueError, KeyError, TypeError, EOFError, zlib.error):
        return {
            "readState": "UNAVAILABLE",
            "status": "REGISTERED_STUDY_EVIDENCE_UNAVAILABLE",
            "latest": None,
            "economicQualification": False,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["register", "collect"])
    parser.add_argument("--registration", type=Path, required=True)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--start")
    parser.add_argument("--until")
    args = parser.parse_args()
    if args.action == "register":
        if os.geteuid() != 0 or args.start is None or args.until is None:
            raise ValueError("BREAKOUT_REGISTRATION_ADMIN_REQUIRED")
        register(args.registration, timestamp(args.start), timestamp(args.until), datetime.now(UTC))
        print("BREAKOUT_REGISTERED")
    else:
        if os.geteuid() == 0 or args.root is None:
            raise ValueError("BREAKOUT_DEDICATED_READER_REQUIRED")
        trusted_path(args.registration.resolve(strict=True))
        value = Registration.model_validate_json(bounded(args.registration, 32768))
        try:
            result = collect(args.root, value, datetime.now(UTC))
        except Exception as error:
            result = failure(args.root, value, datetime.now(UTC), error)
        print(result["status"])
        if result["status"].startswith(("BREAKOUT_", "LEARNING_")):
            raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("BREAKOUT_OBSERVER_UNAVAILABLE")
        raise SystemExit(1) from None
