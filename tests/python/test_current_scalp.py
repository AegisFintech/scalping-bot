from copy import deepcopy
from decimal import Decimal
from typing import Any

import pytest

from python.backtest.current_scalp import reconstruct, report, screen
from python.research.demo_catalogue import Catalogue, load
from tests.python.test_breakout_hypotheses import dataset
from tests.python.test_scalp_replay import at, fill, fixture, model


def current() -> dict[str, Any]:
    value = fixture()
    value["contexts"][0]["originRelease"] = "0.9.0-cost-balanced.1-codex.2"
    value["setups"][0]["originRelease"] = "0.9.0-cost-balanced.1-codex.2"
    return value


def test_catalogue_is_finite_and_single_dimension_per_batch():
    catalogue = load()
    assert len(catalogue.profiles) == 9
    broken = catalogue.model_dump()
    broken["profiles"][3]["pendingSeconds"] = 60
    with pytest.raises(ValueError, match="MULTIPLE_DIMENSIONS"):
        Catalogue.model_validate(broken)
    clone = deepcopy(catalogue.profiles[0])
    clone.id = "OTHER_NAME"
    assert clone.digest() == catalogue.profiles[0].digest()


def test_current_screen_retains_wait_denominator_and_never_creates_fills():
    packet = dataset()
    result = report(packet, load().profiles[2])
    assert sum(result["counts"].values()) == len(packet.contexts)
    assert result["counterfactualNet"] is None and result["brokerAuthority"] is False
    for row in result["screens"]:
        assert row["counterfactualFill"] is None
    codex = screen(packet.contexts[0], load().profiles[0], packet.until)
    assert codex.status == "WAIT" and "CODEX_WAIT" in codex.reason


def test_baseline_does_not_shift_a_crossed_completed_candle_line():
    packet = dataset()
    origin = packet.contexts[0].model_copy(deep=True)
    assert origin.market is not None
    origin.market.entry_boundaries.buy_stop_minimum = "5000"
    result = screen(origin, load().profiles[1], packet.until)
    assert result.status == "WAIT" and result.entry is None
    assert result.reason == "ORIGINAL_BOUNDARY_NOT_EXECUTABLE_AT_CAPTURE"


def test_pending_uses_original_acceptance_not_local_placement_timestamp():
    value = current()
    row = reconstruct(model(value))[0]
    assert row.status == "PENDING" and row.brokerAcceptedAt == at(7)
    value["setups"][0]["orders"][0]["placementResultPersistedAt"] = at(500)
    assert reconstruct(model(value))[0].brokerAcceptedAt == at(7)
    value["setups"][0]["brokerEvents"] = []
    row = reconstruct(model(value))[0]
    assert row.status == "UNKNOWN" and row.brokerAcceptedAt is None


def test_chronology_partial_manual_gap_and_cutoff_remain_explicit():
    value = current()
    fill(value)
    row = reconstruct(model(value))[0]
    assert row.status == "PARTIAL_OPEN" and Decimal(row.filledVolume) == 10
    value["setups"][0]["brokerEvents"][0].update(occurredAt=at(1))
    row = reconstruct(model(value))[0]
    assert row.status == "UNKNOWN" and "ACCEPTANCE_PRECEDES_PROVIDER" in row.reasons
    value = current()
    value["setups"][0]["updatedAt"] = at(601)
    row = reconstruct(model(value))[0]
    assert row.status == "UNKNOWN" and "GROUP_OR_ORDER_STATE_NOT_KNOWN_AT_CUTOFF" in row.reasons


def test_no_legacy_oracle_or_expiry_only_terminal_authority():
    assert reconstruct(model(fixture()))[0].status == "UNSUPPORTED"
    value = current()
    value["setups"][0]["state"] = "EXPIRED"
    value["setups"][0]["orders"][0]["state"] = "EXPIRED"
    row = reconstruct(model(value))[0]
    assert row.status == "UNKNOWN" and "ZERO_FILL_TERMINAL_PROOF_MISSING" in row.reasons


def closed_current() -> dict[str, Any]:
    from python.research.learning_evidence import identity

    value = current()
    fill(value, "20")
    group = value["setups"][0]
    group["state"] = "CLOSED"
    group["currentProtection"][0]["positionState"] = "CLOSED"
    group["currentProtection"][0]["observedAt"] = at(32)
    group["updatedAt"] = at(33)
    group["closedTrades"] = [
        dict(
            id=identity("trade"),
            direction="LONG",
            realizedNet="1",
            signedFees="-0.7",
            openedAt=at(10),
            closedAt=at(30),
        )
    ]
    group["closeDeals"] = [
        dict(
            id=identity("deal"),
            positionId=identity("position"),
            closedVolume="20",
            entryPrice="4002.1",
            gross="1.7",
            commission="-0.7",
            swap="0",
            conversionFee="0",
            occurredAt=at(30),
            recordedAt=at(31),
            externalIntervention=True,
            evidenceSha256="a" * 64,
            exitCause=None,
        )
    ]
    return value


def test_actual_manual_close_costs_reconcile_once_and_conflicts_stay_unknown():
    value = closed_current()
    group = value["setups"][0]
    row = reconstruct(model(value))[0]
    assert row.status == "CLOSED" and row.recordedClosedNet == "1" and row.signedFees == "-0.7"
    group["closeDeals"][0]["commission"] = "-0.8"
    row = reconstruct(model(value))[0]
    assert row.status == "UNKNOWN" and row.recordedClosedNet is None
    assert "ACTUAL_SIGNED_COST_RECONCILIATION_MISMATCH" in row.reasons


def test_actual_report_matches_its_json_schema():
    import json
    from pathlib import Path

    import jsonschema

    value = report(dataset(), load().profiles[1])
    schema = json.loads(Path("schemas/current-scalp-screen-1.0.json").read_text())
    jsonschema.validate(value, schema)
    value["brokerAuthority"] = True
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(value, schema)


@pytest.mark.parametrize(
    "change",
    [
        "no_position",
        "wrong_side",
        "negative_volume",
        "wrong_remaining",
        "future_position",
        "future_order",
        "duplicate_event",
        "late_accept",
        "wrong_type",
        "future_resolution",
    ],
)
def test_reconstruction_rejects_missing_contradictory_or_future_evidence(change: str):
    value = current()
    fill(value, "20")
    group = value["setups"][0]
    if change == "no_position":
        group["currentProtection"] = []
    elif change == "wrong_side":
        group["currentProtection"][0]["side"] = "SELL"
    elif change == "negative_volume":
        group["currentProtection"][0]["volume"] = "-20"
    elif change == "wrong_remaining":
        group["currentProtection"][0]["volume"] = "19"
    elif change == "future_position":
        group["currentProtection"][0]["observedAt"] = at(601)
    elif change == "future_order":
        group["orders"][0]["updatedAt"] = at(601)
    elif change == "duplicate_event":
        group["brokerEvents"].append(group["brokerEvents"][0] | {"executionType": 6})
    elif change == "late_accept":
        group["brokerEvents"][0].update(occurredAt=at(121), receivedAt=at(122), persistedAt=at(123))
    elif change == "wrong_type":
        group["brokerEvents"][0]["orderType"] = 3
    elif change == "future_resolution":
        group["brokerEvents"][0]["resolvedAt"] = at(601)
    row = reconstruct(model(value))[0]
    assert row.status == "UNKNOWN" and row.reasons
    assert row.recordedClosedNet is None


def test_report_censors_future_provider_availability_and_retains_every_context():
    value = dataset().model_dump()
    value["until"] = at(364)
    packet = model(value)
    result = report(packet, load().profiles[2])
    assert len(result["screens"]) == 2
    assert result["screens"][1]["status"] == "UNAVAILABLE"
    assert result["screens"][1]["reason"] == "CONTEXT_NOT_KNOWN_AT_CUTOFF"


def test_unknown_closing_order_does_not_expire_actual_partial_exposure():
    from python.research.learning_evidence import identity

    value = current()
    fill(value)
    group = value["setups"][0]
    event = group["brokerEvents"][0].copy()
    event.update(
        id=identity("expiry-event"),
        executionType=6,
        occurredAt=at(120),
        receivedAt=at(121),
        persistedAt=at(122),
    )
    group["brokerEvents"].append(event)
    group["orders"][0]["state"] = "EXPIRED"
    assert reconstruct(model(value))[0].status == "PARTIAL_OPEN"


@pytest.mark.parametrize(
    "change", ["close_before_fill", "negative_close", "trade_before_fill", "position_before_close"]
)
def test_impossible_closure_timing_or_quantity_is_unknown(change: str):
    value = closed_current()
    group = value["setups"][0]
    if change == "close_before_fill":
        group["closeDeals"][0].update(occurredAt=at(9), recordedAt=at(9))
    elif change == "negative_close":
        group["closeDeals"][0]["closedVolume"] = "-20"
    elif change == "trade_before_fill":
        group["closedTrades"][0]["closedAt"] = at(9)
    else:
        group["currentProtection"][0]["observedAt"] = at(20)
    assert reconstruct(model(value))[0].status == "UNKNOWN"


def test_large_decimal_mismatch_is_not_rounded_into_reconciliation():
    from decimal import getcontext

    precision = getcontext().prec
    value = closed_current()
    group = value["setups"][0]
    group["closeDeals"][0]["gross"] = "12345678901234567890.0000000001"
    group["closedTrades"][0]["realizedNet"] = "12345678901234567889.3000000002"
    assert reconstruct(model(value))[0].status == "UNKNOWN"
    group["closedTrades"][0]["realizedNet"] = "12345678901234567889.3000000001"
    assert reconstruct(model(value))[0].status == "CLOSED"
    assert getcontext().prec == precision


def test_intent_and_terminal_events_follow_original_provider_and_acceptance():
    from python.research.learning_evidence import identity

    value = current()
    value["setups"][0]["createdAt"] = at(4)
    assert "INTENT_PRECEDES_PROVIDER_AVAILABILITY" in reconstruct(model(value))[0].reasons
    value = current()
    group = value["setups"][0]
    event = group["brokerEvents"][0].copy()
    group["state"] = "FAILED"
    group["orders"][0]["state"] = "CANCELLED"
    event.update(
        id=identity("terminal-event"),
        executionType=5,
        occurredAt=at(6),
        receivedAt=at(8),
        persistedAt=at(9),
    )
    group["brokerEvents"].append(event)
    row = reconstruct(model(value))[0]
    assert row.status == "UNKNOWN" and "TERMINAL_PRECEDES_ACCEPTANCE" in row.reasons


def test_new_trial_recorded_release_keeps_source_identity_separate():
    value = current()
    value["contexts"][0]["originRelease"] = "0.10.0-demo-trials.1-codex.1"
    value["setups"][0]["originRelease"] = "0.10.0-demo-trials.1-codex.1"
    assert reconstruct(model(value))[0].status == "PENDING"
    packet = dataset()
    context = packet.contexts[0].model_copy(deep=True)
    context.originRelease = "0.10.0-demo-trials.1-codex.1"
    context.requestedModel = "local-range-v1"
    assert (
        screen(context, load().profiles[0], packet.until).reason
        == "RECORDED_CODEX_SOURCE_UNAVAILABLE"
    )
