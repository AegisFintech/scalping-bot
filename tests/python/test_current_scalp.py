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
    codex = screen(packet.contexts[0], load().profiles[0])
    assert codex.status == "WAIT" and "CODEX_WAIT" in codex.reason


def test_baseline_does_not_shift_a_crossed_completed_candle_line():
    packet = dataset()
    origin = packet.contexts[0].model_copy(deep=True)
    assert origin.market is not None
    origin.market.entry_boundaries.buy_stop_minimum = "5000"
    result = screen(origin, load().profiles[1])
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
    assert row.status == "UNKNOWN" and "GROUP_STATE_NOT_KNOWN_AT_CUTOFF" in row.reasons


def test_no_legacy_oracle_or_expiry_only_terminal_authority():
    assert reconstruct(model(fixture()))[0].status == "UNSUPPORTED"
    value = current()
    value["setups"][0]["state"] = "EXPIRED"
    value["setups"][0]["orders"][0]["state"] = "EXPIRED"
    row = reconstruct(model(value))[0]
    assert row.status == "UNKNOWN" and "ZERO_FILL_TERMINAL_PROOF_MISSING" in row.reasons


def test_actual_manual_close_costs_reconcile_once_and_conflicts_stay_unknown():
    from python.research.learning_evidence import identity

    value = current()
    fill(value, "20")
    group = value["setups"][0]
    group["state"] = "CLOSED"
    group["currentProtection"][0]["positionState"] = "CLOSED"
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
