"""Durable admission for relevant holding research, independent of repository churn."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from python.research.codex_loop import timestamp
from python.research.experiment_registry import read
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha

COOLDOWN = timedelta(hours=1)
MAX_AGE = timedelta(days=7)


def now() -> datetime:
    return datetime.now(UTC)


def material(task: str, prompt: str, facts: dict[str, Any]) -> str:
    # A new main commit alone does not justify paying for the same research again.
    return sha(
        encoded([task, prompt, facts["resultSha256"], facts["findingSha256"], facts["rows"]])
    )


def relevant(packet: dict[str, Any], rows: list[dict[str, Any]]) -> bool:
    start, until = timestamp(packet["start"]), timestamp(packet["until"])
    return bool(
        rows
        and packet["mode"] == "demo"
        and packet["symbol"] == "XAUUSD"
        and start < until <= now()
        and now() - until <= MAX_AGE
    )


def admit(root: Path, digest: str, *, parent: bool = False) -> dict[str, Any] | None:
    """Called under the caller's durable registry lock, before any new claim.

    Legacy claims remain authoritative. An unsaved response or malformed history
    never permits another dispatch. Parent claims describe transport, not receipt.
    """
    latest: datetime | None = None
    duplicate = False
    for job in sorted(root.iterdir()):
        if not re.fullmatch(r"[a-f0-9]{64}", job.name):
            continue
        if job.is_symlink() or not job.is_dir():
            raise ValueError("RESEARCH_HISTORY_INVALID")
        attempt = job / "generation" if parent else job
        if not (attempt / "claim.json").exists():
            continue
        claimed = timestamp(read(attempt / "claim.json")["claimedAt"])
        if claimed > now():
            raise ValueError("RESEARCH_CLOCK_INVALID")
        if not (attempt / "response.json").exists():
            return {"status": "WAITING_RESEARCH_UNKNOWN"}
        if parent:
            response = read(attempt / "response.json", 17 * 1024 * 1024)
            if response.get("status") == "OUTCOME_UNKNOWN":
                return {"status": "WAITING_RESEARCH_UNKNOWN"}
            if (job / "pacing.json").exists():
                reservation = read(job / "pacing.json")
                request_sha = sha(encoded(read(attempt / "request.json", 17 * 1024 * 1024)))
                if (
                    reservation["requestSha256"] != request_sha
                    or read(attempt / "claim.json")["requestSha256"] != request_sha
                    or response["requestSha256"] != request_sha
                    or not re.fullmatch(r"[a-f0-9]{64}", reservation["materialSha256"])
                ):
                    raise ValueError("RESEARCH_HISTORY_BINDING")
                old = reservation["materialSha256"]
            else:
                raw = response.get("artifacts", {}).get("request.json")
                if raw is None:
                    raise ValueError("RESEARCH_HISTORY_MATERIAL_MISSING")
                request = json.loads(bytes.fromhex(raw))
                old = material(
                    request["payload"]["task"], request["promptSha256"], request["payload"]
                )
        else:
            response = read(attempt / "response.json", 32768)
            if (
                set(response) != {"raw"}
                or not isinstance(response["raw"], str)
                or len(response["raw"].encode()) > 8192
            ):
                raise ValueError("RESEARCH_HISTORY_RESPONSE_INVALID")
            request = read(attempt / "request.json", 128000)
            old = material(request["payload"]["task"], request["promptSha256"], request["payload"])
        duplicate |= old == digest
        latest = max(latest, claimed) if latest else claimed
    if duplicate:
        return {"status": "WAITING_RESEARCH_DUPLICATE"}
    if latest is not None and now() < latest + COOLDOWN:
        return {
            "status": "WAITING_RESEARCH_COOLDOWN",
            "nextEligibleAt": (latest + COOLDOWN).isoformat(),
        }
    return None
