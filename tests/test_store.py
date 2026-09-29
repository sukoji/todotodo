import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(store, "DB_PATH", Path(self.temp.name) / "test.db")
        self.db_patch.start()
        store.init_db()

    def tearDown(self):
        self.db_patch.stop()
        self.temp.cleanup()

    def test_shared_workflow_and_brief(self):
        today = "2026-10-01"
        task = store.create_item({"title": "회의 준비", "kind": "task", "scope": "work", "date": today}, source="mcp")
        idea = store.create_item({"title": "새 아이디어", "kind": "idea", "scope": "personal"})
        self.assertEqual(task["source"], "mcp")
        self.assertEqual([entry["id"] for entry in store.list_items(scope="work")], [task["id"]])
        self.assertEqual(store.day_brief(today, "work")["due_today"][0]["id"], task["id"])
        self.assertEqual(store.day_brief(today, "personal")["open_ideas"][0]["id"], idea["id"])
        store.update_item(task["id"], {"status": "done"})
        self.assertEqual(store.day_brief(today)["due_today"], [])
        self.assertTrue(store.delete_item(idea["id"]))
        self.assertIsNone(store.get_item(idea["id"]))

    def test_rejects_invalid_input_without_changing_data(self):
        task = store.create_item({"title": "원래 제목"})
        with self.assertRaises(ValueError):
            store.update_item(task["id"], {"title": ""})
        with self.assertRaises(ValueError):
            store.create_item({"title": "불가능", "date": "2026-02-30"})
        with self.assertRaises(ValueError):
            store.update_item(task["id"], {"source": "forged"})
        self.assertEqual(store.get_item(task["id"])["title"], "원래 제목")
        self.assertEqual(len(store.list_items()), 1)


if __name__ == "__main__":
    unittest.main()
