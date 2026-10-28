from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from python.operations.export_learning_evidence import context
from python.research.learning_archive import ResearchArchive, parse
from python.research.learning_evidence import LearningEvidence, encoded, identity, revised


def wait_record() -> dict[str, Any]:
    return revised(
        {
            "id": identity("context-fixture"),
            "originRelease": "0.8.0-model-scalp.1-codex.1",
            "recordedCodeHash": None,
            "recordedConfigHash": None,
            "cohortRole": "OBSERVED_WINDOW",
            "sourceAnalysisId": identity("analysis-fixture"),
            "refreshAfterContextId": None,
            "refreshAfterEntryContextId": None,
            "refreshAfterWaitContextId": None,
            "consumedBySetupId": None,
            "retiredAt": None,
            "retirementReasonCodes": [],
            "state": "READY",
            "requestedAt": "2026-10-28T00:10:00+00:00",
            "capturedAt": "2026-10-28T00:09:59+00:00",
            "availableAt": "2026-10-28T00:10:05+00:00",
            "completedAt": "2026-10-28T00:10:05+00:00",
            "validUntil": "2026-10-28T00:14:59+00:00",
            "clockStatus": "CAUSAL",
            "decision": "WAIT",
            "requestedModel": "gpt-6.1-sol",
            "returnedModel": None,
            "providerCost": None,
            "failureCode": None,
            "narrativeSha256": None,
            "promptVersion": "entry-scalp-v1",
            "promptSha256": "a" * 64,
            "requestSha256": "b" * 64,
            "responseSha256": "c" * 64,
            "planSchema": "entry-wait-1.0",
            "entryPrice": None,
            "takeProfit": None,
            "stopLoss": None,
            "pendingSeconds": None,
            "market": None,
            "unavailableReasons": ["MARKET_INPUT_MISSING_OR_OVERSIZED"],
        }
    )


def packet(**changes: Any) -> dict[str, Any]:
    return {
        "schemaVersion": "scalper-learning-evidence-1.0",
        "sourceId": "fixture-demo",
        "mode": "demo",
        "symbol": "XAUUSD",
        "exporterSourceSha256": "e" * 64,
        "start": "2026-10-28T00:00:00+00:00",
        "until": "2026-10-28T00:30:00+00:00",
        "journalSnapshotAt": "2026-10-28T00:30:01+00:00",
        "exportedAt": "2026-10-28T00:31:00+00:00",
        "snapshotScope": "ONE_REPEATABLE_READ_JOURNAL",
        "cohortBasis": "OBSERVED_OR_CHANGED_IN_WINDOW_PLUS_ACTIVE_AND_LINKED",
        "dataUse": "EXTERNAL_OBSERVATIONS_NOT_A_DATASET_PARTITION",
        "contexts": [wait_record()],
        "analyses": [],
        "setups": [],
        "flight": [],
        "unscopedBrokerEvents": [],
        "coverageWarnings": ["JOURNAL_NOT_ALL_MARKET_OPPORTUNITIES"],
        "scopeComplete": True,
        "brokerAuthority": False,
        "promotionAuthority": False,
        "autonomousFinding": False,
        "completeTickTape": False,
        "counterfactualNet": None,
        **changes,
    }


def ingest(archive: ResearchArchive, value: dict[str, Any]) -> dict[str, Any]:
    raw = encoded(value)
    return archive.ingest(raw, hashlib.sha256(raw).hexdigest(), "fixture-demo")


def test_wait_is_a_valid_observation_without_a_fabricated_entry_box(tmp_path: Path) -> None:
    value = LearningEvidence.model_validate(packet())
    assert value.contexts[0].decision == "WAIT" and value.contexts[0].entryPrice is None
    result = ingest(ResearchArchive(tmp_path / "research"), packet())
    assert result["recordCount"] == 1 and result["autonomousFinding"] is False
    assert not result["brokerAuthority"] and not result["promotionAuthority"]


def test_duplicate_import_is_idempotent_and_research_files_only(tmp_path: Path) -> None:
    archive = ResearchArchive(tmp_path / "research")
    first = ingest(archive, packet())
    second = ingest(archive, packet())
    assert first["changedRecords"] == 1 and second["changedRecords"] == 0
    assert len(list((archive.root / "fixture-demo" / "records").iterdir())) == 1
    assert len(list((archive.root / "fixture-demo" / "packets").iterdir())) == 1
    assert not list(tmp_path.glob("*.db"))


def test_late_revision_is_retained_and_older_snapshot_cannot_downgrade(tmp_path: Path) -> None:
    archive = ResearchArchive(tmp_path / "research")
    old = packet()
    changed = deepcopy(old)
    changed["journalSnapshotAt"] = "2026-10-28T00:32:00+00:00"
    changed["exportedAt"] = "2026-10-28T00:33:00+00:00"
    row = changed["contexts"][0]
    row.pop("revisionSha256")
    row["responseSha256"] = "d" * 64
    changed["contexts"][0] = revised(row)
    ingest(archive, changed)
    result = ingest(archive, old)
    assert result["staleRecordsNotPromoted"] == 1
    index = json.loads((archive.root / "fixture-demo" / "index.json").read_text())
    pointer = next(iter(index["latest"].values()))
    assert pointer["revisionSha256"] == changed["contexts"][0]["revisionSha256"]
    assert len(list((archive.root / "fixture-demo" / "records").iterdir())) == 2


def test_conflicting_same_snapshot_refuses_before_any_publication(tmp_path: Path) -> None:
    archive = ResearchArchive(tmp_path / "research")
    ingest(archive, packet())
    original = (archive.root / "fixture-demo" / "index.json").read_bytes()
    changed = packet()
    row = changed["contexts"][0]
    row.pop("revisionSha256")
    row["responseSha256"] = "d" * 64
    changed["contexts"][0] = revised(row)
    with pytest.raises(ValueError, match="SNAPSHOT_CONFLICT"):
        ingest(archive, changed)
    assert (archive.root / "fixture-demo" / "index.json").read_bytes() == original
    assert len(list((archive.root / "fixture-demo" / "records").iterdir())) == 1


@pytest.mark.parametrize("field", ["brokerAuthority", "promotionAuthority", "autonomousFinding"])
def test_authority_cannot_be_injected(tmp_path: Path, field: str) -> None:
    with pytest.raises(ValidationError):
        ingest(ResearchArchive(tmp_path / "research"), packet(**{field: True}))
    assert not list((tmp_path / "research").iterdir())


def test_raw_identifiers_extra_fields_and_revision_tampering_reject() -> None:
    value = packet()
    value["contexts"][0]["accountId"] = "private-identifier"
    with pytest.raises(ValidationError):
        LearningEvidence.model_validate(value)
    value = packet()
    value["contexts"][0]["decision"] = "BUY"
    with pytest.raises(ValidationError, match="REVISION_MISMATCH"):
        LearningEvidence.model_validate(value)


def test_packet_digest_duplicate_json_and_unsafe_archive_paths_reject(tmp_path: Path) -> None:
    raw = encoded(packet())
    with pytest.raises(ValueError, match="HASH_MISMATCH"):
        parse(raw, "0" * 64)
    raw = raw.replace(b'"brokerAuthority":false', b'"brokerAuthority":true,"brokerAuthority":false')
    with pytest.raises(ValueError, match="DUPLICATE_KEY"):
        parse(raw, hashlib.sha256(raw).hexdigest())
    target = tmp_path / "target"
    target.mkdir()
    link = tmp_path / "link"
    link.symlink_to(target)
    with pytest.raises(ValueError, match="ROOT_INVALID"):
        ResearchArchive(link)


def test_wait_projection_never_requires_buy_sell_fields() -> None:
    template = wait_record()
    row = {
        "id": "source-context",
        "source_analysis_id": "source-analysis",
        "origin_release": template["originRelease"],
        "requested_model": "gpt-6.1-sol",
        "plan": {"schema_version": "entry-wait-1.0", "reason": "Wait for actual structure"},
        "state": "READY",
        "reason": None,
        "requested_at": template["requestedAt"],
        "captured_at": template["capturedAt"],
        "available_at": template["availableAt"],
        "completed_at": template["completedAt"],
        "valid_until": template["validUntil"],
        "prompt_version": template["promptVersion"],
        "prompt_sha256": template["promptSha256"],
        "request_sha256": template["requestSha256"],
        "response_sha256": template["responseSha256"],
        "provider_input": None,
    }
    observed = context(row, "OBSERVED_WINDOW")
    assert observed["decision"] == "WAIT" and observed["entryPrice"] is None
    assert "source-context" not in encoded(observed).decode()
    assert "Wait for actual structure" not in encoded(observed).decode()


def test_tampered_existing_archive_is_not_overwritten(tmp_path: Path) -> None:
    archive = ResearchArchive(tmp_path / "research")
    ingest(archive, packet())
    record = next((archive.root / "fixture-demo" / "records").iterdir())
    record.write_bytes(b"corrupted")
    with pytest.raises(ValueError, match="CONTENT_CONFLICT"):
        ingest(archive, packet())
    assert record.read_bytes() == b"corrupted"


def test_failed_index_publication_can_resume_without_rewriting_evidence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from python.research import learning_archive as module

    archive = ResearchArchive(tmp_path / "research")
    original = module.durable_json

    def fail(*_args: Any) -> None:
        raise OSError("simulated disk failure")

    monkeypatch.setattr(module, "durable_json", fail)
    with pytest.raises(OSError):
        ingest(archive, packet())
    record = next((archive.root / "fixture-demo" / "records").iterdir())
    original_bytes = record.read_bytes()
    assert not (archive.root / "fixture-demo" / "index.json").exists()
    monkeypatch.setattr(module, "durable_json", original)
    assert ingest(archive, packet())["recordCount"] == 1
    assert record.read_bytes() == original_bytes


def test_a_future_export_cannot_poison_the_archive_watermark() -> None:
    value = packet()
    value["exportedAt"] = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
    with pytest.raises(ValidationError, match="CLOCK_FUTURE"):
        LearningEvidence.model_validate(value)


def test_integer_flags_are_not_boolean_authority() -> None:
    with pytest.raises(ValidationError, match="AUTHORITY_INVALID"):
        LearningEvidence.model_validate(packet(brokerAuthority=0))


def test_recorder_summary_is_explicitly_not_a_verified_tick_path(tmp_path: Path) -> None:
    from python.operations.export_learning_evidence import recorder_summaries

    setup = {
        "id": identity("setup"),
        "originRelease": "fixture",
        "cohortRole": "CARRY_IN",
        "recordedCodeHash": None,
        "recordedConfigHash": None,
    }
    path = tmp_path / f"flight-{setup['id']}-fixture.summary.json"
    value = {
        "schemaVersion": "1.0",
        "setup": setup["id"],
        "originRelease": "fixture",
        "checkedAt": "2026-10-28T00:31:00+00:00",
        "coverageStart": "2026-10-28T00:00:00+00:00",
        "quoteAt": None,
        "final": False,
        "gaps": 2,
        "records": 10,
        "completeTickTape": False,
        "legs": [
            {
                "side": "BUY",
                "samples": 2,
                "entry": "4000.123456789012345678901234",
                "volume": "20",
                "mfePips": "1",
                "maePips": "-1",
                "bestModeledNetPips": "0.11111111111111111111",
                "closestTpPips": "0.3",
                "closestSlPips": "6",
                "timeProfitableSeconds": "1.5",
            }
        ],
    }
    path.write_text(json.dumps(value))
    result = recorder_summaries(tmp_path, [setup])[0]
    assert result["gaps"] == 2 and result["unavailableReason"] is None
    assert result["chainVerified"] is False and result["counterfactualNet"] is None
    assert result["metrics"][0]["bestModeledNetPips"] == "0.11111111111111111111"
    assert result["metrics"][0]["entry"] == "4000.123456789012345678901234"
    path.write_text("[]")
    assert (
        recorder_summaries(tmp_path, [setup])[0]["unavailableReason"] == "RECORDER_SUMMARY_INVALID"
    )
    path.unlink()
    assert (
        recorder_summaries(tmp_path, [setup])[0]["unavailableReason"] == "RECORDER_SUMMARY_MISSING"
    )


def test_published_learning_schema_matches_the_authoritative_model() -> None:
    assert (
        json.loads(Path("schemas/scalper-learning-evidence-1.0.json").read_text())
        == LearningEvidence.model_json_schema()
    )


@pytest.mark.parametrize(
    "changes,code",
    [
        (
            {
                "entryPrice": "4000",
                "takeProfit": "4000.4",
                "stopLoss": "3993",
                "pendingSeconds": 120,
            },
            "WAIT_HAS_NO_ENTRY_AUTHORITY",
        ),
        ({"capturedAt": "2026-10-28T00:11:00+00:00"}, "CONTEXT_CLOCK_CLASSIFICATION"),
    ],
)
def test_a_resealed_contradictory_context_is_rejected_before_publication(
    tmp_path: Path,
    changes: dict[str, Any],
    code: str,
) -> None:
    value = packet()
    row = value["contexts"][0]
    row.pop("revisionSha256")
    row.update(changes)
    value["contexts"][0] = revised(row)
    root = tmp_path / "research"
    with pytest.raises(ValidationError, match=code):
        ingest(ResearchArchive(root), value)
    assert not list(root.iterdir())


def test_bad_source_clock_is_preserved_only_with_explicit_unordered_classification() -> None:
    value = packet()
    row = value["contexts"][0]
    row.pop("revisionSha256")
    row.update(capturedAt="2026-10-28T00:11:00+00:00", clockStatus="UNORDERED")
    value["contexts"][0] = revised(row)
    result = LearningEvidence.model_validate(value)
    assert result.contexts[0].clockStatus == "UNORDERED"
    assert result.contexts[0].decision == "WAIT" and result.counterfactualNet is None


def test_local_persistence_cannot_follow_the_claimed_journal_snapshot(tmp_path: Path) -> None:
    value = packet(exportedAt="2026-10-28T00:40:00+00:00")
    value["unscopedBrokerEvents"] = [
        {
            "id": identity("broker-event"),
            "payloadSha256": "a" * 64,
            "executionType": 3,
            "mappingState": "UNMATCHED",
            "closingOrder": False,
            "orderType": None,
            "orderId": None,
            "positionId": None,
            "occurredAt": "2026-10-28T00:31:00+00:00",
            "receivedAt": "2026-10-28T00:31:01+00:00",
            "persistedAt": "2026-10-28T00:35:00+00:00",
            "resolvedAt": None,
            "reasonCodes": [],
            "clockStatus": "CAUSAL",
        }
    ]
    root = tmp_path / "research"
    with pytest.raises(ValidationError, match="JOURNAL_AFTER_SNAPSHOT"):
        ingest(ResearchArchive(root), value)
    assert not list(root.iterdir())


def test_flight_order_uses_its_own_capture_not_the_journal_clock(tmp_path: Path) -> None:
    archive = ResearchArchive(tmp_path / "research")
    flight = revised(
        {
            "id": identity("flight-session"),
            "setupId": identity("setup"),
            "originRelease": "fixture",
            "recordedCodeHash": None,
            "recordedConfigHash": None,
            "cohortRole": "CARRY_IN",
            "checkedAt": "2026-10-28T00:31:59+00:00",
            "observedAt": "2026-10-28T00:32:00+00:00",
            "coverageStart": "2026-10-28T00:00:00+00:00",
            "quoteAt": None,
            "final": False,
            "gaps": 0,
            "records": 1,
            "snapshotSha256": "a" * 64,
            "metrics": [],
            "unavailableReason": None,
            "basis": "RECORDER_SUMMARY_NOT_VERIFIED_TICK_PATH",
            "chainVerified": False,
            "counterfactualNet": None,
        }
    )
    first = packet(flight=[flight], exportedAt="2026-10-28T00:33:00+00:00")
    ingest(archive, first)
    old = deepcopy(first)
    old["journalSnapshotAt"] = "2026-10-28T00:30:02+00:00"
    row = old["flight"][0]
    row.pop("revisionSha256")
    row.update(checkedAt="2026-10-28T00:30:59+00:00", observedAt="2026-10-28T00:31:00+00:00")
    old["flight"][0] = revised(row)
    assert ingest(archive, old)["staleRecordsNotPromoted"] == 1
    index = json.loads((archive.root / "fixture-demo" / "index.json").read_text())
    assert index["latest"]["flight:" + flight["id"]]["snapshotAt"] == flight["observedAt"]


def test_interrupted_record_write_never_poisoned_the_final_digest_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from python.research import learning_archive as module

    archive = ResearchArchive(tmp_path / "research")
    original = module.os.fdopen

    @contextmanager
    def partial(descriptor: int, mode: str) -> Any:
        with original(descriptor, mode) as handle:

            class Broken:
                def write(self, raw: bytes) -> None:
                    handle.write(raw[:8])
                    handle.flush()
                    raise OSError("simulated partial write")

            yield Broken()

    monkeypatch.setattr(module.os, "fdopen", partial)
    with pytest.raises(OSError):
        ingest(archive, packet())
    assert not list((archive.root / "fixture-demo" / "records").iterdir())
    monkeypatch.setattr(module.os, "fdopen", original)
    assert ingest(archive, packet())["changedRecords"] == 1


@pytest.mark.parametrize("available", ["00:09:58", "00:10:01"])
def test_resealed_available_before_completion_cannot_claim_causal(available: str) -> None:
    value = packet()
    row = value["contexts"][0]
    row.pop("revisionSha256")
    row["availableAt"] = "2026-10-28T" + available + "+00:00"
    value["contexts"][0] = revised(row)
    with pytest.raises(ValidationError, match="CLOCK_CLASSIFICATION"):
        LearningEvidence.model_validate(value)
    row["clockStatus"] = "UNORDERED"
    value["contexts"][0] = revised(row)
    assert LearningEvidence.model_validate(value).contexts[0].clockStatus == "UNORDERED"


def test_resealed_analysis_update_cannot_postdate_snapshot() -> None:
    value = packet()
    value["analyses"] = [
        revised(
            {
                "id": identity("analysis-fixture"),
                "originRelease": "fixture",
                "recordedCodeHash": None,
                "recordedConfigHash": None,
                "cohortRole": "OBSERVED_WINDOW",
                "state": "REJECTED",
                "analysisAt": "2026-10-28T00:10:00+00:00",
                "persistedAt": "2026-10-28T00:10:01+00:00",
                "updatedAt": "2026-10-28T00:30:02+00:00",
                "contextIds": [],
                "reasonCodes": [],
                "risk": [],
            }
        )
    ]
    with pytest.raises(ValidationError, match="JOURNAL_AFTER_SNAPSHOT"):
        LearningEvidence.model_validate(value)


def test_database_decimal_zero_keeps_plain_decimal_boundary() -> None:
    from decimal import Decimal

    from python.operations.export_learning_evidence import number

    assert number(Decimal("0E-10")) == "0.0000000000"
    assert number(Decimal("1E+3")) == "1000"
    assert number(Decimal("1.2300000000")) == "1.2300000000"
    assert number(None) is None


def test_export_byte_limit_includes_file_newline(monkeypatch: pytest.MonkeyPatch) -> None:
    from python.research import learning_evidence as module

    value = LearningEvidence.model_validate(packet()).model_dump()
    monkeypatch.setattr(module, "MAX_BYTES", len(encoded(value)))
    with pytest.raises(ValidationError, match="BYTE_LIMIT"):
        LearningEvidence.model_validate(value)
    monkeypatch.setattr(module, "MAX_BYTES", len(encoded(value)) + 1)
    assert LearningEvidence.model_validate(value).schemaVersion == "scalper-learning-evidence-1.0"
