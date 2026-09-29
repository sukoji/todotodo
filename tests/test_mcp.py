import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import store

try:
    from mcp import Client
    from mcp_server import mcp
except ImportError:
    Client = None


@unittest.skipIf(Client is None, "MCP SDK is not installed")
class MCPTests(unittest.TestCase):
    def test_agent_capture_visible_in_shared_store(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(store, "DB_PATH", Path(folder) / "agent.db"):
            store.init_db()

            async def run():
                async with Client(mcp) as client:
                    await client.call_tool("capture_entry", {"title": "에이전트 메모", "kind": "idea", "scope": "work"})
                    result = await client.call_tool("list_entries", {"kind": "idea", "scope": "work"})
                    self.assertFalse(result.is_error)

            asyncio.run(run())
            items = store.list_items(kind="idea", scope="work")
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["title"], "에이전트 메모")
            self.assertEqual(items[0]["source"], "mcp")
