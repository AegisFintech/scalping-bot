import gzip
import json
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path

import pytest

from python.operations import breakout_observer as observer
from python.research.learning_evidence import encoded
from tests.python.test_breakout_hypotheses import dataset


def study(tmp_path):
    packet = dataset()
    start = datetime.fromisoformat(packet.start)
    until = start + timedelta(minutes=30)
    path = tmp_path / "registration.json"
    reg = observer.register(path, start, until, start - timedelta(minutes=1))
    return (
        path,
        reg,
        tmp_path / "results",
        until + timedelta(minutes=6),
        encoded(packet.model_dump()),
    )


def test_compression_preserves_exact_original_and_latest_status_is_recomputed(
    tmp_path, monkeypatch
):
    path, reg, root, now, raw = study(tmp_path)
    assert observer.collect(root, reg, now, export=lambda *_: raw)["status"] == "RECORDED"
    compressed = next(root.glob("*.input.json.gz"))
    assert observer.decompress(compressed) == raw
    assert len(compressed.read_bytes()) < len(raw)
    monkeypatch.setattr(observer, "trusted_path", lambda _: None)
    result = observer.read_status(path, root, Path.cwd(), now)
    assert result["readState"] == "CURRENT" and result["retainedWindows"] == 1
    assert result["latest"]["origins"] == 2 and not result["economicQualification"]
    assert (
        observer.read_status(path, root, Path.cwd(), now + timedelta(hours=1))["readState"]
        == "STALE"
    )


def test_interrupted_report_reuses_compressed_original_without_another_export(
    tmp_path, monkeypatch
):
    _, reg, root, now, raw = study(tmp_path)
    original = observer.immutable

    def interrupted(path, value):
        if path.name.endswith(".report.json"):
            raise OSError("interrupted after input")
        original(path, value)

    monkeypatch.setattr(observer, "immutable", interrupted)
    with pytest.raises(OSError):
        observer.collect(root, reg, now, export=lambda *_: raw)
    compressed = next(root.glob("*.input.json.gz"))
    before = compressed.read_bytes()
    monkeypatch.setattr(observer, "immutable", original)
    assert (
        observer.collect(root, reg, now, export=lambda *_: pytest.fail("export replay"))["status"]
        == "RECORDED"
    )
    assert compressed.read_bytes() == before


def test_projected_budget_rejects_before_writing_input_or_report(tmp_path, monkeypatch):
    _, reg, root, now, raw = study(tmp_path)
    monkeypatch.setattr(observer, "MAX_STORAGE", 16385)
    with pytest.raises(ValueError, match="BREAKOUT_STORAGE_CAPACITY"):
        observer.collect(root, reg, now, export=lambda *_: raw)
    assert list(root.glob("*.input.json.gz")) == list(root.glob("*.report.json")) == []
    value = observer.failure(root, reg, now, ValueError("BREAKOUT_STORAGE_CAPACITY"))
    assert value["status"] == "BREAKOUT_STORAGE_CAPACITY"


def test_failed_dependency_records_only_safe_code_not_private_error(tmp_path):
    _, reg, root, now, _ = study(tmp_path)
    root.mkdir()
    result = observer.failure(root, reg, now, RuntimeError("postgresql://private:private@private"))
    assert result["status"] == "BREAKOUT_COLLECTOR_READ_FAILURE"
    assert b"postgresql" not in (root / "status.json").read_bytes()


@pytest.mark.parametrize("change", ["compressed", "report", "status", "registration"])
def test_tampered_binding_withholds_only_study(tmp_path, monkeypatch, change):
    path, reg, root, now, raw = study(tmp_path)
    observer.collect(root, reg, now, export=lambda *_: raw)
    monkeypatch.setattr(observer, "trusted_path", lambda _: None)
    if change == "compressed":
        next(root.glob("*.input.json.gz")).write_bytes(gzip.compress(b"{}"))
    elif change == "report":
        report = next(root.glob("*.report.json"))
        value = json.loads(report.read_bytes())
        value["measurement"]["rows"][0]["observedFavorablePrice"] = "9999"
        report.write_bytes(encoded(value))
    elif change == "status":
        value = json.loads((root / "status.json").read_bytes())
        value["registrationSha256"] = "f" * 64
        (root / "status.json").write_bytes(encoded(value))
    else:
        value = json.loads(path.read_bytes())
        value["sourceFiles"]["requirements.lock"] = "f" * 64
        path.write_bytes(encoded(value))
    result = observer.read_status(path, root, Path.cwd(), now)
    assert result["readState"] == "UNAVAILABLE" and result["latest"] is None


def test_decompression_is_bounded_and_original_schema_stays_immutable(tmp_path):
    path = tmp_path / "large.gz"
    path.write_bytes(gzip.compress(b"x" * (observer.MAX_BYTES + 1)))
    with pytest.raises(ValueError, match="BREAKOUT_DECOMPRESSED_LIMIT"):
        observer.decompress(path)
    assert (
        sha256(Path("schemas/breakout-observer-registration-1.0.json").read_bytes()).hexdigest()
        == "76e9a1c8ec7c34597d0957b885e1f6a92d65c40649ecd3a5d67b579967db9d4c"
    )


def test_runtime_drift_stops_research_and_visibility_without_export(tmp_path, monkeypatch):
    path, reg, root, now, raw = study(tmp_path)
    observer.collect(root, reg, now, export=lambda *_: raw)
    monkeypatch.setattr(
        observer,
        "runtime_hashes",
        lambda *_: {"pythonSha256": "f" * 64, "packagesSha256": "e" * 64},
    )
    assert (
        observer.collect(root, reg, now, export=lambda *_: pytest.fail("runtime drift export"))[
            "status"
        ]
        == "RUNTIME_DRIFT"
    )
    monkeypatch.setattr(observer, "trusted_path", lambda _: None)
    assert observer.read_status(path, root, Path.cwd(), now)["readState"] == "UNAVAILABLE"


def test_new_schema_is_versioned_and_old_registration_contract_stays_pinned():
    assert (
        json.loads(Path("schemas/breakout-observer-registration-1.1.json").read_bytes())
        == observer.Registration.model_json_schema()
    )


def test_interrupted_measurement_reuses_first_retained_export(tmp_path, monkeypatch):
    _, reg, root, now, raw = study(tmp_path)
    original = observer.measure
    monkeypatch.setattr(
        observer, "measure", lambda *_: (_ for _ in ()).throw(OSError("interrupted measurement"))
    )
    with pytest.raises(OSError):
        observer.collect(root, reg, now, export=lambda *_: raw)
    before = next(root.glob("*.input.json.gz")).read_bytes()
    monkeypatch.setattr(observer, "measure", original)
    assert (
        observer.collect(root, reg, now, export=lambda *_: pytest.fail("export replay"))["status"]
        == "RECORDED"
    )
    assert next(root.glob("*.input.json.gz")).read_bytes() == before


def test_capture_claim_with_no_input_never_reexports_unknown_snapshot(tmp_path):
    _, reg, root, now, _ = study(tmp_path)
    with pytest.raises(OSError):
        observer.collect(
            root, reg, now, export=lambda *_: (_ for _ in ()).throw(OSError("interrupted export"))
        )
    assert len(list(root.glob("*.capture.json"))) == 1
    with pytest.raises(ValueError, match="BREAKOUT_INPUT_EXPORT_UNKNOWN"):
        observer.collect(root, reg, now, export=lambda *_: pytest.fail("unknown export replay"))


def test_actual_executing_interpreter_is_checked_not_only_source_venv(tmp_path, monkeypatch):
    _, reg, root, now, _ = study(tmp_path)
    expected = observer.runtime_hashes(Path.cwd())
    altered = tmp_path / "other-python"
    altered.write_bytes(b"another executable")
    monkeypatch.setattr(observer.sys, "executable", str(altered))
    assert observer.runtime_hashes(Path.cwd()) == expected
    assert observer.runtime_hashes()["pythonSha256"] != expected["pythonSha256"]
    assert (
        observer.collect(root, reg, now, export=lambda *_: pytest.fail("wrong interpreter export"))[
            "status"
        ]
        == "RUNTIME_DRIFT"
    )
