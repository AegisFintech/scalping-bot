"""Strategy-variant screening simulator over journaled entry-pair setups.

Replays identical recorded provider levels through alternative direction,
geometry and execution models calibrated from measured demo fills. All prices
and money use Decimal arithmetic. Intrabar races are resolved conservatively:
the stop loss wins every unresolved same-bar ambiguity, limit fills require a
one-tick pierce, and stop exits pay the measured adverse overshoot.

This module is research-only. It has no broker authority and produces no
profitability claim by itself; promotion requires the documented gates.
"""

from __future__ import annotations

from bisect import bisect_left
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Literal


class EntryStyle(StrEnum):
    STOP_BREAKOUT = "STOP_BREAKOUT"
    FADE_LIMIT = "FADE_LIMIT"
    CONFIRMED_STOP = "CONFIRMED_STOP"
    SWEEP_REVERSAL = "SWEEP_REVERSAL"


class ExitStyle(StrEnum):
    STOP_MARKET = "STOP_MARKET"
    STOP_LIMIT = "STOP_LIMIT"


class GeometryKind(StrEnum):
    FIXED = "FIXED"
    ATR = "ATR"


@dataclass(frozen=True)
class Bar:
    start_time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal


@dataclass(frozen=True)
class CostModel:
    entry_slip: Decimal
    exit_overshoot: Decimal
    spread: Decimal

    def __post_init__(self) -> None:
        for value in (self.entry_slip, self.exit_overshoot, self.spread):
            if value < 0:
                raise ValueError("costs must not be negative")


@dataclass(frozen=True)
class Economics:
    dollars_per_point: Decimal
    commission_round_trip: Decimal

    def __post_init__(self) -> None:
        if self.dollars_per_point <= 0 or self.commission_round_trip < 0:
            raise ValueError("economics must be positive/consistent")


@dataclass(frozen=True)
class GeometrySpec:
    kind: GeometryKind
    fixed_tp: Decimal | None = None
    fixed_sl: Decimal | None = None
    tp_atr: Decimal | None = None
    sl_atr: Decimal | None = None
    tp_sl_ratio: Decimal | None = None
    atr_bars: int = 14

    def __post_init__(self) -> None:
        if self.kind is GeometryKind.FIXED and (self.fixed_tp is None or self.fixed_sl is None):
            raise ValueError("fixed geometry requires fixed_tp and fixed_sl")
        if self.kind is GeometryKind.ATR:
            if self.sl_atr is None or self.sl_atr <= 0:
                raise ValueError("atr geometry requires positive sl_atr")
            if self.tp_atr is None and self.tp_sl_ratio is None:
                raise ValueError("atr geometry requires tp_atr or tp_sl_ratio")
        if self.atr_bars < 1:
            raise ValueError("atr_bars must be positive")

    def distances(self, atr: Decimal) -> tuple[Decimal, Decimal]:
        if self.kind is GeometryKind.FIXED:
            assert self.fixed_tp is not None and self.fixed_sl is not None
            return self.fixed_tp, self.fixed_sl
        assert self.sl_atr is not None
        sl_distance = self.sl_atr * atr
        if self.tp_atr is not None:
            return self.tp_atr * atr, sl_distance
        assert self.tp_sl_ratio is not None
        return self.tp_sl_ratio * sl_distance, sl_distance


@dataclass(frozen=True)
class VariantSpec:
    name: str
    entry: EntryStyle
    exit: ExitStyle
    geometry: GeometrySpec
    tick_size: Decimal = Decimal("0.01")
    confirm_buffer_ticks: int = 0
    sweep_pierce_ticks: int = 2
    stop_limit_cap_ticks: int = 30
    stop_limit_escalation_bars: int = 3
    limit_pierce_ticks: int = 1
    expire_bars: int = 30
    window_bars: int = 90
    breakeven_at_tp_fraction: Decimal | None = None
    trend_filter_bars: int = 0
    range_filter_bars: int = 0
    range_filter_max_span_atr: Decimal | None = None
    efficiency_ratio_bars: int = 60
    max_efficiency_ratio: Decimal | None = None

    def __post_init__(self) -> None:
        if self.tick_size <= 0:
            raise ValueError("tick size must be positive")
        if min(self.confirm_buffer_ticks, self.stop_limit_cap_ticks, self.expire_bars) < 0:
            raise ValueError("variant parameters must not be negative")
        if self.limit_pierce_ticks < 0 or self.window_bars < 1:
            raise ValueError("variant parameters must not be negative")
        if self.stop_limit_escalation_bars < 0:
            raise ValueError("stop_limit_escalation_bars must not be negative")
        if self.sweep_pierce_ticks < 1:
            raise ValueError("sweep_pierce_ticks must be positive")
        if self.trend_filter_bars < 0 or self.range_filter_bars < 0:
            raise ValueError("trend_filter_bars must not be negative")
        if self.breakeven_at_tp_fraction is not None and self.breakeven_at_tp_fraction <= 0:
            raise ValueError("breakeven fraction must be positive")
        if (self.range_filter_max_span_atr is None) != (self.range_filter_bars == 0):
            raise ValueError("range filter requires bars and span threshold together")
        if self.range_filter_max_span_atr is not None and self.range_filter_max_span_atr <= 0:
            raise ValueError("range filter span threshold must be positive")
        if self.efficiency_ratio_bars < 1:
            raise ValueError("efficiency_ratio_bars must be positive")
        if self.max_efficiency_ratio is not None and not (
            Decimal(0) < self.max_efficiency_ratio <= Decimal(1)
        ):
            raise ValueError("max_efficiency_ratio must be within (0, 1]")


@dataclass(frozen=True)
class SetupInput:
    context_id: str
    captured_at: datetime
    buy_stop: Decimal
    sell_stop: Decimal
    release: str | None = None


Status = Literal[
    "WIN",
    "LOSS",
    "EXPIRED",
    "OPEN",
    "NO_DATA",
    "NO_ATR",
    "NO_TREND_DATA",
    "NO_RANGE_DATA",
    "NO_REGIME_DATA",
]
Side = Literal["BUY", "SELL"]


@dataclass(frozen=True)
class SetupOutcome:
    variant: str
    context_id: str
    captured_at: datetime
    release: str | None
    status: Status
    reason: str
    side: Side | None = None
    fill_price: Decimal | None = None
    exit_price: Decimal | None = None
    exit_time: datetime | None = None
    hold_bars: int | None = None
    atr: Decimal | None = None
    pnl_price: Decimal = Decimal(0)
    net_usd: Decimal = Decimal(0)


@dataclass(frozen=True)
class VariantMetrics:
    name: str
    entry: str
    exit: str
    n_setups: int
    n_filled: int
    fill_rate: float
    wins: int
    losses: int
    win_rate_filled: float
    avg_net_usd_setup: Decimal
    avg_net_usd_filled: Decimal
    total_net_usd: Decimal
    profit_factor: Decimal | None
    avg_win_price: Decimal | None
    avg_loss_price: Decimal | None
    realized_rr: Decimal | None
    tail_p5_net_usd: Decimal | None
    avg_hold_bars: float | None
    reason_counts: dict[str, int] = field(default_factory=dict)


def _atr(prior: list[Bar], required: int) -> Decimal | None:
    if len(prior) < required:
        return None
    window = prior[-required:]
    total = sum((bar.high - bar.low for bar in window), Decimal(0))
    return total / Decimal(len(window))


def _signed_move(side: str, fill: Decimal, exit_price: Decimal) -> Decimal:
    return exit_price - fill if side == "BUY" else fill - exit_price


@dataclass(frozen=True)
class StopExitResult:
    state: Literal["FILLED", "TRIGGERED_UNFILLED", "NOT_TRIGGERED"]
    price: Decimal | None = None
    reason: str = ""


def _stop_exit_price(
    side: str,
    stop_price: Decimal,
    bar: Bar,
    costs: CostModel,
    style: ExitStyle,
    cap: Decimal,
) -> StopExitResult:
    """Resolve a stop exit against one bar of the post-entry path."""
    if side == "BUY":
        triggered = bar.low <= stop_price or bar.open <= stop_price
    else:
        triggered = bar.high >= stop_price or bar.open >= stop_price
    if not triggered:
        return StopExitResult("NOT_TRIGGERED")
    if style is ExitStyle.STOP_MARKET:
        gapped = bar.open <= stop_price if side == "BUY" else bar.open >= stop_price
        base = bar.open if gapped else stop_price
        overshoot = costs.exit_overshoot
        price = base - overshoot if side == "BUY" else base + overshoot
        return StopExitResult("FILLED", price, "STOP_MARKET_EXIT")
    # STOP_LIMIT: after the stop triggers, a capped limit rests in the market.
    # A gap beyond the limit stays unfilled until price trades back through it;
    # that non-fill risk is modeled honestly instead of assuming a fill.
    limit_price = stop_price - cap if side == "BUY" else stop_price + cap
    if side == "BUY":
        if bar.open < limit_price:
            if bar.high >= limit_price:
                return StopExitResult("FILLED", limit_price, "STOP_LIMIT_RECOVERY_FILL")
            return StopExitResult("TRIGGERED_UNFILLED", reason="STOP_LIMIT_GAP_BEYOND_CAP")
        if bar.low <= limit_price:
            return StopExitResult("FILLED", limit_price, "STOP_LIMIT_EXIT")
        return StopExitResult("TRIGGERED_UNFILLED", reason="STOP_LIMIT_ARMED")
    if bar.open > limit_price:
        if bar.low <= limit_price:
            return StopExitResult("FILLED", limit_price, "STOP_LIMIT_RECOVERY_FILL")
        return StopExitResult("TRIGGERED_UNFILLED", reason="STOP_LIMIT_GAP_BEYOND_CAP")
    if bar.high >= limit_price:
        return StopExitResult("FILLED", limit_price, "STOP_LIMIT_EXIT")
    return StopExitResult("TRIGGERED_UNFILLED", reason="STOP_LIMIT_ARMED")


def _target_exit(side: str, target: Decimal, bar: Bar) -> bool:
    return bar.high >= target if side == "BUY" else bar.low <= target


def _resolve_exit(
    side: str,
    fill_price: Decimal,
    tp_distance: Decimal,
    sl_distance: Decimal,
    bars: list[Bar],
    entry_index: int,
    spec: VariantSpec,
    costs: CostModel,
) -> tuple[Status, Decimal, int, str]:
    stop_price = fill_price - sl_distance if side == "BUY" else fill_price + sl_distance
    target_price = fill_price + tp_distance if side == "BUY" else fill_price - tp_distance
    cap = spec.stop_limit_cap_ticks * spec.tick_size
    armed_offset: int | None = None
    be_trigger: Decimal | None = None
    if spec.breakeven_at_tp_fraction is not None:
        be_distance = spec.breakeven_at_tp_fraction * tp_distance
        be_trigger = fill_price + be_distance if side == "BUY" else fill_price - be_distance
    path = bars[entry_index:]
    for offset, bar in enumerate(path):
        stop_result = _stop_exit_price(side, stop_price, bar, costs, spec.exit, cap)
        # Conservative intrabar race: the stop wins every unresolved ambiguity.
        if stop_result.state == "FILLED" and stop_result.price is not None:
            move = _signed_move(side, fill_price, stop_result.price)
            status: Status = "WIN" if move > 0 else "LOSS"
            return status, stop_result.price, entry_index + offset, stop_result.reason
        if stop_result.state == "TRIGGERED_UNFILLED":
            if armed_offset is None:
                armed_offset = offset
            if (
                spec.stop_limit_escalation_bars > 0
                and offset >= armed_offset + spec.stop_limit_escalation_bars
            ):
                # Bounded escalation proxy for the protective-close path: never
                # leave a simulated position unprotected past the window.
                move = _signed_move(side, fill_price, bar.close)
                return (
                    "WIN" if move > 0 else "LOSS",
                    bar.close,
                    entry_index + offset,
                    "STOP_LIMIT_ESCALATED_CLOSE",
                )
            continue
        # Once the stop child is armed the OCO target no longer races.
        if armed_offset is not None:
            continue
        if be_trigger is not None and offset > 0:
            touched = bar.high >= be_trigger if side == "BUY" else bar.low <= be_trigger
            if touched:
                stop_price = fill_price
                be_trigger = None
        if _target_exit(side, target_price, bar):
            move = _signed_move(side, fill_price, target_price)
            return (
                "WIN" if move > 0 else "LOSS",
                target_price,
                entry_index + offset,
                "TARGET_EXIT",
            )
    last = bars[-1]
    move = _signed_move(side, fill_price, last.close)
    reason = "STOP_LIMIT_ESCALATED_CLOSE" if armed_offset is not None else "OPEN_AT_WINDOW_END"
    return "OPEN", last.close, len(bars) - 1, reason


LegPair = tuple[tuple[Side, Decimal], tuple[Side, Decimal]]


def _legs_for(spec: VariantSpec, setup: SetupInput) -> LegPair:
    """Return ((buy-side leg, level), (sell-side leg, level)) per variant style."""
    if spec.entry in (EntryStyle.FADE_LIMIT, EntryStyle.SWEEP_REVERSAL):
        return (("BUY", setup.sell_stop), ("SELL", setup.buy_stop))
    return (("BUY", setup.buy_stop), ("SELL", setup.sell_stop))


def _triggered(spec: VariantSpec, side: Side, level: Decimal, bar: Bar) -> bool:
    pierce = spec.limit_pierce_ticks * spec.tick_size
    if spec.entry is EntryStyle.FADE_LIMIT:
        return bar.low <= level - pierce if side == "BUY" else bar.high >= level + pierce
    return bar.high >= level if side == "BUY" else bar.low <= level


def _fill_price_for(
    spec: VariantSpec,
    costs: CostModel,
    side: Side,
    level: Decimal,
    bar: Bar,
) -> Decimal:
    if spec.entry is EntryStyle.FADE_LIMIT:
        return level
    if spec.entry in (EntryStyle.CONFIRMED_STOP, EntryStyle.SWEEP_REVERSAL):
        return bar.open + costs.entry_slip if side == "BUY" else bar.open - costs.entry_slip
    return level + costs.entry_slip if side == "BUY" else level - costs.entry_slip


def _loser_first(
    side_a: Side,
    level_a: Decimal,
    side_b: Side,
    level_b: Decimal,
    bar: Bar,
    spec: VariantSpec,
    costs: CostModel,
    tp_distance: Decimal,
    sl_distance: Decimal,
) -> tuple[Side, Decimal]:
    """Same-bar dual trigger: pick the leg whose bar outcome is the loss."""
    for side, level in ((side_a, level_a), (side_b, level_b)):
        fill = _fill_price_for(spec, costs, side, level, bar)
        stop_price = fill - sl_distance if side == "BUY" else fill + sl_distance
        stop_hit = bar.low <= stop_price if side == "BUY" else bar.high >= stop_price
        if stop_hit:
            return side, level
    return side_a, level_a


def simulate_setup(
    setup: SetupInput,
    bars: list[Bar],
    index0: int,
    spec: VariantSpec,
    costs: CostModel,
    economics: Economics,
) -> SetupOutcome:
    def outcome(
        status: Status,
        reason: str,
        atr_value: Decimal | None = None,
    ) -> SetupOutcome:
        return SetupOutcome(
            variant=spec.name,
            context_id=setup.context_id,
            captured_at=setup.captured_at,
            release=setup.release,
            status=status,
            reason=reason,
            atr=atr_value,
        )

    prior = bars[max(0, index0 - spec.geometry.atr_bars) : index0]
    window = bars[index0 : index0 + spec.window_bars]
    if not window:
        return outcome("NO_DATA", "NO_FORWARD_BARS")
    atr: Decimal | None = None
    if spec.geometry.kind is GeometryKind.ATR:
        atr = _atr(prior, spec.geometry.atr_bars)
        if atr is None or atr <= 0:
            return outcome("NO_ATR", "INSUFFICIENT_PRIOR_BARS")
        tp_distance, sl_distance = spec.geometry.distances(atr)
    else:
        tp_distance, sl_distance = spec.geometry.distances(Decimal(0))
    if spec.range_filter_bars > 0 and spec.range_filter_max_span_atr is not None:
        span_bars = bars[max(0, index0 - spec.range_filter_bars) : index0]
        span_atr = _atr(span_bars, spec.range_filter_bars)
        if len(span_bars) < spec.range_filter_bars or span_atr is None or span_atr <= 0:
            return outcome("NO_RANGE_DATA", "INSUFFICIENT_RANGE_PRIOR_BARS")
        span = max(sb.high for sb in span_bars) - min(sb.low for sb in span_bars)
        if span > spec.range_filter_max_span_atr * span_atr:
            return outcome("NO_RANGE_DATA", "RANGE_FILTER_SPAN_TOO_WIDE")
    if spec.max_efficiency_ratio is not None:
        er_count = spec.efficiency_ratio_bars
        if index0 - er_count - 1 < 0:
            return outcome("NO_REGIME_DATA", "INSUFFICIENT_EFFICIENCY_PRIOR_BARS")
        closes = [bars[i].close for i in range(index0 - er_count - 1, index0)]
        net_move = abs(closes[-1] - closes[0])
        path_length = sum(
            (abs(closes[i + 1] - closes[i]) for i in range(len(closes) - 1)), Decimal(0)
        )
        efficiency = Decimal(1) if path_length == 0 else net_move / path_length
        if efficiency > spec.max_efficiency_ratio:
            return outcome("NO_REGIME_DATA", "EFFICIENCY_RATIO_TOO_HIGH")

    horizon = min(spec.expire_bars, len(window))
    buffer_distance = spec.confirm_buffer_ticks * spec.tick_size
    sweep_distance = spec.sweep_pierce_ticks * spec.tick_size
    (buy_side, buy_level), (sell_side, sell_level) = _legs_for(spec, setup)
    allowed: tuple[Side, ...] = ("BUY", "SELL")
    if spec.trend_filter_bars > 0:
        trend_index = index0 - 1 - spec.trend_filter_bars
        if trend_index < 0 or index0 - 1 < 0:
            return outcome("NO_TREND_DATA", "INSUFFICIENT_TREND_PRIOR_BARS")
        allowed = ("BUY",) if bars[index0 - 1].close >= bars[trend_index].close else ("SELL",)
    entry_index: int | None = None
    side: Side | None = None
    level: Decimal | None = None
    armed = False
    for offset in range(horizon):
        bar = window[offset]
        if spec.entry in (EntryStyle.CONFIRMED_STOP, EntryStyle.SWEEP_REVERSAL):
            if armed:
                entry_index = offset
                break
            if spec.entry is EntryStyle.CONFIRMED_STOP:
                buy_signal = buy_side in allowed and bar.close >= buy_level + buffer_distance
                sell_signal = sell_side in allowed and bar.close <= sell_level - buffer_distance
            else:
                buy_signal = (
                    buy_side in allowed
                    and bar.low <= buy_level - sweep_distance
                    and bar.close > buy_level
                )
                sell_signal = (
                    sell_side in allowed
                    and bar.high >= sell_level + sweep_distance
                    and bar.close < sell_level
                )
            if buy_signal and sell_signal:
                # Same-bar opposing confirmation/sweep is ambiguous; wait.
                continue
            if buy_signal:
                side, level, armed = buy_side, buy_level, True
                continue
            if sell_signal:
                side, level, armed = sell_side, sell_level, True
                continue
            continue
        buy_hit = buy_side in allowed and _triggered(spec, buy_side, buy_level, bar)
        sell_hit = sell_side in allowed and _triggered(spec, sell_side, sell_level, bar)
        if buy_hit and sell_hit:
            picked_side, picked_level = _loser_first(
                buy_side,
                buy_level,
                sell_side,
                sell_level,
                bar,
                spec,
                costs,
                tp_distance,
                sl_distance,
            )
            side, level, entry_index = picked_side, picked_level, offset
            break
        if buy_hit:
            side, level, entry_index = buy_side, buy_level, offset
            break
        if sell_hit:
            side, level, entry_index = sell_side, sell_level, offset
            break
    if entry_index is None or side is None or level is None:
        return outcome("EXPIRED", "NO_FILL_BEFORE_HORIZON", atr)
    fill_price = _fill_price_for(spec, costs, side, level, window[entry_index])
    status, exit_price, exit_index, reason = _resolve_exit(
        side, fill_price, tp_distance, sl_distance, window, entry_index, spec, costs
    )
    pnl_price = _signed_move(side, fill_price, exit_price)
    net_usd = pnl_price * economics.dollars_per_point - economics.commission_round_trip
    return SetupOutcome(
        variant=spec.name,
        context_id=setup.context_id,
        captured_at=setup.captured_at,
        release=setup.release,
        status=status,
        reason=reason,
        side=side,
        fill_price=fill_price,
        exit_price=exit_price,
        exit_time=window[exit_index].start_time,
        hold_bars=exit_index - entry_index,
        atr=atr,
        pnl_price=pnl_price,
        net_usd=net_usd,
    )


def _percentile(values: list[Decimal], pct: float) -> Decimal | None:
    if not values:
        return None
    ordered = sorted(values)
    position = min(len(ordered) - 1, max(0, round(pct * (len(ordered) - 1))))
    return ordered[position]


def aggregate(name: str, spec: VariantSpec, outcomes: list[SetupOutcome]) -> VariantMetrics:
    filled = [o for o in outcomes if o.fill_price is not None]
    wins = [o for o in filled if o.status == "WIN"]
    losses = [o for o in filled if o.status == "LOSS"]
    open_exits = [o for o in filled if o.status == "OPEN"]
    gross_win = sum((o.net_usd for o in filled if o.net_usd > 0), Decimal(0))
    gross_loss = sum((o.net_usd for o in filled if o.net_usd < 0), Decimal(0))
    total_net = sum((o.net_usd for o in outcomes), Decimal(0))
    counted = wins + losses + open_exits
    avg_win_price = (
        sum((o.pnl_price for o in wins), Decimal(0)) / Decimal(len(wins)) if wins else None
    )
    avg_loss_price = (
        sum((o.pnl_price for o in losses), Decimal(0)) / Decimal(len(losses)) if losses else None
    )
    return VariantMetrics(
        name=name,
        entry=str(spec.entry),
        exit=str(spec.exit),
        n_setups=len(outcomes),
        n_filled=len(filled),
        fill_rate=float(len(filled)) / float(len(outcomes)) if outcomes else 0.0,
        wins=len(wins),
        losses=len(losses),
        win_rate_filled=float(len(wins)) / float(len(counted)) if counted else 0.0,
        avg_net_usd_setup=total_net / Decimal(len(outcomes)) if outcomes else Decimal(0),
        avg_net_usd_filled=total_net / Decimal(len(filled)) if filled else Decimal(0),
        total_net_usd=total_net,
        profit_factor=abs(gross_win / gross_loss) if gross_loss < 0 else None,
        avg_win_price=avg_win_price,
        avg_loss_price=avg_loss_price,
        realized_rr=abs(avg_win_price / avg_loss_price)
        if avg_win_price is not None and avg_loss_price not in (None, Decimal(0))
        else None,
        tail_p5_net_usd=_percentile([o.net_usd for o in filled], 0.05),
        avg_hold_bars=float(sum(o.hold_bars or 0 for o in filled)) / float(len(filled))
        if filled
        else None,
        reason_counts=dict(Counter(o.reason for o in outcomes)),
    )


def find_index(bars: list[Bar], when: datetime) -> int:
    """First completed bar starting at or after ``when`` (bars sorted ascending)."""
    return bisect_left([bar.start_time for bar in bars], when)
