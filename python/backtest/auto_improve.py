"""Bounded walk-forward strategy improvement.

This module is research-only.  It evaluates the existing replay variants in
chronological folds, with an embargo and stressed costs, and emits either a
candidate recommendation or ``HOLD``.  It never changes production policy,
risk, orders, or broker state.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from python.backtest.screen import (
    _metrics_json,
    default_costs,
    default_economics,
    default_variants,
    parse_bars,
    parse_setups,
    run_variant,
    stress_costs,
)
from python.backtest.variants import (
    Economics,
    SetupInput,
    SetupOutcome,
    VariantMetrics,
    VariantSpec,
    aggregate,
)


@dataclass(frozen=True)
class AutoImprovementConfig:
    train_days: int = 28
    test_days: int = 7
    step_days: int = 7
    embargo_days: int = 1
    min_test_filled: int = 20
    min_positive_fold_fraction: Decimal = Decimal("0.67")

    def __post_init__(self) -> None:
        if min(self.train_days, self.test_days, self.step_days, self.embargo_days) < 1:
            raise ValueError("AUTO_IMPROVEMENT_WINDOW_INVALID")
        if self.min_test_filled < 1:
            raise ValueError("AUTO_IMPROVEMENT_MIN_SAMPLE_INVALID")
        if not Decimal("0") < self.min_positive_fold_fraction <= Decimal("1"):
            raise ValueError("AUTO_IMPROVEMENT_FRACTION_INVALID")


DEFAULT_CONFIG = AutoImprovementConfig()


@dataclass(frozen=True)
class Fold:
    train_start: datetime
    train_end: datetime
    test_start: datetime
    test_end: datetime


def make_folds(setups: list[SetupInput], config: AutoImprovementConfig) -> list[Fold]:
    """Create expanding-train, forward-test folds with an embargo gap."""
    if not setups:
        return []
    first = min(item.captured_at for item in setups)
    last = max(item.captured_at for item in setups)
    train_end = first + timedelta(days=config.train_days)
    folds: list[Fold] = []
    while True:
        test_start = train_end + timedelta(days=config.embargo_days)
        test_end = test_start + timedelta(days=config.test_days)
        if test_end > last + timedelta(minutes=1):
            break
        folds.append(Fold(first, train_end, test_start, test_end))
        train_end += timedelta(days=config.step_days)
    return folds


def _purge_train_outcomes(outcomes: list[SetupOutcome], test_start: datetime) -> list[SetupOutcome]:
    """Remove training labels whose realized path reaches the test window."""
    return [
        outcome
        for outcome in outcomes
        if outcome.exit_time is None or outcome.exit_time < test_start
    ]


def _run_window(
    spec: VariantSpec,
    setups: list[SetupInput],
    bars: list[Any],
    times: list[datetime],
    costs: Any,
    economics: Economics,
) -> list[SetupOutcome]:
    return run_variant(
        spec,
        setups,
        bars,
        times,
        costs,
        economics,
        serial=True,
        streak_losses=3,
        streak_pause_bars=60,
    )


def evaluate_auto_improvement(
    variants: list[VariantSpec],
    setups: list[SetupInput],
    bars: list[Any],
    times: list[datetime],
    costs: Any,
    stressed_costs: Any,
    economics: Economics,
    config: AutoImprovementConfig = DEFAULT_CONFIG,
) -> dict[str, Any]:
    """Select on past data, score only on later unseen data, and fail closed."""
    folds = make_folds(setups, config)
    fold_reports: list[dict[str, Any]] = []
    selections: list[str] = []

    for fold in folds:
        train_setups = [s for s in setups if fold.train_start <= s.captured_at < fold.train_end]
        test_setups = [s for s in setups if fold.test_start <= s.captured_at < fold.test_end]
        train_rank: list[tuple[Decimal, int, VariantSpec, VariantMetrics]] = []
        for spec in variants:
            train_outcomes = _run_window(spec, train_setups, bars, times, costs, economics)
            metrics = aggregate(
                spec.name,
                spec,
                _purge_train_outcomes(train_outcomes, fold.test_start),
            )
            if metrics.n_filled >= config.min_test_filled:
                train_rank.append((metrics.avg_net_usd_filled, metrics.n_filled, spec, metrics))
        if not train_rank:
            fold_reports.append({"fold": asdict(fold), "status": "INSUFFICIENT_TRAIN"})
            continue
        train_rank.sort(key=lambda item: (item[0], item[1]), reverse=True)
        _, _, selected, train_metrics = train_rank[0]
        selections.append(selected.name)
        test_outcomes = _run_window(selected, test_setups, bars, times, costs, economics)
        stress_outcomes = _run_window(selected, test_setups, bars, times, stressed_costs, economics)
        test_metrics = aggregate(selected.name, selected, test_outcomes)
        stress_metrics = aggregate(selected.name, selected, stress_outcomes)
        fold_reports.append(
            {
                "fold": {key: value.isoformat() for key, value in asdict(fold).items()},
                "selected": selected.name,
                "train": _metrics_json(train_metrics),
                "test": _metrics_json(test_metrics),
                "stress_test": _metrics_json(stress_metrics),
                "test_gate": {
                    "min_filled": config.min_test_filled,
                    "filled": test_metrics.n_filled,
                    "positive_net": test_metrics.total_net_usd > 0,
                    "positive_stress_net": stress_metrics.total_net_usd > 0,
                },
            }
        )

    eligible = [
        row
        for row in fold_reports
        if row.get("test_gate", {}).get("filled", 0) >= config.min_test_filled
    ]
    positive = [
        row
        for row in eligible
        if row["test_gate"]["positive_net"] and row["test_gate"]["positive_stress_net"]
    ]
    selected_name = max(set(selections), key=selections.count) if selections else None
    positive_fraction = Decimal(len(positive)) / Decimal(len(eligible)) if eligible else Decimal(0)
    promoted = (
        selected_name is not None
        and len(eligible) >= 3
        and positive_fraction >= config.min_positive_fold_fraction
        and selections.count(selected_name) >= 2
    )
    return {
        "label": "AUTO_IMPROVEMENT_WALK_FORWARD_V1",
        "decision": "RECOMMEND_CANDIDATE" if promoted else "HOLD",
        "candidate": selected_name if promoted else None,
        "variants_tested": len(variants),
        "folds": fold_reports,
        "selection_counts": {name: selections.count(name) for name in sorted(set(selections))},
        "positive_stress_fold_fraction": str(positive_fraction),
        "promotion_rules": {
            "min_folds": 3,
            "min_test_filled": config.min_test_filled,
            "min_positive_stress_fold_fraction": str(config.min_positive_fold_fraction),
            "requires_repeated_selection": 2,
            "requires_manual_release_and_runtime_review": True,
        },
        "safety": {
            "broker_authority": False,
            "changes_production_policy": False,
            "changes_risk_or_protection": False,
            "multiple_testing_control": (
                "fold-consistent selection plus cost stress; review trial count before promotion"
            ),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Bounded walk-forward strategy improvement")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--train-days", type=int, default=28)
    parser.add_argument("--test-days", type=int, default=7)
    parser.add_argument("--step-days", type=int, default=7)
    parser.add_argument("--embargo-days", type=int, default=1)
    parser.add_argument("--min-test-filled", type=int, default=20)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    if payload.get("label") != "VARIANT_REPLAY_INPUTS_V1":
        raise ValueError("VARIANT_INPUTS_LABEL_INVALID")
    bars, times = parse_bars(payload["candles"])
    setups = parse_setups(payload["setups"])
    calibration = list(payload["outcome_calibration"])
    spread = dict(payload["spread_calibration"])
    tick_size = Decimal(str(payload.get("tick_size", "0.01")))
    result = evaluate_auto_improvement(
        default_variants(tick_size),
        setups,
        bars,
        times,
        default_costs(calibration, spread),
        stress_costs(calibration, spread),
        default_economics(calibration),
        AutoImprovementConfig(
            train_days=args.train_days,
            test_days=args.test_days,
            step_days=args.step_days,
            embargo_days=args.embargo_days,
            min_test_filled=args.min_test_filled,
        ),
    )
    result["input"] = str(args.input)
    result["generated_at"] = datetime.now().astimezone().isoformat()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"decision": result["decision"], "candidate": result["candidate"]}, indent=2))


if __name__ == "__main__":
    main()
