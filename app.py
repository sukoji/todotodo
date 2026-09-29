"""Local web server. Run with: python app.py"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from store import create_item, day_brief, delete_item, init_db, list_items, update_item

STATIC = Path(__file__).with_name("static")
FILES = {"/": ("index.html", "text/html; charset=utf-8"),
         "/app.js": ("app.js", "text/javascript; charset=utf-8"),
         "/styles.css": ("styles.css", "text/css; charset=utf-8"),
         "/theme.css": ("theme.css", "text/css; charset=utf-8"),
         "/logo.svg": ("logo.svg", "image/svg+xml"),
         "/empty.svg": ("empty.svg", "image/svg+xml")}


class Handler(BaseHTTPRequestHandler):
    def send_data(self, status, body, content_type="application/json; charset=utf-8"):
        raw = json.dumps(body, ensure_ascii=False).encode() if isinstance(body, (dict, list)) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            raise ValueError("Content-Type은 application/json이어야 합니다.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 1 or length > 20000:
            raise ValueError("요청 크기가 올바르지 않습니다.")
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as exc:
            raise ValueError("올바른 JSON이 아닙니다.") from exc

    def dispatch(self):
        parsed = urlparse(self.path)
        path = parsed.path
        token = os.environ.get("TODOTODO_TOKEN")
        if token and path.startswith("/api/") and self.headers.get("Authorization") != f"Bearer {token}":
            return self.send_data(401, {"error": "인증이 필요합니다."})
        if self.command == "GET" and path in FILES:
            filename, content_type = FILES[path]
            return self.send_data(200, (STATIC / filename).read_bytes(), content_type)
        if path == "/api/items":
            if self.command == "GET":
                params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
                return self.send_data(200, list_items(**params))
            if self.command == "POST":
                return self.send_data(201, create_item(self.read_json()))
        if path == "/api/brief" and self.command == "GET":
            params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
            return self.send_data(200, day_brief(**params))
        if path == "/api/export" and self.command == "GET":
            return self.send_data(200, {"format": "todotodo-v1", "items": list_items()})
        if path.startswith("/api/items/"):
            item_id = path.removeprefix("/api/items/")
            if not item_id or "/" in item_id:
                return self.send_data(404, {"error": "찾을 수 없습니다."})
            if self.command == "PATCH":
                item = update_item(item_id, self.read_json())
                return self.send_data(200, item) if item else self.send_data(404, {"error": "항목을 찾을 수 없습니다."})
            if self.command == "DELETE":
                return self.send_data(200, {"deleted": True}) if delete_item(item_id) else self.send_data(404, {"error": "항목을 찾을 수 없습니다."})
        return self.send_data(404, {"error": "찾을 수 없습니다."})

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def do_PATCH(self):
        self.handle_request()

    def do_DELETE(self):
        self.handle_request()

    def handle_request(self):
        try:
            self.dispatch()
        except (ValueError, TypeError) as exc:
            self.send_data(400, {"error": str(exc)})


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("TODOTODO_PORT", "8765"))), Handler)
    print(f"TodoTodo: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
