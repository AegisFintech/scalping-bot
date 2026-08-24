from __future__ import annotations

from decimal import ROUND_DOWN, Decimal

from python.analytics.models import PerformanceOutcome, PerformanceSummary


def decimal_text(value: Decimal) -> str:
    value = value.quantize(Decimal("0.0000000001"), rounding=ROUND_DOWN)
    text = format(value.normalize(), "f")
    return "0" if text in {"-0", ""} else text


def summarize(outcomes: list[PerformanceOutcome]) -> PerformanceSummary:
    values = [Decimal(outcome.net_pnl) for outcome in outcomes]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    total = sum(values, Decimal(0))
    gross_profit = sum(wins, Decimal(0))
    gross_loss = sum((-value for value in losses), Decimal(0))
    equity = Decimal(0)
    peak = Decimal(0)
    drawdown = Decimal(0)
    for value in reversed(values):
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    consecutive_wins = 0
    consecutive_losses = 0
    for value in values:
        if value > 0:
            if consecutive_losses:
                break
            consecutive_wins += 1
        elif value < 0:
            if consecutive_wins:
                break
            consecutive_losses += 1
        else:
            break
    count = len(values)
    return PerformanceSummary(
        sample_size=count,
        wins=len(wins),
        losses=len(losses),
        win_rate=decimal_text(Decimal(len(wins)) / count) if count else None,
        loss_rate=decimal_text(Decimal(len(losses)) / count) if count else None,
        profit_factor=decimal_text(gross_profit / gross_loss) if gross_loss else None,
        expectancy=decimal_text(total / count) if count else None,
        average_win=decimal_text(gross_profit / len(wins)) if wins else None,
        average_loss=decimal_text(-gross_loss / len(losses)) if losses else None,
        realized_pnl=decimal_text(total),
        drawdown=decimal_text(drawdown),
        consecutive_wins=consecutive_wins,
        consecutive_losses=consecutive_losses,
    )
