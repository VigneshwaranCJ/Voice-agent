from datetime import UTC, datetime
from zoneinfo import ZoneInfo


def as_utc(dt: datetime) -> datetime:
    """SQLite returns naive datetimes; everything is stored in UTC."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def local_str(dt: datetime, tz: str, fmt: str = "%A %d %B, %I:%M %p") -> str:
    return as_utc(dt).astimezone(ZoneInfo(tz)).strftime(fmt)
