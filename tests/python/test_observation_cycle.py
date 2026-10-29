from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from python.research import observation_cycle as c
from python.research.learning_evidence import encoded
from tests.python.test_learning_bridge import packet
from tests.python.test_scalp_replay import fill, fixture, model


def answer(prompt: str, job: Path) -> bytes:
    assert (job / "claim.json").exists() and "Carry-in" in prompt
    data = json.loads(prompt.split("\nINPUT ", 1)[1])
    return encoded(
        {
            "diagnosticSha256": data["diagnosticSha256"],
            "summary": "No economic qualification from this bounded window.",
            "limitations": ["No complete tick paths or counterfactual costs."],
            "nextTopic": "execution",
            "nextQuestion": "What fraction of submitted entries receive exact acceptance?",
            "requiredEvidence": "Provider availability and broker acceptance clocks.",
            "falsificationTest": "Keep uncertain and unfilled submissions in the denominator.",
        }
    )


def run(root: Path, value: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    return c.run(
        root,
        encoded(value),
        "fixture-demo",
        c.timestamp(value["exportedAt"]),
        invoke=kwargs.pop("invoke", answer),
        **kwargs,
    )


def job(root: Path) -> Path:
    return next(root.rglob("plan.json")).parent


def test_real_wait_cycle_closes_and_duplicate_never_dispatches(tmp_path: Path) -> None:
    value = packet()
    first = run(tmp_path, value)
    assert first["status"] == "CLOSED"
    directory = job(tmp_path)
    report = json.loads((directory / "diagnostic.json").read_text())
    assert report["counts"]["decision_WAIT"] == 1
    assert report["counterfactualNet"] is None and report["recordedClosedStatistics"] == []
    assert report["cohortRoles"]["contexts"] == {"OBSERVED_WINDOW": 1}
    assert not first["promotionAuthority"] and not first["brokerAuthority"]
    original = (directory / "finding.json").read_bytes()
    value["exportedAt"] = "2026-10-28T00:32:00+00:00"
    assert (
        run(tmp_path, value, invoke=lambda *_: pytest.fail("duplicate call"))["status"] == "CLOSED"
    )
    assert (directory / "finding.json").read_bytes() == original


@pytest.mark.parametrize("volume", ["0", "5", "10"])
def test_unfilled_partial_open_and_carry_in_are_not_closed_winners(
    tmp_path: Path, volume: str
) -> None:
    value = fixture()
    if volume != "0":
        fill(value, volume)
    value["setups"][0]["cohortRole"] = "CARRY_IN"
    value = model(value).model_dump()
    run(tmp_path, value)
    report = json.loads((job(tmp_path) / "diagnostic.json").read_text())
    assert report["counts"]["setups"] == 1
    assert report["cohortRoles"]["setups"] == {"CARRY_IN": 1}
    assert report["recordedClosedStatistics"] == [] and report["counterfactualNet"] is None


@pytest.mark.parametrize("kind", ["timeout", "wrong_hash", "extra_tool", "duplicate_key"])
def test_unknown_or_invalid_provider_result_is_never_replayed(tmp_path: Path, kind: str) -> None:
    def invalid(prompt: str, directory: Path) -> bytes:
        if kind == "timeout":
            raise ValueError("CODEX_TIMEOUT_UNKNOWN")
        response = json.loads(answer(prompt, directory))
        if kind == "wrong_hash":
            response["diagnosticSha256"] = "f" * 64
        if kind == "extra_tool":
            response["tool"] = "engineering_deploy"
        raw = encoded(response)
        if kind == "duplicate_key":
            raw = raw[:-1] + b',"summary":"conflict"}'
        return raw

    assert (
        run(tmp_path, packet(), invoke=invalid)["status"] == "PROVIDER_OUTCOME_UNKNOWN_OR_INVALID"
    )
    assert run(tmp_path, packet(), invoke=lambda *_: pytest.fail("replay"))["status"] != "CLOSED"
    assert not (job(tmp_path) / "closed.json").exists()


def test_restart_after_finding_before_closure_recovers_without_provider(tmp_path: Path) -> None:
    run(tmp_path, packet())
    (job(tmp_path) / "closed.json").unlink()
    assert run(tmp_path, packet(), invoke=lambda *_: pytest.fail("replay"))["status"] == "CLOSED"
    assert (job(tmp_path) / "closed.json").exists()


@pytest.mark.parametrize("kind", ["stale", "future", "wrong_source", "revision"])
def test_bad_intake_cannot_dispatch(tmp_path: Path, kind: str) -> None:
    value = packet()
    now = c.timestamp(value["exportedAt"])
    if kind == "stale":
        now += timedelta(hours=2)
    elif kind == "future":
        now -= timedelta(hours=2)
    elif kind == "wrong_source":
        value["sourceId"] = "other"
    else:
        value["contexts"][0]["revisionSha256"] = "f" * 64
    with pytest.raises(ValueError):
        c.run(tmp_path, encoded(value), "fixture-demo", now, invoke=lambda *_: pytest.fail("call"))
    assert not list(tmp_path.rglob("claim.json"))


def test_retained_diagnostic_tampering_fails_closed(tmp_path: Path) -> None:
    run(tmp_path, packet())
    path = job(tmp_path) / "diagnostic.json"
    value = json.loads(path.read_text())
    value["counts"]["decision_WAIT"] = 100
    path.write_bytes(encoded(value))
    with pytest.raises(ValueError, match="CONTENT_CONFLICT"):
        run(tmp_path, packet(), invoke=lambda *_: pytest.fail("call"))


def test_cooldown_applies_across_different_windows(tmp_path: Path) -> None:
    run(tmp_path, packet())
    value = packet(start="2026-10-28T00:01:00+00:00")
    assert (
        run(tmp_path, value, invoke=lambda *_: pytest.fail("call"))["status"] == "REVIEW_COOLDOWN"
    )


def test_symlink_agenda_is_not_followed(tmp_path: Path) -> None:
    scope = tmp_path / "fixture-demo"
    scope.mkdir()
    (scope / "current-observation-agenda").symlink_to(tmp_path)
    with pytest.raises(ValueError, match="PATH_INVALID"):
        run(tmp_path, packet(), invoke=lambda *_: pytest.fail("call"))


def test_stale_completed_feed_is_not_reported_healthy(tmp_path: Path) -> None:
    value = packet()
    run(tmp_path, value)
    result = c.run(
        tmp_path,
        encoded(value),
        "fixture-demo",
        c.timestamp(value["exportedAt"]) + timedelta(hours=2),
        invoke=lambda *_: pytest.fail("call"),
    )
    assert result["status"] == "STALE_FEED"
    assert result["lastCompletedAt"] is not None


def test_older_completion_never_rewinds_completion_watermark(tmp_path: Path) -> None:
    value = packet()
    run(tmp_path, value)
    later = packet(
        start="2026-10-28T00:30:00Z",
        until="2026-10-28T01:00:00Z",
        journalSnapshotAt="2026-10-28T01:00:01Z",
        exportedAt="2026-10-28T01:01:00Z",
        contexts=[],
    )
    second = run(tmp_path, later)
    previous = run(tmp_path, value, invoke=lambda *_: pytest.fail("call"))
    assert previous["lastCompletedWindow"] == second["lastCompletedWindow"]
    assert previous["lastCompletedAt"] == second["lastCompletedAt"]


def test_interpretation_schema_matches_published_contract() -> None:
    schema = json.loads(Path("schemas/current-observation-interpretation-1.0.json").read_text())
    schema.pop("$schema")
    schema.pop("$id")
    assert schema == c.Interpretation.model_json_schema()


def test_future_retained_packet_is_unhealthy_without_redispatch(tmp_path: Path) -> None:
    value = packet()
    run(tmp_path, value)
    result = c.run(
        tmp_path,
        encoded(value),
        "fixture-demo",
        c.timestamp(value["exportedAt"]) - timedelta(hours=2),
        invoke=lambda *_: pytest.fail("call"),
    )
    assert result["status"] == "FUTURE_FEED"


def test_saved_response_can_finish_after_crash_without_a_second_call(tmp_path: Path) -> None:
    run(tmp_path, packet())
    directory = job(tmp_path)
    (directory / "closed.json").unlink()
    (directory / "finding.json").unlink()
    result = run(tmp_path, packet(), invoke=lambda *_: pytest.fail("call"))
    assert result["status"] == "CLOSED" and (directory / "finding.json").exists()


def test_safe_reason_never_exposes_provider_or_database_details() -> None:
    assert c.safe_reason(ValueError("CODEX_TIMEOUT_UNKNOWN")) == "CODEX_TIMEOUT_UNKNOWN"
    assert (
        c.safe_reason(ValueError("private endpoint with credentials"))
        == "RESEARCH_INVALID_EVIDENCE"
    )


def test_changed_interpretation_cannot_be_attributed_to_saved_response(tmp_path: Path) -> None:
    run(tmp_path, packet())
    directory = job(tmp_path)
    (directory / "closed.json").unlink()
    path = directory / "finding.json"
    value = json.loads(path.read_text())
    value["interpretation"]["summary"] = "Fabricated interpretation"
    path.write_bytes(encoded(value))
    with pytest.raises(ValueError, match="FINDING_BINDING_INVALID"):
        run(tmp_path, packet(), invoke=lambda *_: pytest.fail("call"))
    assert not (directory / "closed.json").exists()
