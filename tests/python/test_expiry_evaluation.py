import json
from dataclasses import replace
from decimal import Decimal as D
from pathlib import Path

import pytest

from python.evaluation.engine import Plan, Quote, Scenario
from python.evaluation.expiry import FrozenSetup, load_setups, summarize, window


def setup() -> FrozenSetup:
    return FrozenSetup(
        Plan(0, 0, 60_000, ((1, D("101"), D("1"), D("2")), (-1, D("98"), D("1"), D("2")))),
        300_000,
        0,
    )


def tape(end: int, changes: dict[int, tuple[str, str]]) -> list[Quote]:
    result = []
    bid, ask = D("100"), D("100.1")
    for t in range(0, end + 1, 1000):
        if t in changes:
            bid, ask = map(D, changes[t])
        result.append(Quote(t, t, bid, ask))
    return result


def test_later_entry_requires_longer_pending_expiry() -> None:
    quotes = tape(185_000, {90_000: ("100.9", "101"), 95_000: ("102.1", "102.2")})
    old = window(quotes, setup(), 60_000, True, Scenario())
    new = window(quotes, setup(), 180_000, True, Scenario())
    assert old["fills"] == 0 and old["censored"] is None
    assert new["fills"] == 1 and new["exits"][0]["reason"] == "TP"
    expected = D("0.95") - (D("101.02") + D("101.97")) * D(30) / 1_000_000
    assert D(new["complete_pair_net_before_model"]) == expected


def test_tp_after_stop_is_not_counted_as_a_win() -> None:
    quotes = tape(65_000, {1000: ("100.9", "101"), 3000: ("98", "98.1"), 5000: ("103", "103.1")})
    result = window(quotes, setup(), 60_000, True, Scenario())
    assert [e["reason"] for e in result["exits"]] == ["SL"]
    assert D(result["exits"][0]["net"]) < -3  # observed gap, not nominal two-dollar stop


def test_expiry_does_not_close_a_position_and_boundary_does_not_fill() -> None:
    quotes = tape(65_000, {55_000: ("100.9", "101"), 63_000: ("102.1", "102.2")})
    result = window(quotes, setup(), 60_000, True, Scenario())
    assert result["exits"][0]["hold_ms"] == 7000
    boundary = tape(61_000, {60_000: ("100.9", "101")})
    assert window(boundary, setup(), 60_000, True, Scenario())["fills"] == 0


def test_stop_limit_latches_trigger_and_can_fill_on_retracement() -> None:
    quotes = tape(
        65_000, {1000: ("101.1", "101.2"), 3000: ("100.8", "100.9"), 5000: ("102", "102.1")}
    )
    result = window(quotes, setup(), 60_000, True, Scenario())
    assert result["counts"]["outside_limit_observations"] > 0
    assert result["fills"] == 1
    cancelled = window(quotes, setup(), 60_000, True, Scenario(), cancel_on_miss=True)
    assert cancelled["fills"] == 0


def test_sell_uses_bid_entry_and_ask_exit_with_fees_once() -> None:
    quotes = tape(65_000, {1000: ("98", "98.1"), 4000: ("96.8", "96.9")})
    result = window(quotes, setup(), 60_000, True, Scenario())
    expected = D("0.95") - (D("97.98") + D("97.03")) * D(30) / 1_000_000
    assert D(result["exits"][0]["net"]) == expected


def test_gaps_and_open_endpoints_stay_unknown() -> None:
    quotes = tape(2000, {1000: ("100.9", "101")})
    assert window(quotes, setup(), 60_000, True, Scenario())["censored"] == "recording_ended"
    quotes += [Quote(10_000, 10_000, D("102.1"), D("102.2"))]
    result = window(quotes, setup(), 60_000, True, Scenario())
    assert result["censored"] == "missing_quote_path"
    assert result["complete_pair_net_before_model"] is None
    assert result["exits"] == []


def test_lifetime_beyond_map_is_explicit_research_only() -> None:
    quotes = tape(910_000, {})
    bounded = window(quotes, setup(), 900_000, True, Scenario())
    research = window(quotes, setup(), 900_000, False, Scenario())
    assert bounded["expiry"] == 300_000 and bounded["outside_map_ms"] == 0
    assert research["expiry"] == 900_000 and research["outside_map_ms"] == 600_000
    assert summarize([research])["portfolio_net_pnl"] is None
    assert summarize([research])["model_cost"] is None


def test_partial_fill_and_oco_race_are_explicit() -> None:
    quotes = tape(6000, {1000: ("100.9", "101"), 3000: ("98", "98.1"), 5000: ("96.8", "96.9")})
    scenario = Scenario(fill_fraction=D("0.5"), oco_cancel_latency_ms=3000)
    result = window(quotes, setup(), 60_000, True, scenario)
    assert result["fills"] == 2 and result["counts"]["partial_fill_legs"] == 2
    assert summarize([result])["pairs_with_oco_race"] == 1


@pytest.mark.parametrize(
    "scenario",
    [Scenario(entry_slippage=D("NaN")), Scenario(latency_ms=-1), Scenario(fill_fraction=D("1.1"))],
)
def test_invalid_scenario_fails(scenario: Scenario) -> None:
    with pytest.raises(ValueError, match="EXPIRY_SCENARIO_INVALID"):
        window([], setup(), 60_000, True, scenario)


def test_frozen_plan_rejects_backdated_availability_and_unvalidated_values(tmp_path: Path) -> None:
    row = {
        "created": "2026-09-08T00:00:02Z",
        "available": "2026-09-08T00:00:03Z",
        "expires": "2026-09-08T00:01:02Z",
        "map_captured": "2026-09-08T00:00:00Z",
        "map_available": "2026-09-08T00:00:01Z",
        "map_expires": "2026-09-08T00:05:00Z",
        "decision_at": "2026-09-08T00:00:02Z",
        "legs": [{"side": side, "entry": "100", "tp": "1", "sl": "2"} for side in (1, -1)],
    }
    path = tmp_path / "plans.json"
    path.write_text(json.dumps([row]))
    assert len(load_setups(path)) == 1
    row["map_available"] = "2026-09-08T00:00:04Z"
    path.write_text(json.dumps([row]))
    with pytest.raises(ValueError, match="FROZEN_SETUP_INVALID"):
        load_setups(path)
    row["map_available"] = "2026-09-08T00:00:01Z"
    row["legs"][0]["entry"] = "NaN"
    path.write_text(json.dumps([row]))
    with pytest.raises(ValueError, match="DECIMAL_NONFINITE"):
        load_setups(path)


def test_end_of_followup_is_censored_instead_of_an_invented_time_exit() -> None:
    quotes = tape(700_000, {1000: ("100.9", "101")})
    result = window(quotes, setup(), 60_000, True, replace(Scenario(), commission_per_million=D(0)))
    assert result["censored"] == "open_at_observation_limit"
    assert result["exits"] == []
