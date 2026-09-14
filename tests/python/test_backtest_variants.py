from datetime import UTC, datetime, timedelta
from decimal import Decimal

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
    VariantSpec,
    aggregate,
    find_index,
    simulate_setup,
)

T0 = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
COSTS = CostModel(
    entry_slip=Decimal("0.10"), exit_overshoot=Decimal("0.20"), spread=Decimal("0.05")
)
ECONOMICS = Economics(dollars_per_point=Decimal("1000"), commission_round_trip=Decimal("5"))


def bar(offset: int, open_: str, high: str, low: str, close: str) -> Bar:
    start = T0 + timedelta(minutes=offset)
    return Bar(
        start_time=start,
        open=Decimal(open_),
        high=Decimal(high),
        low=Decimal(low),
        close=Decimal(close),
    )


def prior_bars(count: int, span: str = "0.50") -> list[Bar]:
    bars: list[Bar] = []
    for index in range(count):
        start = -(count - index)
        base = Decimal("100")
        bars.append(
            Bar(
                start_time=T0 + timedelta(minutes=start),
                open=base,
                high=base + Decimal(span),
                low=base,
                close=base,
            )
        )
    return bars


def setup(buy: str = "102", sell: str = "100") -> SetupInput:
    return SetupInput(
        context_id="ctx-1",
        captured_at=T0,
        buy_stop=Decimal(buy),
        sell_stop=Decimal(sell),
    )


def spec(
    entry: EntryStyle,
    exit_style: ExitStyle,
    geometry: GeometrySpec,
    **overrides: object,
) -> VariantSpec:
    return VariantSpec(name="test", entry=entry, exit=exit_style, geometry=geometry, **overrides)  # type: ignore[arg-type]


FIXED_1_TO_2 = GeometrySpec(GeometryKind.FIXED, fixed_tp=Decimal("0.5"), fixed_sl=Decimal("1.0"))


def test_fade_limit_fills_on_pierce_and_wins_at_target() -> None:
    variant = spec(EntryStyle.FADE_LIMIT, ExitStyle.STOP_MARKET, FIXED_1_TO_2)
    bars = [
        bar(0, "100.10", "100.20", "99.96", "100.00"),
        bar(1, "100.00", "100.60", "99.98", "100.55"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "WIN"
    assert result.side == "BUY"
    assert result.fill_price == Decimal("100")
    assert result.exit_price == Decimal("100.5")
    assert result.reason == "TARGET_EXIT"
    assert result.pnl_price == Decimal("0.5")
    assert result.net_usd == Decimal("495")


def test_fade_limit_requires_pierce_not_touch() -> None:
    variant = spec(EntryStyle.FADE_LIMIT, ExitStyle.STOP_MARKET, FIXED_1_TO_2, expire_bars=1)
    bars = [bar(0, "100.10", "100.20", "100.00", "100.05")]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "EXPIRED"
    assert result.reason == "NO_FILL_BEFORE_HORIZON"
    assert result.net_usd == Decimal("0")


def test_fade_sell_side_fills_at_resistance() -> None:
    variant = spec(EntryStyle.FADE_LIMIT, ExitStyle.STOP_MARKET, FIXED_1_TO_2, expire_bars=4)
    bars = [
        bar(0, "101.00", "101.50", "100.80", "101.20"),
        bar(1, "101.20", "102.05", "101.10", "101.90"),
        bar(2, "101.90", "101.95", "101.40", "101.45"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "WIN"
    assert result.side == "SELL"
    assert result.fill_price == Decimal("102")
    assert result.exit_price == Decimal("101.5")


def test_stop_breakout_same_bar_ambiguity_uses_stop_with_overshoot() -> None:
    variant = spec(EntryStyle.STOP_BREAKOUT, ExitStyle.STOP_MARKET, FIXED_1_TO_2)
    bars = [bar(0, "101.90", "103.00", "100.90", "101.00")]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "LOSS"
    assert result.side == "BUY"
    assert result.fill_price == Decimal("102.10")
    assert result.exit_price == Decimal("100.90")
    assert result.reason == "STOP_MARKET_EXIT"
    assert result.pnl_price == Decimal("-1.20")


def test_stop_exit_gaps_beyond_stop_fill_at_open() -> None:
    variant = spec(EntryStyle.STOP_BREAKOUT, ExitStyle.STOP_MARKET, FIXED_1_TO_2)
    bars = [
        bar(0, "101.90", "102.50", "101.95", "102.45"),
        bar(1, "100.50", "100.80", "100.40", "100.60"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "LOSS"
    assert result.exit_price == Decimal("100.30")


def test_stop_limit_exit_fills_at_capped_limit() -> None:
    variant = spec(
        EntryStyle.STOP_BREAKOUT,
        ExitStyle.STOP_LIMIT,
        FIXED_1_TO_2,
        stop_limit_cap_ticks=30,
    )
    bars = [
        bar(0, "101.90", "102.40", "101.95", "102.10"),
        bar(1, "101.50", "101.60", "100.75", "100.90"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "LOSS"
    assert result.reason == "STOP_LIMIT_EXIT"
    assert result.exit_price == Decimal("100.80")


def test_stop_limit_gap_beyond_cap_recovers_to_limit_fill() -> None:
    variant = spec(
        EntryStyle.STOP_BREAKOUT,
        ExitStyle.STOP_LIMIT,
        FIXED_1_TO_2,
        stop_limit_cap_ticks=30,
        stop_limit_escalation_bars=5,
    )
    bars = [
        bar(0, "101.90", "102.40", "101.95", "102.10"),
        bar(1, "100.60", "100.95", "100.40", "100.90"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "LOSS"
    assert result.reason == "STOP_LIMIT_RECOVERY_FILL"
    assert result.exit_price == Decimal("100.80")


def test_stop_limit_unfilled_gap_escalates_at_close() -> None:
    variant = spec(
        EntryStyle.STOP_BREAKOUT,
        ExitStyle.STOP_LIMIT,
        FIXED_1_TO_2,
        stop_limit_cap_ticks=30,
        stop_limit_escalation_bars=2,
    )
    bars = [
        bar(0, "101.90", "102.40", "101.95", "102.10"),
        bar(1, "100.60", "100.75", "100.40", "100.50"),
        bar(2, "100.50", "100.70", "100.30", "100.55"),
        bar(3, "100.55", "100.60", "100.20", "100.25"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "LOSS"
    assert result.reason == "STOP_LIMIT_ESCALATED_CLOSE"
    assert result.exit_price == Decimal("100.25")


def test_confirmed_stop_enters_next_open_after_close_beyond_buffer() -> None:
    variant = spec(
        EntryStyle.CONFIRMED_STOP,
        ExitStyle.STOP_MARKET,
        FIXED_1_TO_2,
        confirm_buffer_ticks=2,
    )
    bars = [
        bar(0, "101.00", "102.10", "100.90", "102.05"),
        bar(1, "102.20", "102.60", "102.00", "102.50"),
        bar(2, "102.50", "102.90", "102.40", "102.85"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "WIN"
    assert result.side == "BUY"
    assert result.fill_price == Decimal("102.30")
    assert result.exit_price == Decimal("102.80")


def test_atr_geometry_scales_distances_from_prior_bars() -> None:
    geometry = GeometrySpec(
        GeometryKind.ATR, sl_atr=Decimal("1.5"), tp_atr=Decimal("1.0"), atr_bars=2
    )
    variant = spec(EntryStyle.FADE_LIMIT, ExitStyle.STOP_MARKET, geometry)
    bars = [
        *prior_bars(2, span="0.50"),
        bar(0, "100.10", "100.20", "99.96", "100.00"),
        bar(1, "100.00", "100.55", "99.98", "100.50"),
    ]
    result = simulate_setup(setup(), bars, 2, variant, COSTS, ECONOMICS)
    assert result.atr == Decimal("0.50")
    assert result.status == "WIN"
    assert result.exit_price == Decimal("100.50")


def test_no_atr_without_sufficient_prior_bars() -> None:
    geometry = GeometrySpec(
        GeometryKind.ATR, sl_atr=Decimal("1.5"), tp_atr=Decimal("1.0"), atr_bars=2
    )
    variant = spec(EntryStyle.FADE_LIMIT, ExitStyle.STOP_MARKET, geometry)
    bars = [*prior_bars(1, span="0.50"), bar(0, "100.10", "100.20", "99.96", "100.00")]
    result = simulate_setup(setup(), bars, 1, variant, COSTS, ECONOMICS)
    assert result.status == "NO_ATR"


def test_same_bar_dual_trigger_picks_losing_leg() -> None:
    variant = spec(EntryStyle.FADE_LIMIT, ExitStyle.STOP_MARKET, FIXED_1_TO_2, expire_bars=2)
    bars = [bar(0, "101.00", "103.20", "99.50", "101.00")]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.side == "SELL"
    assert result.status == "LOSS"


def test_expired_when_no_trigger_within_horizon() -> None:
    variant = spec(EntryStyle.STOP_BREAKOUT, ExitStyle.STOP_MARKET, FIXED_1_TO_2, expire_bars=2)
    bars = [
        bar(0, "100.50", "101.00", "100.40", "100.60"),
        bar(1, "100.60", "101.10", "100.50", "100.70"),
        bar(2, "100.70", "103.00", "100.60", "102.80"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "EXPIRED"


def test_no_data_without_forward_bars() -> None:
    variant = spec(EntryStyle.STOP_BREAKOUT, ExitStyle.STOP_MARKET, FIXED_1_TO_2)
    bars = prior_bars(14)
    result = simulate_setup(setup(), bars, 14, variant, COSTS, ECONOMICS)
    assert result.status == "NO_DATA"


def test_open_position_marks_at_window_end() -> None:
    variant = spec(EntryStyle.STOP_BREAKOUT, ExitStyle.STOP_MARKET, FIXED_1_TO_2)
    bars = [
        bar(0, "101.90", "102.20", "101.95", "102.15"),
        bar(1, "102.15", "102.40", "101.60", "102.30"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "OPEN"
    assert result.reason == "OPEN_AT_WINDOW_END"
    assert result.exit_price == Decimal("102.30")


def test_aggregate_computes_ev_profit_factor_and_reasons() -> None:
    variant = spec(EntryStyle.FADE_LIMIT, ExitStyle.STOP_MARKET, FIXED_1_TO_2)
    outcomes = [
        SetupOutcome(
            "test",
            "a",
            T0,
            None,
            "WIN",
            "TARGET_EXIT",
            side="BUY",
            fill_price=Decimal("100"),
            exit_price=Decimal("100.5"),
            pnl_price=Decimal("0.5"),
            net_usd=Decimal("495"),
        ),
        SetupOutcome(
            "test",
            "b",
            T0,
            None,
            "WIN",
            "TARGET_EXIT",
            side="BUY",
            fill_price=Decimal("100"),
            exit_price=Decimal("100.2"),
            pnl_price=Decimal("0.2"),
            net_usd=Decimal("200"),
        ),
        SetupOutcome(
            "test",
            "c",
            T0,
            None,
            "LOSS",
            "STOP_MARKET_EXIT",
            side="BUY",
            fill_price=Decimal("100"),
            exit_price=Decimal("99"),
            pnl_price=Decimal("-1"),
            net_usd=Decimal("-1000"),
        ),
        SetupOutcome("test", "d", T0, None, "EXPIRED", "NO_FILL_BEFORE_HORIZON"),
    ]
    metrics = aggregate("test", variant, outcomes)
    assert metrics.n_setups == 4
    assert metrics.n_filled == 3
    assert metrics.wins == 2
    assert metrics.win_rate_filled == 2 / 3
    assert metrics.avg_net_usd_filled == Decimal("-305") / Decimal("3")
    assert metrics.profit_factor == Decimal("0.695")
    assert metrics.reason_counts["TARGET_EXIT"] == 2
    assert metrics.reason_counts["NO_FILL_BEFORE_HORIZON"] == 1


def test_find_index_locates_first_bar_at_or_after_capture() -> None:
    bars = [bar(0, "1", "1", "1", "1"), bar(1, "1", "1", "1", "1")]
    assert find_index(bars, T0) == 0
    assert find_index(bars, T0 + timedelta(seconds=30)) == 1
    assert find_index(bars, T0 + timedelta(minutes=5)) == 2


def test_sweep_reversal_enters_after_pierce_and_reclaim() -> None:
    variant = spec(
        EntryStyle.SWEEP_REVERSAL,
        ExitStyle.STOP_MARKET,
        GeometrySpec(GeometryKind.FIXED, fixed_tp=Decimal("0.5"), fixed_sl=Decimal("1.0")),
        sweep_pierce_ticks=2,
    )
    bars = [
        bar(0, "100.40", "100.45", "99.70", "100.05"),
        bar(1, "100.10", "100.75", "100.00", "100.60"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "WIN"
    assert result.side == "BUY"
    assert result.fill_price == Decimal("100.20")
    assert result.exit_price == Decimal("100.70")


def test_sweep_without_reclaim_does_not_enter() -> None:
    variant = spec(
        EntryStyle.SWEEP_REVERSAL,
        ExitStyle.STOP_MARKET,
        GeometrySpec(GeometryKind.FIXED, fixed_tp=Decimal("0.5"), fixed_sl=Decimal("1.0")),
        sweep_pierce_ticks=2,
        expire_bars=2,
    )
    bars = [
        bar(0, "100.40", "100.45", "99.70", "99.90"),
        bar(1, "99.90", "100.80", "99.85", "100.70"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "EXPIRED"


def test_trend_filter_blocks_counter_trend_leg() -> None:
    variant = spec(
        EntryStyle.FADE_LIMIT,
        ExitStyle.STOP_MARKET,
        FIXED_1_TO_2,
        trend_filter_bars=2,
    )
    falling = [
        bar(-3, "100.60", "100.70", "100.40", "100.50"),
        bar(-2, "100.40", "100.50", "100.20", "100.30"),
        bar(-1, "100.30", "100.35", "100.10", "100.20"),
    ]
    window = [bar(0, "100.10", "100.20", "99.96", "100.00")]
    result = simulate_setup(setup(), [*falling, *window], 3, variant, COSTS, ECONOMICS)
    assert result.status == "EXPIRED"
    rising = [
        bar(-3, "100.10", "100.20", "100.00", "100.15"),
        bar(-2, "100.15", "100.30", "100.05", "100.25"),
        bar(-1, "100.25", "100.40", "100.15", "100.35"),
    ]
    result = simulate_setup(
        setup(),
        [*rising, *window, bar(1, "100.00", "100.60", "99.98", "100.55")],
        3,
        variant,
        COSTS,
        ECONOMICS,
    )
    assert result.status == "WIN"
    assert result.side == "BUY"


def test_breakeven_stop_activates_after_partial_move() -> None:
    variant = spec(
        EntryStyle.FADE_LIMIT,
        ExitStyle.STOP_MARKET,
        GeometrySpec(GeometryKind.FIXED, fixed_tp=Decimal("1.0"), fixed_sl=Decimal("1.0")),
        breakeven_at_tp_fraction=Decimal("0.5"),
    )
    bars = [
        bar(0, "100.10", "100.20", "99.96", "100.05"),
        bar(1, "100.05", "100.55", "100.00", "100.50"),
        bar(2, "100.10", "100.15", "99.95", "100.00"),
    ]
    result = simulate_setup(setup(), bars, 0, variant, COSTS, ECONOMICS)
    assert result.status == "LOSS"
    assert result.fill_price == Decimal("100")
    assert result.exit_price == Decimal("99.80")
    assert result.reason == "STOP_MARKET_EXIT"


def test_range_filter_skips_wide_prior_span_and_allows_chop() -> None:
    geometry = GeometrySpec(
        GeometryKind.ATR, sl_atr=Decimal("1.5"), tp_atr=Decimal("0.5"), atr_bars=14
    )
    variant = spec(
        EntryStyle.FADE_LIMIT,
        ExitStyle.STOP_MARKET,
        geometry,
        range_filter_bars=30,
        range_filter_max_span_atr=Decimal("8"),
    )
    window = [
        bar(0, "100.10", "100.20", "99.96", "100.00"),
        bar(1, "100.00", "100.60", "99.98", "100.55"),
    ]
    wide_prior = []
    for index in range(30):
        base = Decimal("100") + Decimal(index) * Decimal("0.40")
        wide_prior.append(
            Bar(
                start_time=T0 - timedelta(minutes=30 - index),
                open=base,
                high=base + Decimal("0.50"),
                low=base,
                close=base + Decimal("0.20"),
            )
        )
    result = simulate_setup(setup(), [*wide_prior, *window], 30, variant, COSTS, ECONOMICS)
    assert result.status == "NO_RANGE_DATA"
    assert result.reason == "RANGE_FILTER_SPAN_TOO_WIDE"
    narrow_prior = []
    for index in range(30):
        narrow_prior.append(
            Bar(
                start_time=T0 - timedelta(minutes=30 - index),
                open=Decimal("100"),
                high=Decimal("100.25"),
                low=Decimal("99.75"),
                close=Decimal("100"),
            )
        )
    result = simulate_setup(setup(), [*narrow_prior, *window], 30, variant, COSTS, ECONOMICS)
    assert result.status == "WIN"
    assert result.side == "BUY"


def test_efficiency_ratio_gate_blocks_trending_regime() -> None:
    geometry = GeometrySpec(
        GeometryKind.ATR, sl_atr=Decimal("1.5"), tp_atr=Decimal("0.5"), atr_bars=14
    )
    variant = spec(
        EntryStyle.FADE_LIMIT,
        ExitStyle.STOP_MARKET,
        geometry,
        efficiency_ratio_bars=10,
        max_efficiency_ratio=Decimal("0.4"),
    )
    window = [
        bar(0, "100.10", "100.20", "99.96", "100.00"),
        bar(1, "100.00", "100.60", "99.98", "100.55"),
    ]
    trending = []
    for index in range(30):
        base = Decimal("100") + Decimal(index) * Decimal("0.40")
        trending.append(
            Bar(
                start_time=T0 - timedelta(minutes=30 - index),
                open=base,
                high=base + Decimal("0.50"),
                low=base,
                close=base + Decimal("0.45"),
            )
        )
    result = simulate_setup(setup(), [*trending, *window], 30, variant, COSTS, ECONOMICS)
    assert result.status == "NO_REGIME_DATA"
    assert result.reason == "EFFICIENCY_RATIO_TOO_HIGH"
    choppy = []
    for index in range(30):
        base = Decimal("100") if index % 2 == 0 else Decimal("99.90")
        choppy.append(
            Bar(
                start_time=T0 - timedelta(minutes=30 - index),
                open=base,
                high=base + Decimal("0.25"),
                low=base - Decimal("0.25"),
                close=Decimal("100") if index % 2 == 0 else Decimal("99.90"),
            )
        )
    result = simulate_setup(setup(), [*choppy, *window], 30, variant, COSTS, ECONOMICS)
    assert result.status == "WIN"


def test_serial_run_skips_overlapping_setups_and_pauses_on_loss_streak() -> None:
    from python.backtest.screen import run_variant

    geometry = GeometrySpec(GeometryKind.FIXED, fixed_tp=Decimal("0.5"), fixed_sl=Decimal("1.0"))
    variant = spec(EntryStyle.FADE_LIMIT, ExitStyle.STOP_MARKET, geometry)
    bars = [
        bar(0, "100.10", "100.20", "99.96", "100.00"),
        bar(1, "100.00", "99.98", "98.90", "99.00"),
        bar(2, "99.00", "99.20", "98.80", "99.10"),
        bar(3, "99.10", "99.30", "99.00", "99.20"),
    ]
    setups = [
        SetupInput("a", T0, Decimal("102"), Decimal("100")),
        SetupInput("b", T0 + timedelta(seconds=30), Decimal("102"), Decimal("100")),
    ]
    results = run_variant(
        variant,
        setups,
        bars,
        [b.start_time for b in bars],
        COSTS,
        ECONOMICS,
        serial=True,
        streak_losses=1,
        streak_pause_bars=5,
    )
    assert results[0].status == "LOSS"
    assert results[0].exit_time is not None
    assert results[1].status == "EXPIRED"
    assert results[1].reason in {"SERIAL_BUSY", "STREAK_PAUSE"}
