from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

SINGAPORE_TIME = ZoneInfo("Asia/Singapore")
GMT8_DISPLAY_FORMAT = "%d %b %Y, %H:%M:%S GMT+8"


def format_gmt8_timestamp(value: object) -> str:
    """Render a UTC/service timestamp for operators without mutating its source."""

    if value is None:
        return "—"
    try:
        if bool(pd.isna(value)):
            return "—"
    except (TypeError, ValueError):
        return "Unavailable"

    parsed: datetime
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return "—"
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return "Unavailable"
    else:
        return "Unavailable"

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    try:
        return parsed.astimezone(SINGAPORE_TIME).strftime(GMT8_DISPLAY_FORMAT)
    except (OverflowError, ValueError):
        return "Unavailable"


def is_timestamp_column(column: object) -> bool:
    name = str(column).lower()
    return name in {"day", "interval_start", "latest_delivery", "timestamp"} or name.endswith(
        ("_at", "_time", "_until", "_timestamp")
    )


def format_dataframe_timestamps(frame: pd.DataFrame) -> pd.DataFrame:
    """Return a display copy with timestamp columns rendered in GMT+8."""

    displayed = frame.copy(deep=False)
    for column in displayed.columns:
        if is_timestamp_column(column):
            displayed[column] = displayed[column].map(format_gmt8_timestamp)
    return displayed


def dataframe_for_display(data: Any) -> pd.DataFrame:
    frame = data if isinstance(data, pd.DataFrame) else pd.DataFrame(data)
    return format_dataframe_timestamps(frame)
