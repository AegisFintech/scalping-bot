from copy import deepcopy
from datetime import timedelta
from pathlib import Path

import pytest

from python.backtest.loss_control import CANDIDATES, report
from python.operations import loss_control_study as study
from python.operations.export_learning_evidence import context
from python.research.learning_evidence import ContextObservation, encoded
from tests.python.test_current_scalp import closed_current, current
from tests.python.test_demo_trial_protocol import trial_request
from tests.python.test_scalp_replay import at, fill, model


def test_all_contexts_and_unknown_outcomes_retained():
    packet = model(current())
    result = report(packet)
    assert sum(result.contextCounts.values()) == len(packet.contexts)
    assert sum(result.setupCounts.values()) == len(packet.setups)
    assert result.counterfactualNet is None and not result.brokerAuthority
    assert result.candidates == CANDIDATES
    assert result.setups[0]["holding"] == "UNAVAILABLE"


def test_structural_ratio_rejects_without_moving_prices():
    packet = model(current())
    c = packet.contexts[0]
    c.entryPrice, c.takeProfit, c.stopLoss = "4002", "4003", "3995"
    before = packet.model_dump()
    result = report(packet)
    assert result.contexts[0]["state"] == "REJECT_GEOMETRY"
    assert result.contexts[0]["plannedStopToTarget"] == "7"
    assert packet.model_dump() == before
    c.stopLoss = "4000"
    assert report(packet).contexts[0]["state"] == "PASS_GEOMETRY"
    c.takeProfit = c.entryPrice
    assert report(packet).contexts[0]["state"] == "UNAVAILABLE"


def test_timer_uses_actual_fill_and_does_not_claim_profit_or_execution():
    value = current()
    fill(value, "20")
    result = report(model(value)).setups[0]
    assert result["holding"] == "TIMER_OBSERVED_NOT_EXECUTED"
    assert result["holdingDueAt"] == at(190)
    assert result["counterfactualNet"] is None
    value = closed_current()
    assert report(model(value)).setups[0]["holding"] == "CLOSED_AT_OR_BEFORE_TIMER"
    value = current()
    fill(value, "10")
    assert report(model(value)).setups[0]["holding"] == "UNAVAILABLE"


def test_partial_unknown_and_missing_candles_never_invent_exit():
    value = current()
    fill(value, "20")
    result = report(model(value))
    assert result.setups[0]["failedBreakout"] == "INSUFFICIENT_PATH"
    value["setups"][0]["brokerEvents"] = []
    assert report(model(value)).setups[0]["holding"] == "UNAVAILABLE"


def trial_row():
    req = trial_request()
    capture = req.payload.captured_at
    return {
        "id": "c",
        "source_analysis_id": "a",
        "origin_release": "0.10.0-demo-trials.1-codex.1",
        "requested_model": "local-range-v1",
        "plan": {"schema_version": "entry-wait-1.0"},
        "state": "READY",
        "reason": None,
        "requested_at": capture,
        "captured_at": capture,
        "available_at": capture,
        "completed_at": capture,
        "valid_until": (study.timestamp(capture) + timedelta(seconds=180)).isoformat(),
        "prompt_version": req.promptVersion,
        "prompt_sha256": req.promptSha256,
        "request_sha256": "a" * 64,
        "response_sha256": "b" * 64,
        "provider_input": req.payload.model_dump_json(),
    }


def test_trial_market_projects_after_strict_validation_and_preserves_old_contract():
    import json

    row = trial_row()
    result = ContextObservation.model_validate(context(row, "OBSERVED_WINDOW"))
    assert result.market is not None
    assert result.market.candles
    assert result.unavailableReasons == ["TRIAL_STRESS_COSTS_NOT_PROJECTED"]
    assert "stress_exit_reserve_ticks" not in result.market.model_dump()["execution_context"]
    for field, value in [
        ("stress_exit_reserve_ticks", 5),
        ("unknown", 1),
        ("modeled_stress_round_trip_cost_price", "0"),
    ]:
        bad = deepcopy(row)
        raw = json.loads(bad["provider_input"])
        raw["execution_context"][field] = value
        bad["provider_input"] = json.dumps(raw)
        assert context(bad, "OBSERVED_WINDOW")["market"] is None
    row["origin_release"] = "0.9.0-cost-balanced.1-codex.2"
    assert context(row, "OBSERVED_WINDOW")["market"] is None


def test_future_registration_replay_and_drift(tmp_path: Path, monkeypatch):
    packet = model(current())
    start = study.timestamp(packet.start).replace(minute=0) + timedelta(hours=1)
    packet.start = start.isoformat()
    root = tmp_path / "study"
    monkeypatch.setattr(study, "fingerprint", lambda: "a" * 64)
    study.register(root, start, start - timedelta(minutes=1), packet.sourceId)
    with pytest.raises(ValueError, match="ALREADY_REGISTERED"):
        study.register(root, start, start - timedelta(minutes=1), packet.sourceId)
    # Fixture window is ten minutes; the production feed requires a full half hour.
    packet.until = (start + timedelta(minutes=30)).isoformat()
    packet.exportedAt = packet.journalSnapshotAt = packet.until
    feed = tmp_path / "feed.json"
    feed.write_bytes(encoded(packet.model_dump()))
    now = study.timestamp(packet.until) + timedelta(minutes=1)
    assert study.run(root, feed, now)["state"] == "REPORT_WRITTEN"
    assert study.run(root, feed, now)["state"] == "ALREADY_RECORDED"
    monkeypatch.setattr(study, "fingerprint", lambda: "b" * 64)
    with pytest.raises(ValueError, match="DRIFT"):
        study.run(root, feed, now)


def test_past_registration_and_stale_feed_reject(tmp_path: Path, monkeypatch):
    packet = model(current())
    start = study.timestamp(packet.start)
    monkeypatch.setattr(study, "fingerprint", lambda: "a" * 64)
    with pytest.raises(ValueError, match="FUTURE"):
        study.register(tmp_path / "study", start, start, packet.sourceId)


@pytest.mark.parametrize("bar_start,known", [(0, 70), (60, 140)])
def test_failed_breakout_uses_observed_availability_not_candle_close(bar_start, known):
    value = current()
    fill(value, "20")
    packet = model(value)
    later = packet.contexts[0].model_copy(deep=True)
    later.id = "d" * 24
    later.capturedAt = later.availableAt = at(known)
    later.completedAt = at(known)
    assert later.market is not None
    frame = next(f for f in later.market.candles if f.timeframe == "M1")
    frame.rows = [
        [at(bar_start), at(bar_start + 60), "4001", "4002", "3999", "4000", None, True, []]
    ]
    packet.contexts.append(later)
    result = report(packet).setups[0]
    assert result["failedBreakout"] == "OBSERVED_SIGNAL_NOT_EXECUTED"
    assert result["observedSignalAvailableAt"] == at(known)
    later.availableAt = at(601)
    assert report(packet).setups[0]["failedBreakout"] == "INSUFFICIENT_PATH"
    later.availableAt = at(known)
    frame.rows.append(
        [at(bar_start), at(bar_start + 60), "4001", "4002", "3999", "4001", None, True, []]
    )
    assert report(packet).setups[0]["failedBreakout"] == "CANDLE_CONFLICT"


def test_schemas_match_checked_contracts():
    import json

    from python.backtest.loss_control import LossControlReport

    for name, cls in [
        ("loss-control-screen-1.0", LossControlReport),
        ("loss-control-registration-1.0", study.Registration),
    ]:
        assert json.loads(Path("schemas", name + ".json").read_text()) == cls.model_json_schema()


def test_closed_partial_fill_is_not_a_full_exit_path():
    value = closed_current()
    g = value["setups"][0]
    g["orders"][0]["filledVolume"] = g["fills"][0]["volume"] = "10"
    g["closeDeals"][0]["closedVolume"] = g["currentProtection"][0]["volume"] = "10"
    row = report(model(value)).setups[0]
    assert row["actualState"] == "CLOSED"
    assert row["holding"] == row["failedBreakout"] == "PARTIAL_PATH_UNSUPPORTED"


def empty_study(tmp_path, monkeypatch):
    from tests.python.test_learning_bridge import packet as empty_packet

    value = empty_packet(contexts=[], analyses=[], setups=[], flight=[])
    p = model(value)
    start = study.timestamp(p.start)
    root, feed = tmp_path / "study", tmp_path / "feed.json"
    monkeypatch.setattr(study, "fingerprint", lambda: "a" * 64)
    study.register(root, start, start - timedelta(minutes=1), p.sourceId)

    def publish(index):
        p.start = (start + timedelta(minutes=30 * index)).isoformat()
        p.until = (start + timedelta(minutes=30 * (index + 1))).isoformat()
        p.journalSnapshotAt = p.exportedAt = p.until
        feed.write_bytes(encoded(p.model_dump()))

    publish(0)
    return root, feed, start, publish


def test_late_window_does_not_rewrite_original_gap_snapshot(tmp_path, monkeypatch):
    root, feed, start, publish = empty_study(tmp_path, monkeypatch)
    now = start + timedelta(minutes=61)
    publish(1)
    assert study.run(root, feed, now)["missingPriorWindows"] == 1
    before = (root / "window-0001.json").read_bytes()
    publish(0)
    study.run(root, feed, now)
    publish(1)
    assert study.run(root, feed, now)["state"] == "ALREADY_RECORDED"
    assert (root / "window-0001.json").read_bytes() == before


def test_runner_rejects_stale_scope_and_projected_storage_before_write(tmp_path, monkeypatch):
    import json
    from collections import namedtuple

    root, feed, start, _ = empty_study(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="STALE_OR_SCOPE"):
        study.run(root, feed, start + timedelta(minutes=71))
    original = feed.read_bytes()
    wrong = json.loads(original)
    wrong["sourceId"] = "other-source"
    feed.write_bytes(encoded(wrong))
    with pytest.raises(ValueError, match="STALE_OR_SCOPE"):
        study.run(root, feed, start + timedelta(minutes=31))
    feed.write_bytes(original)
    usage = namedtuple("usage", "total used free")
    monkeypatch.setattr(study.shutil, "disk_usage", lambda _: usage(10**10, 1, 2 * 1024**3 + 1))
    with pytest.raises(ValueError, match="STORAGE_RESERVE"):
        study.run(root, feed, start + timedelta(minutes=31))
    assert not list(root.glob("window*"))


def test_interrupted_report_recovers_original_input_and_rejects_tampering(tmp_path, monkeypatch):
    import json

    root, feed, start, _ = empty_study(tmp_path, monkeypatch)
    original = study.immutable

    def fail_report(path, value):
        if path.name == "window-0000.json":
            raise OSError("simulated interruption")
        original(path, value)

    monkeypatch.setattr(study, "immutable", fail_report)
    now = start + timedelta(minutes=31)
    with pytest.raises(OSError):
        study.run(root, feed, now)
    retained = (root / "window-0000.input.json").read_bytes()
    monkeypatch.setattr(study, "immutable", original)
    assert study.run(root, feed, now)["state"] == "REPORT_WRITTEN"
    assert (root / "window-0000.input.json").read_bytes() == retained
    path = root / "window-0000.json"
    value = json.loads(path.read_bytes())
    value["sourceSha256"] = "f" * 64
    path.write_bytes(encoded(value))
    with pytest.raises(ValueError, match="CONFLICT"):
        study.run(root, feed, now)


def test_only_exact_closing_fill_is_represented_by_its_close_deal():
    from python.operations.export_learning_evidence import entry_fills

    f = dict(order_id=None, broker_fill_id="123", position_id="p", volume="20", occurred_at=at(30))
    d = dict(broker_deal_id="123", position_id="p", closed_volume="20", occurred_at=at(30))
    assert entry_fills([f], [d]) == []
    assert entry_fills([{**f, "order_id": "owned-entry"}], [d]) == [
        {**f, "order_id": "owned-entry"}
    ]
    for key, value in [
        ("broker_deal_id", "456"),
        ("position_id", "q"),
        ("closed_volume", "10"),
        ("occurred_at", at(31)),
    ]:
        assert entry_fills([f], [{**d, key: value}]) == [f]
    assert entry_fills([f], [d, d]) == [f]
    assert entry_fills([f, dict(f)], [d]) == [f, f]
    assert entry_fills([f], []) == [f]
