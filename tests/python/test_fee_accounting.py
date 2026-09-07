from pathlib import Path


def test_dashboard_does_not_subtract_fees_from_fee_inclusive_realized_pnl() -> None:
    source = Path("apps/dashboard/app.py").read_text(encoding="utf-8")

    assert "realized_pnl - fees" not in source
    assert 'data["net_pnl"].cumsum()' in source
    assert "t.realized_pnl AS net_pnl" in source
