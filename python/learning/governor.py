"""Learning-only admission; no broker, risk, promotion or accounting authority."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from python.learning.budget import Budget
from python.research.codex_loop import timestamp
from python.research.isolated_worker import trusted_path
from python.research.learning_archive import atomic_bytes

CONFIG = Path("/etc/scalper-learning/policy.json")


def configured() -> Budget | None:
    if not CONFIG.exists():
        return None  # Explicit deployment activation, never inferred from credentials.
    trusted_path(CONFIG)
    value = json.loads(CONFIG.read_bytes())
    root = Path(value["root"])
    if not root.resolve().is_relative_to(Path.home().resolve()):
        raise ValueError("LEARNING_DEDICATED_HOME_REQUIRED")
    return Budget(root)


def identity(job: Path) -> str:
    return hashlib.sha256(str(job.resolve()).encode()).hexdigest()


def prepare(job: Path, prompt: str, topic: str) -> dict[str, Any] | None:
    budget = configured()
    if budget is None:
        return None
    # Research uses a fresh thread per completed request. Include the model's
    # entire output allowance (reasoning included), not only its small JSON reply.
    estimate = 4 * len(prompt.encode()) + 24_576 + 128_000
    binding = hashlib.sha256(prompt.encode()).hexdigest()

    def note(result: dict[str, Any]) -> dict[str, Any] | None:
        job.mkdir(mode=0o700, parents=True, exist_ok=True)
        report = {
            **result,
            "checkedAt": datetime.now(UTC).isoformat(),
            "requiredTokens": estimate,
            "topic": topic,
        }
        atomic_bytes(job / "learning-admission.json", json.dumps(report).encode(), replace=True)
        return None if result["status"] == "ADMITTED" else result

    prior = budget.reservation(identity(job))
    if prior is not None:
        result = budget.reserve(identity(job), estimate, topic, binding=binding)
        return note(result)
    quota = budget.path.parent / "quota.json"
    try:
        report = json.loads(quota.read_bytes())
        fresh = (
            datetime.now(UTC) - timedelta(minutes=15)
            <= timestamp(report["checkedAt"])
            <= datetime.now(UTC) + timedelta(seconds=5)
        )
        remaining = report["remainingPercent"]
        if not fresh or type(remaining) not in {int, float} or not 0 <= remaining <= 100:
            raise ValueError("LEARNING_QUOTA_UNKNOWN")
    except (OSError, ValueError, KeyError, TypeError):
        return note({"status": "WAITING_LEARNING_QUOTA_UNAVAILABLE"})
    if remaining < 20:
        return note({"status": "WAITING_LEARNING_QUOTA_LOW"})
    result = budget.reserve(identity(job), estimate, topic, binding=binding)
    return note(result)


def dispatch(job: Path) -> None:
    budget = configured()
    if budget is not None:
        budget.dispatch(identity(job))


def complete(job: Path, usage: dict[str, int] | None) -> None:
    budget = configured()
    if budget is not None:
        budget.settle(identity(job), usage["totalTokens"] if usage else None)


def guidance() -> dict[str, Any]:
    budget = configured()
    if budget is None:
        return {}
    policy = budget.snapshot()["policy"]
    return {"focus": policy["focus"], "guidance": policy["guidance"]}
