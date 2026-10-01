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

    def test_agent_gets_an_error_for_time_without_date(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(store, "DB_PATH", Path(folder) / "agent.db"):
            store.init_db()

            async def run():
                async with Client(mcp) as client:
                    result = await client.call_tool("capture_entry", {"title": "알림", "time": "09:30"})
                    self.assertTrue(result.is_error)
                    self.assertIn("날짜를 먼저", result.content[0].text)

            asyncio.run(run())
            self.assertEqual(store.list_items(), [])

    def test_agent_can_capture_and_revise_schedule_end_time(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(store, "DB_PATH", Path(folder) / "agent.db"):
            store.init_db()

            async def run():
                async with Client(mcp) as client:
                    result = await client.call_tool("capture_entry", {"title": "회의", "kind": "event", "date": "2026-10-02", "time": "10:00", "end_time": "11:00"})
                    self.assertFalse(result.is_error)
                    item = store.list_items()[0]
                    self.assertEqual(item["end_time"], "11:00")
                    result = await client.call_tool("revise_entry", {"item_id": item["id"], "end_time": "12:00"})
                    self.assertFalse(result.is_error)
                    self.assertEqual(store.get_item(item["id"])["end_time"], "12:00")

            asyncio.run(run())

    def test_agent_can_create_and_stop_repeated_schedule(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(store, "DB_PATH", Path(folder) / "agent.db"):
            store.init_db()

            async def run():
                async with Client(mcp) as client:
                    result = await client.call_tool("capture_entry", {
                        "title": "주간 회의", "kind": "event", "date": "2026-10-01", "time": "10:00",
                        "repeat": "weekly", "repeat_until": "2026-10-22",
                    })
                    self.assertFalse(result.is_error)
                    entries = store.list_items()
                    self.assertEqual(len(entries), 4)
                    result = await client.call_tool("revise_entry", {
                        "item_id": entries[1]["id"], "title": "새 회의 이름", "future": True,
                        "expected_revision": entries[1]["revision"],
                    })
                    self.assertFalse(result.is_error)
                    self.assertEqual([item["title"] for item in store.list_items()],
                                     ["주간 회의", "새 회의 이름", "새 회의 이름", "새 회의 이름"])
                    entries = store.list_items()
                    result = await client.call_tool("stop_repeat", {
                        "item_id": entries[1]["id"], "expected_revision": entries[1]["revision"],
                    })
                    self.assertFalse(result.is_error)
                    self.assertEqual([item["date"] for item in store.list_items()], ["2026-10-01"])
                    one_off = store.create_item({"title": "물 주기", "kind": "task", "date": "2026-10-02"})
                    result = await client.call_tool("revise_entry", {
                        "item_id": one_off["id"], "repeat": "daily", "repeat_until": "2026-10-04",
                        "expected_revision": one_off["revision"],
                    })
                    self.assertFalse(result.is_error)
                    self.assertEqual(len([item for item in store.list_items() if item["series_id"] == one_off["id"]]), 3)

            asyncio.run(run())

    def test_agent_can_move_entries_without_overwriting_newer_edits(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(store, "DB_PATH", Path(folder) / "agent.db"):
            store.init_db()
            item = store.create_item({"title": "아이디어", "kind": "idea", "scope": "work"})

            async def run():
                async with Client(mcp) as client:
                    moved = await client.call_tool("revise_entry", {
                        "item_id": item["id"], "kind": "task", "scope": "personal",
                        "date": "2026-10-02", "expected_revision": item["revision"],
                    })
                    self.assertFalse(moved.is_error)
                    current = store.get_item(item["id"])
                    self.assertEqual((current["kind"], current["scope"], current["date"], current["revision"]),
                                     ("task", "personal", "2026-10-02", 1))

                    store.update_item(item["id"], {"title": "사용자가 고친 제목"}, expected_revision=1)
                    stale = await client.call_tool("revise_entry", {
                        "item_id": item["id"], "title": "이전 제목", "expected_revision": 1,
                    })
                    self.assertTrue(stale.is_error)
                    self.assertIn("다른 곳에서 바뀌었습니다", stale.content[0].text)
                    stale_done = await client.call_tool("mark_done", {"item_id": item["id"], "expected_revision": 1})
                    self.assertTrue(stale_done.is_error)
                    self.assertEqual((store.get_item(item["id"])["title"], store.get_item(item["id"])["status"]),
                                     ("사용자가 고친 제목", "todo"))

                    done = await client.call_tool("mark_done", {"item_id": item["id"], "expected_revision": 2})
                    self.assertFalse(done.is_error)
                    self.assertEqual(store.get_item(item["id"])["status"], "done")

            asyncio.run(run())
