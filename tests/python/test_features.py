from decimal import Decimal

import pytest

from python.features.builder import decimal_text


def test_decimal_text_truncates_positive_values_to_contract_precision() -> None:
    source = Decimal("2.840095457306321069040301509")
    result = decimal_text(source)

    assert result == "2.8400954573"
    assert Decimal(result) <= source


def test_decimal_text_is_canonical_for_signed_and_tiny_values() -> None:
    assert decimal_text(Decimal("-12.34567890129")) == "-12.3456789012"
    assert decimal_text(Decimal("1.23000000000")) == "1.23"
    assert decimal_text(Decimal("0.00000000009")) == "0"
    assert decimal_text(Decimal("-0.00000000009")) == "0"
    assert decimal_text(None) is None


@pytest.mark.parametrize("value", [Decimal("NaN"), Decimal("Infinity"), Decimal("-Infinity")])
def test_decimal_text_rejects_non_finite_values(value: Decimal) -> None:
    with pytest.raises(ValueError, match="ANALYTICS_DECIMAL_NON_FINITE"):
        decimal_text(value)
