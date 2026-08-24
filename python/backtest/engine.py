from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

from python.analytics.models import Candle


@dataclass(frozen=True)
class OrderLeg:
    side: Literal["BUY", "SELL"]
    entry: Decimal
    stop_loss: Decimal
    take_profit: Decimal
    expires_at: datetime

    def __post_init__(self) -> None:
        if self.side == "BUY" and not self.stop_loss < self.entry < self.take_profit:
            raise ValueError("invalid buy levels")
        if self.side == "SELL" and not self.take_profit < self.entry < self.stop_loss:
            raise ValueError("invalid sell levels")


@dataclass(frozen=True)
class BacktestConfig:
    tick_size: Decimal
    slippage_points: Decimal = Decimal(0)
    spread_points: Decimal = Decimal(0)
    latency_bars: int = 0

    def __post_init__(self) -> None:
        if self.tick_size <= 0:
            raise ValueError("tick size must be positive")
        if self.slippage_points < 0 or self.spread_points < 0 or self.latency_bars < 0:
            raise ValueError("costs and latency must not be negative")


@dataclass(frozen=True)
class BacktestResult:
    status: Literal["WIN", "LOSS", "OPEN", "EXPIRED", "NO_DATA"]
    filled_side: Literal["BUY", "SELL"] | None
    filled_at: datetime | None
    fill_price: Decimal | None
    exit_price: Decimal | None
    exit_at: datetime | None
    pnl_per_unit: Decimal
    reason_code: str


def _triggered(leg: OrderLeg, candle: Candle) -> bool:
    return (
        candle.high_decimal >= leg.entry if leg.side == "BUY" else candle.low_decimal <= leg.entry
    )


def _fill_price(leg: OrderLeg, config: BacktestConfig) -> Decimal:
    cost = config.tick_size * (config.slippage_points + (config.spread_points / Decimal(2)))
    return leg.entry + cost if leg.side == "BUY" else leg.entry - cost


def _bar_outcome(leg: OrderLeg, candle: Candle) -> tuple[str, Decimal | None]:
    if leg.side == "BUY":
        stop_hit = candle.low_decimal <= leg.stop_loss
        target_hit = candle.high_decimal >= leg.take_profit
    else:
        stop_hit = candle.high_decimal >= leg.stop_loss
        target_hit = candle.low_decimal <= leg.take_profit
    if stop_hit:
        return ("LOSS_SAME_BAR_AMBIGUITY" if target_hit else "LOSS", leg.stop_loss)
    if target_hit:
        return "WIN", leg.take_profit
    return "OPEN", None


def _pnl(side: str, fill: Decimal, exit_price: Decimal) -> Decimal:
    return exit_price - fill if side == "BUY" else fill - exit_price


def simulate_oco(
    candles: list[Candle],
    buy: OrderLeg,
    sell: OrderLeg,
    config: BacktestConfig,
) -> BacktestResult:
    """Conservative candle simulation: stop wins every unresolved intrabar race."""
    if buy.side != "BUY" or sell.side != "SELL":
        raise ValueError("OCO requires one buy and one sell leg")
    eligible = candles[config.latency_bars :]
    if not eligible:
        return BacktestResult(
            "NO_DATA", None, None, None, None, None, Decimal(0), "NO_ELIGIBLE_BARS"
        )

    filled_leg: OrderLeg | None = None
    fill_time: datetime | None = None
    fill_price: Decimal | None = None
    for candle in eligible:
        if candle.start_time >= min(buy.expires_at, sell.expires_at):
            return BacktestResult(
                "EXPIRED", None, None, None, None, None, Decimal(0), "OCO_EXPIRED"
            )
        candidates = [leg for leg in (buy, sell) if _triggered(leg, candle)]
        if not candidates:
            continue
        if len(candidates) == 2:
            losing = [leg for leg in candidates if _bar_outcome(leg, candle)[0].startswith("LOSS")]
            filled_leg = losing[0] if losing else buy
            dual_reason = "CONSERVATIVE_DUAL_TRIGGER"
        else:
            filled_leg = candidates[0]
            dual_reason = "ORDER_TRIGGERED"
        fill_time = candle.start_time
        fill_price = _fill_price(filled_leg, config)
        outcome, exit_price = _bar_outcome(filled_leg, candle)
        if exit_price is not None:
            status: Literal["WIN", "LOSS"] = "LOSS" if outcome.startswith("LOSS") else "WIN"
            reason = "CONSERVATIVE_SAME_BAR_STOP" if "SAME_BAR" in outcome else dual_reason
            return BacktestResult(
                status,
                filled_leg.side,
                fill_time,
                fill_price,
                exit_price,
                candle.end_time,
                _pnl(filled_leg.side, fill_price, exit_price),
                reason,
            )
        start_index = eligible.index(candle) + 1
        for later in eligible[start_index:]:
            outcome, exit_price = _bar_outcome(filled_leg, later)
            if exit_price is None:
                continue
            status = "LOSS" if outcome.startswith("LOSS") else "WIN"
            reason = "CONSERVATIVE_SAME_BAR_STOP" if "SAME_BAR" in outcome else outcome
            return BacktestResult(
                status,
                filled_leg.side,
                fill_time,
                fill_price,
                exit_price,
                later.end_time,
                _pnl(filled_leg.side, fill_price, exit_price),
                reason,
            )
        break
    if filled_leg is not None:
        return BacktestResult(
            "OPEN",
            filled_leg.side,
            fill_time,
            fill_price,
            None,
            None,
            Decimal(0),
            "OPEN_AT_DATA_END",
        )
    return BacktestResult(
        "EXPIRED", None, None, None, None, None, Decimal(0), "NO_TRIGGER_BEFORE_DATA_END"
    )
