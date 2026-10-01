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

    def test_agent_schedule_needs_a_date_when_time_is_set(self):
        with self.assertRaisesRegex(ValueError, "날짜를 먼저"):
            store.create_item({"title": "날짜 없는 알림", "time": "09:30"}, source="mcp")
        item = store.create_item({"title": "회의", "date": "2026-10-02", "time": "09:30"})
        with self.assertRaisesRegex(ValueError, "날짜를 먼저"):
            store.update_item(item["id"], {"date": ""})
        self.assertEqual(store.get_item(item["id"]), item)
        changed = store.update_item(item["id"], {"date": "", "time": ""})
        self.assertEqual((changed["date"], changed["time"]), ("", ""))
        with self.assertRaisesRegex(ValueError, "날짜를 먼저"):
            store.update_item(item["id"], {"time": "09:30"})
        self.assertEqual(len(store.list_items()), 1)

        old_entry = {key: value for key, value in {**item, "id": "a" * 32, "date": "", "time": "09:30"}.items() if key not in ("end_time", "repeat", "repeat_until", "series_id")}
        self.assertEqual(store.import_items({"format": "todotodo-v1", "items": [old_entry]})["imported"], 1)
        self.assertEqual(store.update_item(old_entry["id"], {"status": "done"})["status"], "done")
        roundtrip = {"format": "todotodo-v2", "items": [store.get_item(old_entry["id"])]}
        store.delete_item(old_entry["id"])
        self.assertEqual(store.import_items(roundtrip)["imported"], 1)

    def test_schedule_end_time_validation_and_roundtrip(self):
        for fields in ({"end_time": "11:00"}, {"time": "10:00", "end_time": "11:00"}):
            with self.assertRaises(ValueError):
                store.create_item({"title": "잘못된 일정", **fields})
        for end_time in ("10:00", "09:30", "25:00"):
            with self.assertRaises(ValueError):
                store.create_item({"title": "잘못된 일정", "date": "2026-10-02", "time": "10:00", "end_time": end_time})
        item = store.create_item({"title": "회의", "kind": "event", "date": "2026-10-02", "time": "10:00", "end_time": "11:00"})
        self.assertEqual(store.get_item(item["id"])["end_time"], "11:00")
        with self.assertRaises(ValueError):
            store.update_item(item["id"], {"time": "12:00"})
        with self.assertRaises(ValueError):
            store.update_item(item["id"], {"date": "", "time": ""})
        self.assertEqual(store.get_item(item["id"]), item)
        changed = store.update_item(item["id"], {"time": "12:00", "end_time": "13:00"})
        self.assertEqual((changed["time"], changed["end_time"]), ("12:00", "13:00"))
        backup = {"format": "todotodo-v2", "items": [changed]}
        store.delete_item(item["id"])
        self.assertEqual(store.import_items(backup)["imported"], 1)
        self.assertEqual(store.get_item(item["id"])["end_time"], "13:00")

    def test_repeated_dates_keep_month_end_and_each_occurrence_is_independent(self):
        self.assertEqual(store.recurring_dates("2026-01-31", "2026-04-30", "monthly", "event"),
                         ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])
        first = store.create_item({"title": "월말 결산", "kind": "event", "scope": "work", "date": "2026-01-31",
                                   "time": "10:00", "end_time": "11:00", "repeat": "monthly", "repeat_until": "2026-04-30"})
        entries = store.list_items()
        self.assertEqual([item["date"] for item in entries], ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])
        self.assertEqual({item["series_id"] for item in entries}, {first["id"]})
        self.assertEqual(len({item["id"] for item in entries}), 4)
        self.assertTrue(all(item["repeat"] == "monthly" and item["repeat_until"] == "2026-04-30" for item in entries))
        changed = store.update_item(entries[1]["id"], {"status": "done", "title": "2월 결산"}, expected_revision=0)
        self.assertEqual(changed["status"], "done")
        self.assertEqual(store.get_item(entries[2]["id"])["title"], "월말 결산")
        self.assertEqual(store.day_brief("2026-03-31", "work")["due_today"][0]["id"], entries[2]["id"])
        with self.assertRaises(store.ConflictError):
            store.delete_item(entries[1]["id"], expected_revision=0, future=True)
        with self.assertRaises(ValueError):
            store.delete_item(entries[2]["id"], future="yes")
        self.assertEqual(store.delete_item(entries[2]["id"], expected_revision=0, future=True), 2)
        self.assertEqual([item["date"] for item in store.list_items()], ["2026-01-31", "2026-02-28"])
        self.assertTrue(all(item["repeat_until"] == "2026-02-28" for item in store.list_items()))
        backup = {"format": "todotodo-v3", "items": store.list_items()}
        for item in store.list_items():
            store.delete_item(item["id"])
        self.assertEqual(store.import_items(backup)["imported"], 2)
        self.assertEqual(store.list_items(), backup["items"])

    def test_repeat_conversion_validation_and_atomic_limit(self):
        task = store.create_item({"title": "스트레칭", "kind": "task", "date": "2026-10-01"})
        changed = store.update_item(task["id"], {"repeat": "weekly", "repeat_until": "2026-10-22"}, expected_revision=0)
        self.assertEqual(changed["series_id"], task["id"])
        self.assertEqual([item["date"] for item in store.list_items()],
                         ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"])
        with self.assertRaises(store.ConflictError):
            store.update_item(task["id"], {"title": "오래된 수정"}, expected_revision=0)
        with self.assertRaises(ValueError):
            store.update_item(task["id"], {"repeat": "daily", "repeat_until": "2026-10-25"})
        with self.assertRaises(ValueError):
            store.update_item(task["id"], {"kind": "idea"})
        self.assertEqual(len(store.list_items()), 4)
        for fields in (
            {"repeat": "daily", "repeat_until": "2026-10-03"},
            {"date": "2026-10-01", "repeat": "monthly", "repeat_until": "2026-09-30"},
            {"date": "2026-10-01", "repeat": "daily", "repeat_until": "2030-01-01"},
            {"date": "2026-10-01", "repeat": "hourly", "repeat_until": "2026-10-03"},
            {"date": "2026-10-01", "kind": "idea", "repeat": "daily", "repeat_until": "2026-10-03"},
        ):
            with self.assertRaises(ValueError):
                store.create_item({"title": "잘못된 반복", **fields})
        self.assertEqual(len(store.list_items()), 4)

    def test_deleting_one_repeat_updates_end_only_when_last_date_changes(self):
        first = store.create_item({"title": "주간 정리", "date": "2026-10-01",
                                   "repeat": "weekly", "repeat_until": "2026-10-22"})
        entries = store.list_items()
        self.assertTrue(store.delete_item(entries[1]["id"], expected_revision=0))
        self.assertEqual(store.get_item(first["id"])["repeat_until"], "2026-10-22")
        self.assertEqual(store.get_item(first["id"])["revision"], 0)
        self.assertTrue(store.delete_item(entries[3]["id"], expected_revision=0))
        self.assertEqual(store.get_item(first["id"])["repeat_until"], "2026-10-15")
        self.assertEqual(store.get_item(first["id"])["revision"], 1)

    def test_moving_one_repeat_keeps_unique_dates_and_series_end_consistent(self):
        first = store.create_item({"title": "Weekly", "date": "2026-10-01",
                                   "repeat": "weekly", "repeat_until": "2026-10-22"})
        entries = store.list_items()
        with self.assertRaises(ValueError):
            store.update_item(entries[1]["id"], {"date": ""}, expected_revision=0)
        with self.assertRaises(ValueError):
            store.update_item(entries[1]["id"], {"date": "2026-10-15"}, expected_revision=0)
        self.assertEqual(store.list_items(), entries)
        moved = store.update_item(entries[3]["id"], {"date": "2026-10-16"}, expected_revision=0)
        self.assertEqual(moved["revision"], 1)
        self.assertEqual(moved["repeat_until"], "2026-10-16")
        self.assertEqual({item["repeat_until"] for item in store.list_items()}, {"2026-10-16"})
        moved_again = store.update_item(entries[1]["id"], {"date": "2026-10-29"}, expected_revision=1)
        self.assertEqual(moved_again["repeat_until"], "2026-10-29")
        self.assertEqual({item["repeat_until"] for item in store.list_items()}, {"2026-10-29"})
        self.assertEqual(store.get_item(first["id"])["date"], "2026-10-01")

    def test_legacy_undated_repeat_cannot_delete_entire_series(self):
        store.create_item({"title": "Weekly", "date": "2026-10-01",
                           "repeat": "weekly", "repeat_until": "2026-10-15"})
        entries = store.list_items()
        with store.connection() as db:
            db.execute("UPDATE items SET date = '' WHERE id = ?", (entries[1]["id"],))
        with self.assertRaises(ValueError):
            store.delete_item(entries[1]["id"], expected_revision=0, future=True)
        with self.assertRaises(ValueError):
            store.update_item(entries[1]["id"], {"title": "Changed"}, expected_revision=0, future=True)
        self.assertEqual(len(store.list_items()), 3)

    def test_unchanged_repeat_date_does_not_rewrite_other_occurrences(self):
        store.create_item({"title": "Weekly", "date": "2026-10-01",
                           "repeat": "weekly", "repeat_until": "2026-10-20"})
        entries = store.list_items()
        changed = store.update_item(entries[1]["id"], {"title": "One week", "date": "2026-10-08"},
                                    expected_revision=0)
        self.assertEqual(changed["repeat_until"], "2026-10-20")
        self.assertEqual([item["revision"] for item in store.list_items()], [0, 1, 0])

    def test_future_edit_updates_only_supplied_fields_and_preserves_completion(self):
        first = store.create_item({"title": "Weekly", "kind": "event", "date": "2026-10-01",
                                   "time": "10:00", "end_time": "11:00", "repeat": "weekly", "repeat_until": "2026-10-22"})
        entries = store.list_items()
        store.update_item(entries[1]["id"], {"details": "Special notes", "status": "done"})
        changed = store.update_item(entries[1]["id"], {"title": "Updated", "time": "11:00", "end_time": "12:00"},
                                    expected_revision=1, future=True)
        self.assertEqual(changed["revision"], 2)
        self.assertEqual([item["title"] for item in store.list_items()], ["Weekly", "Updated", "Updated", "Updated"])
        self.assertEqual([item["status"] for item in store.list_items()], ["todo", "done", "todo", "todo"])
        self.assertEqual([item["details"] for item in store.list_items()], ["", "Special notes", "", ""])
        self.assertEqual([item["date"] for item in store.list_items()], ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"])
        with self.assertRaises(store.ConflictError):
            store.update_item(entries[1]["id"], {"title": "Stale"}, expected_revision=1, future=True)
        with self.assertRaises(ValueError):
            store.update_item(entries[1]["id"], {"date": "2026-10-09"}, future=True)
        with self.assertRaises(ValueError):
            store.update_item(first["id"], {"status": "done"}, future=True)
        self.assertEqual(store.list_items()[2]["title"], "Updated")

    def test_future_time_edit_is_atomic_when_one_date_has_a_custom_end_time(self):
        store.create_item({"title": "Weekly", "kind": "event", "date": "2026-10-01",
                           "time": "10:00", "end_time": "12:00", "repeat": "weekly", "repeat_until": "2026-10-22"})
        entries = store.list_items()
        store.update_item(entries[2]["id"], {"end_time": "11:00"})
        before = store.list_items()
        with self.assertRaises(ValueError):
            store.update_item(entries[1]["id"], {"time": "11:30"}, expected_revision=0, future=True)
        self.assertEqual(store.list_items(), before)

    def test_backup_import_is_idempotent_and_atomic(self):
        first = store.create_item({"title": "되찾을 생각", "kind": "idea", "details": "원본 메모"})
        backup = {"format": "todotodo-v2", "items": store.list_items()}
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
            store.update_item(item["id"], {"date": "", "time": "09:30"}, expected_revision=item["revision"])
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
        self.assertEqual(store.get_item("a" * 32)["end_time"], "")
        self.assertEqual((store.get_item("a" * 32)["repeat"], store.get_item("a" * 32)["series_id"]), ("", ""))
        item = store.create_item({"title": "옛날 백업"})
        legacy = {key: value for key, value in item.items() if key not in ("revision", "end_time", "repeat", "repeat_until", "series_id")}
        store.delete_item(item["id"])
        self.assertEqual(store.import_items({"format": "todotodo-v1", "items": [legacy]}), {"imported": 1, "skipped": 0})
        self.assertEqual(store.get_item(item["id"])["revision"], 0)
        self.assertEqual(store.get_item(item["id"])["end_time"], "")
        with_revision = {key: value for key, value in store.create_item({"title": "최근 옛 백업"}).items() if key not in ("end_time", "repeat", "repeat_until", "series_id")}
        store.delete_item(with_revision["id"])
        self.assertEqual(store.import_items({"format": "todotodo-v1", "items": [with_revision]})["imported"], 1)
        self.assertEqual(store.get_item(with_revision["id"])["end_time"], "")


if __name__ == "__main__":
    unittest.main()
