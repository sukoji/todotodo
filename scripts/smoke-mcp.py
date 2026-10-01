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
        result = await client.call_tool("capture_entry", {"title": "Invalid reminder", "time": "09:30"})
        if not result.is_error or "날짜를 먼저" not in result.content[0].text:
            raise RuntimeError("MCP scheduling error was not explained")

    with closing(sqlite3.connect(db)) as connection:
        count = connection.execute("SELECT count(*) FROM items WHERE title = ?", ("Release smoke test",)).fetchone()[0]
    if count != 1:
        raise RuntimeError("MCP entry was not saved to the expected database")
    print("Packaged MCP read/write and validation smoke test passed")


if __name__ == "__main__":
    executable = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix="todotodo-mcp-smoke-") as folder:
        asyncio.run(main(executable, Path(folder) / "smoke.db"))
