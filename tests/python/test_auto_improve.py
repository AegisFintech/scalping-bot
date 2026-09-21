from datetime import UTC, datetime, timedelta
from decimal import Decimal

from python.backtest.auto_improve import AutoImprovementConfig, make_folds
from python.backtest.variants import SetupInput


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
