"""Shared SQLite storage for the web app and MCP tools."""

import ctypes
import os
import re
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

def _default_db_path():
    if not getattr(sys, "frozen", False):
        return Path(__file__).with_name("todotodo.db")
    if sys.platform == "win32":
        folder = ctypes.create_unicode_buffer(260)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x001A, None, 0, folder) != 0:
            raise OSError("Windows roaming app data folder is unavailable")
        return Path(folder.value) / "TodoTodo" / "todotodo.db"
    return Path(os.environ.get("APPDATA", Path.home())) / "TodoTodo" / "todotodo.db"


DB_PATH = Path(os.environ["TODOTODO_DB"]) if "TODOTODO_DB" in os.environ else _default_db_path()
KINDS = {"task", "idea", "event"}
SCOPES = {"work", "personal"}
STATUSES = {"todo", "doing", "done"}
PRIORITIES = {"low", "normal", "high"}
FIELDS = {"title", "details", "kind", "scope", "status", "priority", "date", "time", "end_time", "tags"}
LEGACY_BACKUP_FIELDS = (FIELDS - {"end_time"}) | {"id", "source", "created_at", "updated_at"}
CURRENT_BACKUP_FIELDS = FIELDS | {"id", "source", "created_at", "updated_at"}
BACKUP_FIELDS = CURRENT_BACKUP_FIELDS | {"revision"}


class ConflictError(Exception):
    pass


def validate_revision(value):
    if type(value) is not int or value < 0:
        raise ValueError("개정 번호가 올바르지 않습니다.")


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout=10000")
        try:
            db.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).lower():
                raise
            # Another process can be switching the same database to WAL at startup.
        yield db
        db.commit()
    finally:
        db.close()


def init_db():
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("""CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL,
            priority TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', time TEXT NOT NULL DEFAULT '',
            end_time TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0
        )""")
        columns = {row["name"] for row in db.execute("PRAGMA table_info(items)")}
        if "revision" not in columns:
            db.execute("ALTER TABLE items ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
        if "end_time" not in columns:
            db.execute("ALTER TABLE items ADD COLUMN end_time TEXT NOT NULL DEFAULT ''")
        db.execute("CREATE INDEX IF NOT EXISTS idx_items_date ON items(date)")


def validate(data, *, partial=False):
    if not isinstance(data, dict):
        raise ValueError("JSON 객체가 필요합니다.")
    unknown = set(data) - FIELDS
    if unknown:
        raise ValueError(f"알 수 없는 필드: {', '.join(sorted(unknown))}")
    if not partial and not str(data.get("title", "")).strip():
        raise ValueError("제목을 입력하세요.")
    for key in ("title", "details", "date", "time", "end_time", "tags"):
        if key in data and not isinstance(data[key], str):
            raise ValueError(f"{key}는 문자열이어야 합니다.")
    if "title" in data and not 1 <= len(data["title"].strip()) <= 200:
        raise ValueError("제목은 1~200자여야 합니다.")
    if "details" in data and len(data["details"]) > 10000:
        raise ValueError("내용은 10,000자 이하여야 합니다.")
    if "tags" in data and len(data["tags"]) > 500:
        raise ValueError("태그는 500자 이하여야 합니다.")
    for key, allowed in (("kind", KINDS), ("scope", SCOPES), ("status", STATUSES), ("priority", PRIORITIES)):
        if key in data and data[key] not in allowed:
            raise ValueError(f"{key}: {', '.join(sorted(allowed))} 중에서 선택하세요.")
    if data.get("date"):
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data["date"]):
                raise ValueError()
            date.fromisoformat(data["date"])
        except ValueError as exc:
            raise ValueError("날짜는 YYYY-MM-DD 형식이어야 합니다.") from exc
    for key, label in (("time", "시간"), ("end_time", "종료 시간")):
        if data.get(key):
            try:
                if not re.fullmatch(r"\d{2}:\d{2}", data[key]):
                    raise ValueError()
                datetime.strptime(data[key], "%H:%M")
            except ValueError as exc:
                raise ValueError(f"{label}은 HH:MM 형식이어야 합니다.") from exc


def validate_schedule(data):
    if data.get("time") and not data.get("date"):
        raise ValueError("시간을 입력하려면 날짜를 먼저 선택하세요.")
    if data.get("end_time") and not data.get("time"):
        raise ValueError("종료 시간을 입력하려면 시작 시간을 먼저 선택하세요.")
    if data.get("end_time") and data["end_time"] <= data["time"]:
        raise ValueError("종료 시간은 시작 시간보다 늦어야 합니다.")


def create_item(data, source="web"):
    validate(data)
    validate_schedule(data)
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    item = {
        "id": uuid.uuid4().hex, "title": data["title"].strip(),
        "details": data.get("details", "").strip(), "kind": data.get("kind", "task"),
        "scope": data.get("scope", "personal"), "status": data.get("status", "todo"),
        "priority": data.get("priority", "normal"), "date": data.get("date", ""),
        "time": data.get("time", ""), "end_time": data.get("end_time", ""),
        "tags": data.get("tags", "").strip(),
        "source": source, "created_at": now, "updated_at": now, "revision": 0,
    }
    with connection() as db:
        db.execute("""INSERT INTO items (id,title,details,kind,scope,status,priority,date,time,end_time,tags,source,created_at,updated_at,revision)
            VALUES (:id,:title,:details,:kind,:scope,:status,:priority,:date,:time,:end_time,:tags,:source,:created_at,:updated_at,:revision)""", item)
    return item


def list_items(kind=None, scope=None, status=None, query=None, start=None, end=None):
    conditions, params = [], []
    for field, value, allowed in (("kind", kind, KINDS), ("scope", scope, SCOPES), ("status", status, STATUSES)):
        if value:
            if value not in allowed:
                raise ValueError(f"잘못된 {field} 값입니다.")
            conditions.append(f"{field} = ?")
            params.append(value)
    if query:
        conditions.append("(title LIKE ? OR details LIKE ? OR tags LIKE ?)")
        term = f"%{query}%"
        params.extend([term] * 3)
    if start:
        date.fromisoformat(start)
        conditions.append("date >= ?")
        params.append(start)
    if end:
        date.fromisoformat(end)
        conditions.append("date <= ?")
        params.append(end)
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    with connection() as db:
        rows = db.execute("SELECT * FROM items" + where + " ORDER BY CASE WHEN date = '' THEN 1 ELSE 0 END, date, time, created_at DESC", params).fetchall()
    return [dict(row) for row in rows]


def get_item(item_id):
    with connection() as db:
        row = db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return dict(row) if row else None


def update_item(item_id, data, expected_revision=None):
    if expected_revision is not None:
        validate_revision(expected_revision)
    validate(data, partial=True)
    if not data:
        raise ValueError("변경할 필드가 없습니다.")
    data = dict(data)
    for key in ("title", "details", "tags"):
        if key in data:
            data[key] = data[key].strip()
    data["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    assignments = ", ".join(f"{key} = ?" for key in data) + ", revision = revision + 1"
    where = "id = ?" + (" AND revision = ?" if expected_revision is not None else "")
    params = [*data.values(), item_id] + ([expected_revision] if expected_revision is not None else [])
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT date, time, end_time, revision FROM items WHERE id = ?", (item_id,)).fetchone()
        if current and expected_revision is not None and current["revision"] != expected_revision:
            raise ConflictError("기록이 다른 곳에서 바뀌었습니다.")
        if current and any(key in data for key in ("date", "time", "end_time")):
            validate_schedule({key: data.get(key, current[key]) for key in ("date", "time", "end_time")})
        result = db.execute(f"UPDATE items SET {assignments} WHERE {where}", params)
        if not result.rowcount:
            if expected_revision is not None and db.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone():
                raise ConflictError("기록이 다른 곳에서 바뀌었습니다.")
            return None
        return dict(db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone())


def delete_item(item_id, expected_revision=None):
    if expected_revision is not None:
        validate_revision(expected_revision)
    where = "id = ?" + (" AND revision = ?" if expected_revision is not None else "")
    params = [item_id] + ([expected_revision] if expected_revision is not None else [])
    with connection() as db:
        result = db.execute(f"DELETE FROM items WHERE {where}", params)
        if not result.rowcount and expected_revision is not None and db.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone():
            raise ConflictError("기록이 다른 곳에서 바뀌었습니다.")
        return result.rowcount > 0


def import_items(backup):
    if not isinstance(backup, dict) or backup.get("format") not in ("todotodo-v1", "todotodo-v2") or not isinstance(backup.get("items"), list):
        raise ValueError("TodoTodo 백업 파일이 아닙니다.")
    items = backup["items"]
    if len(items) > 10000:
        raise ValueError("한 번에 10,000개 이하의 항목만 가져올 수 있습니다.")
    for item in items:
        if not isinstance(item, dict) or set(item) not in (LEGACY_BACKUP_FIELDS, LEGACY_BACKUP_FIELDS | {"revision"}, CURRENT_BACKUP_FIELDS, BACKUP_FIELDS):
            raise ValueError("백업 항목의 필드가 올바르지 않습니다.")
        if any(not isinstance(item[key], str) for key in LEGACY_BACKUP_FIELDS):
            raise ValueError("백업 항목의 값이 올바르지 않습니다.")
        if "revision" in item:
            validate_revision(item["revision"])
        if not re.fullmatch(r"[a-f0-9]{32}", item["id"]):
            raise ValueError("백업 항목의 ID가 올바르지 않습니다.")
        if not 1 <= len(item["source"]) <= 100:
            raise ValueError("백업 항목의 출처가 올바르지 않습니다.")
        for key in ("created_at", "updated_at"):
            try:
                parsed = datetime.fromisoformat(item[key])
                if parsed.tzinfo is None:
                    raise ValueError()
            except ValueError as exc:
                raise ValueError("백업 항목의 시간이 올바르지 않습니다.") from exc
        validate({key: item[key] for key in FIELDS if key in item})
        if item.get("end_time"):
            validate_schedule(item)

    imported = 0
    with connection() as db:
        for item in items:
            entry = {**item, "end_time": item.get("end_time", ""), "revision": item.get("revision", 0)}
            result = db.execute("""INSERT OR IGNORE INTO items (id,title,details,kind,scope,status,priority,date,time,end_time,tags,source,created_at,updated_at,revision)
                VALUES (:id,:title,:details,:kind,:scope,:status,:priority,:date,:time,:end_time,:tags,:source,:created_at,:updated_at,:revision)""", entry)
            imported += result.rowcount
    return {"imported": imported, "skipped": len(items) - imported}


def day_brief(day=None, scope=None):
    day = day or date.today().isoformat()
    date.fromisoformat(day)
    items = list_items(scope=scope)
    due = [item for item in items if item["date"] == day and item["status"] != "done"]
    overdue = [item for item in items if item["date"] and item["date"] < day and item["kind"] == "task" and item["status"] != "done"]
    ideas = [item for item in items if item["kind"] == "idea" and item["status"] != "done"]
    return {"date": day, "due_today": due, "overdue": overdue, "open_ideas": ideas[:10]}
