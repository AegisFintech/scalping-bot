"""Unprivileged source-review adapter. No GitHub, signer or broker credentials."""

import json
import os
import sys
from pathlib import Path

from python.codex_entry.memory import invoke_daily
from python.learning import governor
from python.research.learning_archive import unique
from python.research.learning_evidence import encoded
from python.research.observation_cycle import MODEL, sha
from python.research.source_review import PROMPTS, Review, ReviewInput, evaluate


def invoke(prompt: str, job: Path) -> bytes:
    return invoke_daily(
        prompt,
        job,
        schema=Review.model_json_schema(),
        model=MODEL,
        timeout=180,
        purpose="research",
        effort="medium",
    )


def main() -> None:
    if os.geteuid() == 0:
        raise ValueError("REVIEW_DEDICATED_USER_REQUIRED")
    raw = sys.stdin.buffer.read(64001)
    if len(raw) > 64000:
        raise ValueError("REVIEW_INPUT_OVERSIZED")
    decoded = json.loads(raw, object_pairs_hook=unique)
    admission_only = decoded.pop("admissionOnly", False)
    value = ReviewInput.model_validate(decoded)
    if admission_only:
        key = sha(encoded(value.model_dump()))
        prompt = PROMPTS[value.axis] + "\nINPUT=" + encoded(value.model_dump()).decode()
        result = governor.prepare(Path.home() / "source-reviews465" / key, prompt, "review")
        print(encoded({**(result or {"status": "ADMITTED"}), "job": key}).decode())
        return
    result = evaluate(Path.home() / "source-reviews465", value, invoke)
    print(encoded(result).decode())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("REVIEW_MODEL_FAILED_OR_UNKNOWN") from None
