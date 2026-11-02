from copy import deepcopy
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path

import pytest

from python.operations.breakout_observer import collect, register
from python.research.breakout_hypotheses import CANDIDATES, measure
from python.research.execution_funnel import measure as funnel
from python.research.harness_agenda import measure as agenda
from python.research.learning_evidence import encoded, identity, revised
from tests.python.test_scalp_replay import at, fixture, model


def dataset():
    value = fixture()
    value.update(
        sourceId="scalper-epoch314",
        start=at(0),
        until=at(1800),
        journalSnapshotAt=at(1801),
        exportedAt=at(1860),
    )
    value["setups"] = []
    value["flight"] = []
    origin = value["contexts"][0]
    origin.update(
        originRelease="0.9.0-cost-balanced.1-codex.2",
        decision="WAIT",
        planSchema="entry-wait-1.0",
        entryPrice=None,
        takeProfit=None,
        stopLoss=None,
        pendingSeconds=None,
    )
    origin["market"]["candles"][1]["rows"] = [
        [
            at(-900 + i * 300),
            at(-600 + i * 300),
            "4000",
            "4003",
            "3999",
            str(4000 + i),
            "1",
            True,
            [],
        ]
        for i in range(3)
    ]
    origin["market"]["candles"].sort(key=lambda f: {"M1": 0, "M5": 1, "M15": 2}[f["timeframe"]])
    future = deepcopy(origin)
    future.update(
        id=identity("future-context"),
        capturedAt=at(360),
        requestedAt=at(361),
        availableAt=at(365),
        completedAt=at(364),
        validUntil=at(660),
    )
    future["market"]["captured_at"] = at(360)
    future["market"]["quote"]["sourceTime"] = at(360)
    future["market"]["quote"]["receivedAt"] = at(360)
    future["market"]["candles"][1]["rows"] = [
        [
            at(-600 + i * 300),
            at(-300 + i * 300),
            "4000",
            "4003",
            "3999",
            str(4000 + i),
            "1",
            True,
            [],
        ]
        for i in range(3)
    ]
    future["market"]["candles"][0]["rows"] = [
        [at(i * 60), at((i + 1) * 60), "4002", "4004", "4001", "4003", "1", True, []]
        for i in range(1, 6)
    ]
    future["market"]["market_captured_at"] = at(360)
    future["market"]["technical_context"]["depth"].update(source_at=at(360), received_at=at(360))
    for frame in future["market"]["technical_context"]["frames"]:
        series = next(
            v for v in future["market"]["candles"] if v["timeframe"] == frame["timeframe"]
        )
        frame["latest_completed_at"] = series["rows"][-1][1]
    value["contexts"].append(future)
    return model(value)


def test_all_three_hypotheses_have_complete_denominators_and_no_profit_claim():
    packet = dataset()
    result = measure(packet, "a" * 64)
    assert len(result.rows) == 6
    first = [r for r in result.rows if r.contextId == packet.contexts[0].id]
    assert [r.candidate for r in first] == list(CANDIDATES)
    assert all(r.status == "OBSERVED" and r.direction == "BUY" for r in first)
    assert first[0].eventBarEnd == at(120)
    assert first[2].eventBarEnd == at(180)
    assert all(r.counterfactualFill is None and r.counterfactualNet is None for r in result.rows)
    assert not result.economicQualification and not result.brokerAuthority


def test_forming_origin_bar_is_never_eligible_and_missing_forward_path_is_censored():
    packet = dataset()
    value = packet.model_dump()
    value["contexts"][1]["market"]["candles"][0]["rows"] = value["contexts"][1]["market"][
        "candles"
    ][0]["rows"][:-1]
    next(
        f
        for f in value["contexts"][1]["market"]["technical_context"]["frames"]
        if f["timeframe"] == "M1"
    )["latest_completed_at"] = at(300)
    result = measure(model(value), "a" * 64)
    assert all(r.status == "CENSORED" for r in result.rows[:3])


def test_conflicting_retained_candles_are_unavailable_not_selected():
    value = dataset().model_dump()
    duplicate = deepcopy(value["contexts"][1])
    duplicate["id"] = identity("conflict")
    duplicate["market"]["candles"][0]["rows"][0][3] = "4005"
    value["contexts"].append(duplicate)
    result = measure(model(value), "a" * 64)
    assert result.conflictingCandles == 1
    assert all(r.status == "UNAVAILABLE" for r in result.rows[:3])


def test_unordered_carrier_cannot_backdate_future_bar_availability():
    value = dataset().model_dump()
    value["contexts"][1].update(requestedAt=at(1), clockStatus="UNORDERED")
    result = measure(model(value), "a" * 64)
    assert result.pathInputStates["UNORDERED_RECEIPT"] == 1
    assert all(r.status == "CENSORED" for r in result.rows[:3])
    assert all(r.firstRecordedAt is None for r in result.rows)


def test_registered_observer_rejects_old_release_available_inside_window(tmp_path: Path):
    value = dataset().model_dump()
    value["contexts"][0].update(
        originRelease="0.9.0-cost-balanced.1-codex.1", requestedAt=at(-1), capturedAt=at(-2)
    )
    value["contexts"][0]["market"] = None
    packet = model(value)
    start = datetime.fromisoformat(packet.start)
    until = start + timedelta(minutes=30)
    reg = register(tmp_path / "reg.json", start, until, start - timedelta(minutes=1))
    with pytest.raises(ValueError, match="BREAKOUT_RELEASE_DRIFT"):
        collect(
            tmp_path / "results",
            reg,
            until + timedelta(minutes=6),
            export=lambda *_: encoded(packet.model_dump()),
        )


def test_no_break_is_a_measured_negative_not_missing_evidence():
    value = dataset().model_dump()
    for row in value["contexts"][1]["market"]["candles"][0]["rows"]:
        row[3] = "4002"
        row[5] = "4002"
    result = measure(model(value), "a" * 64)
    assert all(r.status == "NO_EVENT" for r in result.rows[:3])


def test_agenda_uses_missing_exact_links_not_matching_counts():
    packet = dataset()
    value = packet.model_dump()
    value["analyses"] = [
        revised(
            {
                "id": identity("wait-analysis"),
                "originRelease": "0.9.0-cost-balanced.1-codex.2",
                "recordedCodeHash": None,
                "recordedConfigHash": None,
                "cohortRole": "OBSERVED_WINDOW",
                "state": "DEFERRED",
                "analysisAt": at(10),
                "persistedAt": at(10),
                "updatedAt": at(11),
                "contextIds": [],
                "reasonCodes": ["SCENARIO_CODEX_WAIT"],
                "risk": [],
            }
        )
    ]
    value["analyses"][0]["contextIds"] = []
    value["analyses"][0] = revised(
        {k: v for k, v in value["analyses"][0].items() if k != "revisionSha256"}
    )
    packet = model(value)
    raw = encoded(packet.model_dump())
    result = agenda(packet, funnel(raw), measure(packet, sha256(raw).hexdigest()))
    assert result.stage == "REPAIR_OBSERVABILITY" and result.unavailableWaitLinks == 1
    value = packet.model_dump()
    value["analyses"][0]["contextIds"] = [packet.contexts[0].id]
    value["analyses"][0] = revised(
        {k: v for k, v in value["analyses"][0].items() if k != "revisionSha256"}
    )
    packet = model(value)
    raw = encoded(packet.model_dump())
    result = agenda(packet, funnel(raw), measure(packet, sha256(raw).hexdigest()))
    assert result.stage == "MEASURE_ENTRY_PATHS" and result.exactlyLinkedWaitChecks == 1


def test_future_registration_source_drift_and_retry_keep_original_bytes(
    tmp_path: Path, monkeypatch
):
    packet = dataset()
    start = datetime.fromisoformat(packet.start)
    until = start + timedelta(minutes=30)
    reg = register(tmp_path / "registration.json", start, until, start - timedelta(minutes=1))
    root = tmp_path / "results"
    raw = encoded(packet.model_dump())
    result = collect(root, reg, until + timedelta(minutes=6), export=lambda *_: raw)
    assert result["status"] == "RECORDED"
    before = {
        p.name: p.read_bytes()
        for p in root.glob("*")
        if p.is_file() and p.name not in {"status.json", ".lock"}
    }
    assert (
        collect(root, reg, until + timedelta(minutes=7), export=lambda *_: pytest.fail("replay"))[
            "status"
        ]
        == "COLLECTION_COMPLETE_NOT_QUALIFIED"
    )
    assert before == {
        p.name: p.read_bytes()
        for p in root.glob("*")
        if p.is_file() and p.name not in {"status.json", ".lock"}
    }
    monkeypatch.setattr("python.operations.breakout_observer.source_hashes", lambda: {})
    assert collect(root, reg, until + timedelta(minutes=8))["status"] == "SOURCE_DRIFT"


def test_registration_rejects_retrospective_or_unaligned_window(tmp_path: Path):
    packet = dataset()
    start = datetime.fromisoformat(packet.start)
    with pytest.raises(ValueError, match="BREAKOUT_REGISTRATION_INVALID"):
        register(tmp_path / "r.json", start, start + timedelta(minutes=30), start)
