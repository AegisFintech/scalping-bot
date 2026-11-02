from datetime import timedelta

from python.operations.broker_evidence_review import associate
from python.research.broker_metadata_evidence import observation, persist
from python.research.codex_loop import timestamp
from tests.python.test_broker_acknowledgement_export import row, run
from tests.python.test_setup_flight import metadata


def test_only_prior_local_metadata_can_be_linked_without_claiming_original_broker_state(tmp_path):
    packet = run([row()])
    at = timestamp(packet.observations[0].receivedAt)
    future = observation(
        {**metadata(), "symbolName": "XAUUSD"},
        "XAUUSD",
        at + timedelta(seconds=1),
        at + timedelta(seconds=2),
    )
    persist(tmp_path, future)
    assert associate(packet, tmp_path)["missingMetadata"] == 1
    past = observation(
        {**metadata(), "symbolName": "XAUUSD"},
        "XAUUSD",
        at - timedelta(seconds=3),
        at - timedelta(seconds=2),
    )
    persist(tmp_path, past)
    report = associate(packet, tmp_path)
    assert report["associations"][0]["metadataSha256"] == past.evidenceSha256
    assert not report["associations"][0]["originalBrokerStateProven"]
    assert report["actualCounterfactualCosts"] is None and not report["economicQualification"]


def test_mismatched_symbol_is_missing_and_tampered_receipt_rejects(tmp_path):
    import pytest

    packet = run([row()])
    at = timestamp(packet.observations[0].receivedAt)
    value = observation({**metadata(), "symbolName": "EURUSD"}, "XAUUSD", at, at)
    persist(tmp_path, value)
    assert associate(packet, tmp_path)["missingMetadata"] == 1
    path = next(tmp_path.glob("*.json"))
    path.chmod(0o600)
    path.write_text(path.read_text().replace('"XAUUSD"', '"EURUSD"'))
    with pytest.raises(ValueError):
        associate(packet, tmp_path)


def test_schema_and_registered_source_drift_rejects(tmp_path, monkeypatch):
    import json
    from pathlib import Path

    import pytest

    from python.operations import broker_evidence_review as evidence
    from python.research.observation_cycle import sha

    root = Path(__file__).resolve().parents[2]
    schema = json.loads((root / "schemas/broker-evidence-review-1.0.json").read_text())
    assert schema == evidence.EvidenceReview.model_json_schema()
    paths = [
        "python/operations/broker_evidence_review.py",
        "python/operations/export_broker_acknowledgements.py",
        "python/operations/setup_flight_recorder.py",
        "python/research/broker_metadata_evidence.py",
        "python/research/broker_acknowledgement_evidence.py",
        "packages/config/src/policy.ts",
    ]
    value = {
        "schemaVersion": "broker-evidence-registration-1.0",
        "registeredAt": "2026-11-02T00:00:00Z",
        "start": "2026-11-03T00:00:00Z",
        "until": "2026-11-10T00:00:00Z",
        "economicRelease": "0.8.0-model-scalp.1-codex.1",
        "sourceFiles": {p: sha((root / p).read_bytes()) for p in paths},
        "collectionOnly": True,
        "economicQualification": False,
        "brokerAuthority": False,
        "promotionAuthority": False,
    }
    path = tmp_path / "registration.json"
    path.write_text(json.dumps(value))
    monkeypatch.setattr(evidence, "trusted_path", lambda _: None)
    assert evidence.registration(path, root)[0].collectionOnly
    value["sourceFiles"][paths[0]] = "a" * 64
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="SOURCE_DRIFT"):
        evidence.registration(path, root)
