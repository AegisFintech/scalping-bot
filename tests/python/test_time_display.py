from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from apps.dashboard.time_display import (
    dataframe_for_display,
    format_dataframe_timestamps,
    format_gmt8_timestamp,
    is_timestamp_column,
)


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


def test_formats_only_timestamp_columns_on_a_display_copy() -> None:
    source = pd.DataFrame(
        [
            {
                "updated_at": datetime(2026, 8, 25, 5, 28, 3, tzinfo=UTC),
                "valid_until": "2026-08-25T05:37:03.364Z",
                "timestamp": "invalid",
                "trading_day": "2026-08-25",
                "entry_price": "4646.6000000000",
            }
        ]
    )

    displayed = format_dataframe_timestamps(source)

    assert displayed.loc[0, "updated_at"] == "25 Aug 2026, 13:28:03 GMT+8"
    assert displayed.loc[0, "valid_until"] == "25 Aug 2026, 13:37:03 GMT+8"
    assert displayed.loc[0, "timestamp"] == "Unavailable"
    assert displayed.loc[0, "trading_day"] == "2026-08-25"
    assert displayed.loc[0, "entry_price"] == "4646.6000000000"
    assert isinstance(source.loc[0, "updated_at"], pd.Timestamp)


def test_column_detection_and_non_dataframe_input() -> None:
    assert is_timestamp_column("analysis_time") is True
    assert is_timestamp_column("expires_at") is True
    assert is_timestamp_column("interval_start") is True
    assert is_timestamp_column("latest_delivery") is True
    assert is_timestamp_column("day") is True
    assert is_timestamp_column("timeframe") is False
    assert dataframe_for_display([{"received_at": None}]).loc[0, "received_at"] == "—"
