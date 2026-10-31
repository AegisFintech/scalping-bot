"""Bounded generation transport shared by protected research task definitions."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from python.research.experiment_registry import Registry, read
from python.research.learning_archive import immutable, unique
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha


def generate[D: BaseModel](
    root: Path,
    experiment: Path,
    base: str,
    invoke: Callable[[str, Path], bytes],
    *,
    task: str,
    prompt_text: str,
    measure: Callable[[Path], tuple[dict[str, Any], list[dict[str, str | None]]]],
    draft_model: type[D],
    files: Callable[[D, dict[str, Any], str], dict[str, bytes]],
) -> dict[str, Any]:
    """Task definitions are trusted code; provider output cannot select them."""
    if not re.fullmatch(r"[a-f0-9]{40}", base):
        raise ValueError("CANDIDATE_BASE_INVALID")
    facts, _ = measure(experiment)
    key = sha(encoded([task, base, facts["findingSha256"]]))
    registry = Registry(root)
    with registry.locked():
        job = registry.directory(key)
        if (
            not job.exists()
            and len(
                [p for p in root.iterdir() if p.is_dir() and re.fullmatch(r"[a-f0-9]{64}", p.name)]
            )
            >= 4
        ):
            return {"status": "CANDIDATE_TASK_TRIAL_BUDGET", "publishAuthority": False}
        job.mkdir(mode=0o700, exist_ok=True)
        binding = {"task": task, "baseCommit": base, **facts}
        prompt = prompt_text + "\nINPUT=" + encoded(binding).decode()
        if len(prompt.encode()) > 64000:
            raise ValueError("CANDIDATE_INPUT_OVERSIZED")
        immutable(job / "binding.json", binding)
        if (job / "draft.json").exists():
            draft = draft_model.model_validate(read(job / "draft.json", 32768))
            files(draft, facts, base)
            return {"status": "GENERATED_UNVERIFIED", "job": key}
        if (job / "rejected.json").exists():
            return {"status": "REJECTED", "job": key}
        if (job / "claim.json").exists() and not (job / "response.json").exists():
            return {"status": "OUTCOME_UNKNOWN", "job": key}
        if not (job / "response.json").exists():
            immutable(
                job / "request.json",
                {
                    "promptSha256": sha(prompt_text.encode()),
                    "payload": {"captured_at": datetime.now(UTC).isoformat(), **binding},
                },
            )
            immutable(
                job / "claim.json",
                {
                    "bindingSha256": sha(encoded(binding)),
                    "claimedAt": datetime.now(UTC).isoformat(),
                },
            )
            raw = invoke(prompt, job)
            if len(raw) > 8192:
                raise ValueError("CANDIDATE_OUTPUT_OVERSIZED")
            immutable(job / "response.json", {"raw": raw.decode()})
        try:
            response = read(job / "response.json", 32768)["raw"]
            draft = draft_model.model_validate(json.loads(response, object_pairs_hook=unique))
            files(draft, facts, base)
        except (ValueError, SyntaxError):
            immutable(
                job / "rejected.json", {"status": "REJECTED", "reason": "CANDIDATE_DRAFT_INVALID"}
            )
            return {"status": "REJECTED", "job": key}
        immutable(job / "draft.json", draft.model_dump())
        return {"status": "GENERATED_UNVERIFIED", "job": key}
