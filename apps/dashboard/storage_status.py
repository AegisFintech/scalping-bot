from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def local_storage_status(runtime: Path, now: datetime | None = None) -> dict[str, Any]:
    """Bounded local reads remain available when PostgreSQL is unavailable."""
    observed = now or datetime.now(UTC)
    result: dict[str, Any] = {}
    for name, maximum_age in (("database", 90), ("storage", 900)):
        path = runtime / f"{name}-status.json"
        try:
            if path.is_symlink() or path.stat().st_size > 16384:
                raise ValueError("invalid status file")
            value = json.loads(path.read_text())
            at = datetime.fromisoformat(value["observedAt"])
            if value.get("version") != 1 or at.tzinfo is None:
                raise ValueError("invalid status")
            age = (observed - at.astimezone(UTC)).total_seconds()
            if not 0 <= age <= maximum_age:
                result[name] = {"state": "stale"}
                continue
            if name == "database":
                reason = value.get("reason")
                if value.get("state") not in {"waiting", "ready"} or reason not in {
                    None,
                    "DATABASE_COMPUTE_QUOTA",
                    "DATABASE_UNAVAILABLE",
                }:
                    raise ValueError("invalid database status")
                result[name] = {
                    "state": value["state"],
                    "reason": reason,
                    "observedAt": at.isoformat(),
                }
            else:
                reasons = value.get("reasons")
                if (
                    not isinstance(value.get("healthy"), bool)
                    or not isinstance(reasons, list)
                    or not all(
                        isinstance(reason, str) and re.fullmatch(r"STORAGE_[A-Z_]{1,80}", reason)
                        for reason in reasons
                    )
                ):
                    raise ValueError("invalid storage status")
                result[name] = {
                    "state": "healthy" if value["healthy"] else "attention",
                    "reasons": reasons,
                    "observedAt": at.isoformat(),
                }
        except (OSError, ValueError, TypeError, KeyError):
            result[name] = {"state": "unavailable"}
    return result
