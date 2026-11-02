"""Registered bounded breakout observation; SELECT-only, no model or broker commands."""

from __future__ import annotations

import argparse
import fcntl
import os
import shutil
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from typing import Any, Final, Literal

from pydantic import model_validator

from python.research.breakout_hypotheses import CANDIDATES, measure
from python.research.codex_loop import StrictModel, timestamp
from python.research.isolated_worker import trusted_path
from python.research.learning_archive import bounded, durable_json, immutable, parse
from python.research.learning_evidence import MAX_BYTES, Digest, Instant, encoded

RELEASE: Final = "0.9.0-cost-balanced.1-codex.2"
# Freeze the complete Python dependency closure, including schemas imported by PayloadScalp.
SOURCE_FILES = (
    *sorted(
        str(p.relative_to(Path(__file__).resolve().parents[2]))
        for p in (Path(__file__).resolve().parents[2] / "python").rglob("*.py")
    ),
    "packages/config/src/policy.ts",
    "requirements.lock",
)


class Registration(StrictModel):
    schemaVersion: Literal["breakout-observer-registration-1.0"]
    registeredAt: Instant
    start: Instant
    until: Instant
    sourceFiles: dict[str, Digest]
    release: Literal["0.9.0-cost-balanced.1-codex.2"]
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
            or set(self.sourceFiles) != set(SOURCE_FILES)
            or self.candidates != list(CANDIDATES)
        ):
            raise ValueError("BREAKOUT_REGISTRATION_INVALID")
        return self


def source_hashes() -> dict[str, str]:
    root = Path(__file__).resolve().parents[2]
    return {name: sha256((root / name).read_bytes()).hexdigest() for name in SOURCE_FILES}


def register(destination: Path, start: datetime, until: datetime, now: datetime) -> Registration:
    value = Registration(
        schemaVersion="breakout-observer-registration-1.0",
        registeredAt=now.isoformat(),
        start=start.isoformat(),
        until=until.isoformat(),
        sourceFiles=source_hashes(),
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
        else:
            files = list(root.glob("*"))
            if (
                len(files) > 5000
                or sum(p.stat().st_size for p in files if p.is_file()) > 256 * 1024 * 1024
                or shutil.disk_usage(root).free < 2 * 1024 * 1024 * 1024
            ):
                raise ValueError("BREAKOUT_STORAGE_CAPACITY")
            start = timestamp(registration.start)
            until = timestamp(registration.until)
            while start < until:
                end = start + timedelta(minutes=30)
                prefix = root / start.strftime("window-%Y%m%dT%H%M")
                report = prefix.with_suffix(".report.json")
                input_path = prefix.with_suffix(".input.json")
                if not report.exists():
                    if now < end + timedelta(minutes=5):
                        break
                    raw = (
                        bounded(input_path, MAX_BYTES)
                        if input_path.exists()
                        else export(start, end)
                    )
                    digest = sha256(raw).hexdigest()
                    packet = parse(raw, digest)
                    if (timestamp(packet.start), timestamp(packet.until)) != (start, end):
                        raise ValueError("BREAKOUT_WINDOW_MISMATCH")
                    if any(
                        c.originRelease != RELEASE
                        for c in packet.contexts
                        if start <= timestamp(c.requestedAt) < end
                        or (c.availableAt is not None and start <= timestamp(c.availableAt) < end)
                    ):
                        raise ValueError("BREAKOUT_RELEASE_DRIFT")
                    if not input_path.exists():
                        from python.research.learning_archive import atomic_bytes

                        atomic_bytes(input_path, raw, replace=False)
                        input_path.chmod(0o400)
                    measured = measure(packet, digest)
                    immutable(
                        report,
                        {
                            "registrationSha256": result["registrationSha256"],
                            "measurement": measured.model_dump(),
                            "scope": "REGISTERED_FUTURE_COLLECTION_NOT_EXECUTION_QUALIFICATION",
                        },
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
        print(collect(args.root, value, datetime.now(UTC))["status"])


if __name__ == "__main__":
    main()
