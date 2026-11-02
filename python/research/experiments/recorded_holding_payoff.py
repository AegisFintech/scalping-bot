from typing import Any


def _scaled(value: str) -> int:
    unsigned = value.removeprefix("-")
    whole, _, fraction = unsigned.partition(".")
    magnitude = int(whole) * 10**10 + int(fraction.ljust(10, "0"))
    return -magnitude if value.startswith("-") else magnitude


def _decimal_string(value: int) -> str:
    whole, fraction = divmod(abs(value), 10**10)
    sign = "-" if value < 0 else ""
    if fraction == 0:
        return f"{sign}{whole}"
    digits = f"{fraction:010d}".rstrip("0")
    return f"{sign}{whole}.{digits}"


def _loss_ratio(losses: int, winning_net: int, wins: int) -> str | None:
    if wins == 0:
        return None
    quotient, remainder = divmod(losses * wins * 10**6, winning_net)
    doubled = remainder * 2
    if doubled > winning_net or (doubled == winning_net and quotient % 2):
        quotient += 1
    whole, fraction = divmod(quotient, 10**6)
    return f"{whole}.{fraction:06d}"


def _payoff(rows: list[dict[str, str | None]]) -> dict[str, Any]:
    known_net = 0
    known_fees = 0
    wins = 0
    losses = 0
    flat = 0
    net = 0
    fees = 0
    winning_net = 0
    losing_net = 0
    for row in rows:
        net_text = row["net"]
        if net_text is not None:
            value = _scaled(net_text)
            known_net += 1
            net += value
            if value > 0:
                wins += 1
                winning_net += value
            elif value < 0:
                losses += 1
                losing_net += value
            else:
                flat += 1
        fee_text = row["signedFees"]
        if fee_text is not None:
            known_fees += 1
            fees += _scaled(fee_text)
    return {
        "rows": len(rows),
        "knownNet": known_net,
        "unknownNet": len(rows) - known_net,
        "wins": wins,
        "losses": losses,
        "flat": flat,
        "knownFees": known_fees,
        "unknownFees": len(rows) - known_fees,
        "net": _decimal_string(net),
        "signedFees": _decimal_string(fees),
        "winningNet": _decimal_string(winning_net),
        "losingNet": _decimal_string(losing_net),
        "lossPerAverageWin": _loss_ratio(-losing_net, winning_net, wins),
        "counterfactualNet": None,
        "economicQualification": False,
    }


def report(rows: list[dict[str, str | None]]) -> dict[str, Any]:
    names = (
        "under_5s",
        "5_to_15s",
        "15_to_60s",
        "60_to_300s",
        "300s_plus",
        "unknown",
    )
    groups: list[list[dict[str, str | None]]] = [[] for _ in names]
    for row in rows:
        holding = row["holdingMicros"]
        if holding is None:
            index = 5
        else:
            micros = int(holding)
            if micros < 5_000_000:
                index = 0
            elif micros < 15_000_000:
                index = 1
            elif micros < 60_000_000:
                index = 2
            elif micros < 300_000_000:
                index = 3
            else:
                index = 4
        groups[index].append(row)
    return {
        "rows": len(rows),
        "buckets": [
            {"bucket": name, "payoff": _payoff(group)}
            for name, group in zip(names, groups, strict=True)
        ],
        "counterfactualNet": None,
        "economicQualification": False,
    }
