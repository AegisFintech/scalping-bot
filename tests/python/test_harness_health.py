from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path

import pytest

from apps.dashboard.flight_view import load_flight_view
from python.operations import harness_health as h
from python.research.learning_evidence import encoded

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded(value))


def bot(**changes):
    return {
        "mode": "demo",
        "operationalReady": True,
        "startupChecksPassed": True,
        "automaticAnalysisEnabled": True,
        "tradingEnabled": True,
        "marketSession": {
            "state": "OPEN",
            "checkedAt": NOW.isoformat(),
            "scheduleFetchedAt": NOW.isoformat(),
        },
        "automationActivity": {"state": "RUNNING"},
        **changes,
    }


@pytest.mark.parametrize(
    "patch,state,detail",
    [
        ({}, "CURRENT", "Operationally ready"),
        ({"pauseNewAnalyses": True}, "BLOCKED", "Explicit pause"),
        ({"operationalReady": False}, "BLOCKED", "not established"),
        ({"automaticAnalysisEnabled": False}, "WAITING", "disabled"),
        ({"automationActivity": {"state": "MANAGING_SETUP"}}, "CURRENT", "Managing accepted"),
        ({"automationActivity": {"state": "STALLED"}}, "BLOCKED", "stalled"),
        ({"automationActivity": {"state": "UNAVAILABLE"}}, "UNAVAILABLE", "cannot be verified"),
        ({"reasonCodes": ["SCENARIO_CODEX_WAIT"]}, "WAITING", "SCENARIO_CODEX_WAIT"),
        (
            {
                "marketSession": {
                    "state": "OPEN",
                    "checkedAt": (NOW - timedelta(minutes=1)).isoformat(),
                }
            },
            "WAITING",
            "stale",
        ),
    ],
)
def test_waits_are_distinct_from_operational_failures(patch, state, detail):
    result = h.demo(bot(**patch), NOW)
    assert result.state == state and detail in result.detail


def test_closed_session_does_not_claim_stall_or_dispatch():
    value = bot()
    value["marketSession"]["state"] = "CLOSED"
    assert h.demo(value, NOW).state == "WAITING"
    assert "protection" in h.demo(value, NOW).detail


@pytest.fixture
def root(tmp_path):
    key = "a" * 64
    finding = {"interpretation": {"nextQuestion": "Are modeled costs observable?"}}
    job = tmp_path / "archive/scalper-epoch314/current-observation-agenda" / key
    write(job / "finding.json", finding)
    write(
        job / "closed.json",
        {"planId": key, "findingSha256": h.sha(encoded(finding)), "status": "CLOSED"},
    )
    write(
        tmp_path / "health.json", {"checkedAt": NOW.isoformat(), "status": "CLOSED", "planId": key}
    )
    write(
        tmp_path / "experiments450/health.json",
        {"checkedAt": NOW.isoformat(), "status": "CHECKED", "admissionBlocker": None, "recent": []},
    )
    for i, kind in enumerate(["NEGATIVE", "INCONCLUSIVE", "REJECTED"]):
        trial = str(i) * 64
        directory = tmp_path / "experiments450" / key / trial
        finding = {"trialId": trial, "kind": kind}
        write(directory / "experiment-finding.json", finding)
        write(
            directory / "experiment-closed.json",
            {"trialId": trial, "findingSha256": h.sha(encoded(finding)), "status": "CLOSED"},
        )
    return tmp_path


def test_research_counts_keep_negative_rejected_and_inconclusive_trials(root):
    result = h.export(root, NOW)
    assert result.observation.state == result.experiments.state == "CURRENT"
    assert result.closureCounts == {"NEGATIVE": 1, "INCONCLUSIVE": 1, "REJECTED": 1}
    assert result.question == "Are modeled costs observable?"
    assert "not trades" in result.experiments.detail


def test_fresh_process_cannot_make_old_review_or_experiment_current(root):
    result = h.export(root, NOW + timedelta(minutes=41))
    assert result.observation.state == result.experiments.state == "STALE"
    assert result.question is None and result.closureCounts is None


def test_missing_or_corrupt_closure_is_unavailable_not_zero(root):
    path = next((root / "experiments450").glob("*/*/experiment-finding.json"))
    path.write_text('{"kind":"POSITIVE"}')
    result = h.export(root, NOW)
    assert result.experiments.state == "UNAVAILABLE"
    (root / "health.json").unlink()
    assert h.export(root, NOW).observation.state == "UNAVAILABLE"


@pytest.mark.parametrize(
    "status", ["NOT_RECEIVED", "TRANSFER_OR_RESULT_UNKNOWN", "RUNNING_OR_UNKNOWN"]
)
def test_unknown_remote_outcome_is_visible_without_retry(root, status):
    path = root / "experiments450/health.json"
    value = json.loads(path.read_bytes())
    value["recent"] = [{"status": status, "trialId": "b" * 64}]
    write(path, value)
    stage, trial, _ = h.experiments(root, NOW)
    assert stage.state == "BLOCKED" and trial == "b" * 64
    assert "never authorize redispatch" in stage.detail


def test_public_monitor_whitelists_and_expires(monkeypatch, root, tmp_path):
    recorder = tmp_path / "flight"
    summary = "flight-" + "a" * 24 + "-20261030T120000000000.summary.json"
    write(
        recorder / "status.json",
        {"checkedAt": NOW.isoformat(), "state": "RECORDING", "summary": summary},
    )
    write(recorder / summary, {"schemaVersion": "1.0", "state": "OPEN", "chart": []})
    flight = load_flight_view(recorder, NOW)
    assert flight["available"] is True and flight["state"] == "OPEN"
    monkeypatch.setattr(
        h,
        "urlopen",
        lambda *a, **k: BytesIO(
            encoded(
                {
                    **bot(accountId="DO_NOT_EXPOSE", token="PRIVATE"),
                    "flight": flight,
                }
            )
        ),
    )
    monkeypatch.setattr(
        h.flight_heartbeat,
        "load",
        lambda now: h.flight_heartbeat.Heartbeat(
            version="flight-heartbeat-1.0",
            checkedAt=NOW.isoformat(),
            recordedAt=NOW.isoformat(),
            state="RECORDING",
            completeTickTape=False,
            brokerAuthority=False,
        ),
    )
    original = h.read

    def read(path):
        if path == Path("/var/lib/scalper-publisher/status.json"):
            raise OSError
        return original(path)

    monkeypatch.setattr(h, "read", read)
    monkeypatch.setattr(h, "fetch_research", lambda: encoded(h.export(root, NOW).model_dump()))
    result = h.collect(NOW)
    assert result.stages[0].state == result.stages[1].state == "CURRENT"
    assert result.stages[-1].state == "UNAVAILABLE"
    raw = encoded(result.model_dump())
    assert b"DO_NOT_EXPOSE" not in raw and b"PRIVATE" not in raw
    path = tmp_path / "public.json"
    path.write_bytes(raw)
    assert h.load(path, NOW)["brokerAuthority"] is False
    assert h.load(path, NOW + timedelta(minutes=4))["available"] is False


def test_unavailable_sources_are_not_reported_healthy(monkeypatch):
    def failed(*args, **kwargs):
        raise OSError

    monkeypatch.setattr(h, "urlopen", failed)
    monkeypatch.setattr(h, "fetch_research", failed)
    monkeypatch.setattr(h, "read", failed)
    result = h.collect(NOW)
    assert [s.state for s in result.stages] == ["UNAVAILABLE"] * 5
    assert result.research is None and result.recoveryAuthority is False


def test_future_or_extra_fields_cannot_be_public_health(tmp_path):
    assert h.load(tmp_path / "missing", NOW)["available"] is False
    assert not h.fresh((NOW + timedelta(seconds=6)).isoformat(), NOW, 300)
    assert not h.fresh(None, NOW, 300)
    with pytest.raises(ValueError):
        h.demo([], NOW)


def test_error_heartbeat_and_publisher_receipt_are_independent(monkeypatch):
    def failed(*args, **kwargs):
        raise OSError

    def read(path):
        if path.name == "status.json" and path.parent.name == "recordings":
            return {"checkedAt": NOW.isoformat(), "state": "UNAVAILABLE"}
        return {
            "checkedAt": NOW.isoformat(),
            "status": "AWAITING_REVIEW",
            "reason": "REVIEW_REQUIRED",
            "pullRequest": 123,
            "headCommit": "a" * 40,
        }

    monkeypatch.setattr(h, "urlopen", failed)
    monkeypatch.setattr(h, "fetch_research", failed)
    monkeypatch.setattr(h, "read", read)
    result = h.collect(NOW)
    assert result.stages[1].state == "UNAVAILABLE"
    assert result.stages[-1].state == "WAITING" and result.publisher.pullRequest == 123
    assert h.collect(NOW + timedelta(minutes=6)).publisher is None


def test_slow_transfer_does_not_make_a_current_export_look_future(monkeypatch, root):
    elapsed = [0]
    monkeypatch.setattr(h, "monotonic", lambda: elapsed[0])

    def failed(*args, **kwargs):
        raise OSError

    monkeypatch.setattr(h, "urlopen", failed)

    def fetch():
        elapsed[0] = 12
        return encoded(h.export(root, NOW + timedelta(seconds=12)).model_dump())

    monkeypatch.setattr(h, "fetch_research", fetch)
    result = h.collect(NOW)
    assert result.research is not None
    assert result.checkedAt == (NOW + timedelta(seconds=12)).isoformat()


def test_public_schema_matches_model():
    assert (
        json.loads(Path("schemas/harness-health-1.0.json").read_bytes())
        == h.HarnessHealth.model_json_schema()
    )


@pytest.mark.parametrize("state", ["DISABLED", "PAUSED", "WAITING_FOR_MARKET", "STARTING"])
def test_watchdog_waits_cannot_be_reported_current(state):
    assert h.demo(bot(automationActivity={"state": state}), NOW).state == "WAITING"


def test_new_unknown_vocabulary_is_unavailable(root):
    assert h.demo(bot(automationActivity={"state": "NEW_UNKNOWN"}), NOW).state == "UNAVAILABLE"
    write(
        root / "experiments450/health.json",
        {
            "checkedAt": NOW.isoformat(),
            "status": "CHECKED",
            "recent": [{"status": "NEW_UNKNOWN", "trialId": "b" * 64}],
        },
    )
    result = h.export(root, NOW)
    assert result.experiments.state == "UNAVAILABLE" and result.closureCounts is None


def test_nested_observations_expire_before_collector_snapshot(monkeypatch, root, tmp_path):
    def failed(*args, **kwargs):
        raise OSError

    monkeypatch.setattr(h, "urlopen", failed)
    monkeypatch.setattr(h, "read", failed)
    monkeypatch.setattr(h, "fetch_research", failed)
    value = h.collect(NOW)
    value.stages[2] = h.stage(
        "Observation", "CURRENT", (NOW - timedelta(seconds=2399)).isoformat(), "Review closed."
    )
    value.stages[3] = h.stage(
        "Experiments", "CURRENT", (NOW - timedelta(seconds=299)).isoformat(), "Known closures."
    )
    value.research = h.ResearchHealth(
        checkedAt=NOW.isoformat(),
        observation=value.stages[2],
        experiments=value.stages[3],
        question="Question",
        planId="a" * 64,
        trialId="b" * 64,
        closureCounts={"NEGATIVE": 1},
    )
    path = tmp_path / "public.json"
    path.write_bytes(encoded(value.model_dump()))
    assert h.load(path, NOW)["research"]["closureCounts"] == {"NEGATIVE": 1}
    after = h.load(path, NOW + timedelta(seconds=2))
    assert after["stages"][2]["state"] == after["stages"][3]["state"] == "STALE"
    assert after["research"]["closureCounts"] is None and after["research"]["question"] is None


@pytest.mark.parametrize(
    "patch,state",
    [
        ({"automationActivity": {"state": "STALLED"}}, "BLOCKED"),
        ({"automationActivity": {"state": "UNAVAILABLE"}}, "UNAVAILABLE"),
        ({"automationActivity": {"state": "MANAGING_SETUP"}}, "CURRENT"),
        ({"reasonCodes": ["QUOTE_STALE"]}, "WAITING"),
    ],
)
def test_effective_admission_denial_preserves_specific_status(patch, state):
    result = h.demo(bot(tradingEnabled=False, **patch), NOW)
    assert result.state == state and "disabled" not in result.detail


def test_closed_session_with_effective_submission_false():
    value = bot(tradingEnabled=False)
    value["marketSession"]["state"] = "CLOSED"
    assert "Broker session closed" in h.demo(value, NOW).detail


@pytest.mark.parametrize("state", ["CURRENT", "WAITING", "BLOCKED", "STALE"])
def test_observed_stage_requires_timestamp(state):
    with pytest.raises(ValueError, match="HEALTH_OBSERVATION_TIME_REQUIRED"):
        h.stage("Demo", state, None, "No source time")


def test_unsampled_claims_remain_visible_across_rotating_checks(root):
    for i in range(5):
        write(root / "experiments450" / ("a" * 64) / (str(i + 4) * 64) / "claim.json", {})
    write(
        root / "experiments450/health.json",
        {
            "checkedAt": NOW.isoformat(),
            "status": "CHECKED",
            "recent": [{"status": "QUEUED", "trialId": str(i + 4) * 64} for i in range(4)],
        },
    )
    stage, _, counts = h.experiments(root, NOW)
    assert stage.state == "WAITING"
    assert "5 claimed job outcomes unresolved" in stage.detail
    assert counts["NEGATIVE"] == 1
