import json
from pathlib import Path

import pytest

from python.operations.learning_control import recorded_funnel
from python.research.execution_funnel import ExecutionFunnel, measure
from python.research.learning_evidence import encoded
from tests.python.test_observation_cycle import job, run
from tests.python.test_scalp_replay import fill, fixture, model


def read(value):
    return measure(encoded(model(value).model_dump()))


def test_known_clocks_are_recorded_latency_not_placement_or_counterfactual_fills():
    result = read(fixture())
    assert result.contexts == result.orderRecords == result.brokerAcceptedOrderRecords == 1
    assert result.availabilityToAcceptance.known == 1
    assert result.availabilityToAcceptance.p50Micros == "2000000"
    assert result.filledOrderRecords == result.recordedFillRows == result.windowClosedRows == 0
    assert result.counterfactualNet is None and not result.economicQualification


@pytest.mark.parametrize("kind", ["absent", "unmapped", "closing", "missing_context"])
def test_missing_or_ineligible_acceptance_never_uses_local_placement_persistence(kind):
    value = fixture()
    if kind == "absent":
        value["setups"][0]["brokerEvents"] = []
    elif kind == "unmapped":
        value["setups"][0]["brokerEvents"][0]["mappingState"] = "UNMATCHED"
    elif kind == "closing":
        value["setups"][0]["brokerEvents"][0]["closingOrder"] = True
    else:
        value["contexts"] = []
    result = read(value)
    assert result.orderRecords == result.availabilityToAcceptance.unknown == 1
    assert result.availabilityToAcceptance.p95Micros is None
    assert result.brokerAcceptedOrderRecords == (1 if kind == "missing_context" else 0)


@pytest.mark.parametrize("volume", ["5", "20"])
def test_partial_and_full_recorded_volume_keep_empty_closed_denominator(volume):
    value = fixture()
    fill(value, volume)
    result = read(value)
    assert result.filledOrderRecords == result.recordedFillRows == 1
    assert result.partialOrderRecords == (1 if volume == "5" else 0)
    assert result.windowClosedRows == 0


def test_schema_and_denominators_are_bound_and_authority_cannot_be_added():
    result = read(fixture())
    assert (
        json.loads(Path("schemas/execution-funnel-1.0.json").read_text())
        == ExecutionFunnel.model_json_schema()
    )
    for change in [{"orderRecords": 3}, {"economicQualification": True}, {"roleCounts": {}}]:
        with pytest.raises(ValueError):
            ExecutionFunnel.model_validate(result.model_dump() | change)


def test_receiver_withholds_unbound_or_legacy_measurements(tmp_path):
    run(tmp_path, model(fixture()).model_dump())
    directory = job(tmp_path)
    result = recorded_funnel(directory)
    assert result is not None and result.orderRecords == 1
    path = directory / "diagnostic.json"
    packet = json.loads(path.read_bytes())
    packet["executionFunnel"]["orderRecords"] = 99
    path.write_bytes(encoded(packet))
    assert recorded_funnel(directory) is None
    packet.pop("executionFunnel")
    path.write_bytes(encoded(packet))
    assert recorded_funnel(directory) is None


@pytest.mark.parametrize(
    ("minutes", "expected"), [(1, "CURRENT"), (60, "CURRENT"), (61, "STALE"), (-1, "UNAVAILABLE")]
)
def test_measurement_age_uses_its_own_recorded_window(minutes, expected):
    from datetime import timedelta

    from python.research.codex_loop import timestamp

    result = read(fixture())
    # Snapshot is one second after the window; allow an ordinary complete-window read.
    now = timestamp(result.until) + timedelta(minutes=minutes)
    assert result.observation_state(now) == expected


def test_status_marks_aged_measurement_explicitly(tmp_path, monkeypatch):
    from python.learning.budget import Budget
    from python.operations import learning_control
    from python.research import observation_cycle
    from python.research.codex_loop import timestamp
    from tests.python.test_observation_cycle import answer

    value = model(fixture()).model_dump()
    value["sourceId"] = "scalper-epoch314"
    observation_cycle.run(
        tmp_path / "archive",
        encoded(value),
        value["sourceId"],
        timestamp(value["exportedAt"]),
        invoke=answer,
    )
    budget = Budget(tmp_path / "budget")
    monkeypatch.setattr(learning_control.governor, "configured", lambda: budget)
    monkeypatch.setattr(learning_control.Path, "home", staticmethod(lambda: tmp_path))
    view = learning_control.status()
    assert view["executionFunnelReadState"] == "STALE"
    assert view["executionFunnel"]["orderRecords"] == 1
