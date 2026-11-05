import json
from datetime import timedelta
from pathlib import Path

import pytest

from python.backtest.current_scalp import TREND_RELEASE
from python.backtest.loss_control import report as legacy_report
from python.backtest.trend_observation import TrendObservationReport, report
from python.operations import loss_control_study as study
from python.research.learning_evidence import encoded
from python.research.position_clock_evidence import PositionClockEvidence
from tests.python.test_current_scalp import closed_current, current
from tests.python.test_scalp_replay import at, model


def evidence(closed=False):
    raw = closed_current() if closed else current()
    for row in raw["contexts"] + raw["setups"]:
        row["originRelease"] = TREND_RELEASE
    packet = model(raw)
    clocks = {p.positionId: at(30) for g in packet.setups for p in g.currentProtection}
    return PositionClockEvidence.bind(packet, clocks)


def rebind(e):
    return PositionClockEvidence.bind(model(e.packet.model_dump()), e.positionUpdatedAt)


def test_trend_observations_preserve_closed_costs_without_legacy_exit_hypotheses():
    e = evidence(closed=True)
    before = e.model_dump()
    result = report(e)
    assert result.setupCounts == {"CLOSED": 1}
    assert result.setups[0]["recordedClosedNet"] == "1"
    assert result.setups[0]["signedFees"] is not None
    assert "holding" not in result.setups[0] and "failedBreakout" not in result.setups[0]
    assert result.contextCounts == {"RECORDED_GEOMETRY_NOT_COST_OR_EXECUTION_QUALIFIED": 1}
    assert not result.economicQualification and not result.promotionAuthority
    assert result.counterfactualNet is None and result.counterfactualFees is None
    assert e.model_dump() == before
    assert legacy_report(e.packet).contextCounts == {"UNSUPPORTED": 1}


def test_waits_failures_and_requests_stay_in_denominator():
    e = evidence()
    c = e.packet.contexts[0]
    c.decision, c.planSchema = "WAIT", "entry-wait-1.0"
    c.entryPrice = c.stopLoss = c.takeProfit = c.pendingSeconds = None
    e.packet.setups = []
    e = rebind(e)
    assert report(e).contextCounts == {"WAIT": 1}
    for state in ("FAILED", "REQUESTING"):
        c = e.packet.contexts[0]
        c.state, c.decision, c.availableAt = state, "UNKNOWN", None
        c.clockStatus = "INCOMPLETE"
        e = rebind(e)
        assert report(e).contextCounts == {state: 1}


def test_unknown_fills_missing_market_and_other_releases_do_not_become_profit():
    e = evidence()
    e.packet.setups[0].brokerEvents = []
    e.packet.contexts[0].market = None
    e = rebind(e)
    result = report(e)
    assert result.setupCounts == {"UNKNOWN": 1}
    assert result.setups[0]["recordedClosedNet"] is None
    assert result.recommendation == "REPAIR"
    assert result.contextCounts == {"UNAVAILABLE": 1}
    e.packet.contexts[0].originRelease = "0.10.0-demo-trials.1-codex.1"
    e = rebind(e)
    assert report(e).contextCounts == {"UNSUPPORTED": 1}


def test_future_availability_and_expiry_never_qualify_a_proposal():
    e = evidence()
    c = e.packet.contexts[0]
    c.completedAt = c.availableAt = at(601)
    e = rebind(e)
    assert report(e).contextCounts == {"UNAVAILABLE": 1}
    c = e.packet.contexts[0]
    c.completedAt = c.availableAt = at(120)
    e = rebind(e)
    assert report(e).contextCounts == {"EXPIRED_BEFORE_AVAILABILITY": 1}


def test_v12_collection_freezes_future_input_and_report_and_rejects_tampering(
    tmp_path, monkeypatch
):
    e = evidence()
    start = study.timestamp(e.packet.start).replace(minute=0) + timedelta(hours=1)
    e.packet.start, e.packet.until = start.isoformat(), (start + timedelta(minutes=30)).isoformat()
    e.packet.journalSnapshotAt = e.packet.exportedAt = e.packet.until
    e = rebind(e)
    monkeypatch.setattr(study, "fingerprint", lambda: "a" * 64)
    root, feed = tmp_path / "study", tmp_path / "feed.json"
    study.register(root, start, start - timedelta(minutes=1), e.packet.sourceId, protocol="1.2")
    feed.write_bytes(encoded(e.model_dump()))
    now = start + timedelta(minutes=31)
    assert study.run(root, feed, now)["state"] == "REPORT_WRITTEN"
    assert study.run(root, feed, now)["state"] == "ALREADY_RECORDED"
    saved = study.read(root / "window-0000.json")
    assert saved["report"]["schemaVersion"] == "trend-observation-1.0"
    assert study.read(root / "registration.json")["method"] == "trend-observation-1.0"
    target = root / "window-0000.json"
    target.chmod(0o600)
    saved["report"]["contextCounts"] = {}
    target.write_bytes(encoded(saved))
    with pytest.raises(ValueError, match="CONFLICT"):
        study.run(root, feed, now)
    monkeypatch.setattr(study, "fingerprint", lambda: "b" * 64)
    with pytest.raises(ValueError, match="DRIFT"):
        study.run(root, feed, now)


def test_schema_parity_and_unknown_protocol_rejection(tmp_path):
    for name, cls in [
        ("trend-observation-1.0", TrendObservationReport),
        ("loss-control-registration-1.2", study.RegistrationV12),
    ]:
        assert json.loads(Path("schemas", name + ".json").read_bytes()) == cls.model_json_schema()
    with pytest.raises(ValueError, match="PROTOCOL_INVALID"):
        start = study.timestamp(at(0))
        study.register(tmp_path / "invalid", start, start, "fixture", protocol="future")
