"""Variant screening CLI over exported entry-pair replay inputs.

Runs the journaled provider levels through the calibrated variant simulator,
splits results chronologically into train/holdout, and writes a go/no-go
report. Research-only: no broker authority, no profitability claim.
"""

from __future__ import annotations

import argparse
import json
from bisect import bisect_left
from collections.abc import Sequence
from dataclasses import asdict, replace
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from python.backtest.variants import (
    Bar,
    CostModel,
    Economics,
    EntryStyle,
    ExitStyle,
    GeometryKind,
    GeometrySpec,
    SetupInput,
    SetupOutcome,
    VariantMetrics,
    VariantSpec,
    aggregate,
    simulate_setup,
)

DEFAULT_TRAIN_UNTIL = "2026-09-13T00:00:00+00:00"


def _dec(value: object) -> Decimal:
    return Decimal(str(value))


def parse_bars(rows: Sequence[dict[str, Any]]) -> tuple[list[Bar], list[datetime]]:
    bars = [
        Bar(
            start_time=datetime.fromisoformat(str(row["start_time"])),
            open=_dec(row["open"]),
            high=_dec(row["high"]),
            low=_dec(row["low"]),
            close=_dec(row["close"]),
        )
        for row in rows
    ]
    bars.sort(key=lambda bar: bar.start_time)
    return bars, [bar.start_time for bar in bars]


def parse_setups(rows: Sequence[dict[str, Any]]) -> list[SetupInput]:
    return [
        SetupInput(
            context_id=str(row["context_id"]),
            captured_at=datetime.fromisoformat(str(row["captured_at"])),
            buy_stop=_dec(row["buy_stop"]),
            sell_stop=_dec(row["sell_stop"]),
            release=row.get("release"),
        )
        for row in rows
    ]


def weighted(groups: Sequence[dict[str, Any]], key: str) -> Decimal:
    total_weight = sum(int(group["n"]) for group in groups)
    if total_weight == 0:
        raise ValueError("CALIBRATION_EMPTY")
    accumulator = Decimal(0)
    for group in groups:
        value = group.get(key)
        if value is None:
            continue
        accumulator += _dec(value) * Decimal(int(group["n"]))
    return accumulator / Decimal(total_weight)


def default_costs(calibration: Sequence[dict[str, Any]], spread: dict[str, Any]) -> CostModel:
    return CostModel(
        entry_slip=weighted(calibration, "entry_slip_mean"),
        exit_overshoot=weighted(calibration, "exit_overshoot_mean"),
        spread=_dec(spread["mean"]),
    )


def stress_costs(calibration: Sequence[dict[str, Any]], spread: dict[str, Any]) -> CostModel:
    recent = [g for g in calibration if str(g["release"]).endswith((".9", ".10", ".11"))] or list(
        calibration
    )
    return CostModel(
        entry_slip=weighted(recent, "entry_slip_p95"),
        exit_overshoot=weighted(recent, "exit_overshoot_p95"),
        spread=_dec(spread["p95"]),
    )


def default_economics(calibration: Sequence[dict[str, Any]]) -> Economics:
    recent = [g for g in calibration if str(g["release"]).endswith((".10", ".11"))] or list(
        calibration
    )
    return Economics(
        dollars_per_point=weighted(recent, "dollars_per_point_mean"),
        commission_round_trip=weighted(recent, "commission_round_trip_mean"),
    )


def default_variants(tick_size: Decimal) -> list[VariantSpec]:
    variants: list[VariantSpec] = [
        VariantSpec(
            name="v0-replica-double-sl",
            entry=EntryStyle.STOP_BREAKOUT,
            exit=ExitStyle.STOP_MARKET,
            geometry=GeometrySpec(
                GeometryKind.FIXED, fixed_tp=Decimal("0.53"), fixed_sl=Decimal("1.06")
            ),
            tick_size=tick_size,
        ),
        VariantSpec(
            name="v0-replica-balanced",
            entry=EntryStyle.STOP_BREAKOUT,
            exit=ExitStyle.STOP_MARKET,
            geometry=GeometrySpec(
                GeometryKind.FIXED, fixed_tp=Decimal("0.52"), fixed_sl=Decimal("0.52")
            ),
            tick_size=tick_size,
        ),
    ]
    for sl_atr in ("1.5", "2.0", "2.5", "3.0"):
        for tp_atr in ("0.75", "1.0", "1.5", "2.0", "3.0"):
            for expire_bars in (30, 60):
                for breakeven, be_code in ((None, "noBe"), (Decimal("0.5"), "be0.5")):
                    for trend in (0, 30):
                        tr_code = f"tr{trend}" if trend else "trOff"
                        variants.append(
                            VariantSpec(
                                name=(
                                    f"v1-fade-sl{sl_atr}-tp{tp_atr}-e{expire_bars}"
                                    f"-{be_code}-{tr_code}"
                                ),
                                entry=EntryStyle.FADE_LIMIT,
                                exit=ExitStyle.STOP_LIMIT,
                                geometry=GeometrySpec(
                                    GeometryKind.ATR,
                                    sl_atr=Decimal(sl_atr),
                                    tp_atr=Decimal(tp_atr),
                                ),
                                tick_size=tick_size,
                                expire_bars=expire_bars,
                                breakeven_at_tp_fraction=breakeven,
                                trend_filter_bars=trend,
                            )
                        )
    for sl_atr in ("2.0", "2.5", "3.0"):
        for tp_atr in ("1.0", "1.5", "2.0"):
            for trend in (30, 120):
                span_grid = ((30, Decimal("4")), (30, Decimal("6")), (30, Decimal("8")))
                for span_bars, span_atr in span_grid:
                    variants.append(
                        VariantSpec(
                            name=(
                                f"v1r-fade-sl{sl_atr}-tp{tp_atr}-tr{trend}-rg{span_bars}x{span_atr}"
                            ),
                            entry=EntryStyle.FADE_LIMIT,
                            exit=ExitStyle.STOP_LIMIT,
                            geometry=GeometrySpec(
                                GeometryKind.ATR,
                                sl_atr=Decimal(sl_atr),
                                tp_atr=Decimal(tp_atr),
                            ),
                            tick_size=tick_size,
                            trend_filter_bars=trend,
                            range_filter_bars=span_bars,
                            range_filter_max_span_atr=span_atr,
                        )
                    )
    for sl_atr in ("2.5", "3.0"):
        for tp_atr in ("1.0", "1.5", "2.0"):
            for er_bars in (60, 120, 240):
                for max_er in (Decimal("0.25"), Decimal("0.40")):
                    for trend in (0, 30):
                        tr_code = f"tr{trend}" if trend else "trOff"
                        variants.append(
                            VariantSpec(
                                name=(
                                    f"v1e-fade-sl{sl_atr}-tp{tp_atr}-er{er_bars}x{max_er}-{tr_code}"
                                ),
                                entry=EntryStyle.FADE_LIMIT,
                                exit=ExitStyle.STOP_LIMIT,
                                geometry=GeometrySpec(
                                    GeometryKind.ATR,
                                    sl_atr=Decimal(sl_atr),
                                    tp_atr=Decimal(tp_atr),
                                ),
                                tick_size=tick_size,
                                trend_filter_bars=trend,
                                efficiency_ratio_bars=er_bars,
                                max_efficiency_ratio=max_er,
                            )
                        )
    for sl_atr in ("2.0", "3.0"):
        for tp_atr in ("1.5", "3.0"):
            for er_bars in (60, 120):
                for max_er in (Decimal("0.25"), Decimal("0.40")):
                    variants.append(
                        VariantSpec(
                            name=f"v3e-sweep-sl{sl_atr}-tp{tp_atr}-er{er_bars}x{max_er}",
                            entry=EntryStyle.SWEEP_REVERSAL,
                            exit=ExitStyle.STOP_LIMIT,
                            geometry=GeometrySpec(
                                GeometryKind.ATR,
                                sl_atr=Decimal(sl_atr),
                                tp_atr=Decimal(tp_atr),
                            ),
                            tick_size=tick_size,
                            efficiency_ratio_bars=er_bars,
                            max_efficiency_ratio=max_er,
                        )
                    )
    for buffer_ticks in (2, 5):
        for sl_atr in ("1.0", "1.5", "2.0"):
            for tp_ratio in ("1.5", "2.0", "3.0"):
                for exit_style, exit_code in (
                    (ExitStyle.STOP_MARKET, "mkt"),
                    (ExitStyle.STOP_LIMIT, "lim"),
                ):
                    variants.append(
                        VariantSpec(
                            name=f"v2-confirm-b{buffer_ticks}-sl{sl_atr}-rr{tp_ratio}-{exit_code}",
                            entry=EntryStyle.CONFIRMED_STOP,
                            exit=exit_style,
                            geometry=GeometrySpec(
                                GeometryKind.ATR,
                                sl_atr=Decimal(sl_atr),
                                tp_sl_ratio=Decimal(tp_ratio),
                            ),
                            tick_size=tick_size,
                            confirm_buffer_ticks=buffer_ticks,
                        )
                    )
    for pierce_ticks in (2, 5, 10):
        for sl_atr in ("1.5", "2.0", "3.0"):
            for tp_atr in ("1.0", "1.5", "2.0", "3.0"):
                for trend in (0, 30):
                    tr_code = f"tr{trend}" if trend else "trOff"
                    variants.append(
                        VariantSpec(
                            name=(f"v3-sweep-p{pierce_ticks}-sl{sl_atr}-tp{tp_atr}-{tr_code}"),
                            entry=EntryStyle.SWEEP_REVERSAL,
                            exit=ExitStyle.STOP_LIMIT,
                            geometry=GeometrySpec(
                                GeometryKind.ATR,
                                sl_atr=Decimal(sl_atr),
                                tp_atr=Decimal(tp_atr),
                            ),
                            tick_size=tick_size,
                            sweep_pierce_ticks=pierce_ticks,
                            trend_filter_bars=trend,
                        )
                    )
    for sl_atr in ("2.0", "3.0"):
        for tp_atr in ("2.0", "3.0"):
            for trend in (30, 120):
                for span_bars, span_atr in ((30, Decimal("5")), (30, Decimal("8"))):
                    variants.append(
                        VariantSpec(
                            name=(
                                f"v3r-sweep-sl{sl_atr}-tp{tp_atr}-tr{trend}-rg{span_bars}x{span_atr}"
                            ),
                            entry=EntryStyle.SWEEP_REVERSAL,
                            exit=ExitStyle.STOP_LIMIT,
                            geometry=GeometrySpec(
                                GeometryKind.ATR,
                                sl_atr=Decimal(sl_atr),
                                tp_atr=Decimal(tp_atr),
                            ),
                            tick_size=tick_size,
                            trend_filter_bars=trend,
                            range_filter_bars=span_bars,
                            range_filter_max_span_atr=span_atr,
                        )
                    )
    return variants


def _metrics_json(metrics: VariantMetrics) -> dict[str, Any]:
    raw = asdict(metrics)
    out: dict[str, Any] = {}
    for key, value in raw.items():
        if isinstance(value, Decimal):
            out[key] = str(round(value, 4))
        elif isinstance(value, float):
            out[key] = round(value, 4)
        else:
            out[key] = value
    return out


def run_variant(
    spec: VariantSpec,
    setups: Sequence[SetupInput],
    bars: list[Bar],
    times: Sequence[datetime],
    costs: CostModel,
    economics: Economics,
    serial: bool = False,
    streak_losses: int = 0,
    streak_pause_bars: int = 0,
) -> list[SetupOutcome]:
    """Run one variant across setups.

    ``serial`` mirrors the production one-position-at-a-time loop: a setup
    captured while the previous accepted position is still open (or inside a
    loss-streak pause) is skipped without cost instead of being overlapped.
    """
    ordered = sorted(setups, key=lambda item: item.captured_at)
    outcomes: list[SetupOutcome] = []
    busy_until: datetime | None = None
    pause_until: datetime | None = None
    consecutive_losses = 0
    for setup in ordered:
        index0 = bisect_left(times, setup.captured_at)
        if serial and busy_until is not None and setup.captured_at < busy_until:
            outcomes.append(
                SetupOutcome(
                    spec.name,
                    setup.context_id,
                    setup.captured_at,
                    setup.release,
                    "EXPIRED",
                    "SERIAL_BUSY",
                )
            )
            continue
        if pause_until is not None and (index0 >= len(times) or times[index0] < pause_until):
            outcomes.append(
                SetupOutcome(
                    spec.name,
                    setup.context_id,
                    setup.captured_at,
                    setup.release,
                    "EXPIRED",
                    "STREAK_PAUSE",
                )
            )
            continue
        result = simulate_setup(setup, bars, index0, spec, costs, economics)
        outcomes.append(result)
        if result.fill_price is None or result.exit_time is None:
            continue
        if serial:
            busy_until = result.exit_time + timedelta(minutes=1)
        if streak_losses > 0:
            if result.status == "LOSS":
                consecutive_losses += 1
                if consecutive_losses >= streak_losses:
                    pause_until = result.exit_time + timedelta(minutes=streak_pause_bars)
                    consecutive_losses = 0
            else:
                consecutive_losses = 0
    return outcomes


def main() -> None:
    parser = argparse.ArgumentParser(description="Entry-pair variant screening (research-only)")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--train-until", default=DEFAULT_TRAIN_UNTIL)
    parser.add_argument("--min-holdout-filled", type=int, default=30)
    parser.add_argument("--only", default="", help="comma-separated variant names")
    parser.add_argument("--dollars-per-point", default="")
    parser.add_argument("--commission-round-trip", default="")
    parser.add_argument("--serial", action="store_true", help="one-position serial loop")
    parser.add_argument("--streak-losses", type=int, default=0)
    parser.add_argument("--streak-pause-bars", type=int, default=0)
    parser.add_argument("--limit-pierce-ticks", type=int, default=-1)
    parser.add_argument("--commission-multiplier", default="")
    args = parser.parse_args()

    artifact: dict[str, Any] = json.loads(args.input.read_text(encoding="utf-8"))
    if artifact.get("label") != "VARIANT_REPLAY_INPUTS_V1":
        raise ValueError("VARIANT_INPUTS_LABEL_INVALID")
    bars, times = parse_bars(artifact["candles"])
    setups = parse_setups(artifact["setups"])
    calibration = list(artifact["outcome_calibration"])
    spread = dict(artifact["spread_calibration"])
    tick_size = _dec(artifact.get("tick_size", "0.01"))

    costs = default_costs(calibration, spread)
    stressed = stress_costs(calibration, spread)
    economics = default_economics(calibration)
    if args.dollars_per_point:
        economics = Economics(_dec(args.dollars_per_point), economics.commission_round_trip)
    if args.commission_round_trip:
        economics = Economics(economics.dollars_per_point, _dec(args.commission_round_trip))
    if args.commission_multiplier:
        economics = Economics(
            economics.dollars_per_point,
            economics.commission_round_trip * _dec(args.commission_multiplier),
        )

    train_until = datetime.fromisoformat(args.train_until)
    variants = default_variants(tick_size)
    if args.only:
        wanted = {name.strip() for name in args.only.split(",") if name.strip()}
        variants = [variant for variant in variants if variant.name in wanted]
        if not variants:
            raise ValueError("VARIANT_FILTER_EMPTY")
    if args.limit_pierce_ticks >= 0:
        variants = [replace(v, limit_pierce_ticks=args.limit_pierce_ticks) for v in variants]

    reports: list[dict[str, Any]] = []
    for spec in variants:
        outcomes = run_variant(
            spec,
            setups,
            bars,
            times,
            costs,
            economics,
            serial=args.serial,
            streak_losses=args.streak_losses,
            streak_pause_bars=args.streak_pause_bars,
        )
        daily: dict[str, dict[str, Any]] = {}
        for entry_outcome in outcomes:
            day = entry_outcome.captured_at.date().isoformat()
            bucket = daily.setdefault(day, {"n_filled": 0, "total_net_usd": Decimal(0)})
            if entry_outcome.fill_price is not None:
                bucket["n_filled"] = int(bucket["n_filled"]) + 1
                bucket["total_net_usd"] = bucket["total_net_usd"] + entry_outcome.net_usd
        daily_out = {
            day: {
                "n_filled": values["n_filled"],
                "total_net_usd": str(round(Decimal(values["total_net_usd"]), 2)),
            }
            for day, values in sorted(daily.items())
        }
        train = [o for o in outcomes if o.captured_at < train_until]
        holdout = [o for o in outcomes if o.captured_at >= train_until]
        holdout_metrics = aggregate(spec.name, spec, holdout)
        gate_passed = (
            holdout_metrics.n_filled >= args.min_holdout_filled
            and holdout_metrics.avg_net_usd_filled > 0
        )
        reports.append(
            {
                "name": spec.name,
                "entry": str(spec.entry),
                "exit": str(spec.exit),
                "geometry": {
                    "kind": str(spec.geometry.kind),
                    "fixed_tp": str(spec.geometry.fixed_tp) if spec.geometry.fixed_tp else None,
                    "fixed_sl": str(spec.geometry.fixed_sl) if spec.geometry.fixed_sl else None,
                    "tp_atr": str(spec.geometry.tp_atr) if spec.geometry.tp_atr else None,
                    "sl_atr": str(spec.geometry.sl_atr) if spec.geometry.sl_atr else None,
                    "tp_sl_ratio": (
                        str(spec.geometry.tp_sl_ratio) if spec.geometry.tp_sl_ratio else None
                    ),
                },
                "confirm_buffer_ticks": spec.confirm_buffer_ticks,
                "sweep_pierce_ticks": spec.sweep_pierce_ticks,
                "stop_limit_cap_ticks": spec.stop_limit_cap_ticks,
                "stop_limit_escalation_bars": spec.stop_limit_escalation_bars,
                "expire_bars": spec.expire_bars,
                "breakeven_at_tp_fraction": (
                    str(spec.breakeven_at_tp_fraction)
                    if spec.breakeven_at_tp_fraction is not None
                    else None
                ),
                "trend_filter_bars": spec.trend_filter_bars,
                "range_filter_bars": spec.range_filter_bars,
                "range_filter_max_span_atr": (
                    str(spec.range_filter_max_span_atr)
                    if spec.range_filter_max_span_atr is not None
                    else None
                ),
                "efficiency_ratio_bars": spec.efficiency_ratio_bars,
                "max_efficiency_ratio": (
                    str(spec.max_efficiency_ratio) if spec.max_efficiency_ratio else None
                ),
                "daily": daily_out,
                "train": _metrics_json(aggregate(spec.name, spec, train)),
                "holdout": _metrics_json(holdout_metrics),
                "gate": {
                    "passed": gate_passed,
                    "min_holdout_filled": args.min_holdout_filled,
                    "holdout_filled": holdout_metrics.n_filled,
                },
            }
        )

    ranking = sorted(
        reports,
        key=lambda report: Decimal(str(report["holdout"]["avg_net_usd_filled"])),
        reverse=True,
    )
    top_names = [report["name"] for report in ranking[:3]]
    stress_reports = []
    for name in top_names:
        spec = next(variant for variant in variants if variant.name == name)
        outcomes = run_variant(
            spec,
            setups,
            bars,
            times,
            stressed,
            economics,
            serial=args.serial,
            streak_losses=args.streak_losses,
            streak_pause_bars=args.streak_pause_bars,
        )
        holdout = [o for o in outcomes if o.captured_at >= train_until]
        stress_reports.append(
            {"name": name, "holdout_stress": _metrics_json(aggregate(name, spec, holdout))}
        )

    report = {
        "label": "VARIANT_SCREEN_V1",
        "generated_at": datetime.now(tz=None).astimezone().isoformat(),
        "input": str(args.input),
        "costs": {
            "base": {k: str(v) for k, v in asdict(costs).items()},
            "stress": {k: str(v) for k, v in asdict(stressed).items()},
        },
        "economics": {k: str(v) for k, v in asdict(economics).items()},
        "overrides": {
            "limit_pierce_ticks": args.limit_pierce_ticks,
            "commission_multiplier": args.commission_multiplier or None,
        },
        "splits": {
            "serial": args.serial,
            "streak_losses": args.streak_losses,
            "streak_pause_bars": args.streak_pause_bars,
            "train_until": args.train_until,
            "train_setups": sum(1 for s in setups if s.captured_at < train_until),
            "holdout_setups": sum(1 for s in setups if s.captured_at >= train_until),
        },
        "measured_reference": [
            {
                "release": group["release"],
                "n": group["n"],
                "avg_net_usd": group.get("avg_net_usd_mean"),
                "winners": group.get("winners"),
                "losers": group.get("losers"),
            }
            for group in calibration
        ],
        "variants": ranking,
        "top3_stress": stress_reports,
        "gate_passing": [r["name"] for r in ranking if r["gate"]["passed"]],
        "notes": [
            "Research-only screen on journaled levels; conservative intrabar and",
            "limit-fill assumptions; no profitability claim.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    summary = {
        "label": "VARIANT_SCREEN_DONE",
        "variants": len(reports),
        "gate_passing": report["gate_passing"],
        "top3": [
            {
                "name": r["name"],
                "holdout_ev_filled": r["holdout"]["avg_net_usd_filled"],
                "holdout_wr": r["holdout"]["win_rate_filled"],
            }
            for r in ranking[:3]
        ],
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
