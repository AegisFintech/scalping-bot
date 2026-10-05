from __future__ import annotations

import fcntl
import json
import subprocess
from pathlib import Path
from unittest.mock import Mock

import pytest

from python.backtest import forward as f

NOW = 1_790_908_200_000
HASH = "a" * 64


def registered(tmp_path: Path) -> tuple[Path, f.Study, int]:
    folder = tmp_path / "study"
    study = f.register(folder, NOW + 60_000, NOW, HASH)
    return folder, study, NOW + 60_000 + f.DAY + f.SETTLE


@pytest.mark.parametrize("offset", [-1, 0, f.DAY + 1])
def test_registration_must_precede_future_window(tmp_path: Path, offset: int) -> None:
    with pytest.raises(ValueError, match="NOT_PROSPECTIVE"):
        f.register(tmp_path / "study", NOW + offset, NOW, HASH)
    assert not (tmp_path / "study").exists()


def test_registration_is_private_and_exclusive(tmp_path: Path) -> None:
    folder, study, _ = registered(tmp_path)
    assert folder.stat().st_mode & 0o777 == 0o700
    assert (folder / "study.json").stat().st_mode & 0o777 == 0o600
    assert study["decision"] == "HOLD"
    with pytest.raises(FileExistsError):
        f.register(folder, NOW + 120_000, NOW, HASH)
    assert f.read_json(folder / "study.json") == study


@pytest.mark.parametrize("delta", [-f.DAY, -1])
def test_no_reads_before_fixed_window_and_settlement(tmp_path: Path, delta: int) -> None:
    folder, _, due = registered(tmp_path)
    collector = Mock()
    assert f.run_once(folder, due + delta, HASH, collector)["status"] == "WAITING_FOR_WINDOW"
    collector.assert_not_called()


def test_one_report_per_call_and_restart_never_overwrites(tmp_path: Path) -> None:
    folder, study, due = registered(tmp_path)
    collector = Mock(return_value={"fixture": "not market evidence"})
    assert f.run_once(folder, due, HASH, collector)["status"] == "REPORT_WRITTEN"
    saved = (folder / "day-01.json").read_bytes()
    body = f.verified_report(folder / "day-01.json", study, 0)
    assert body["counterfactual_net_pnl"] is None
    assert body["broker_authority"] is False
    assert body["production_changed"] is False
    assert f.run_once(folder, due, HASH, collector)["status"] == "WAITING_FOR_WINDOW"
    collector.assert_called_once_with(study["start"], f.iso(due - f.SETTLE))
    # A long outage catches up exactly one fixed window per invocation, not a burst.
    assert f.run_once(folder, due + 4 * f.DAY, HASH, collector)["completed_windows"] == 2
    assert (folder / "day-01.json").read_bytes() == saved
    assert not (folder / "day-03.json").exists()


def test_failure_retries_same_window_without_partial_report(tmp_path: Path) -> None:
    folder, _, due = registered(tmp_path)
    collector = Mock(side_effect=ValueError("fixture failure"))
    with pytest.raises(ValueError):
        f.run_once(folder, due, HASH, collector)
    assert not (folder / "day-01.json").exists()
    collector.side_effect = None
    collector.return_value = {}
    assert f.run_once(folder, due, HASH, collector)["status"] == "REPORT_WRITTEN"
    assert collector.call_args_list[0] == collector.call_args_list[1]


def test_kernel_lock_prevents_concurrent_work(tmp_path: Path) -> None:
    folder, _, due = registered(tmp_path)
    collector = Mock()
    with (folder / ".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert f.run_once(folder, due, HASH, collector)["status"] == "ALREADY_RUNNING"
    collector.assert_not_called()


@pytest.mark.parametrize(
    "mutation", ["hash", "candidate", "authority", "extra", "date", "duration"]
)
def test_modified_registration_is_rejected(tmp_path: Path, mutation: str) -> None:
    _, study, _ = registered(tmp_path)
    value = dict(study)
    if mutation == "hash":
        value["source_sha256"] = "b" * 64
    elif mutation == "candidate":
        value["candidates"] = ["optimized_after_outcome"]
    elif mutation == "authority":
        value["broker_authority"] = True
    elif mutation == "extra":
        value["tuning"] = 1
    elif mutation == "date":
        value["start"] = "not a timestamp"
    else:
        value["until"] = f.iso(NOW + 60_000 + f.DAY)
    with pytest.raises(ValueError):
        f.validate_study(value, HASH)


def test_disk_reserve_never_deletes_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder, _, due = registered(tmp_path)
    monkeypatch.setattr(f.shutil, "disk_usage", lambda _: Mock(free=1, total=100))
    collector = Mock()
    with pytest.raises(ValueError, match="DISK_RESERVE"):
        f.run_once(folder, due, HASH, collector)
    collector.assert_not_called()
    assert (folder / "study.json").exists()


def test_corrupt_report_is_not_overwritten(tmp_path: Path) -> None:
    folder, _, due = registered(tmp_path)
    f.publish(folder / "day-01.json", {"body": {}, "sha256": HASH})
    collector = Mock()
    with pytest.raises(ValueError, match="REPORT_INVALID"):
        f.run_once(folder, due, HASH, collector)
    collector.assert_not_called()


def test_symlink_report_and_lock_are_rejected(tmp_path: Path) -> None:
    folder, _, due = registered(tmp_path)
    (folder / ".lock").symlink_to(folder / "study.json")
    with pytest.raises(OSError):
        f.run_once(folder, due, HASH, Mock())
    with pytest.raises(ValueError, match="FILE_INVALID"):
        f.read_json(folder / ".lock")


def test_atomic_publish_preserves_existing_file(tmp_path: Path) -> None:
    output = tmp_path / "report.json"
    f.publish(output, {"first": True})
    with pytest.raises(FileExistsError):
        f.publish(output, {"second": True})
    assert f.read_json(output) == {"first": True}
    assert list(tmp_path.glob(".forward-*")) == []


def test_collection_stops_after_registered_horizon(tmp_path: Path) -> None:
    folder, _, due = registered(tmp_path)
    collector = Mock(return_value={})
    for _ in range(f.DAYS):
        f.run_once(folder, due + f.DAYS * f.DAY, HASH, collector)
    assert f.run_once(folder, due + f.DAYS * f.DAY, HASH, collector) == {
        "status": "COLLECTION_COMPLETE_NOT_QUALIFIED",
        "completed_windows": 30,
        "decision": "HOLD",
    }
    assert collector.call_count == f.DAYS


def test_cli_redacts_private_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.argv", ["forward", "run", "--directory", str(tmp_path)])
    monkeypatch.setattr(f, "fingerprint", Mock(side_effect=OSError("private credentials")))
    with pytest.raises(SystemExit, match=r"^FORWARD_RESEARCH_FAILED$"):
        f.main()
    assert "private" not in capsys.readouterr().out


def test_export_mismatch_rejects_before_tape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = {
        "label": "PAIRED_REPLAY_INPUT_V1",
        "release": f.RELEASE,
        "from": f.iso(NOW),
        "until": f.iso(NOW + f.DAY),
        "economics": None,
        "cohort": "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
        "setups": [],
    }
    monkeypatch.setattr(f, "export_json", Mock(side_effect=[payload, {}]))
    tape = Mock()
    monkeypatch.setattr(f, "load_tape", tape)
    with pytest.raises(ValueError, match="EXPORT_MISMATCH"):
        f.collect(f.iso(NOW), f.iso(NOW + f.DAY), tmp_path / "node")
    tape.assert_not_called()


def test_schema_matches_registration(tmp_path: Path) -> None:
    # Ajv covers JSON Schema separately; keep Python's shared TypedDict keys aligned.
    _, study, _ = registered(tmp_path)
    schema = json.loads((f.ROOT / "schemas/forward-study-1.0.json").read_text())
    assert set(study) == set(schema["required"]) == set(schema["properties"])
    daily = json.loads((f.ROOT / "schemas/forward-daily-1.0.json").read_text())
    assert set(f.DailyReport.__annotations__) == set(daily["properties"]["body"]["required"])


def test_export_timeout_is_bounded_and_sanitized(monkeypatch: pytest.MonkeyPatch) -> None:
    child = Mock(side_effect=subprocess.TimeoutExpired("private arguments", 60))
    monkeypatch.setattr(f.subprocess, "run", child)
    with pytest.raises(ValueError, match="FORWARD_EXPORT_TIMEOUT"):
        f.export_json(
            "scripts/export-paired-replay.ts", f.iso(NOW), f.iso(NOW + f.DAY), Path("/node")
        )
    assert child.call_args.kwargs["timeout"] == 60
    assert "shell" not in child.call_args.kwargs


@pytest.mark.parametrize(
    "message,code",
    [
        (b"PAIRED_SINGLE_SCOPE_REQUIRED", "FORWARD_PAIRED_SINGLE_SCOPE_REQUIRED"),
        (b"private://secret", "FORWARD_EXPORT_FAILED"),
    ],
)
def test_export_failure_keeps_only_safe_codes(
    monkeypatch: pytest.MonkeyPatch, message: bytes, code: str
) -> None:
    def child(*args: object, **kwargs: object) -> Mock:
        kwargs["stderr"].write(message)
        return Mock(returncode=1)

    monkeypatch.setattr(f.subprocess, "run", child)
    with pytest.raises(ValueError, match=code):
        f.export_json(
            "scripts/export-paired-replay.ts", f.iso(NOW), f.iso(NOW + f.DAY), Path("/node")
        )


def test_source_change_during_collection_publishes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder, _, due = registered(tmp_path)
    monkeypatch.setattr("sys.argv", ["forward", "run", "--directory", str(folder)])
    monkeypatch.setattr(f, "fingerprint", Mock(side_effect=[HASH, "b" * 64]))
    monkeypatch.setattr(f, "now_ms", lambda: due)
    monkeypatch.setattr(f, "collect", Mock(return_value={}))
    with pytest.raises(SystemExit, match="FORWARD_SOURCE_DRIFT"):
        f.main()
    assert not (folder / "day-01.json").exists()


def test_service_is_resource_limited_and_separate_from_trading() -> None:
    unit = (f.ROOT / "systemd/scalper-research-forward.service").read_text()
    assert "MemoryMax=2G" in unit and "CPUQuota=50%" in unit
    assert "TimeoutStartSec=600" in unit and "ProtectSystem=strict" in unit
    assert "ReadWritePaths=/root/scalping-bot/.runtime/forward-study-255\n" in unit
    assert "Restart=" not in unit and "ctrader-execution" not in unit
    assert "ExecStartPost" not in unit
