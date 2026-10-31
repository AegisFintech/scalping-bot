from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from python.research import candidate_generation as generation
from python.research import holding_task as task
from python.research import research_pacing as pacing
from python.research.learning_archive import immutable

CLOCK = datetime(2026, 10, 31, 10, tzinfo=UTC)
ROWS = [{"holdingMicros": "1000000", "net": "-2", "signedFees": "-1"}]
FACTS = {"resultSha256": "a" * 64, "findingSha256": "b" * 64, "rows": ROWS}


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(pacing, "now", lambda: CLOCK)


def history(root, *, age=timedelta(minutes=59), parent=False, response=True):
    job = root / ("a" * 64)
    attempt = job / "generation" if parent else job
    attempt.mkdir(parents=True)
    immutable(attempt / "claim.json", {"claimedAt": (CLOCK - age).isoformat()})
    request = {"promptSha256": "c" * 64, "payload": {"task": task.TASK, **FACTS}}
    immutable(attempt / "request.json", request)
    if response:
        from python.research.learning_evidence import encoded

        immutable(
            attempt / "response.json",
            {"artifacts": {"request.json": encoded(request).hex()}} if parent else {"raw": "{}"},
        )
    return attempt


@pytest.mark.parametrize("parent", [False, True])
def test_hourly_gate_survives_restart_and_includes_legacy_claims(tmp_path, monkeypatch, parent):
    history(tmp_path, parent=parent)
    material = pacing.material(task.TASK, "d" * 64, FACTS)
    first = pacing.admit(tmp_path, material, parent=parent)
    assert first == {
        "status": "WAITING_RESEARCH_COOLDOWN",
        "nextEligibleAt": (CLOCK + timedelta(minutes=1)).isoformat(),
    }
    assert pacing.admit(tmp_path, material, parent=parent) == first
    monkeypatch.setattr(pacing, "now", lambda: CLOCK + timedelta(minutes=1))
    assert pacing.admit(tmp_path, material, parent=parent) is None


@pytest.mark.parametrize("parent", [False, True])
def test_same_material_never_repeats_for_new_repository_head(tmp_path, parent):
    history(tmp_path, age=timedelta(days=1), parent=parent)
    digest = pacing.material(task.TASK, "c" * 64, {**FACTS, "baseCommit": "d" * 40})
    assert pacing.admit(tmp_path, digest, parent=parent)["status"] == "WAITING_RESEARCH_DUPLICATE"
    changed = pacing.material(task.TASK, "c" * 64, {**FACTS, "rows": [{**ROWS[0], "net": "3"}]})
    assert pacing.admit(tmp_path, changed, parent=parent) is None


@pytest.mark.parametrize("parent", [False, True])
def test_unknown_history_blocks_different_material(tmp_path, parent):
    history(tmp_path, age=timedelta(days=1), parent=parent, response=False)
    assert pacing.admit(tmp_path, "d" * 64, parent=parent)["status"] == "WAITING_RESEARCH_UNKNOWN"


@pytest.mark.parametrize("clock", ["bad", "2026-10-31T10:00:01+00:00", "2026-10-31T10:00:00"])
def test_invalid_and_future_history_clocks_fail_closed(tmp_path, clock):
    attempt = history(tmp_path)
    (attempt / "claim.json").write_text('{"claimedAt":"' + clock + '"}')
    with pytest.raises(ValueError):
        pacing.admit(tmp_path, "d" * 64)


@pytest.mark.parametrize(
    "age,mode,symbol,rows,allowed",
    [
        (timedelta(days=7), "demo", "XAUUSD", ROWS, True),
        (timedelta(days=7, microseconds=1), "demo", "XAUUSD", ROWS, False),
        (timedelta(seconds=-1), "demo", "XAUUSD", ROWS, False),
        (timedelta(hours=1), "live", "XAUUSD", ROWS, False),
        (timedelta(hours=1), "demo", "EURUSD", ROWS, False),
        (timedelta(hours=1), "demo", "XAUUSD", [], False),
        (timedelta(hours=1), "demo", "XAUUSD", [{**ROWS[0], "net": "3"}], True),
    ],
)
def test_relevance_is_recent_scoped_complete_data_not_outcome_sign(
    age, mode, symbol, rows, allowed
):
    until = CLOCK - age
    packet = {
        "start": (until - timedelta(minutes=30)).isoformat(),
        "until": until.isoformat(),
        "mode": mode,
        "symbol": symbol,
    }
    assert pacing.relevant(packet, rows) is allowed


def test_worker_wait_is_unsent_and_saved_response_recovery_ignores_new_admission(
    tmp_path, monkeypatch
):
    root = tmp_path / "attempts"
    root.mkdir()
    history(root)
    experiment = tmp_path / "experiment"
    experiment.mkdir()
    (experiment / "input.json").write_text("{}")
    monkeypatch.setattr(pacing, "relevant", lambda *_: True)
    monkeypatch.setattr(task, "evidence", lambda _: (FACTS, ROWS))
    base = "d" * 40
    assert (
        task.generate(root, experiment, base, lambda *_: pytest.fail("cooldown dispatch"))["status"]
        == "WAITING_RESEARCH_COOLDOWN"
    )
    assert len(list(root.glob("*/claim.json"))) == 1
    monkeypatch.setattr(pacing, "now", lambda: CLOCK + timedelta(minutes=1))
    calls = []
    original = generation.immutable

    def crash(path, value):
        if path.name == "rejected.json":
            raise KeyboardInterrupt
        return original(path, value)

    monkeypatch.setattr(generation, "immutable", crash)
    with pytest.raises(KeyboardInterrupt):
        task.generate(root, experiment, base, lambda *_: calls.append(1) or b"{}")
    monkeypatch.setattr(generation, "immutable", original)
    assert (
        task.generate(root, experiment, base, lambda *_: pytest.fail("response replay"))["status"]
        == "REJECTED"
    )
    assert calls == [1]
    assert len(list(root.glob("*/claim.json"))) == 2


@pytest.mark.parametrize("raw", [b"", b"{", b"{}", b'{"raw":4}'])
def test_corrupt_worker_response_never_admits_new_call(tmp_path, raw):
    attempt = history(tmp_path, age=timedelta(days=1))
    (attempt / "response.json").write_bytes(raw)
    with pytest.raises(ValueError):
        pacing.admit(tmp_path, "d" * 64)


def test_parent_transport_receipt_does_not_resolve_unknown_provider_claim(tmp_path):
    attempt = history(tmp_path, age=timedelta(days=1), parent=True)
    from python.research.experiment_registry import read
    from python.research.learning_evidence import encoded

    response = read(attempt / "response.json")
    response["status"] = "OUTCOME_UNKNOWN"
    (attempt / "response.json").write_bytes(encoded(response))
    assert pacing.admit(tmp_path, "d" * 64, parent=True)["status"] == "WAITING_RESEARCH_UNKNOWN"
