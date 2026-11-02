from __future__ import annotations

import json
from copy import deepcopy
from datetime import timedelta
from pathlib import Path

import pytest

from python.operations.entry_range_study import next_window, receipts, retained
from python.research.entry_range_study import (
    RELEASE,
    SOURCE_FILES,
    PointReceipt,
    RangeReport,
    Registration,
    point_receipt,
    review,
)
from tests.python.test_codex_entry import NOW
from tests.python.test_scalp_replay import at, fill, fixture, model
from tests.python.test_setup_flight import metadata


def frozen():
    start = NOW.replace(minute=0, second=0, microsecond=0)
    return Registration.model_validate(
        {
            "schemaVersion": "entry-range-registration-1.0",
            "registeredAt": (start - timedelta(hours=1)).isoformat(),
            "start": start.isoformat(),
            "until": (start + timedelta(days=7)).isoformat(),
            "economicRelease": RELEASE,
            "baselinePoints": 30,
            "candidatePoints": 10,
            "sourceFiles": {p: "a" * 64 for p in SOURCE_FILES},
            "brokerAuthority": False,
            "promotionAuthority": False,
            "economicQualification": False,
        }
    )


def inputs():
    raw = fixture()
    raw["start"] = NOW.replace(minute=0, second=0, microsecond=0).isoformat()
    raw["setups"][0]["originRelease"] = RELEASE
    packet = model(raw).model_dump()
    event = packet["setups"][0]["brokerEvents"][0]
    ack = {
        "id": "b" * 24,
        "eventId": event["id"],
        "eventPayloadSha256": event["payloadSha256"],
        "orderType": 6,
        "metadataAvailability": "NOT_CAPTURED",
        "evidenceSha256": "c" * 64,
        "stopPrice": "4002",
        "slippageInPoints": "30",
        "timeInForce": 1,
        "expirationAt": at(120),
        "brokerUpdatedAt": at(7),
        "receivedAt": at(8),
        "persistedAt": at(10),
        "invalidFields": [],
        "clockStatus": "ORDERED",
    }
    receipt = point_receipt(
        metadata() | {"digits": 2, "symbolName": "XAUUSD"},
        "XAUUSD",
        NOW,
        NOW + timedelta(seconds=1),
    )
    key = packet["setups"][0]["id"]

    def quote(second, ask):
        return {
            "kind": "BROKER_QUOTE",
            "observedAt": at(second + 0.2),
            "payload": {
                "kind": "QUOTE",
                "sourceTime": at(second),
                "receivedAt": at(second + 0.1),
                "bid": str(float(ask) - 0.01),
                "ask": ask,
                "bidUpdated": True,
                "askUpdated": True,
            },
        }

    return {
        "journal": packet,
        "acknowledgements": {
            "schemaVersion": "broker-acknowledgement-evidence-1.0",
            "source": packet["sourceId"],
            "start": packet["start"],
            "until": packet["until"],
            "snapshotAt": at(602),
            "observations": [ack],
            "coverage": "PERSISTED_CALLBACKS_ONLY_ABSENCE_UNKNOWN",
            "brokerAuthority": False,
            "promotionAuthority": False,
        },
        "pointReceipts": [receipt.model_dump()],
        "flight": {
            key: {
                "status": "VERIFIED_SAMPLED_PREFIX",
                "records": [
                    quote(9, "4002.02"),
                    quote(11, "4002.08"),
                    quote(12, "4002.28"),
                    quote(121, "4002.05"),
                ],
            }
        },
    }


def test_native_points_causal_sample_bands_are_not_fills_or_profit():
    value = inputs()
    result = review(value, frozen(), "d" * 64)
    row = result.rows[0]
    assert row.eligibility == "OBSERVABLE" and row.pointSize == "0.01"
    assert row.usableExecutableSamples == row.sampledPricesInBaselineBand == 2
    assert row.sampledPricesInCandidateBand == 1
    assert row.candidateFill is row.candidateNet is row.candidateCosts is None
    assert result.noRecordedFillOrderRecords == 1 and not result.economicQualification


def test_broker_point_is_not_tick_and_outside_original_deal_is_not_saved_loss():
    value = inputs()
    raw = fixture()
    raw["start"] = value["journal"]["start"]
    raw["setups"][0]["originRelease"] = RELEASE
    fill(raw)
    raw["setups"][0]["fills"][0]["price"] = "4002.28"
    value["journal"] = model(raw).model_dump()
    value["pointReceipts"] = [
        point_receipt(
            metadata() | {"digits": 3, "tickSize": "0.01", "symbolName": "XAUUSD"},
            "XAUUSD",
            NOW,
            NOW + timedelta(seconds=1),
        ).model_dump()
    ]
    result = review(value, frozen(), "d" * 64)
    row = result.rows[0]
    assert row.pointSize == "0.001" and row.originalDealOutsideCandidateBand == 1
    assert row.originalPartialAtCutoff and row.originalFillWithoutClosedTradeAtCutoff
    assert result.filledOrderRecords == 1 and row.candidateNet is None


@pytest.mark.parametrize(
    "change",
    [
        "future_metadata",
        "no_ack",
        "unmapped",
        "conflict",
        "range",
        "other_release",
        "unknown_digits",
        "late_provider",
        "changed_expiry",
    ],
)
def test_unknown_or_conflicting_evidence_keeps_denominator_and_withholds_bands(change):
    value = inputs()
    if change == "future_metadata":
        value["pointReceipts"] = [
            point_receipt(
                metadata() | {"digits": 2, "symbolName": "XAUUSD"},
                "XAUUSD",
                NOW,
                NOW + timedelta(seconds=9),
            ).model_dump()
        ]
    elif change == "no_ack":
        value["acknowledgements"]["observations"] = []
    elif change == "unmapped":
        raw = deepcopy(value["journal"])
        raw["setups"][0]["brokerEvents"][0]["mappingState"] = "UNMATCHED"
        value["journal"] = model(raw).model_dump()
    elif change == "conflict":
        value["acknowledgements"]["observations"][0]["eventPayloadSha256"] = "e" * 64
    elif change == "range":
        value["acknowledgements"]["observations"][0]["slippageInPoints"] = "20"
    elif change == "other_release":
        raw = deepcopy(value["journal"])
        raw["setups"][0]["originRelease"] = "old"
        value["journal"] = model(raw).model_dump()
    elif change == "unknown_digits":
        value["pointReceipts"] = [
            point_receipt(
                metadata() | {"digits": True, "symbolName": "XAUUSD"}, "XAUUSD", NOW, NOW
            ).model_dump()
        ]
    elif change == "late_provider":
        raw = deepcopy(value["journal"])
        raw["contexts"][0].update(availableAt=at(8), completedAt=at(8))
        value["journal"] = model(raw).model_dump()
    else:
        value["acknowledgements"]["observations"][0]["expirationAt"] = at(121)
    result = review(value, frozen(), "d" * 64)
    assert result.orderRecords == result.unavailableOrderRecords == 1
    assert result.rows[0].usableExecutableSamples == 0


def test_late_gap_side_updates_and_terminal_observation_are_not_eligible_samples():
    value = inputs()
    records = next(iter(value["flight"].values()))["records"]
    records[1]["observedAt"] = at(601)
    records.insert(2, {"kind": "GAP", "payload": {"reason": "TEST"}})
    records[3]["payload"]["bidUpdated"] = False
    result = review(value, frozen(), "d" * 64)
    assert result.rows[0].usableExecutableSamples == 0
    assert result.rows[0].flightGapRecords == 1


def test_registration_window_and_hash_are_immutable_and_schema_matches(tmp_path):
    value = frozen().model_dump()
    for change in [
        {"candidatePoints": 20},
        {"brokerAuthority": True},
        {"start": value["registeredAt"]},
    ]:
        with pytest.raises(ValueError):
            Registration.model_validate(value | change)
    receipt = inputs()["pointReceipts"][0]
    with pytest.raises(ValueError):
        PointReceipt.model_validate(receipt | {"digits": 3})
    for cls, name in [
        (Registration, "entry-range-registration-1.0"),
        (PointReceipt, "entry-range-point-receipt-1.0"),
        (RangeReport, "entry-range-report-1.0"),
    ]:
        assert json.loads(Path(f"schemas/{name}.json").read_text()) == cls.model_json_schema()
    path = tmp_path / "input.json"
    retained(path, {"a": 1})
    retained(path, {"a": 1})
    with pytest.raises(ValueError):
        retained(path, {"a": 2})


def test_collection_waits_then_catches_up_oldest_window_without_skipping(tmp_path):
    reg = frozen()
    start = NOW.replace(minute=0, second=0, microsecond=0)
    assert next_window(reg, tmp_path, start + timedelta(minutes=64), "d" * 64) is None
    assert next_window(reg, tmp_path, start + timedelta(hours=3), "d" * 64) == (
        start,
        start + timedelta(hours=1),
    )
    assert next_window(reg, tmp_path, start, "d" * 64) is None
    assert receipts(tmp_path, start, start + timedelta(hours=1)) == []


def test_capture_is_metadata_only_and_invalid_digits_remain_unknown(tmp_path):
    import httpx

    from python.operations.entry_range_study import capture

    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(200, json={"metadata": metadata() | {"digits": False}})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        capture(tmp_path, NOW, client)
    value = PointReceipt.model_validate_json(next(tmp_path.glob("point-*.json")).read_bytes())
    assert value.digits is None and calls == [("POST", "/v1/session")]


def test_registration_source_drift_stops_observer_only(tmp_path, monkeypatch):
    from python.operations.entry_range_study import registration
    from python.research.learning_evidence import encoded
    from python.research.observation_cycle import sha

    value = frozen().model_dump()
    for name in SOURCE_FILES:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("frozen")
        value["sourceFiles"][name] = sha(path.read_bytes())
    path = tmp_path / "registration.json"
    path.write_bytes(encoded(value))
    monkeypatch.setattr("python.operations.entry_range_study.trusted_path", lambda p: None)
    assert registration(path, tmp_path)[0] == Registration.model_validate(value)
    (tmp_path / SOURCE_FILES[0]).write_text("drift")
    with pytest.raises(ValueError, match="RANGE_SOURCE_DRIFT"):
        registration(path, tmp_path)


def test_existing_report_hash_binding_and_retry_input_are_required(tmp_path):
    from python.research.learning_evidence import encoded
    from python.research.observation_cycle import sha

    value = inputs()
    reg = frozen()
    start = NOW.replace(minute=0, second=0, microsecond=0)
    # A complete full-hour input; snapshot clocks must remain after the cutoff.
    value["journal"]["until"] = (start + timedelta(hours=1)).isoformat()
    value["journal"]["journalSnapshotAt"] = (start + timedelta(hours=1, seconds=1)).isoformat()
    value["journal"]["exportedAt"] = (start + timedelta(hours=1, seconds=2)).isoformat()
    value["acknowledgements"]["until"] = value["journal"]["until"]
    value["acknowledgements"]["snapshotAt"] = value["journal"]["exportedAt"]
    result = review(value, reg, "d" * 64)
    name = "hour-" + start.strftime("%Y%m%dT%H%M")
    retained(tmp_path / (name + ".input.json"), value)
    retained(tmp_path / (name + ".json"), result.model_dump())
    assert result.inputSha256 == sha(encoded(value))
    assert next_window(reg, tmp_path, start + timedelta(hours=3), "d" * 64)[0] == start + timedelta(
        hours=1
    )
    with pytest.raises(ValueError, match="RANGE_RETAINED_BINDING_CONFLICT"):
        next_window(reg, tmp_path, start + timedelta(hours=3), "e" * 64)


def test_uncertain_fill_clocks_remain_recorded_unknown_not_no_fill():
    value = inputs()
    raw = fixture()
    raw["start"] = value["journal"]["start"]
    raw["setups"][0]["originRelease"] = RELEASE
    fill(raw)
    raw["setups"][0]["fills"][0].update(
        occurredAt=at(30), receivedAt=at(29), clockStatus="UNORDERED"
    )
    value["journal"] = model(raw).model_dump()
    result = review(value, frozen(), "d" * 64)
    row = result.rows[0]
    assert result.filledOrderRecords == row.originalFillRowsBeforeCutoff == 1
    assert result.noRecordedFillOrderRecords == 0
    assert row.originalFillClockUnknownRows == row.originalDealRangeUnknown == 1
    assert row.originalPartialAtCutoff is None and row.originalFillWithoutClosedTradeAtCutoff
    assert row.originalDealInsideCandidateBand == row.originalDealOutsideCandidateBand == 0
