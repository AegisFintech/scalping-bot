"""Fresh read-only pipeline state; heartbeat age and work age stay separate."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from python.operations.harness_health import load

HEALTH = Path("/var/lib/scalper-harness-health/status.json")
PUBLISHER = Path("/var/lib/scalper-publisher")


def progress(now: datetime) -> dict[str, Any]:
    packet = load(HEALTH, now)
    result: dict[str, Any] = {
        "observedAt": now.isoformat(),
        "stages": packet.get("stages", []),
        "publisher": packet.get("publisher"),
        "generation": None,
        "review": None,
        "lastPublicationActivityAt": None,
        "publicationAgeSeconds": None,
    }
    delivery = packet.get("delivery") or {}
    for key in ("generation", "review"):
        value = delivery.get(key)
        if isinstance(value, dict):
            result[key] = {
                k: value.get(k)
                for k in (
                    "status",
                    "reason",
                    "phase",
                    "checkedAt",
                    "baseCommit",
                    "origin",
                    "publicationSha256",
                )
            }
    generation = delivery.get("generation") or {}
    digest = generation.get("publicationSha256")
    import re

    if isinstance(digest, str) and re.fullmatch("[a-f0-9]{64}", digest):
        directory = PUBLISHER / "jobs" / digest / "phases"
        try:
            times = []
            for name in (
                "proposal",
                "commit",
                "push-intent",
                "push-confirmed",
                "pr-intent",
                "remote-pr",
            ):
                p = directory / (name + ".json")
                if p.exists():
                    if p.is_symlink() or not p.is_file():
                        continue
                    times.append(datetime.fromtimestamp(p.stat().st_mtime, UTC))
            if times:
                last = max(times)
                if last <= now:
                    result["lastPublicationActivityAt"] = last.isoformat()
                    result["publicationAgeSeconds"] = int((now - last).total_seconds())
        except (OSError, ValueError):
            pass
    # A stale outer packet must never expose apparently current inner progress.
    if packet.get("available") is False:
        result.update(available=False, reason=packet["reason"])
    else:
        result["available"] = True
    return result
