"""MCP stdio tools for agent clients. Install with: pip install -e ."""

from mcp.server import MCPServer

from store import create_item, day_brief, get_item, init_db, list_items, update_item

init_db()
mcp = MCPServer("TodoTodo")


@mcp.tool()
def list_entries(kind: str = "", scope: str = "", status: str = "", query: str = "") -> list[dict]:
    """Find tasks, ideas, and events. Optional kind: task/idea/event; scope: work/personal; status: todo/doing/done."""
    return list_items(kind=kind or None, scope=scope or None, status=status or None, query=query or None)


@mcp.tool()
def get_entry(item_id: str) -> dict:
    """Read one entry by ID."""
    return get_item(item_id) or {"error": "Entry not found"}


@mcp.tool()
def capture_entry(title: str, kind: str = "task", scope: str = "personal", details: str = "",
                  date: str = "", time: str = "", priority: str = "normal", tags: str = "") -> dict:
    """Capture a task, idea, or event. Date is YYYY-MM-DD and time is HH:MM local time; leave blank if unscheduled."""
    return create_item({"title": title, "kind": kind, "scope": scope, "details": details,
                        "date": date, "time": time, "priority": priority, "tags": tags}, source="mcp")


@mcp.tool()
def revise_entry(item_id: str, title: str | None = None, details: str | None = None,
                 date: str | None = None, time: str | None = None, status: str | None = None,
                 priority: str | None = None, tags: str | None = None) -> dict:
    """Update supplied fields of an entry. Pass an empty date/time/tags string to clear it."""
    changes = {key: value for key, value in locals().items() if key != "item_id" and value is not None}
    return update_item(item_id, changes) or {"error": "Entry not found"}


@mcp.tool()
def mark_done(item_id: str) -> dict:
    """Mark a task, idea, or event complete by ID."""
    return update_item(item_id, {"status": "done"}) or {"error": "Entry not found"}


@mcp.tool()
def get_daily_brief(day: str = "", scope: str = "") -> dict:
    """Get today's schedule, overdue tasks, and open ideas. Optional day: YYYY-MM-DD; scope: work/personal."""
    return day_brief(day or None, scope or None)


if __name__ == "__main__":
    mcp.run()
