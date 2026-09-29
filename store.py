"""Shared SQLite storage for the web app and MCP tools."""

import os
import re
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

_default_db = Path(os.environ.get("APPDATA", Path.home())) / "TodoTodo" / "todotodo.db" if getattr(sys, "frozen", False) else Path(__file__).with_name("todotodo.db")
DB_PATH = Path(os.environ.get("TODOTODO_DB", _default_db))
KINDS = {"task", "idea", "event"}
SCOPES = {"work", "personal"}
STATUSES = {"todo", "doing", "done"}
PRIORITIES = {"low", "normal", "high"}
FIELDS = {"title", "details", "kind", "scope", "status", "priority", "date", "time", "tags"}


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=10000")
        yield db
        db.commit()
    finally:
        db.close()


def init_db():
    with connection() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL,
            priority TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', time TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_items_date ON items(date)")


def validate(data, *, partial=False):
    if not isinstance(data, dict):
        raise ValueError("JSON 객체가 필요합니다.")
    unknown = set(data) - FIELDS
    if unknown:
        raise ValueError(f"알 수 없는 필드: {', '.join(sorted(unknown))}")
    if not partial and not str(data.get("title", "")).strip():
        raise ValueError("제목을 입력하세요.")
    for key in ("title", "details", "date", "time", "tags"):
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
    if data.get("time"):
        try:
            if not re.fullmatch(r"\d{2}:\d{2}", data["time"]):
                raise ValueError()
            datetime.strptime(data["time"], "%H:%M")
        except ValueError as exc:
            raise ValueError("시간은 HH:MM 형식이어야 합니다.") from exc


def create_item(data, source="web"):
    validate(data)
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    item = {
        "id": uuid.uuid4().hex, "title": data["title"].strip(),
        "details": data.get("details", "").strip(), "kind": data.get("kind", "task"),
        "scope": data.get("scope", "personal"), "status": data.get("status", "todo"),
        "priority": data.get("priority", "normal"), "date": data.get("date", ""),
        "time": data.get("time", ""), "tags": data.get("tags", "").strip(),
        "source": source, "created_at": now, "updated_at": now,
    }
    with connection() as db:
        db.execute("""INSERT INTO items VALUES
            (:id,:title,:details,:kind,:scope,:status,:priority,:date,:time,:tags,:source,:created_at,:updated_at)""", item)
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


def update_item(item_id, data):
    validate(data, partial=True)
    if not data:
        raise ValueError("변경할 필드가 없습니다.")
    data = dict(data)
    for key in ("title", "details", "tags"):
        if key in data:
            data[key] = data[key].strip()
    data["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    assignments = ", ".join(f"{key} = ?" for key in data)
    with connection() as db:
        result = db.execute(f"UPDATE items SET {assignments} WHERE id = ?", [*data.values(), item_id])
        if not result.rowcount:
            return None
    return get_item(item_id)


def delete_item(item_id):
    with connection() as db:
        return db.execute("DELETE FROM items WHERE id = ?", (item_id,)).rowcount > 0


def day_brief(day=None, scope=None):
    day = day or date.today().isoformat()
    date.fromisoformat(day)
    items = list_items(scope=scope)
    due = [item for item in items if item["date"] == day and item["status"] != "done"]
    overdue = [item for item in items if item["date"] and item["date"] < day and item["kind"] == "task" and item["status"] != "done"]
    ideas = [item for item in items if item["kind"] == "idea" and item["status"] != "done"]
    return {"date": day, "due_today": due, "overdue": overdue, "open_ideas": ideas[:10]}
