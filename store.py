"""Shared SQLite storage for the web app and MCP tools."""

import calendar
import ctypes
import os
import re
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta
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
REPEATS = {"", "daily", "weekly", "monthly"}
FIELDS = {"title", "details", "kind", "scope", "status", "priority", "date", "time", "end_time", "tags"}
LEGACY_BACKUP_FIELDS = (FIELDS - {"end_time"}) | {"id", "source", "created_at", "updated_at"}
CURRENT_BACKUP_FIELDS = FIELDS | {"id", "source", "created_at", "updated_at"}
SERIES_BACKUP_FIELDS = CURRENT_BACKUP_FIELDS | {"repeat", "repeat_until", "series_id"}
BACKUP_FIELDS = SERIES_BACKUP_FIELDS | {"revision"}


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
            repeat TEXT NOT NULL DEFAULT '', repeat_until TEXT NOT NULL DEFAULT '', series_id TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0
        )""")
        columns = {row["name"] for row in db.execute("PRAGMA table_info(items)")}
        if "revision" not in columns:
            db.execute("ALTER TABLE items ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
        if "end_time" not in columns:
            db.execute("ALTER TABLE items ADD COLUMN end_time TEXT NOT NULL DEFAULT ''")
        for column in ("repeat", "repeat_until", "series_id"):
            if column not in columns:
                db.execute(f"ALTER TABLE items ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        db.execute("CREATE INDEX IF NOT EXISTS idx_items_date ON items(date)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_items_series ON items(series_id, date)")


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


def recurring_dates(start, until, repeat, kind):
    if not isinstance(repeat, str) or repeat not in REPEATS:
        raise ValueError("반복은 매일·매주·매월 중에서 선택하세요.")
    if not isinstance(until, str):
        raise ValueError("반복 종료 날짜는 문자열이어야 합니다.")
    if not repeat:
        if until:
            raise ValueError("반복 종료 날짜를 쓰려면 반복을 선택하세요.")
        return [start]
    if kind == "idea":
        raise ValueError("아이디어는 반복할 수 없습니다.")
    if not start or not until:
        raise ValueError("반복하려면 시작 날짜와 종료 날짜를 선택하세요.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", until):
        raise ValueError("반복 종료 날짜는 YYYY-MM-DD 형식이어야 합니다.")
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(until)
    except ValueError as exc:
        raise ValueError("반복 날짜가 올바르지 않습니다.") from exc
    if last < first:
        raise ValueError("반복 종료 날짜는 시작 날짜보다 이르지 않아야 합니다.")
    dates, current, month = [], first, 0
    while current <= last:
        dates.append(current.isoformat())
        if len(dates) > 1000:
            raise ValueError("반복은 한 번에 1,000개 이하로 만드세요.")
        if repeat == "daily":
            if current == date.max:
                break
            current += timedelta(days=1)
        elif repeat == "weekly":
            if (date.max - current).days < 7:
                break
            current += timedelta(days=7)
        else:
            month += 1
            year = first.year + (first.month - 1 + month) // 12
            if year > 9999:
                break
            number = (first.month - 1 + month) % 12 + 1
            current = date(year, number, min(first.day, calendar.monthrange(year, number)[1]))
    return dates


def insert_item(db, item, ignore=False):
    action = "INSERT OR IGNORE" if ignore else "INSERT"
    return db.execute(f"""{action} INTO items
        (id,title,details,kind,scope,status,priority,date,time,end_time,repeat,repeat_until,series_id,tags,source,created_at,updated_at,revision)
        VALUES (:id,:title,:details,:kind,:scope,:status,:priority,:date,:time,:end_time,:repeat,:repeat_until,:series_id,:tags,:source,:created_at,:updated_at,:revision)""", item)


def create_item(data, source="web"):
    data = dict(data) if isinstance(data, dict) else data
    repeat = data.pop("repeat", "") if isinstance(data, dict) else ""
    repeat_until = data.pop("repeat_until", "") if isinstance(data, dict) else ""
    validate(data)
    validate_schedule(data)
    dates = recurring_dates(data.get("date", ""), repeat_until, repeat, data.get("kind", "task"))
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    item_id = uuid.uuid4().hex
    item = {
        "id": item_id, "title": data["title"].strip(),
        "details": data.get("details", "").strip(), "kind": data.get("kind", "task"),
        "scope": data.get("scope", "personal"), "status": data.get("status", "todo"),
        "priority": data.get("priority", "normal"), "date": data.get("date", ""),
        "time": data.get("time", ""), "end_time": data.get("end_time", ""),
        "repeat": repeat, "repeat_until": repeat_until, "series_id": item_id if repeat else "",
        "tags": data.get("tags", "").strip(),
        "source": source, "created_at": now, "updated_at": now, "revision": 0,
    }
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        for index, day in enumerate(dates):
            insert_item(db, {**item, "id": item_id if index == 0 else uuid.uuid4().hex,
                             "date": day, "status": item["status"] if index == 0 else "todo"})
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


def update_item(item_id, data, expected_revision=None, future=False):
    if expected_revision is not None:
        validate_revision(expected_revision)
    if type(future) is not bool:
        raise ValueError("이후 반복 수정 옵션이 올바르지 않습니다.")
    data = dict(data) if isinstance(data, dict) else data
    repeat = data.pop("repeat", "") if isinstance(data, dict) else ""
    repeat_until = data.pop("repeat_until", "") if isinstance(data, dict) else ""
    validate(data, partial=True)
    if future and (repeat or repeat_until or not data or set(data) - {"title", "details", "kind", "scope", "priority", "time", "end_time", "tags"}):
        raise ValueError("이후 반복에는 제목·메모·종류·공간·우선순위·시간·태그만 수정할 수 있습니다.")
    if not data and not repeat:
        raise ValueError("변경할 필드가 없습니다.")
    for key in ("title", "details", "tags"):
        if key in data:
            data[key] = data[key].strip()
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        if not current:
            return None
        if expected_revision is not None and current["revision"] != expected_revision:
            raise ConflictError("기록이 다른 곳에서 바뀌었습니다.")
        if future and not current["series_id"]:
            raise ValueError("반복 기록만 이후 일정을 수정할 수 있습니다.")
        if future and not current["date"]:
            raise ValueError("날짜가 없는 반복 기록은 먼저 날짜를 지정하세요.")
        if current["series_id"] and data.get("kind") == "idea":
            raise ValueError("반복 기록은 아이디어로 바꿀 수 없습니다.")
        if any(key in data for key in ("date", "time", "end_time")):
            validate_schedule({key: data.get(key, current[key]) for key in ("date", "time", "end_time")})
        if future:
            if "time" in data or "end_time" in data:
                future_rows = db.execute("SELECT date, time, end_time FROM items WHERE series_id = ? AND date >= ?",
                                         (current["series_id"], current["date"])).fetchall()
                for row in future_rows:
                    validate_schedule({"date": row["date"], "time": data.get("time", row["time"]),
                                       "end_time": data.get("end_time", row["end_time"])})
            data["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
            assignments = ", ".join(f"{key} = ?" for key in data) + ", revision = revision + 1"
            db.execute(f"UPDATE items SET {assignments} WHERE series_id = ? AND date >= ?",
                       [*data.values(), current["series_id"], current["date"]])
            return dict(db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone())
        series_end = None
        if current["series_id"] and "date" in data and data["date"] != current["date"]:
            if not data["date"]:
                raise ValueError("반복 기록에는 날짜가 필요합니다.")
            duplicate = db.execute("SELECT 1 FROM items WHERE series_id = ? AND date = ? AND id <> ?",
                                   (current["series_id"], data["date"], item_id)).fetchone()
            if duplicate:
                raise ValueError("같은 반복에 이미 그 날짜의 기록이 있습니다.")
            other_end = db.execute("SELECT MAX(date) FROM items WHERE series_id = ? AND id <> ?",
                                   (current["series_id"], item_id)).fetchone()[0]
            series_end = max(data["date"], other_end or data["date"])
            data["repeat_until"] = series_end
        if repeat or repeat_until:
            if current["series_id"]:
                raise ValueError("반복으로 만든 날짜는 개별 기록만 수정할 수 있습니다.")
            dates = recurring_dates(data.get("date", current["date"]), repeat_until, repeat,
                                    data.get("kind", current["kind"]))
            data.update({"repeat": repeat, "repeat_until": repeat_until, "series_id": item_id})
        else:
            dates = []
        data["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
        assignments = ", ".join(f"{key} = ?" for key in data) + ", revision = revision + 1"
        where = "id = ?" + (" AND revision = ?" if expected_revision is not None else "")
        params = [*data.values(), item_id] + ([expected_revision] if expected_revision is not None else [])
        result = db.execute(f"UPDATE items SET {assignments} WHERE {where}", params)
        if not result.rowcount:
            if expected_revision is not None and db.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone():
                raise ConflictError("기록이 다른 곳에서 바뀌었습니다.")
            return None
        if series_end is not None:
            db.execute("""UPDATE items SET repeat_until = ?, updated_at = ?, revision = revision + 1
                WHERE series_id = ? AND id <> ? AND repeat_until <> ?""",
                (series_end, data["updated_at"], current["series_id"], item_id, series_end))
        updated = dict(db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone())
        for day in dates[1:]:
            insert_item(db, {**updated, "id": uuid.uuid4().hex, "date": day,
                             "status": "todo", "revision": 0})
        return updated


def delete_item(item_id, expected_revision=None, future=False):
    if expected_revision is not None:
        validate_revision(expected_revision)
    if type(future) is not bool:
        raise ValueError("반복 삭제 옵션이 올바르지 않습니다.")
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT series_id, date, revision FROM items WHERE id = ?", (item_id,)).fetchone()
        if not current:
            return 0 if future else False
        if expected_revision is not None and current["revision"] != expected_revision:
            raise ConflictError("기록이 다른 곳에서 바뀌었습니다.")
        if future and not current["series_id"]:
            raise ValueError("반복 기록만 이후 일정을 삭제할 수 있습니다.")
        if future and not current["date"]:
            raise ValueError("날짜가 없는 반복 기록은 먼저 날짜를 지정하세요.")
        if future:
            count = db.execute("DELETE FROM items WHERE series_id = ? AND date >= ?",
                               (current["series_id"], current["date"])).rowcount
        else:
            count = db.execute("DELETE FROM items WHERE id = ?", (item_id,)).rowcount
        if current["series_id"]:
            last = db.execute("SELECT MAX(date) FROM items WHERE series_id = ?", (current["series_id"],)).fetchone()[0]
            if last:
                updated_at = datetime.now().astimezone().isoformat(timespec="seconds")
                db.execute("""UPDATE items SET repeat_until = ?, updated_at = ?, revision = revision + 1
                    WHERE series_id = ? AND repeat_until <> ?""",
                    (last, updated_at, current["series_id"], last))
        return count if future else count > 0


def import_items(backup):
    if not isinstance(backup, dict) or backup.get("format") not in ("todotodo-v1", "todotodo-v2", "todotodo-v3") or not isinstance(backup.get("items"), list):
        raise ValueError("TodoTodo 백업 파일이 아닙니다.")
    items = backup["items"]
    if len(items) > 100000:
        raise ValueError("한 번에 100,000개 이하의 항목만 가져올 수 있습니다.")
    for item in items:
        if not isinstance(item, dict) or set(item) not in (LEGACY_BACKUP_FIELDS, LEGACY_BACKUP_FIELDS | {"revision"},
                                                       CURRENT_BACKUP_FIELDS, CURRENT_BACKUP_FIELDS | {"revision"},
                                                       SERIES_BACKUP_FIELDS, BACKUP_FIELDS):
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
        repeat, until, series_id = item.get("repeat", ""), item.get("repeat_until", ""), item.get("series_id", "")
        if not isinstance(repeat, str) or repeat not in REPEATS or not isinstance(until, str) or not isinstance(series_id, str):
            raise ValueError("백업 항목의 반복 정보가 올바르지 않습니다.")
        if repeat:
            if item["kind"] == "idea" or not item["date"] or not re.fullmatch(r"[a-f0-9]{32}", series_id):
                raise ValueError("백업 항목의 반복 정보가 올바르지 않습니다.")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", until):
                raise ValueError("백업 항목의 반복 종료 날짜가 올바르지 않습니다.")
            try:
                date.fromisoformat(until)
            except ValueError as exc:
                raise ValueError("백업 항목의 반복 종료 날짜가 올바르지 않습니다.") from exc
        elif until or series_id:
            raise ValueError("백업 항목의 반복 정보가 올바르지 않습니다.")

    imported = 0
    with connection() as db:
        for item in items:
            entry = {**item, "end_time": item.get("end_time", ""), "repeat": item.get("repeat", ""),
                     "repeat_until": item.get("repeat_until", ""), "series_id": item.get("series_id", ""),
                     "revision": item.get("revision", 0)}
            result = insert_item(db, entry, ignore=True)
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
