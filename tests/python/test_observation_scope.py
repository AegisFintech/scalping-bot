import json

from python.research.learning_evidence import encoded
from tests.python.test_observation_cycle import answer, run
from tests.python.test_scalp_replay import fixture, model


def current_wait():
    value = fixture()
    value["contexts"][0].update(
        originRelease="0.9.0-cost-balanced.1-codex.1",
        decision="WAIT",
        planSchema="entry-wait-1.0",
        entryPrice=None,
        takeProfit=None,
        stopLoss=None,
        pendingSeconds=None,
    )
    value["setups"] = []
    return model(value).model_dump()


def test_current_release_baseline_unavailable_cannot_become_provider_wait_cause(tmp_path):
    seen = []

    def capture(prompt, directory):
        seen.append(json.loads(prompt.split("\nINPUT ", 1)[1])["diagnostic"])
        return answer(prompt, directory)

    assert run(tmp_path, current_wait(), invoke=capture)["status"] == "CLOSED"
    prompt = seen[0]
    assert prompt["executionFunnel"]["decisionCounts"] == {"WAIT": 1}
    assert prompt["researchBaselineScope"]["unsupportedContexts"] == 1
    assert prompt["researchBaselineScope"]["supportedContexts"] == 0
    assert prompt["researchBaselineScope"]["decisions"] == {}
    assert "researchBaselineDecisions" not in prompt["executionFunnel"]
    assert "CONTEXT_RELEASE_UNSUPPORTED" not in encoded(prompt).decode()


def scope(value):
    from python.backtest.scalp_replay import replay
    from python.research.observation_cycle import sha
    from python.research.observation_scope import measure

    packet = model(value)
    digest = sha(encoded(packet.model_dump()))
    return measure(packet, digest, replay(packet, digest).benchmark)


def add_close(value, net="-5.25", fees="-1.50", close=None):
    from tests.python.test_scalp_replay import at

    value["setups"][0]["closedTrades"] = [
        {
            "id": "e" * 24,
            "direction": "LONG",
            "realizedNet": net,
            "signedFees": fees,
            "openedAt": at(10),
            "closedAt": close or at(20),
        }
    ]


def test_new_release_actual_closed_costs_survive_unsupported_historical_replay():
    value = fixture()
    for family in ["contexts", "setups"]:
        value[family][0]["originRelease"] = "0.9.0-cost-balanced.1-codex.1"
    add_close(value)
    result = scope(value)
    assert result.unsupportedContexts == result.windowClosedRows == 1
    assert result.decisions == {} and result.windowOutcomes[0].realizedNet == "-5.25"
    assert result.windowOutcomes[0].signedFees == "-1.50"
    assert result.windowOutcomes[0].negative == 1
    assert result.counterfactualNet is None and not result.economicQualification


def test_mixed_release_scope_preserves_actual_rows_without_computing_new_baseline():
    from copy import deepcopy

    value = fixture()
    other = deepcopy(value["contexts"][0])
    other["id"] = "e" * 24
    other["originRelease"] = "0.9.0-cost-balanced.1-codex.1"
    value["contexts"].append(other)
    result = scope(value)
    assert result.supportedContexts == result.unsupportedContexts == 1
    assert sum(result.decisions.values()) == 1
    assert "CONTEXT_RELEASE_UNSUPPORTED" not in result.reasons


def test_closed_identity_dedupe_and_conflicts_never_mix_currencies():
    from copy import deepcopy

    import pytest

    value = fixture()
    value["setups"][0]["originRelease"] = "0.9.0-cost-balanced.1-codex.1"
    add_close(value)
    other = deepcopy(value["setups"][0])
    other["id"] = "f" * 24
    value["setups"].append(other)
    result = scope(value)
    assert result.closedRowsInPacket == 2 and result.duplicateClosedRows == 1
    assert result.windowClosedRows == 1 and result.windowOutcomes[0].realizedNet == "-5.25"
    other["accountCurrency"] = "EUR"
    with pytest.raises(ValueError, match="CLOSED_IDENTITY_CONFLICT"):
        scope(value)
    other["closedTrades"][0]["id"] = "d" * 24
    result = scope(value)
    assert result.windowClosedRows == 2 and len(result.windowOutcomes) == 2


def test_window_close_cutoff_is_exclusive_and_net_uses_exact_decimal_sum():
    from copy import deepcopy

    value = fixture()
    add_close(value, "0.1000000001", "-0.01")
    other = deepcopy(value["setups"][0])
    other["id"] = "f" * 24
    other["closedTrades"][0]["id"] = "d" * 24
    value["setups"].append(other)
    result = scope(value)
    assert result.windowOutcomes[0].realizedNet == "0.2000000002"
    other["closedTrades"][0]["closedAt"] = value["until"]
    result = scope(value)
    assert result.closedRowsInPacket == 2 and result.windowClosedRows == 1


def test_scope_schema_denominators_and_authority_fail_closed():
    from pathlib import Path

    import pytest

    from python.research.observation_scope import ObservationScope

    result = scope(fixture())
    assert (
        json.loads(Path("schemas/research-observation-scope-1.0.json").read_text())
        == ObservationScope.model_json_schema()
    )
    for change in [
        {"unsupportedContexts": 3},
        {"unsupportedIsTradingGate": True},
        {"windowClosedRows": 2},
        {"brokerAuthority": True},
    ]:
        with pytest.raises(ValueError):
            ObservationScope.model_validate(result.model_dump() | change)


def test_receiver_scope_is_bound_to_exact_finding_and_context_denominator(tmp_path):
    from python.operations.learning_control import recorded_observation_scope
    from tests.python.test_observation_cycle import job

    run(tmp_path, current_wait())
    directory = job(tmp_path)
    result = recorded_observation_scope(directory)
    assert result.unsupportedContexts == 1 and result.decisions == {}
    p = directory / "diagnostic.json"
    d = json.loads(p.read_bytes())
    d["researchBaselineScope"]["unsupportedContexts"] = 0
    p.write_bytes(encoded(d))
    assert recorded_observation_scope(directory) is None
