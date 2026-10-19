from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from python.research import feed as f
from python.research.codex_loop import Evidence
from tests.python.test_codex_research import evidence


def test_window_uses_seven_complete_utc_days() -> None:
    assert f.window(datetime(2026, 10, 19, 2, 10, tzinfo=UTC)) == (
        "2026-10-12T00:00:00Z",
        "2026-10-19T00:00:00Z",
    )
    with pytest.raises(ValueError):
        f.window(datetime(2026, 10, 19))


def protected_inbox(monkeypatch: pytest.MonkeyPatch, directory: Path) -> None:
    original = Path.lstat

    def info(path: Path) -> Any:
        result = original(path)
        if path == directory:
            return SimpleNamespace(st_mode=result.st_mode, st_uid=0)
        return result

    monkeypatch.setattr(Path, "lstat", info)
    monkeypatch.setattr(f.os, "fchown", lambda *_: None)


def test_atomic_latest_retains_original_archive(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    item = Evidence.model_validate_json(evidence(tmp_path).read_bytes())
    inbox = tmp_path / "inbox"
    inbox.mkdir(mode=0o750)
    protected_inbox(monkeypatch, inbox)
    first = f.publish_latest(inbox, item, os.getgid())
    second = f.publish_latest(inbox, item, os.getgid())
    assert first == second
    assert len(list(inbox.glob("aggregate-*.json"))) == 1
    assert (inbox / "latest.json").stat().st_mode & 0o777 == 0o640
    assert json.loads((inbox / "latest.json").read_bytes()) == item.model_dump()
    updated = item.model_copy(update={"net_pnl": None})
    f.publish_latest(inbox, updated, os.getgid())
    assert len(list(inbox.glob("aggregate-*.json"))) == 2
    assert json.loads((inbox / f"aggregate-{first}.json").read_bytes()) == item.model_dump()


def test_failed_publication_preserves_previous_latest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    item = Evidence.model_validate_json(evidence(tmp_path).read_bytes())
    inbox = tmp_path / "inbox"
    inbox.mkdir(mode=0o750)
    protected_inbox(monkeypatch, inbox)
    f.publish_latest(inbox, item, os.getgid())
    before = (inbox / "latest.json").read_bytes()

    def fail(*_: Any) -> None:
        raise OSError("fixture write failure")

    monkeypatch.setattr(f.os, "replace", fail)
    with pytest.raises(OSError):
        f.publish_latest(inbox, item.model_copy(update={"net_pnl": None}), os.getgid())
    assert (inbox / "latest.json").read_bytes() == before
    assert not list(inbox.glob(".latest-*"))


def test_writable_inbox_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    item = Evidence.model_validate_json(evidence(tmp_path).read_bytes())
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    inbox.chmod(0o777)
    protected_inbox(monkeypatch, inbox)
    with pytest.raises(ValueError, match="NOT_PROTECTED"):
        f.publish_latest(inbox, item, os.getgid())


def test_export_timeout_kills_group_and_does_not_publish(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    killed = []

    class Process:
        pid = 123
        calls = 0

        def wait(self, **_: Any) -> None:
            self.calls += 1
            if self.calls == 1:
                raise f.subprocess.TimeoutExpired("fixture", 60)

    def spawn(command: list[str], **kwargs: Any) -> Process:
        assert command[-3] == f.RELEASE
        assert set(kwargs["env"]) == {"PATH", "LANG", "DOTENV_CONFIG_PATH", "TSX_DISABLE_CACHE"}
        assert kwargs["start_new_session"]
        return Process()

    monkeypatch.setattr(f.subprocess, "Popen", spawn)
    monkeypatch.setattr(f.os, "killpg", lambda pid, sig: killed.append((pid, sig)))
    with pytest.raises(ValueError, match="EXPORT_TIMEOUT"):
        f.collect(tmp_path, tmp_path / "environment", datetime(2026, 10, 19, tzinfo=UTC))
    assert killed == [(123, f.signal.SIGKILL)]
