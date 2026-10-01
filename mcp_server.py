"""MCP stdio tools for agent clients. Install with: pip install -e ."""

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from store import ConflictError, create_item, day_brief, delete_item, get_item, init_db, list_items, update_item

init_db()
mcp = MCPServer("TodoTodo")


@mcp.tool()
def list_entries(kind: str = "", scope: str = "", status: str = "", query: str = "") -> list[dict]:
    """Find tasks, ideas, and events. Optional kind: task/idea/event; scope: work/personal; status: todo/doing/done."""
    try:
        return list_items(kind=kind or None, scope=scope or None, status=status or None, query=query or None)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool()
def get_entry(item_id: str) -> dict:
    """Read one entry by ID."""
    return get_item(item_id) or {"error": "Entry not found"}


@mcp.tool()
def capture_entry(title: str, kind: str = "task", scope: str = "personal", details: str = "",
                  date: str = "", time: str = "", end_time: str = "", priority: str = "normal", tags: str = "",
                  repeat: str = "", repeat_until: str = "") -> dict:
    """Capture a task, idea, or event. Times are HH:MM local. For tasks/events, repeat may be daily/weekly/monthly and requires repeat_until (YYYY-MM-DD); up to 1,000 occurrences."""
    try:
        return create_item({"title": title, "kind": kind, "scope": scope, "details": details,
                            "date": date, "time": time, "end_time": end_time, "priority": priority, "tags": tags,
                            "repeat": repeat, "repeat_until": repeat_until}, source="mcp")
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool()
def revise_entry(item_id: str, title: str | None = None, details: str | None = None,
                  date: str | None = None, time: str | None = None, end_time: str | None = None, status: str | None = None,
                  priority: str | None = None, tags: str | None = None, kind: str | None = None,
                  scope: str | None = None, repeat: str | None = None, repeat_until: str | None = None,
                  expected_revision: int | None = None, future: bool = False) -> dict:
    """Update supplied fields. Use future=True on a repeated entry to apply title/details/kind/scope/priority/time/end_time/tags from that date onward; dates and completion stay individual. A one-off can start repeating with repeat and repeat_until. Pass expected_revision to protect concurrent edits."""
    changes = {key: value for key, value in locals().items() if key not in ("item_id", "expected_revision", "future") and value is not None}
    try:
        return update_item(item_id, changes, expected_revision=expected_revision, future=future) or {"error": "Entry not found"}
    except (ValueError, ConflictError) as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool()
def mark_done(item_id: str, expected_revision: int | None = None) -> dict:
    """Mark an entry complete. Pass expected_revision from get_entry or list_entries to protect concurrent edits."""
    try:
        return update_item(item_id, {"status": "done"}, expected_revision=expected_revision) or {"error": "Entry not found"}
    except (ValueError, ConflictError) as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool()
def stop_repeat(item_id: str, expected_revision: int | None = None) -> dict:
    """Delete the selected repeated occurrence and all later occurrences in its series. Pass expected_revision to protect concurrent edits."""
    try:
        deleted = delete_item(item_id, expected_revision=expected_revision, future=True)
        return {"deleted": deleted} if deleted else {"error": "Entry not found"}
    except (ValueError, ConflictError) as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool()
def get_daily_brief(day: str = "", scope: str = "") -> dict:
    """Get today's schedule, overdue tasks, and open ideas. Optional day: YYYY-MM-DD; scope: work/personal."""
    try:
        return day_brief(day or None, scope or None)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


if __name__ == "__main__":
    mcp.run()
