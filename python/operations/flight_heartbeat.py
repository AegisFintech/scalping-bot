"""Public recorder metadata, independent of broker/account/dashboard availability."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_archive import atomic_bytes, bounded
from python.research.learning_evidence import Instant, encoded

PUBLIC = Path("/var/lib/scalper-flight-health/status.json")


class Heartbeat(StrictModel):
    version: Literal["flight-heartbeat-1.0"]
    checkedAt: Instant
    recordedAt: Instant | None
    state: Literal["RECORDING", "LAST_COMPLETED", "GAP", "UNAVAILABLE"]
    completeTickTape: Literal[False]
    brokerAuthority: Literal[False]


def publish(source: Path, now: datetime, target: Path = PUBLIC) -> None:
    at, state = None, "UNAVAILABLE"
    try:
        import json

        original = json.loads(bounded(source, 4096))
        if not isinstance(original, dict):
            raise ValueError("FLIGHT_HEARTBEAT_SOURCE_SHAPE")
        if original.get("state") in {"RECORDING", "LAST_COMPLETED", "GAP"}:
            at, state = original["checkedAt"], original["state"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    value = Heartbeat.model_validate(
        {
            "version": "flight-heartbeat-1.0",
            "checkedAt": now.isoformat(),
            "recordedAt": at,
            "state": state,
            "completeTickTape": False,
            "brokerAuthority": False,
        }
    )
    atomic_bytes(target, encoded(value.model_dump()), replace=True)
    target.chmod(0o644)


def load(now: datetime) -> Heartbeat:
    value = Heartbeat.model_validate_json(bounded(PUBLIC, 4096))
    for at in [value.checkedAt, value.recordedAt]:
        if at is None or not now - timedelta(seconds=10) <= timestamp(at) <= now + timedelta(
            seconds=5
        ):
            raise ValueError("FLIGHT_HEARTBEAT_STALE_OR_UNAVAILABLE")
    return value
