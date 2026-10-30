from decimal import Decimal
from typing import Any

Amount = tuple[int, int]


def _parse(value: str) -> Amount:
    number = Decimal(value)
    if not number.is_finite():
        raise ValueError("Amounts must be finite decimal strings")
    parts = number.as_tuple()
    coefficient = 0
    for digit in parts.digits:
        coefficient = coefficient * 10 + digit
    if parts.sign:
        coefficient = -coefficient
    return coefficient, int(parts.exponent)


def _add(left: Amount, right: Amount) -> Amount:
    exponent = min(left[1], right[1])
    return (
        left[0] * 10 ** (left[1] - exponent) + right[0] * 10 ** (right[1] - exponent),
        exponent,
    )


def _plain(amount: Amount) -> str:
    coefficient, exponent = amount
    if coefficient == 0:
        return "0"
    sign = "-" if coefficient < 0 else ""
    digits = str(abs(coefficient))
    if exponent >= 0:
        return sign + digits + "0" * exponent
    digits = digits.zfill(1 - exponent)
    point = len(digits) + exponent
    text = (digits[:point] + "." + digits[point:]).rstrip("0").rstrip(".")
    return sign + text


def report(rows: list[dict[str, str | None]]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "rows": len(rows),
        "knownNet": 0,
        "unknownNet": 0,
        "wins": 0,
        "losses": 0,
        "flat": 0,
        "knownFees": 0,
        "unknownFees": 0,
    }
    net = fees = winning = losing = (0, 0)
    for row in rows:
        value = row["net"]
        if value is None:
            result["unknownNet"] += 1
        else:
            amount = _parse(value)
            result["knownNet"] += 1
            net = _add(net, amount)
            if amount[0] > 0:
                result["wins"] += 1
                winning = _add(winning, amount)
            elif amount[0] < 0:
                result["losses"] += 1
                losing = _add(losing, amount)
            else:
                result["flat"] += 1
        value = row["signedFees"]
        if value is None:
            result["unknownFees"] += 1
        else:
            result["knownFees"] += 1
            fees = _add(fees, _parse(value))

    ratio = None
    if result["wins"]:
        exponent = min(losing[1], winning[1])
        numerator = abs(losing[0]) * 10 ** (losing[1] - exponent) * result["wins"] * 1000000
        denominator = winning[0] * 10 ** (winning[1] - exponent)
        quotient, remainder = divmod(numerator, denominator)
        if remainder * 2 > denominator or (remainder * 2 == denominator and quotient % 2):
            quotient += 1
        ratio = str(quotient // 1000000) + "." + str(quotient % 1000000).zfill(6)

    result.update(
        {
            "net": _plain(net),
            "signedFees": _plain(fees),
            "winningNet": _plain(winning),
            "losingNet": _plain(losing),
            "lossPerAverageWin": ratio,
            "counterfactualNet": None,
            "economicQualification": False,
        }
    )
    return result
