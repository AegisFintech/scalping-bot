from __future__ import annotations

from datetime import UTC, datetime

from apps.dashboard.time_display import format_gmt8_timestamp


def test_formats_aware_and_service_iso_timestamps_as_gmt8() -> None:
    expected = "25 Aug 2026, 13:37:03 GMT+8"

    assert format_gmt8_timestamp(datetime(2026, 8, 25, 5, 37, 3, tzinfo=UTC)) == expected
    assert format_gmt8_timestamp("2026-08-25T05:37:03.364Z") == expected
    assert format_gmt8_timestamp("2026-08-25T13:37:03+08:00") == expected


def test_treats_naive_database_datetime_as_utc() -> None:
    assert format_gmt8_timestamp(datetime(2026, 8, 25, 5, 28, 3)) == ("25 Aug 2026, 13:28:03 GMT+8")


def test_missing_and_invalid_values_are_not_presented_as_times() -> None:
    assert format_gmt8_timestamp(None) == "—"
    assert format_gmt8_timestamp("") == "—"
    assert format_gmt8_timestamp("not-a-time") == "Unavailable"
    assert format_gmt8_timestamp(1787636223) == "Unavailable"
