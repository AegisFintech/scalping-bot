import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from jsonschema import Draft202012Validator, ValidationError

from python.operations.demo_scorecards import Scorecard, summarize
from python.operations.demo_trial_witness import (
    Completion,
    RestartProof,
    WitnessStatus,
    read_status,
    receipt,
    restart,
    retain,
)
from python.research.codex_loop import encoded
from python.research.demo_catalogue import load
from python.research.demo_trial_status import TrialRow, TrialStatus

NOW = datetime(2026, 11, 4, 5, tzinfo=UTC)


def status():
    cat = load()
    rows = []
    for slot, idx in enumerate((1, 2, 0)):
        at = NOW - timedelta(hours=3 - slot)
        closed = slot < 2
        profile = cat.profiles[idx]
        review = (
            {
                "closedPositions": 20,
                "observedNet": "-100",
                "interpretation": "NONPOSITIVE_OBSERVED_NET_UNQUALIFIED",
                "waits": 1,
                "failedProposals": 1,
                "incompleteContexts": 0,
                "nextProfileId": cat.profiles[(1, 2, 0)[(slot + 1) % 3]].id,
            }
            if closed
            else None
        )
        rows.append(
            TrialRow(
                id=str(uuid4()),
                profile_id=profile.id,
                profile_sha256=profile.digest(),
                catalogue_sha256=hashlib.sha256(encoded(cat.model_dump())).hexdigest(),
                source_sha256="a" * 64,
                cycle=0,
                ordinal=slot,
                registered_at=at,
                starts_at=at + timedelta(seconds=1),
                state="COMPLETED" if closed else "ACTIVE",
                market_open_ms="3600000" if closed else "0",
                observed_at=NOW,
                completed_at=at + timedelta(hours=1) if closed else None,
                retirement_reason="ALLOCATION_COMPLETE" if closed else None,
                definition=profile,
                proposals=22 if closed else 0,
                provider_claims=0,
                waits=1 if closed else 0,
                entry_fill_events=20 if closed else 0,
                closes=20 if closed else 0,
                realized_net="-100" if closed else None,
                review=review,
                session_state="OPEN",
                clock_receipts=0,
                last_clock_receipt=None,
            )
        )
    return TrialStatus(
        schemaVersion="demo-trial-status-1.0",
        observedAt=NOW,
        controllerVerifiedAt=NOW,
        reason=None,
        experimental=True,
        nextProfileId="TP_040",
        nextAction="EVALUATE_FRESH_OPPORTUNITIES",
        netIncludesSignedFees=True,
        actualFutureCosts=None,
        trials=list(reversed(rows)),
    )


def proof(s):
    row = s.trials[-1]
    return RestartProof(
        schemaVersion="demo-trial-restart-proof-1.0",
        sourceSha256=row.source_sha256,
        trialId=row.id,
        beforePid=101,
        afterPid=102,
        beforeAt=(row.starts_at + timedelta(minutes=5)).isoformat(),
        afterAt=(row.starts_at + timedelta(minutes=5, seconds=5)).isoformat(),
        originalTrialHeadRetained=True,
        originalGroupIdentitiesRetained=True,
        noShutdownCancellation=True,
        uniqueContextClaimsVerified=True,
        oldPidExited=True,
        brokerAuthority=False,
    )


@pytest.fixture(autouse=True)
def unit_capacity(monkeypatch):
    monkeypatch.setattr("shutil.disk_usage", lambda p: SimpleNamespace(free=5 * 1024**3))


def test_two_distinct_actual_completed_profiles_need_next_action_and_real_restart(tmp_path):
    s = status()
    assert not retain(s, tmp_path, NOW, None)["engineeringMilestoneObserved"]
    r = retain(s, tmp_path, NOW, proof(s))
    assert r["engineeringMilestoneObserved"]
    assert r["windowDistinctFilledProfilesWithNextAction"] == 2
    assert r["actualRestartProofBound"]
    assert not r["economicQualification"]
    assert not r["brokerAuthority"]


def test_negative_results_and_completed_files_are_immutable_and_idempotent(tmp_path):
    s = status()
    retain(s, tmp_path, NOW, None)
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    s.trials[-1].waits += 1  # Late provider completion does not rewrite its frozen review.
    retain(s, tmp_path, NOW, None)
    assert before == {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    assert all(b'"observedNet":"-100"' in b for b in before.values())


def test_zero_fill_and_open_allocations_cannot_establish_milestone(tmp_path):
    s = status()
    for r in s.trials:
        if r.review:
            r.review.closedPositions = 0
            r.review.observedNet = None
            r.review.interpretation = "NO_CLOSED_SAMPLE"
            r.closes = 0
            r.realized_net = None
            r.entry_fill_events = 0
    r = retain(s, tmp_path, NOW, proof(s))
    assert r["retainedCompletedAllocations"] == 2
    assert r["windowFilledCompletedAllocations"] == 0
    assert not r["engineeringMilestoneObserved"]


def test_unregistered_next_action_does_not_count(tmp_path):
    s = status()
    s.trials = s.trials[1:]
    r = retain(s, tmp_path, NOW, proof(s))
    assert r["windowDistinctFilledProfilesWithNextAction"] == 1
    assert not r["engineeringMilestoneObserved"]


def test_archive_files_do_not_manufacture_fresh_broker_proof(tmp_path):
    previous = status()
    retain(previous, tmp_path, NOW, None)
    current = status()
    current.trials = [current.trials[0]]
    r = retain(current, tmp_path, NOW, None)
    assert r["retainedCompletedAllocations"] == 2
    assert r["windowFilledCompletedAllocations"] == 0


def test_duplicate_baseline_hashes_do_not_count_as_different_profiles(tmp_path):
    s = status()
    s.trials[-2].profile_sha256 = s.trials[-1].profile_sha256
    r = retain(s, tmp_path, NOW, proof(s))
    assert r["windowDistinctFilledProfilesWithNextAction"] == 1
    assert not r["engineeringMilestoneObserved"]


def test_stale_controller_and_full_disk_write_nothing(tmp_path, monkeypatch):
    s = status()
    s.controllerVerifiedAt = NOW - timedelta(seconds=31)
    with pytest.raises(ValueError, match="CONTROLLER_STALE"):
        retain(s, tmp_path, NOW, None)
    assert not list(tmp_path.iterdir())
    monkeypatch.setattr("shutil.disk_usage", lambda p: SimpleNamespace(free=1))
    with pytest.raises(ValueError, match="STORAGE_RESERVE"):
        retain(status(), tmp_path, NOW, None)
    assert not list(tmp_path.iterdir())


def test_completion_contradiction_and_future_restart_reject(tmp_path):
    s = status()
    s.trials[-1].review.closedPositions = 19
    with pytest.raises(ValueError, match="COMPLETION_CONTRADICTION"):
        receipt(s.trials[-1])
    raw = proof(status()).model_dump()
    raw["afterPid"] = raw["beforePid"]
    with pytest.raises(ValueError, match="RESTART_INVALID"):
        RestartProof.model_validate(raw)
    path = tmp_path / "receipt.json"
    path.write_text("{}")
    path.chmod(0o666)
    with pytest.raises(ValueError, match="PROTECTION_INVALID"):
        restart(path, NOW)


def test_unknown_and_stale_observer_status_stay_unavailable(tmp_path):
    p = tmp_path / "status.json"
    assert read_status(NOW, p) is None
    p.write_bytes(encoded(retain(status(), tmp_path, NOW, None)))
    assert read_status(NOW, p) is not None
    assert read_status(NOW + timedelta(seconds=181), p) is None
    p.write_text('{"available":false}')
    assert read_status(NOW, p) is None


def test_actual_restart_can_precede_completed_allocation_proof(tmp_path):
    s = status()
    p = proof(s)
    s.trials[-1].state = "ACTIVE"
    s.trials[-1].completed_at = None
    s.trials[-1].review = None
    r = retain(s, tmp_path, NOW, p)
    assert r["actualRestartRecorded"]
    assert not r["actualRestartProofBound"]
    assert not r["engineeringMilestoneObserved"]


@pytest.mark.parametrize("owner", [0, 1001])
def test_restart_receipt_owner_is_checked_independently_of_runner(tmp_path, monkeypatch, owner):
    p = tmp_path / "restart.json"
    expected = proof(status())
    p.write_bytes(encoded(expected.model_dump(mode="json")))
    p.chmod(0o644)
    original = Path.lstat

    def metadata(path):
        info = original(path)
        if path == p:
            fields = list(info)
            fields[4] = owner
            return os.stat_result(fields)
        return info

    monkeypatch.setattr(Path, "lstat", metadata)
    if owner == 0:
        assert restart(p, NOW) == expected
    else:
        with pytest.raises(ValueError, match="PROTECTION_INVALID"):
            restart(p, NOW)


@pytest.mark.parametrize("model", [Scorecard, Completion, RestartProof, WitnessStatus])
def test_exported_schemas_match_actual_models_and_reject_authority(model, tmp_path):
    s = status()
    examples = {
        Scorecard: summarize([], NOW - timedelta(hours=1), NOW, "USD", 0, 0).model_dump(
            mode="json"
        ),
        Completion: receipt(s.trials[-1]),
        RestartProof: proof(s).model_dump(mode="json"),
        WitnessStatus: retain(s, tmp_path, NOW, proof(s)),
    }
    value = examples[model]
    schema = json.loads(Path(f"schemas/{value['schemaVersion']}.json").read_bytes())
    assert schema == {
        "$schema": "http://json-schema.org/draft-07/schema#",
        **model.model_json_schema(),
    }
    validator = Draft202012Validator(schema)
    validator.validate(value)
    with pytest.raises(ValidationError):
        validator.validate({**value, "brokerAuthority": True})


def test_fresh_storage_failure_is_visible_but_unknown_text_is_withheld(tmp_path):
    path = tmp_path / "status.json"
    failure = {
        "checkedAt": NOW.isoformat(),
        "available": False,
        "reason": "WITNESS_STORAGE_RESERVE",
    }
    path.write_text(json.dumps(failure))
    assert read_status(NOW, path) == failure
    assert read_status(NOW + timedelta(minutes=4), path) is None
    failure["reason"] = "private raw exception"
    path.write_text(json.dumps(failure))
    assert read_status(NOW, path) is None


@pytest.mark.parametrize("at", [None, 42, {}, [], "invalid"])
def test_malformed_failure_clock_does_not_break_learning(tmp_path, at):
    path = tmp_path / "status.json"
    path.write_text(
        json.dumps({"checkedAt": at, "available": False, "reason": "WITNESS_STORAGE_RESERVE"})
    )
    assert read_status(NOW, path) is None


def test_source_handover_is_not_a_completed_allocation(tmp_path):
    s = status()
    s.trials[-1].retirement_reason = "SOURCE_HANDOVER"
    result = retain(s, tmp_path, NOW, None)
    assert result["retainedCompletedAllocations"] == 1
    assert result["windowFilledCompletedAllocations"] == 1
    assert not (tmp_path / f"trial-{s.trials[-1].id}.json").exists()


def test_trend_status_schema_preserves_old_schema_and_rejects_wrong_catalogue():
    from python.codex_entry.trend_protocol import TrendProfile, catalogue
    from python.research.demo_trial_status import TrendTrialStatus, status_reader

    schema = json.loads(Path("schemas/demo-trial-status-1.1.json").read_bytes())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == TrendTrialStatus.model_json_schema()
    raw = status().model_dump(mode="json")
    raw["schemaVersion"] = "demo-trial-status-1.1"
    row = raw["trials"][0]
    profile = TrendProfile.model_validate(catalogue()["profiles"][0])
    row.update(
        profile_id=profile.id,
        definition=profile.model_dump(),
        profile_sha256=profile.digest(),
        catalogue_sha256=hashlib.sha256(encoded(catalogue())).hexdigest(),
    )
    assert status_reader.validate_json(json.dumps(raw)).trials[0].profile_id == "TREND_BREAKOUT"
    row["catalogue_sha256"] = "f" * 64
    with pytest.raises(ValueError):
        status_reader.validate_json(json.dumps(raw))


def test_scorecard_labels_the_selected_release_without_relabeling_history():
    from python.operations.demo_scorecards import TrendScorecard

    new = summarize([], NOW - timedelta(hours=1), NOW, "USD", 0, 0, "0.11.0-trend-retest.1-codex.1")
    assert isinstance(new, TrendScorecard)
    assert new.schemaVersion == "demo-day-scorecard-1.1"
    old = summarize([], NOW - timedelta(hours=1), NOW, "USD", 0, 0)
    assert old.release == "0.10.0-demo-trials.1-codex.1"
    with pytest.raises(ValueError, match="SCORECARD_RELEASE_UNKNOWN"):
        summarize([], NOW - timedelta(hours=1), NOW, "USD", 0, 0, "unknown")
