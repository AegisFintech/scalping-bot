from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

SINGAPORE_TIME = ZoneInfo("Asia/Singapore")
GMT8_DISPLAY_FORMAT = "%d %b %Y, %H:%M:%S GMT+8"


def format_gmt8_timestamp(value: object) -> str:
    """Render a UTC/service timestamp for operators without mutating its source."""

    if value is None:
        return "—"

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
