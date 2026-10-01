"""Check that a packaged MCP server can write to the local database."""

import asyncio
import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

from mcp import Client, StdioServerParameters


async def main(executable: Path, db: Path):
    server = StdioServerParameters(
        command=str(executable), args=[], env={**os.environ, "TODOTODO_DB": str(db)}
    )
    async with Client(server) as client:
        result = await client.call_tool("capture_entry", {"title": "Release smoke test", "kind": "idea"})
        if result.is_error:
            raise RuntimeError(result)
        result = await client.call_tool("list_entries", {"kind": "idea"})
        if result.is_error:
            raise RuntimeError(result)
        with closing(sqlite3.connect(db)) as connection:
            item_id, revision = connection.execute("SELECT id, revision FROM items WHERE title = ?", ("Release smoke test",)).fetchone()
        result = await client.call_tool("revise_entry", {"item_id": item_id, "kind": "task", "scope": "work", "expected_revision": revision})
        if result.is_error:
            raise RuntimeError(result)
        stale = await client.call_tool("revise_entry", {"item_id": item_id, "title": "Stale edit", "expected_revision": revision})
        if not stale.is_error or "다른 곳에서 바뀌었습니다" not in stale.content[0].text:
            raise RuntimeError("MCP stale edit was not rejected")
        result = await client.call_tool("mark_done", {"item_id": item_id, "expected_revision": revision + 1})
        if result.is_error:
            raise RuntimeError(result)
        result = await client.call_tool("capture_entry", {"title": "Invalid reminder", "time": "09:30"})
        if not result.is_error or "날짜를 먼저" not in result.content[0].text:
            raise RuntimeError("MCP scheduling error was not explained")
        result = await client.call_tool("capture_entry", {"title": "Timed meeting", "kind": "event", "date": "2026-10-02", "time": "10:00", "end_time": "11:00"})
        if result.is_error:
            raise RuntimeError(result)
        result = await client.call_tool("capture_entry", {"title": "Invalid range", "date": "2026-10-02", "time": "10:00", "end_time": "09:00"})
        if not result.is_error or "종료 시간은" not in result.content[0].text:
            raise RuntimeError("MCP end-time validation was not explained")
        result = await client.call_tool("capture_entry", {"title": "Weekly meeting", "kind": "event", "date": "2026-10-01",
                                                          "repeat": "weekly", "repeat_until": "2026-10-15"})
        if result.is_error:
            raise RuntimeError(result)
        with closing(sqlite3.connect(db)) as connection:
            item_id, revision = connection.execute("SELECT id, revision FROM items WHERE title = ? AND date = ?",
                                                   ("Weekly meeting", "2026-10-08")).fetchone()
        result = await client.call_tool("revise_entry", {"item_id": item_id, "details": "Shared agenda",
                                                         "future": True, "expected_revision": revision})
        if result.is_error:
            raise RuntimeError(result)
        with closing(sqlite3.connect(db)) as connection:
            future_notes = connection.execute("SELECT date, details FROM items WHERE title = ? ORDER BY date",
                                              ("Weekly meeting",)).fetchall()
        if future_notes != [("2026-10-01", ""), ("2026-10-08", "Shared agenda"),
                            ("2026-10-15", "Shared agenda")]:
            raise RuntimeError("MCP future edit did not preserve the earlier occurrence")
        result = await client.call_tool("stop_repeat", {"item_id": item_id, "expected_revision": revision + 1})
        if result.is_error:
            raise RuntimeError(result)

    with closing(sqlite3.connect(db)) as connection:
        moved = connection.execute("SELECT kind, scope, status, revision FROM items WHERE title = ?", ("Release smoke test",)).fetchone()
        end_time = connection.execute("SELECT end_time FROM items WHERE title = ?", ("Timed meeting",)).fetchone()[0]
        remaining_repeat = connection.execute("SELECT COUNT(*) FROM items WHERE title = ?", ("Weekly meeting",)).fetchone()[0]
    if moved != ("task", "work", "done", 2):
        raise RuntimeError("MCP guarded edit was not saved to the expected database")
    if end_time != "11:00":
        raise RuntimeError("MCP end time was not saved to the expected database")
    if remaining_repeat != 1:
        raise RuntimeError("MCP repeat stop did not keep only the earlier occurrence")
    print("Packaged MCP read/write and validation smoke test passed")


if __name__ == "__main__":
    executable = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix="todotodo-mcp-smoke-") as folder:
        asyncio.run(main(executable, Path(folder) / "smoke.db"))
