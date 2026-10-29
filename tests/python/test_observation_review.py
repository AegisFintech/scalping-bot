from __future__ import annotations

import subprocess
from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from python.operations import export_learning_evidence as exporter
from python.operations import observation_review as operation
from python.research.learning_evidence import LearningEvidence
from tests.python.test_learning_bridge import packet


def test_feed_uses_closed_half_hour_and_read_only_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psycopg

    monkeypatch.setenv("DATABASE_URL", "fixture")
    monkeypatch.setenv("ACCOUNT_KEY_HASH", "fixture")

    def connect(*_: Any, **options: Any) -> Any:
        assert "default_transaction_read_only=on" in options["options"]
        return nullcontext(object())

    def export(*args: Any, **_: Any) -> Any:
        assert args[4:6] == (
            datetime(2026, 10, 28, 0, 0, tzinfo=UTC),
            datetime(2026, 10, 28, 0, 30, tzinfo=UTC),
        )
        return LearningEvidence.model_validate(packet())

    monkeypatch.setattr(psycopg, "connect", connect)
    monkeypatch.setattr(exporter, "export", export)
    path = tmp_path / "current.json"
    operation.feed(path, datetime(2026, 10, 28, 0, 32, tzinfo=UTC))
    assert path.stat().st_mode & 0o777 == 0o640
    assert LearningEvidence.model_validate_json(path.read_bytes()).mode == "demo"


def test_fetch_uses_only_restricted_host_sanitized_env_and_bounded_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def execute(command: list[str], **options: Any) -> None:
        assert command[0] == "ssh" and command[-1] == "scalper-evidence"
        assert options["timeout"] == 30 and options["check"] is True
        assert options["preexec_fn"] is operation.limit_transfer_file
        assert set(options["env"]) == {"HOME", "PATH", "LANG"}
        options["stdout"].write(b"fixture")

    monkeypatch.setattr(operation.subprocess, "run", execute)
    assert operation.fetch() == b"fixture"


@pytest.mark.parametrize("failure", ["oversized", "timeout"])
def test_bad_transfer_never_reaches_advisor(monkeypatch: pytest.MonkeyPatch, failure: str) -> None:
    def execute(*_: Any, **options: Any) -> None:
        if failure == "timeout":
            raise subprocess.TimeoutExpired("ssh", 30)
        options["stdout"].write(b"x" * (operation.MAX_BYTES + 1))

    monkeypatch.setattr(operation.subprocess, "run", execute)
    with pytest.raises((ValueError, subprocess.TimeoutExpired)):
        operation.fetch()
