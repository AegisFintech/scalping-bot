import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from python.learning import governor
from python.learning.budget import Budget, Policy

NOW = datetime(2026, 11, 2, tzinfo=UTC)


def test_budget_reservations_are_atomic_and_unknowns_survive_restart_and_day(tmp_path):
    budget = Budget(tmp_path / "budget", default_limit=100)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda key: budget.reserve(key, 60, "fixture", NOW), ["one", "two"])
        )
    assert sorted(r["status"] for r in results) == ["ADMITTED", "WAITING_LEARNING_BUDGET"]
    first = "one" if results[0]["status"] == "ADMITTED" else "two"
    budget.dispatch(first, NOW)
    budget.settle(first, None)
    reopened = Budget(tmp_path / "budget")
    assert reopened.snapshot(NOW + timedelta(days=1))["charged"] == 60
    assert (
        reopened.reserve("three", 50, "fixture", NOW + timedelta(days=1))["status"]
        == "WAITING_LEARNING_BUDGET"
    )
    with pytest.raises(ValueError, match="ALREADY_DISPATCHED"):
        reopened.dispatch(first)


def test_known_usage_and_policy_changes_never_reset_history(tmp_path):
    budget = Budget(tmp_path / "budget", default_limit=100)
    assert budget.reserve("one", 60, "fixture", NOW)["status"] == "ADMITTED"
    budget.dispatch("one", NOW)
    budget.settle("one", 40)
    budget.update(Policy(paused=True, dailyLimit=100, guidance="Study costs"))
    assert budget.reserve("two", 1, "fixture", NOW)["status"] == "WAITING_LEARNING_PAUSED"
    assert budget.snapshot(NOW)["charged"] == 40
    assert budget.snapshot(NOW + timedelta(days=1))["charged"] == 0
    assert "guidance" not in budget.snapshot(NOW)["events"][0]["policy"]
    assert budget.snapshot(NOW)["events"][0]["guidanceSha256"]
    with pytest.raises(ValueError, match="CHANGED"):
        budget.settle("one", 0)


def test_reservation_repeats_are_bound_to_the_original_request(tmp_path):
    budget = Budget(tmp_path / "budget")
    assert budget.reserve("one", 10, "fixture")["status"] == "ADMITTED"
    assert budget.reserve("one", 10, "fixture")["status"] == "ADMITTED"
    assert len(budget.snapshot()["recent"]) == 1
    with pytest.raises(ValueError, match="CHANGED"):
        budget.reserve("one", 11, "fixture")


def test_quota_admission_waits_before_any_dispatch(tmp_path, monkeypatch):
    config = tmp_path / "policy.json"
    root = tmp_path / "control"
    config.write_text(json.dumps({"root": str(root)}))
    monkeypatch.setattr(governor, "CONFIG", config)
    monkeypatch.setattr(governor, "trusted_path", lambda _: None)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    job = tmp_path / "job"
    assert (
        governor.prepare(job, "data", "observation")["status"]
        == "WAITING_LEARNING_QUOTA_UNAVAILABLE"
    )
    (root / "quota.json").write_text(
        json.dumps({"checkedAt": datetime.now(UTC).isoformat(), "remainingPercent": 10})
    )
    assert governor.prepare(job, "data", "observation")["status"] == "WAITING_LEARNING_QUOTA_LOW"
    (root / "quota.json").write_text(
        json.dumps({"checkedAt": datetime.now(UTC).isoformat(), "remainingPercent": 80})
    )
    assert governor.prepare(job, "data", "observation") is None
    assert governor.configured().snapshot()["recent"][0]["status"] == "RESERVED"
    governor.dispatch(job)
    governor.complete(job, {"totalTokens": 20})
    assert governor.configured().snapshot()["charged"] == 20


def test_admitted_work_retains_its_authorization_but_cannot_replay(tmp_path, monkeypatch):
    budget = Budget(tmp_path / "control")
    monkeypatch.setattr(governor, "configured", lambda: budget)
    (budget.path.parent / "quota.json").write_text(
        json.dumps({"checkedAt": datetime.now(UTC).isoformat(), "remainingPercent": 80})
    )
    job = tmp_path / "job"
    assert governor.prepare(job, "fresh", "review") is None
    budget.update(Policy(paused=True, dailyLimit=1))
    (budget.path.parent / "quota.json").unlink()
    assert governor.prepare(job, "fresh", "review") is None
    assert governor.prepare(tmp_path / "other", "fresh", "review")["status"].startswith("WAITING_")
    with pytest.raises(ValueError, match="CHANGED"):
        governor.prepare(job, "changed", "review")
    governor.dispatch(job)
    assert governor.prepare(job, "fresh", "review")["status"] == "OUTCOME_ALREADY_CLAIMED"


def test_stale_quota_is_not_fresh_admission(tmp_path, monkeypatch):
    budget = Budget(tmp_path / "control")
    monkeypatch.setattr(governor, "configured", lambda: budget)
    (budget.path.parent / "quota.json").write_text(
        json.dumps(
            {
                "checkedAt": (datetime.now(UTC) - timedelta(minutes=16)).isoformat(),
                "remainingPercent": 100,
            }
        )
    )
    job = tmp_path / "job"
    assert (
        governor.prepare(job, "fresh", "review")["status"] == "WAITING_LEARNING_QUOTA_UNAVAILABLE"
    )
    assert not budget.snapshot()["recent"]
