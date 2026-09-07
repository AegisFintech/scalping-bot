from decimal import Decimal as D

import pytest

from python.evaluation.engine import Plan, Quote, Scenario, evaluate


def test_latency_and_expiry_do_not_chase_a_missed_entry() -> None:
    quotes = [Quote(0, 0, D("100"), D("100.1")), Quote(1000, 1000, D("101"), D("101.1"))]
    plan = Plan(0, 0, 900, ((1, D("100.5"), D("1"), D("2")),))
    result = evaluate(quotes, [plan], Scenario(latency_ms=1000))
    assert result["counters"]["stale_plan_rejections"] == 1
    assert result["closed_trades"] == 0


def test_side_correct_fills_and_fees_are_counted_once() -> None:
    quotes = [
        Quote(0, 0, D("100"), D("100.1")),
        Quote(500, 500, D("100"), D("100.1")),
        Quote(1000, 1000, D("100.4"), D("100.5")),
        Quote(1500, 1500, D("101.6"), D("101.7")),
    ]
    result = evaluate(quotes, [Plan(0, 0, 60000, ((1, D("100.5"), D("1"), D("2")),))], Scenario())
    expected = D("101.55") - D("100.52") - (D("100.52") + D("101.55")) * D("30") / 1_000_000
    assert D(result["net_pnl"]) == expected
    assert result["closed_trades"] == 1


def test_missing_path_is_censored_and_lookahead_plan_is_rejected() -> None:
    quotes = [
        Quote(0, 0, D("100"), D("100.1")),
        Quote(500, 500, D("100"), D("100.1")),
        Quote(1000, 1000, D("100.4"), D("100.5")),
        Quote(10000, 10000, D("90"), D("90.1")),
    ]
    result = evaluate(quotes, [Plan(0, 0, 60000, ((1, D("100.5"), D("1"), D("2")),))], Scenario())
    assert result["counters"]["censored_positions"] == 1
    assert result["closed_trades"] == 0
    with pytest.raises(ValueError, match="PLAN_VALIDITY_INVALID"):
        evaluate(quotes, [Plan(1000, 0, 2000, ())], Scenario())


def test_completed_features_ignore_first_partial_minute_and_future_quotes() -> None:
    from python.evaluation.engine import candidates

    quotes = [
        Quote(t, t, D(100) + D(t % 60_000) / 10_000, D("100.1") + D(t % 60_000) / 10_000)
        for t in range(30_000, 480_001, 1000)
    ]
    plans = candidates(quotes, 60_000, False)
    assert plans and plans[0].created == 360_000
    earlier = candidates(quotes[:331], 60_000, False)
    assert earlier == [p for p in plans if p.created <= quotes[330].time]


def test_oco_peer_is_exposed_until_cancel_confirmation() -> None:
    quotes = [
        Quote(0, 0, D("100"), D("100.1")),
        Quote(500, 500, D("100"), D("100.1")),
        Quote(1000, 1000, D("100.4"), D("100.5")),
        Quote(1250, 1250, D("99.5"), D("99.6")),
    ]
    plan = Plan(0, 0, 60000, ((1, D("100.5"), D("1"), D("2")), (-1, D("99.5"), D("1"), D("2"))))
    result = evaluate(quotes, [plan], Scenario())
    assert result["counters"]["fills"] == 2
    assert result["counters"]["censored_positions"] == 2
    assert result["net_pnl"] is None


def test_recording_checksum_failure_precedes_evaluation(tmp_path) -> None:  # type: ignore[no-untyped-def]
    import json

    from python.evaluation.engine import load_recordings

    segment = tmp_path / "test.jsonl.gz"
    segment.write_bytes(b"corrupt")
    (tmp_path / "test.jsonl.gz.manifest.json").write_text(json.dumps({"sha256": "wrong"}))
    with pytest.raises(ValueError, match="SEGMENT_CHECKSUM_MISMATCH"):
        load_recordings(tmp_path)
