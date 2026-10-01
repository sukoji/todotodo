import os
import copy
import sqlite3
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
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

    @unittest.skipUnless(sys.platform == "win32", "Windows roaming folder lookup")
    def test_frozen_default_database_ignores_overridden_appdata(self):
        with patch.object(sys, "frozen", True, create=True):
            expected = store._default_db_path()
            with patch.dict(os.environ, {"APPDATA": self.temp.name}):
                self.assertEqual(store._default_db_path(), expected)
        self.assertNotEqual(expected, Path(self.temp.name) / "TodoTodo" / "todotodo.db")

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

    def test_backup_import_is_idempotent_and_atomic(self):
        first = store.create_item({"title": "되찾을 생각", "kind": "idea", "details": "원본 메모"})
        backup = {"format": "todotodo-v1", "items": store.list_items()}
        store.delete_item(first["id"])
        self.assertEqual(store.import_items(backup), {"imported": 1, "skipped": 0})
        self.assertEqual(store.get_item(first["id"]), first)
        self.assertEqual(store.import_items(backup), {"imported": 0, "skipped": 1})

        invalid = copy.deepcopy(backup)
        invalid["items"][0]["id"] = "a" * 32
        invalid["items"].append({**invalid["items"][0], "id": "b" * 32, "date": "2026-02-30"})
        with self.assertRaises(ValueError):
            store.import_items(invalid)
        self.assertEqual(store.list_items(), [first])

    def test_stale_edit_and_delete_preserve_agent_changes(self):
        item = store.create_item({"title": "초안"})
        changed = store.update_item(item["id"], {"title": "에이전트 수정"}, expected_revision=item["revision"])
        self.assertEqual(changed["revision"], 1)
        with self.assertRaises(store.ConflictError):
            store.update_item(item["id"], {"title": "오래된 화면 수정"}, expected_revision=item["revision"])
        with self.assertRaises(store.ConflictError):
            store.delete_item(item["id"], expected_revision=item["revision"])
        self.assertEqual(store.get_item(item["id"])["title"], "에이전트 수정")
        self.assertTrue(store.delete_item(item["id"], expected_revision=changed["revision"]))

    def test_old_database_and_backup_gain_revision(self):
        self.db_patch.stop()
        old_db = Path(self.temp.name) / "old.db"
        with closing(sqlite3.connect(old_db)) as db:
            db.execute("""CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL,
                date TEXT NOT NULL DEFAULT '', time TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            db.execute("INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                "a" * 32, "기존 기록", "", "task", "personal", "todo", "normal", "", "", "", "web",
                "2026-09-29T10:00:00+09:00", "2026-09-29T10:00:00+09:00"))
            db.commit()
        self.db_patch = patch.object(store, "DB_PATH", old_db)
        self.db_patch.start()
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: store.init_db(), range(2)))
        with closing(sqlite3.connect(old_db)) as db:
            self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        self.assertEqual(store.get_item("a" * 32)["title"], "기존 기록")
        self.assertEqual(store.get_item("a" * 32)["revision"], 0)
        item = store.create_item({"title": "옛날 백업"})
        legacy = {key: value for key, value in item.items() if key != "revision"}
        store.delete_item(item["id"])
        self.assertEqual(store.import_items({"format": "todotodo-v1", "items": [legacy]}), {"imported": 1, "skipped": 0})
        self.assertEqual(store.get_item(item["id"])["revision"], 0)


if __name__ == "__main__":
    unittest.main()
