from __future__ import annotations

import gzip
import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from apps.dashboard.flight_view import load_flight_view
from python.operations.setup_flight_recorder import (
    Flight,
    StorageBudget,
    encoded,
    estimate_net_pips,
)

NOW = datetime(2026, 10, 26, tzinfo=UTC)


def metadata() -> dict:
    return {
        "pipSize": "0.01",
        "tickSize": "0.01",
        "tickValue": "0.0001",
        "volumeScale": "0.01",
        "quoteAsset": "USD",
        "accountAsset": "USD",
        "quoteToAccountConversionRate": "1",
        "commission": {
            "type": "USD_PER_MILLION_USD",
            "rate": "30",
            "minimum": "0",
            "minimumType": "QUOTE_CURRENCY",
            "minimumAsset": "USD",
            "pnlConversionFeeRate": "0",
        },
    }


def setup(side: str = "BUY") -> dict:
    return {
        "setup": "a" * 24,
        "state": "POSITION_OPEN",
        "createdAt": (NOW - timedelta(seconds=2)).isoformat(),
        "updatedAt": NOW.isoformat(),
        "originRelease": "fixture",
        "executionMode": "OCO_STOP_LIMIT",
        "orders": [
            {
                "side": side,
                "entry_price": "4000",
                "stop_loss": "3993" if side == "BUY" else "4007",
                "take_profit": "4001" if side == "BUY" else "3999",
                "fill_price": "4000",
                "fill_volume": "10000",
                "first_fill": NOW - timedelta(seconds=1),
                "last_fill": NOW - timedelta(seconds=1),
                "state": "FILLED",
            }
        ],
        "protection": [],
        "closedTrades": [],
        "brokerEvents": [],
    }


def quote(bid: str = "4000.5", ask: str = "4000.6", seconds: int = 0) -> dict:
    at = (NOW + timedelta(seconds=seconds)).isoformat()
    return {
        "kind": "QUOTE",
        "sequence": seconds + 1,
        "bid": bid,
        "ask": ask,
        "sourceTime": at,
        "receivedAt": at,
        "bidUpdated": True,
        "askUpdated": True,
    }


def test_cost_model_uses_executable_side_and_broker_commission() -> None:
    net = estimate_net_pips(metadata(), Decimal(4000), Decimal("4000.5"), Decimal(10000), "BUY")
    assert net == Decimal("25.9985")
    assert (
        estimate_net_pips(metadata(), Decimal(4000), Decimal("4000.5"), Decimal(10000), "SELL") < 0
    )
    m = metadata()
    m["commission"]["type"] = "UNKNOWN"
    with pytest.raises(ValueError, match="FLIGHT_COST_UNSUPPORTED"):
        estimate_net_pips(m, Decimal(4000), Decimal(4001), Decimal(10000), "BUY")


def test_tracks_buy_bid_excursions_proximity_and_signed_slippage(tmp_path: Path) -> None:
    f = Flight(tmp_path, setup(), NOW)
    f.quote(quote(), metadata(), NOW)
    leg = f.legs["BUY"]
    assert Decimal(leg["mfePips"]) == 50
    assert Decimal(leg["maePips"]) == 0
    assert Decimal(leg["closestTpPips"]) == 50
    assert Decimal(leg["modeledNetPips"]) == Decimal("25.9985")
    assert Decimal(leg["entrySlippagePips"]) == 0
    f.quote(quote("3999.5", "3999.6", 1), metadata(), NOW + timedelta(seconds=1))
    assert Decimal(leg["maePips"]) == -50
    assert Decimal(leg["bestModeledNetPips"]) > 0
    assert f.boundaries["BUY"]["observedBoundaryCross"] is True
    assert f.boundaries["BUY"]["counterfactualNet"] is None


def test_sell_uses_ask_and_does_not_extend_metrics_beyond_proven_close(tmp_path: Path) -> None:
    s = setup("SELL")
    f = Flight(tmp_path, s, NOW)
    f.quote(quote("3999.3", "3999.5"), metadata(), NOW)
    assert Decimal(f.legs["SELL"]["mfePips"]) == 50
    s["closedTrades"] = [
        {
            "direction": "SHORT",
            "closed_at": (NOW + timedelta(seconds=1)).isoformat(),
            "net": "2",
            "signed_fees": "-1",
        }
    ]
    f.update(s)
    f.quote(quote("3998", "3998.1", 2), metadata(), NOW + timedelta(seconds=2))
    assert Decimal(f.legs["SELL"]["mfePips"]) == 50
    assert len(f.chart) == 2  # post-close raw movement remains evidence, not hypothetical P/L


def test_gaps_censor_profitable_duration_and_partial_basis(tmp_path: Path) -> None:
    f = Flight(tmp_path, setup(), NOW)
    f.quote(quote(), metadata(), NOW)
    f.quote(quote(seconds=1), metadata(), NOW + timedelta(seconds=1))
    assert Decimal(f.legs["BUY"]["timeProfitableSeconds"]) == 1
    f.gap("NETWORK_GAP")
    f.quote(quote(seconds=2), metadata(), NOW + timedelta(seconds=2))
    assert Decimal(f.legs["BUY"]["timeProfitableSeconds"]) == 1
    f.quote({**quote(seconds=3), "bid": "NaN"}, metadata(), NOW + timedelta(seconds=3))
    assert f.gaps >= 3
    s = setup()
    s["orders"][0]["fill_volume"] = "15000"
    f.update(s)
    f.quote(quote(seconds=4), metadata(), NOW + timedelta(seconds=4))
    assert f.legs["BUY"]["samples"] == 1
    assert f.gaps >= 4


def test_hash_chain_compression_final_immutability_and_safe_dashboard_view(tmp_path: Path) -> None:
    f = Flight(tmp_path, setup(), NOW)
    f.quote(quote(), metadata(), NOW)
    f.finish(NOW)
    raw = gzip.decompress(next(tmp_path.glob("*.jsonl.gz")).read_bytes())
    previous = "0" * 64
    for line in raw.splitlines():
        row = json.loads(line)
        digest = row.pop("sha256")
        assert row["previous"] == previous
        assert hashlib.sha256(encoded(row)).hexdigest() == digest
        previous = digest
    before = f.summary_path.read_bytes()
    f.finish(NOW + timedelta(seconds=1))
    f.quote(quote(seconds=1), metadata(), NOW + timedelta(seconds=1))
    assert f.summary_path.read_bytes() == before
    with pytest.raises(ValueError, match="FLIGHT_ALREADY_FINAL"):
        f.append("BAD", {})
    view = load_flight_view(tmp_path, NOW)
    assert view["available"] is True and view["final"] is True
    assert "basis" not in view["legs"][0]
    assert load_flight_view(tmp_path, NOW + timedelta(seconds=11))["state"] == "STALE"


def test_conflicting_archive_and_full_budget_never_delete_original_evidence(tmp_path: Path) -> None:
    f = Flight(tmp_path, setup(), NOW)
    content = f.path.read_bytes()
    f.path.with_suffix(".jsonl.gz").write_bytes(b"existing")
    with pytest.raises(FileExistsError):
        f.compress()
    assert f.path.read_bytes() == content
    f.budget.used = 512 * 1024**2
    with pytest.raises(ValueError, match="FLIGHT_STORAGE_BUDGET_FULL"):
        f.append("QUOTE", {})
    assert f.path.read_bytes() == content
    assert isinstance(StorageBudget(tmp_path).used, int)


def test_dashboard_rejects_arbitrary_paths_symlinks_and_malformed_summary(tmp_path: Path) -> None:
    status = {"checkedAt": NOW.isoformat(), "summary": "../../private.json", "state": "RECORDING"}
    (tmp_path / "status.json").write_text(json.dumps(status))
    assert not load_flight_view(tmp_path, NOW)["available"]
    name = "flight-" + "b" * 24 + "-20261026T000000000000.summary.json"
    status["summary"] = name
    (tmp_path / "status.json").write_text(json.dumps(status))
    (tmp_path / name).write_text("[]")
    assert not load_flight_view(tmp_path, NOW)["available"]
    (tmp_path / name).unlink()
    (tmp_path / name).symlink_to(tmp_path / "status.json")
    assert not load_flight_view(tmp_path, NOW)["available"]


def test_late_broker_close_removes_post_close_excursions(tmp_path: Path) -> None:
    f = Flight(tmp_path, setup(), NOW)
    f.quote(quote("4000.5", "4000.6", 0), metadata(), NOW)
    f.quote(quote("4005", "4005.1", 2), metadata(), NOW + timedelta(seconds=2))
    assert Decimal(f.legs["BUY"]["mfePips"]) == 500
    closed = setup()
    closed["closedTrades"] = [{"direction": "LONG", "closed_at": NOW + timedelta(seconds=1)}]
    f.update(closed)
    assert Decimal(f.legs["BUY"]["mfePips"]) == 50
    assert f.legs["BUY"]["quoteAt"] == NOW.isoformat()


def test_cached_partial_quote_side_requires_independent_freshness(tmp_path: Path) -> None:
    f = Flight(tmp_path, setup(), NOW)
    f.quote({**quote(), "askUpdated": False}, metadata(), NOW)
    assert not f.legs
    f.quote(quote(), metadata(), NOW)
    assert f.legs["BUY"]["samples"] == 1
    f.quote({**quote(seconds=4), "askUpdated": False}, metadata(), NOW + timedelta(seconds=4))
    assert f.legs["BUY"]["samples"] == 1
    assert "QUOTE_SIDE_FRESHNESS_UNKNOWN" in f.path.read_text()


def test_partial_close_remaining_volume_changes_only_after_observed_position_update(
    tmp_path: Path,
) -> None:
    f = Flight(tmp_path, setup(), NOW)
    f.quote(quote(), metadata(), NOW)
    changed = setup()
    changed["protection"] = [
        {
            "side": "BUY",
            "state": "OPEN",
            "volume": "5000",
            "updated_at": NOW + timedelta(seconds=1),
            "protection_status": "UNKNOWN",
        }
    ]
    f.update(changed)
    f.quote(quote(seconds=2), metadata(), NOW + timedelta(seconds=2))
    assert Decimal(f.legs["BUY"]["volume"]) == 5000
    assert f.legs["BUY"]["samples"] == 1
    assert "POSITION_VOLUME_BASIS_CHANGED_PRIOR_METRICS_CENSORED" in f.path.read_text()
