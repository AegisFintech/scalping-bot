from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from python.operations import flight_heartbeat as flight
from python.operations import harness_health as health
from python.operations import research_delivery as delivery
from python.research.learning_evidence import encoded
from tests.python import test_holding_mailbox as fixtures

NOW = datetime(2026, 10, 31, 3, tzinfo=UTC)


def generation(**changes):
    return delivery.GenerationHealth(
        version="research-generation-health-1.0",
        checkedAt=NOW.isoformat(),
        status="SIGNED",
        phase="PUBLISHING",
        reason=None,
        job="a" * 64,
        baseCommit="b" * 40,
        publicationSha256="c" * 64,
        origin=None,
        brokerAuthority=False,
        promotionAuthority=False,
        **changes,
    )


def review(digest="c" * 64, at=None):
    return delivery.ReviewHealth(
        version="research-review-health-1.0",
        checkedAt=at or NOW.isoformat(),
        status="IDLE",
        reason=None,
        recent=[],
        lastTerminal=delivery.ReviewOutcome(
            pullRequest=42,
            status="MERGED",
            publicationSha256=digest,
            headCommit="d" * 40,
            mergeCommit="e" * 40,
        ),
        brokerAuthority=False,
        promotionAuthority=False,
    )


def packet(gen=None, rev=None):
    return delivery.DeliveryHealth(
        version="research-delivery-health-1.0",
        checkedAt=NOW.isoformat(),
        generation=gen,
        review=rev,
        brokerAuthority=False,
        promotionAuthority=False,
    )


def test_lineage_matches_only_exact_publication_and_never_promotes():
    assert delivery.view(packet(generation(), review("f" * 64)), NOW)["matchedOutcome"] is None
    value = delivery.view(packet(generation(), review()), NOW)
    assert value["matchedOutcome"]["mergeCommit"] == "e" * 40
    assert value["brokerAuthority"] is value["promotionAuthority"] is False
    expired = delivery.view(packet(generation(), review()), NOW + timedelta(seconds=301))
    assert expired["generation"] is expired["review"] is expired["matchedOutcome"] is None


def test_future_review_does_not_inherit_candidate_identity():
    value = delivery.view(
        packet(generation(), review(at=(NOW + timedelta(seconds=6)).isoformat())), NOW
    )
    assert value["review"] is value["matchedOutcome"] is None


def test_actual_selected_archive_drives_origin_not_latest_agenda(tmp_path):
    closed = fixtures.closed.__wrapped__(tmp_path)
    request = fixtures.request(closed)
    root = tmp_path / "authority"
    job = "a" * 64
    directory = root / job
    directory.mkdir(parents=True)
    (directory / "request.json").write_bytes(encoded(request))
    status = {"checkedAt": NOW.isoformat(), "status": "QUEUED_OR_UNKNOWN", "job": job}
    result = delivery.generation(root, status)
    assert (
        result.origin.trialId
        == json.loads((closed / "experiment-closed.json").read_bytes())["trialId"]
    )
    assert result.origin.recordedClosedRows == 0
    assert result.origin.resultSha256 != result.origin.findingSha256
    assert not (directory / "experiment").exists()
    request["experiment"]["result.bin"] = b"{}".hex()
    (directory / "request.json").write_bytes(encoded(request))
    with pytest.raises(ValueError):
        delivery.generation(root, status)


def test_public_metadata_rejects_private_extra_fields_and_stale_files(tmp_path):
    path = tmp_path / "status.json"
    delivery.publish(path, generation())
    assert path.stat().st_mode & 0o777 == 0o644
    assert delivery.load(path, delivery.GenerationHealth, NOW).job == "a" * 64
    assert delivery.load(path, delivery.GenerationHealth, NOW + timedelta(seconds=301)) is None
    value = generation().model_dump()
    value["token"] = "PRIVATE"
    path.write_bytes(encoded(value))
    assert delivery.load(path, delivery.GenerationHealth, NOW) is None


def test_recorder_heartbeat_is_independent_and_does_not_refresh_recorded_clock(
    tmp_path, monkeypatch
):
    source, public = tmp_path / "private.json", tmp_path / "public.json"
    source.write_bytes(
        encoded(
            {
                "checkedAt": NOW.isoformat(),
                "state": "GAP",
                "summary": "PRIVATE",
                "accountId": "PRIVATE",
            }
        )
    )
    flight.publish(source, NOW, public)
    monkeypatch.setattr(flight, "PUBLIC", public)
    value = flight.load(NOW)
    assert value.state == "GAP" and value.completeTickTape is False
    assert b"PRIVATE" not in public.read_bytes()
    flight.publish(source, NOW + timedelta(seconds=11), public)
    with pytest.raises(ValueError, match="STALE"):
        flight.load(NOW + timedelta(seconds=11))
    source.unlink()
    flight.publish(source, NOW, public)
    with pytest.raises(ValueError, match="UNAVAILABLE"):
        flight.load(NOW)


def test_versioned_composition_preserves_old_health_and_expires_nested_lineage(
    tmp_path, monkeypatch
):
    def failed(*args, **kwargs):
        raise OSError

    monkeypatch.setattr(health, "urlopen", failed)
    monkeypatch.setattr(health, "fetch_research", failed)
    monkeypatch.setattr(health, "read", failed)
    core = health.collect(NOW)
    value = health.HarnessEnvelope11(
        version="harness-health-1.1",
        checkedAt=core.checkedAt,
        core=core,
        delivery=packet(generation(), review()).model_copy(update={"checkedAt": core.checkedAt}),
    )
    path = tmp_path / "status.json"
    path.write_bytes(encoded(value.model_dump()))
    assert health.load(path, NOW)["delivery"]["matchedOutcome"]["pullRequest"] == 42
    assert health.load(path, NOW + timedelta(seconds=181))["available"] is False
    value.delivery.generation.checkedAt = (NOW - timedelta(seconds=299)).isoformat()
    path.write_bytes(encoded(value.model_dump()))
    assert health.load(path, NOW + timedelta(seconds=2))["delivery"]["generation"] is None
    value.checkedAt = (NOW + timedelta(seconds=1)).isoformat()
    with pytest.raises(ValueError, match="CLOCK"):
        health.HarnessEnvelope11.model_validate(value.model_dump())


def test_new_schema_files_match():
    for name, model in [
        ("harness-health-1.1", health.HarnessEnvelope11),
        ("research-health-1.1", health.RemoteHealth11),
        ("flight-heartbeat-1.0", flight.Heartbeat),
    ]:
        assert json.loads(Path(f"schemas/{name}.json").read_bytes()) == model.model_json_schema()


def test_remote_composition_collects_review_once_and_preserves_source_clocks(tmp_path, monkeypatch):
    from tests.python.test_harness_health import root as make_root

    root = make_root.__wrapped__(tmp_path)
    remote = health.RemoteHealth11(
        version="research-health-1.1", core=health.export(root, NOW), review=review()
    )
    calls = []
    monkeypatch.setattr(
        health, "fetch_research", lambda: calls.append(1) or encoded(remote.model_dump())
    )
    monkeypatch.setattr(health, "urlopen", lambda *_a, **_k: (_ for _ in ()).throw(OSError()))
    value = health.collect_packet(NOW)
    assert calls == [1] and value.delivery.review.lastTerminal.pullRequest == 42
    assert value.core.research.checkedAt == remote.core.checkedAt


def test_recorder_gap_remains_blocked_without_dashboard_or_account_access(monkeypatch):
    def failed(*args, **kwargs):
        raise OSError

    monkeypatch.setattr(health, "urlopen", failed)
    monkeypatch.setattr(health, "fetch_research", failed)
    monkeypatch.setattr(
        health.flight_heartbeat,
        "load",
        lambda now: flight.Heartbeat(
            version="flight-heartbeat-1.0",
            checkedAt=NOW.isoformat(),
            recordedAt=NOW.isoformat(),
            state="GAP",
            completeTickTape=False,
            brokerAuthority=False,
        ),
    )
    value = health.collect(NOW)
    assert value.stages[0].state == "UNAVAILABLE"
    assert value.stages[1].state == "BLOCKED" and "GAP" in value.stages[1].detail


@pytest.mark.parametrize("bad", [[], None, 7, "invalid"])
def test_nonobject_sources_are_unavailable_instead_of_crashing(tmp_path, monkeypatch, bad):
    path = tmp_path / "status.json"
    path.write_bytes(encoded(bad))
    assert health.load(path, NOW)["available"] is False
    monkeypatch.setattr(health, "fetch_research", lambda: encoded(bad))
    monkeypatch.setattr(health, "urlopen", lambda *_a, **_k: (_ for _ in ()).throw(OSError()))
    assert health.collect(NOW).research is None
    target = tmp_path / "flight.json"
    flight.publish(path, NOW, target)
    assert flight.Heartbeat.model_validate_json(target.read_bytes()).state == "UNAVAILABLE"
