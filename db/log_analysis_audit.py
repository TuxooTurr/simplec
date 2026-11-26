"""Persistent metadata for searches analyzed by the Logs screen."""
from contextlib import closing
from datetime import datetime, timezone
import sqlite3
from uuid import uuid4

from db.paths import DATA_DIR

_FILE = DATA_DIR / "log_analysis_audit.sqlite3"


def _connect() -> sqlite3.Connection:
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(_FILE)
    connection.row_factory = sqlite3.Row
    connection.execute("""
        CREATE TABLE IF NOT EXISTS analysis (
            id TEXT PRIMARY KEY, actor TEXT NOT NULL, source TEXT NOT NULL,
            started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
            provider TEXT NOT NULL, item_count INTEGER, size_bytes INTEGER,
            period_start TEXT, period_end TEXT, errors_only INTEGER
        )
    """)
    return connection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def begin(actor: str, source: str, provider: str = "", *, item_count: int | None = None,
          period: tuple[str, str] | None = None) -> str:
    entry = uuid4().hex
    with closing(_connect()) as connection, connection:
        connection.execute("""
            INSERT INTO analysis (id, actor, source, started_at, status, provider, item_count, period_start, period_end)
            VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)
        """, (entry, actor, source, _now(), provider, item_count, *(period or (None, None))))
    return entry


def uploaded(entry: str, provider: str, item_count: int, size_bytes: int, errors_only: bool) -> None:
    with closing(_connect()) as connection, connection:
        connection.execute(
            "UPDATE analysis SET provider = ?, item_count = ?, size_bytes = ?, errors_only = ? WHERE id = ?",
            (provider, item_count, size_bytes, errors_only, entry),
        )


def finish(entry: str, status: str) -> None:
    with closing(_connect()) as connection, connection:
        connection.execute("UPDATE analysis SET finished_at = ?, status = ? WHERE id = ?", (_now(), status, entry))


def list_entries(actor: str | None, offset: int, limit: int) -> list[dict]:
    with closing(_connect()) as connection:
        where, args = ("WHERE actor = ?", (actor,)) if actor is not None else ("", ())
        rows = connection.execute(
            f"SELECT * FROM analysis {where} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?",
            (*args, limit, offset),
        ).fetchall()
    return [dict(row) for row in rows]
