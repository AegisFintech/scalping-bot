"""Bounded prospective loss diagnostics from the existing read-only observation feed."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from python.backtest.loss_control import CANDIDATES, LossControlReport, report
from python.backtest.rr_screen import RR_CANDIDATES, RRReport
from python.backtest.rr_screen import report as rr_report
from python.backtest.trend_observation import CANDIDATES as TREND_CANDIDATES
from python.backtest.trend_observation import TrendObservationReport
from python.backtest.trend_observation import report as trend_report
from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_archive import bounded, immutable, parse, unique
from python.research.learning_evidence import (
    MAX_BYTES,
    Digest,
    Instant,
    LearningEvidence,
    digest,
    encoded,
)
from python.research.position_clock_evidence import PositionClockEvidence

ROOT = Path(__file__).resolve().parents[2]


class Registration(StrictModel):
    version: Literal["loss-control-registration-1.0"] = "loss-control-registration-1.0"
    registeredAt: Instant
    start: Instant
    until: Instant
    sourceSha256: Digest
    method: Literal["loss-control-screen-1.0"] = "loss-control-screen-1.0"
    candidates: dict[str, str]
    sourceId: str
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False


class RegistrationV11(Registration):
    version: Literal["loss-control-registration-1.1"] = "loss-control-registration-1.1"  # type: ignore[assignment]
    method: Literal["loss-control-screen-1.1"] = "loss-control-screen-1.1"  # type: ignore[assignment]


class RegistrationV12(Registration):
    version: Literal["loss-control-registration-1.2"] = "loss-control-registration-1.2"  # type: ignore[assignment]
    method: Literal["trend-observation-1.0"] = "trend-observation-1.0"  # type: ignore[assignment]


def protocol_types(protocol: str) -> tuple[type[Registration], dict[str, str]]:
    if protocol == "1.0":
        return Registration, CANDIDATES
    if protocol == "1.1":
        return RegistrationV11, RR_CANDIDATES
    if protocol == "1.2":
        return RegistrationV12, TREND_CANDIDATES
    raise ValueError("LOSS_STUDY_PROTOCOL_INVALID")


def decode(raw: bytes, clocks: bool) -> LearningEvidence | PositionClockEvidence:
    return (
        PositionClockEvidence.model_validate(json.loads(raw, object_pairs_hook=unique))
        if clocks
        else parse(raw, hashlib.sha256(raw).hexdigest())
    )


def packet_of(value: LearningEvidence | PositionClockEvidence) -> LearningEvidence:
    return value.packet if isinstance(value, PositionClockEvidence) else value


def fingerprint() -> str:
    paths = [*sorted((ROOT / "python").rglob("*.py")), ROOT / "requirements.lock"]
    return digest(
        [(str(p.relative_to(ROOT)), hashlib.sha256(p.read_bytes()).hexdigest()) for p in paths]
    )


def read(path: Path, maximum: int = MAX_BYTES) -> Any:
    return json.loads(bounded(path, maximum), object_pairs_hook=unique)


def register(
    directory: Path, start: datetime, now: datetime, source_id: str, *, protocol: str = "1.0"
) -> None:
    cls, candidates = protocol_types(protocol)
    if (
        not now < start <= now + timedelta(days=1)
        or start.second
        or start.microsecond
        or start.minute % 30
    ):
        raise ValueError("LOSS_STUDY_FUTURE_HALF_HOUR_REQUIRED")
    if any(p.is_symlink() for p in (directory, *directory.parents)):
        raise ValueError("LOSS_STUDY_PATH_INVALID")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if (directory / "registration.json").exists():
        raise ValueError("LOSS_STUDY_ALREADY_REGISTERED")
    value = cls(
        registeredAt=now.isoformat(),
        start=start.isoformat(),
        until=(start + timedelta(days=30)).isoformat(),
        sourceSha256=fingerprint(),
        candidates=candidates,
        sourceId=source_id,
    )
    immutable(directory / "registration.json", value.model_dump())


def run(directory: Path, feed: Path, now: datetime) -> dict[str, Any]:
    if any(p.is_symlink() for p in (directory, *directory.parents, feed)):
        raise ValueError("LOSS_STUDY_PATH_INVALID")
    with (directory / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        saved = read(directory / "registration.json", 8192)
        version = saved.get("version")
        protocol = {
            "loss-control-registration-1.0": "1.0",
            "loss-control-registration-1.1": "1.1",
            "loss-control-registration-1.2": "1.2",
        }.get(version)
        cls, candidates = protocol_types(protocol or "")
        clocks = protocol != "1.0"
        registration = cls.model_validate(saved)
        code = fingerprint()
        start, until = timestamp(registration.start), timestamp(registration.until)
        if (
            registration.sourceSha256 != code
            or registration.candidates != candidates
            or not timestamp(registration.registeredAt) < start
            or until != start + timedelta(days=30)
        ):
            raise ValueError("LOSS_STUDY_SOURCE_OR_REGISTRATION_DRIFT")
        if now < start:
            return {"state": "WAITING_FOR_FUTURE_WINDOW"}
        if (
            shutil.disk_usage(directory).free < 2 * 1024**3
            or sum(p.stat().st_size for p in directory.iterdir() if p.is_file()) > 256 * 1024**2
        ):
            raise ValueError("LOSS_STUDY_STORAGE_RESERVE")
        raw = bounded(feed, MAX_BYTES)
        input_model = decode(raw, clocks)
        packet = packet_of(input_model)
        lower, upper = timestamp(packet.start), timestamp(packet.until)
        if lower < start or upper > until:
            return {"state": "FEED_OUTSIDE_REGISTERED_WINDOW"}
        if (
            packet.sourceId != registration.sourceId
            or upper - lower != timedelta(minutes=30)
            or not upper <= timestamp(packet.exportedAt) <= now
            or now - upper > timedelta(minutes=40)
        ):
            raise ValueError("LOSS_STUDY_FEED_STALE_OR_SCOPE_INVALID")
        index = int((lower - start).total_seconds() // 1800)
        if lower != start + timedelta(minutes=30 * index):
            raise ValueError("LOSS_STUDY_WINDOW_ALIGNMENT")
        target = directory / f"window-{index:04d}.json"
        source = directory / f"window-{index:04d}.input.json"
        # First captured packet is immutable even if a later export revises this window.
        if source.exists():
            raw = bounded(source, MAX_BYTES)
            input_model = decode(raw, clocks)
            packet = packet_of(input_model)
            if timestamp(packet.start) != lower or timestamp(packet.until) != upper:
                raise ValueError("LOSS_STUDY_PRIOR_INPUT_INVALID")
        result: TrendObservationReport | RRReport | LossControlReport
        if protocol == "1.2":
            assert isinstance(input_model, PositionClockEvidence)
            result = trend_report(input_model)
        elif isinstance(input_model, PositionClockEvidence):
            result = rr_report(input_model)
        else:
            result = report(packet)
        missing = [i for i in range(index) if not (directory / f"window-{i:04d}.json").exists()]
        value = {
            "registrationSha256": digest(registration.model_dump()),
            "sourceSha256": code,
            "from": packet.start,
            "until": packet.until,
            "missingPriorWindows": missing,
            "report": result.model_dump(),
        }
        if target.exists():
            prior = read(target)
            type(result).model_validate(prior["report"])
            retained_missing = prior.get("missingPriorWindows")
            if (
                not isinstance(retained_missing, list)
                or any(type(i) is not int or not 0 <= i < index for i in retained_missing)
                or retained_missing != sorted(set(retained_missing))
                or prior != {**value, "missingPriorWindows": retained_missing}
            ):
                raise ValueError("LOSS_STUDY_PRIOR_REPORT_CONFLICT")
            return {"state": "ALREADY_RECORDED", "window": index}
        pending_bytes = len(encoded(value)) + (
            0 if source.exists() else len(encoded(input_model.model_dump()))
        )
        if (
            pending_bytes > MAX_BYTES
            or shutil.disk_usage(directory).free - pending_bytes < 2 * 1024**3
            or sum(p.stat().st_size for p in directory.iterdir() if p.is_file()) + pending_bytes
            > 256 * 1024**2
        ):
            raise ValueError("LOSS_STUDY_STORAGE_RESERVE")
        if (
            fingerprint() != code
            or read(directory / "registration.json", 8192) != registration.model_dump()
        ):
            raise ValueError("LOSS_STUDY_SOURCE_DRIFT")
        immutable(source, input_model.model_dump())
        immutable(target, value)
        return {
            "state": "REPORT_WRITTEN",
            "window": index,
            "recommendation": result.recommendation,
            "missingPriorWindows": len(missing),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["register", "run"])
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument(
        "--feed", type=Path, default=Path("/var/lib/scalper-observation-feed/current.json")
    )
    parser.add_argument("--start")
    parser.add_argument("--protocol", choices=["1.0", "1.1", "1.2"], default="1.0")
    args = parser.parse_args()
    now = datetime.now(UTC)
    if args.action == "register":
        if args.start is None:
            raise ValueError("LOSS_STUDY_START_REQUIRED")
        register(
            args.directory, timestamp(args.start), now, "scalper-epoch314", protocol=args.protocol
        )
        print("REGISTERED_NOT_QUALIFIED")
    else:
        print(json.dumps(run(args.directory, args.feed, now)))


if __name__ == "__main__":
    main()
