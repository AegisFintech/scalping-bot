from datetime import UTC, datetime, timedelta

from apps.dashboard import learning_progress as p
from python.research.learning_evidence import encoded

NOW = datetime(2026, 11, 2, 12, tzinfo=UTC)


def test_publisher_blocker_and_actual_activity_are_separate_from_heartbeat(tmp_path, monkeypatch):
    digest = "a" * 64
    packet = {
        "publisher": {"status": "BLOCKED", "reason": "PUBLICATION_ATTESTATION_STALE"},
        "stages": [],
        "delivery": {
            "generation": {"status": "WAITING_RESEARCH_DUPLICATE", "publicationSha256": digest},
            "review": {"status": "IDLE"},
        },
    }
    monkeypatch.setattr(p, "load", lambda *_: packet)
    monkeypatch.setattr(p, "PUBLISHER", tmp_path)
    directory = tmp_path / "jobs" / digest / "phases"
    directory.mkdir(parents=True)
    phase = directory / "proposal.json"
    phase.write_bytes(encoded({"placeholder": "data"}))
    import os

    old = (NOW - timedelta(days=2)).timestamp()
    os.utime(phase, (old, old))
    value = p.progress(NOW)
    assert value["publisher"]["reason"] == "PUBLICATION_ATTESTATION_STALE"
    assert value["generation"]["status"] == "WAITING_RESEARCH_DUPLICATE"
    assert value["publicationAgeSeconds"] == 172800


def test_stale_outer_health_withholds_inner_state(tmp_path, monkeypatch):
    monkeypatch.setattr(p, "load", lambda *_: {"available": False, "reason": "unavailable"})
    value = p.progress(NOW)
    assert (
        value["available"] is False and value["publisher"] is None and value["generation"] is None
    )
