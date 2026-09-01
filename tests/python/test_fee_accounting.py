from pathlib import Path


def test_dashboard_does_not_subtract_fees_from_fee_inclusive_realized_pnl() -> None:
    source = Path("apps/dashboard/app.py").read_text(encoding="utf-8")

    assert "realized_pnl - fees" not in source
    assert "sum(realized_pnl) OVER" in source
    assert "sum(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)" in source
