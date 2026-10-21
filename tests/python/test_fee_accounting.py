from datetime import UTC, datetime
from decimal import Decimal

from apps.dashboard.landscape_model import landscape_model


def test_dashboard_preserves_fee_inclusive_net_without_subtracting_fees_again() -> None:
    now = datetime.now(UTC)
    model = landscape_model(
        {
            "captured_at": now,
            "status": {"mode": "demo", "startupChecksPassed": True},
            "curve": [
                {"closed_at": now, "net_pnl": Decimal("1.25"), "fees": Decimal("-0.30")},
                {"closed_at": now, "net_pnl": Decimal("-0.25"), "fees": Decimal("-0.20")},
            ],
        },
        "ready",
        now,
    )
    assert model["values"]["closed-net"]["text"] == "+1.00"
