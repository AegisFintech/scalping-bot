from __future__ import annotations

from typing import Any

Amount = tuple[int, int]
Row = dict[str, str | None]


def _parse(text: str) -> Amount:
    whole, separator, fraction = text.partition(".")
    scale = len(fraction) if separator else 0
    digits = whole.lstrip("+-") + fraction
    coefficient = int(digits or "0")
    if text.startswith("-"):
        coefficient = -coefficient
    return coefficient, scale


def _add(left: Amount, right: Amount) -> Amount:
    scale = max(left[1], right[1])
    left_units = left[0] * 10 ** (scale - left[1])
    right_units = right[0] * 10 ** (scale - right[1])
    return left_units + right_units, scale


def _render(amount: Amount) -> str:
    coefficient, scale = amount
    if coefficient == 0:
        return "0"
    sign = "-" if coefficient < 0 else ""
    digits = str(abs(coefficient))
    if scale == 0:
        return sign + digits
    digits = digits.zfill(scale + 1)
    decimal_text = digits[:-scale] + "." + digits[-scale:]
    return sign + decimal_text.rstrip("0").rstrip(".")


def _loss_ratio(losses: Amount, winnings: Amount, wins: int) -> str | None:
    if wins == 0:
        return None
    numerator = abs(losses[0]) * wins * 10 ** (winnings[1] + 6)
    denominator = winnings[0] * 10 ** losses[1]
    quotient, remainder = divmod(numerator, denominator)
    comparison = remainder * 2
    if comparison > denominator or (comparison == denominator and quotient % 2):
        quotient += 1
    whole, fraction = divmod(quotient, 1_000_000)
    return f"{whole}.{fraction:06d}"


def _payoff(rows: list[Row]) -> dict[str, Any]:
    known_net = 0
    known_fees = 0
    wins = 0
    losses = 0
    flat = 0
    net: Amount = (0, 0)
    fees: Amount = (0, 0)
    winning_net: Amount = (0, 0)
    losing_net: Amount = (0, 0)
    for row in rows:
        net_text = row["net"]
        if net_text is not None:
            amount = _parse(net_text)
            known_net += 1
            net = _add(net, amount)
            if amount[0] > 0:
                wins += 1
                winning_net = _add(winning_net, amount)
            elif amount[0] < 0:
                losses += 1
                losing_net = _add(losing_net, amount)
            else:
                flat += 1
        fee_text = row["signedFees"]
        if fee_text is not None:
            known_fees += 1
            fees = _add(fees, _parse(fee_text))
    return {
        "rows": len(rows),
        "knownNet": known_net,
        "unknownNet": len(rows) - known_net,
        "wins": wins,
        "losses": losses,
        "flat": flat,
        "knownFees": known_fees,
        "unknownFees": len(rows) - known_fees,
        "net": _render(net),
        "signedFees": _render(fees),
        "winningNet": _render(winning_net),
        "losingNet": _render(losing_net),
        "lossPerAverageWin": _loss_ratio(losing_net, winning_net, wins),
        "counterfactualNet": None,
        "economicQualification": False,
    }


def report(rows: list[Row]) -> dict[str, Any]:
    names = (
        "under_5s",
        "5_to_15s",
        "15_to_60s",
        "60_to_300s",
        "300s_plus",
        "unknown",
    )
    boundaries = (5_000_000, 15_000_000, 60_000_000, 300_000_000)
    grouped: list[list[Row]] = [[] for _ in names]
    for row in rows:
        holding = row["holdingMicros"]
        index = 5
        if holding is not None:
            micros = int(holding)
            index = 4
            for candidate, boundary in enumerate(boundaries):
                if micros < boundary:
                    index = candidate
                    break
        grouped[index].append(row)
    return {
        "rows": len(rows),
        "buckets": [
            {"bucket": name, "payoff": _payoff(grouped[index])} for index, name in enumerate(names)
        ],
        "counterfactualNet": None,
        "economicQualification": False,
    }
