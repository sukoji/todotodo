"""MCP stdio tools for agent clients. Install with: pip install -e ."""

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from store import create_item, day_brief, get_item, init_db, list_items, update_item

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
                  date: str = "", time: str = "", end_time: str = "", priority: str = "normal", tags: str = "") -> dict:
    """Capture a task, idea, or event. Times are HH:MM local; end_time is optional and must be later than time on the same date."""
    try:
        return create_item({"title": title, "kind": kind, "scope": scope, "details": details,
                            "date": date, "time": time, "end_time": end_time, "priority": priority, "tags": tags}, source="mcp")
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool()
def revise_entry(item_id: str, title: str | None = None, details: str | None = None,
                 date: str | None = None, time: str | None = None, end_time: str | None = None, status: str | None = None,
                 priority: str | None = None, tags: str | None = None) -> dict:
    """Update supplied fields. end_time must be later than time; pass empty strings to clear date, time, end_time, or tags."""
    changes = {key: value for key, value in locals().items() if key != "item_id" and value is not None}
    try:
        return update_item(item_id, changes) or {"error": "Entry not found"}
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool()
def mark_done(item_id: str) -> dict:
    """Mark a task, idea, or event complete by ID."""
    return update_item(item_id, {"status": "done"}) or {"error": "Entry not found"}


@mcp.tool()
def get_daily_brief(day: str = "", scope: str = "") -> dict:
    """Get today's schedule, overdue tasks, and open ideas. Optional day: YYYY-MM-DD; scope: work/personal."""
    try:
        return day_brief(day or None, scope or None)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


if __name__ == "__main__":
    mcp.run()
