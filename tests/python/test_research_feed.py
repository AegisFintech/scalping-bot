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


def test_epoch_clips_window_without_inventing_pre_epoch_zero_results() -> None:
    epoch = datetime(2026, 10, 19, 6, 16, 40, tzinfo=UTC)
    assert f.window(datetime(2026, 10, 20, 2, tzinfo=UTC), epoch) == (
        "2026-10-19T06:16:40Z",
        "2026-10-20T00:00:00Z",
    )
    assert f.window(datetime(2026, 10, 30, tzinfo=UTC), epoch) == (
        "2026-10-23T00:00:00Z",
        "2026-10-30T00:00:00Z",
    )
    with pytest.raises(f.EpochNotComplete):
        f.window(datetime(2026, 10, 19, 7, tzinfo=UTC), epoch)
    with pytest.raises(f.EpochNotComplete):
        f.window(datetime(2026, 10, 19, 7, tzinfo=UTC), datetime(2026, 10, 19, tzinfo=UTC))
    with pytest.raises(ValueError, match="EPOCH_FUTURE"):
        f.window(datetime(2026, 10, 19, tzinfo=UTC), epoch)
    with pytest.raises(ValueError, match="UTC_REQUIRED"):
        f.window(datetime(2026, 10, 20, tzinfo=UTC), epoch.replace(tzinfo=None))


def test_incomplete_epoch_never_starts_export_or_replaces_latest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    latest = tmp_path / "latest.json"
    latest.write_text("retained historical evidence")

    def forbidden(*_: Any, **__: Any) -> None:
        pytest.fail("Incomplete epoch must not export")

    monkeypatch.setattr(f.subprocess, "Popen", forbidden)
    with pytest.raises(f.EpochNotComplete):
        f.collect(
            tmp_path,
            tmp_path / "environment",
            datetime(2026, 10, 19, 8, tzinfo=UTC),
            datetime(2026, 10, 19, 6, tzinfo=UTC),
        )
    assert latest.read_text() == "retained historical evidence"


def test_epoch_is_passed_to_export_and_checked_against_returned_window(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    epoch = datetime(2026, 10, 19, 6, tzinfo=UTC)

    class Process:
        returncode = 0

        def wait(self, **_: Any) -> None:
            pass

    def spawn(command: list[str], **kwargs: Any) -> Process:
        assert command[-2:] == ["2026-10-19T06:00:00Z", "2026-10-20T00:00:00Z"]
        kwargs["stdout"].write(b"{}")
        return Process()

    monkeypatch.setattr(f.subprocess, "Popen", spawn)
    item = Evidence.model_validate_json(evidence(tmp_path).read_bytes()).model_copy(
        update={
            "release": f.RELEASE,
            "start": "2026-10-19T06:00:00Z",
            "end": "2026-10-20T00:00:00Z",
        }
    )
    monkeypatch.setattr(f, "project", lambda _: item)
    assert (
        f.collect(tmp_path, tmp_path / "environment", datetime(2026, 10, 20, 2, tzinfo=UTC), epoch)
        == item
    )
    monkeypatch.setattr(
        f, "project", lambda _: item.model_copy(update={"start": "2026-10-13T00:00:00Z"})
    )
    with pytest.raises(ValueError, match="WINDOW_MISMATCH"):
        f.collect(tmp_path, tmp_path / "environment", datetime(2026, 10, 20, 2, tzinfo=UTC), epoch)
