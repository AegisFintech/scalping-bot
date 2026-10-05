from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch

from python.backtest.auto_improve import (
    REPLAY_EVIDENCE_BLOCKERS,
    AutoImprovementConfig,
    evaluate_auto_improvement,
    make_folds,
)
from python.backtest.screen import default_variants
from python.backtest.variants import CostModel, Economics, SetupInput, SetupOutcome, aggregate


def setup(at: datetime) -> SetupInput:
    return SetupInput("ctx", at, Decimal("102"), Decimal("100"))


def test_walk_forward_folds_have_embargo_and_forward_test() -> None:
    first = datetime(2026, 1, 1, tzinfo=UTC)
    setups = [setup(first + timedelta(days=day)) for day in range(70)]
    folds = make_folds(
        setups,
        AutoImprovementConfig(train_days=28, test_days=7, step_days=7, embargo_days=2),
    )
    assert len(folds) == 5
    assert folds[0].train_end + timedelta(days=2) == folds[0].test_start
    assert folds[0].test_end <= folds[1].test_start


def test_walk_forward_returns_no_fold_when_history_is_short() -> None:
    first = datetime(2026, 1, 1, tzinfo=UTC)
    setups = [setup(first + timedelta(days=day)) for day in range(35)]
    assert make_folds(setups, AutoImprovementConfig()) == []


def test_unfinished_mark_can_inflate_legacy_screen_but_cannot_recommend() -> None:
    first = datetime(2026, 1, 1, tzinfo=UTC)
    spec = default_variants(Decimal("0.01"))[0]
    # Reproduce the legacy aggregate's mark-to-window P/L, not a real close.
    unfinished = SetupOutcome(
        variant=spec.name,
        context_id="fixture",
        captured_at=first,
        release=None,
        status="OPEN",
        reason="OPEN_AT_WINDOW_END",
        fill_price=Decimal("100"),
        exit_time=first + timedelta(minutes=90),
        net_usd=Decimal("1000"),
    )
    assert aggregate(spec.name, spec, [unfinished]).total_net_usd == Decimal("1000")
    setups = [setup(first + timedelta(days=day)) for day in range(70)]
    costs = CostModel(Decimal(0), Decimal(0), Decimal(0))
    with patch("python.backtest.auto_improve._run_window", return_value=[unfinished]):
        report = evaluate_auto_improvement(
            [spec],
            setups,
            [],
            [],
            costs,
            costs,
            Economics(Decimal(1), Decimal(0)),
            AutoImprovementConfig(min_test_filled=1),
        )
    assert report["evidence_gate"]["statistical_screen_passed"] is True
    assert report["decision"] == "HOLD"
    assert report["candidate"] is None
    assert report["evidence_gate"]["qualified"] is False
    assert report["evidence_gate"]["blockers"] == list(REPLAY_EVIDENCE_BLOCKERS)
    assert report["safety"]["broker_authority"] is False


def test_short_history_reports_fidelity_limits_without_claiming_validation() -> None:
    costs = CostModel(Decimal(0), Decimal(0), Decimal(0))
    report = evaluate_auto_improvement(
        [],
        [],
        [],
        [],
        costs,
        costs,
        Economics(Decimal(1), Decimal(0)),
    )
    assert report["label"] == "AUTO_IMPROVEMENT_WALK_FORWARD_V2"
    assert report["decision"] == "HOLD"
    assert report["folds"] == []
    assert report["evidence_gate"]["statistical_screen_passed"] is False
    assert report["evidence_gate"]["blockers"]
