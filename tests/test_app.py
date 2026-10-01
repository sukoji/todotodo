import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

import app
import store


class APITests(unittest.TestCase):
    def test_embedded_server_stops_when_parent_pipe_closes(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, "TODOTODO_DB": str(Path(folder) / "items.db"),
                   "TODOTODO_PORT": "0", "TODOTODO_PARENT_PIPE": "1"}
            process = subprocess.Popen([sys.executable, "-u", str(Path(app.__file__))],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, env=env)
            try:
                output = queue.Queue()
                threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True).start()
                self.assertIn(b"TodoTodo: http://127.0.0.1:", output.get(timeout=8))
                process.stdin.close()
                self.assertEqual(process.wait(timeout=5), 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()

    def test_standalone_server_does_not_depend_on_parent_pipe(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, "TODOTODO_DB": str(Path(folder) / "items.db"), "TODOTODO_PORT": "0"}
            env.pop("TODOTODO_PARENT_PIPE", None)
            process = subprocess.Popen([sys.executable, "-u", str(Path(app.__file__))],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, env=env)
            try:
                output = queue.Queue()
                threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True).start()
                self.assertIn(b"TodoTodo: http://127.0.0.1:", output.get(timeout=8))
                self.assertIsNone(process.poll())
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()

    def test_electron_token_protects_shared_api(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(store, "DB_PATH", Path(folder) / "api.db"), patch.dict(os.environ, {"TODOTODO_TOKEN": "test-secret"}):
            store.init_db()
            server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_port}"
            try:
                version_request = Request(url + "/api/version", headers={"Authorization": "Bearer test-secret"})
                with self.assertRaises(HTTPError) as version_error:
                    urlopen(url + "/api/version")
                self.assertEqual(version_error.exception.code, 401)
                with urlopen(version_request) as response:
                    initial_version = json.load(response)["version"]
                with self.assertRaises(HTTPError) as error:
                    urlopen(url + "/api/items")
                self.assertEqual(error.exception.code, 401)
                request = Request(url + "/api/items", data=json.dumps({"title": "화면과 에이전트가 공유"}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="POST")
                with urlopen(request) as response:
                    self.assertEqual(response.status, 201)
                with urlopen(version_request) as response:
                    self.assertGreater(json.load(response)["version"], initial_version)
                self.assertEqual(store.list_items()[0]["title"], "화면과 에이전트가 공유")
                item = store.list_items()[0]
                patch_request = Request(url + f"/api/items/{item['id']}", data=json.dumps({"status": "doing", "expected_revision": 0}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="PATCH")
                with urlopen(patch_request) as response:
                    self.assertEqual(json.load(response)["revision"], 1)
                with self.assertRaises(HTTPError) as conflict:
                    urlopen(patch_request)
                self.assertEqual(conflict.exception.code, 409)
                delete_request = Request(url + f"/api/items/{item['id']}", data=json.dumps({"expected_revision": 0}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="DELETE")
                with self.assertRaises(HTTPError) as delete_conflict:
                    urlopen(delete_request)
                self.assertEqual(delete_conflict.exception.code, 409)
                self.assertEqual(store.get_item(item["id"])["status"], "doing")
                export_request = Request(url + "/api/export", headers={"Authorization": "Bearer test-secret"})
                with urlopen(export_request) as response:
                    backup = json.load(response)
                self.assertEqual(backup["format"], "todotodo-v3")
                self.assertEqual(backup["items"][0]["end_time"], "")
                import_request = Request(url + "/api/import", data=json.dumps(backup).encode(), headers={"Content-Type": "application/json"}, method="POST")
                with self.assertRaises(HTTPError) as error:
                    urlopen(import_request)
                self.assertEqual(error.exception.code, 401)
                import_request.add_header("Authorization", "Bearer test-secret")
                with urlopen(import_request) as response:
                    self.assertEqual(json.load(response), {"imported": 0, "skipped": 1})
                large_backup = json.dumps({"format": "todotodo-v1", "items": []}).encode() + b" " * 20_000_000
                large_request = Request(url + "/api/import", data=large_backup, headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="POST")
                with urlopen(large_request, timeout=30) as response:
                    self.assertEqual(json.load(response), {"imported": 0, "skipped": 0})
                repeat_request = Request(url + "/api/items", data=json.dumps({
                    "title": "주간 회의", "kind": "event", "date": "2026-10-01",
                    "repeat": "weekly", "repeat_until": "2026-10-22",
                }).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="POST")
                with urlopen(repeat_request) as response:
                    repeated = json.load(response)
                self.assertEqual(len([item for item in store.list_items() if item["series_id"] == repeated["id"]]), 4)
                last = next(item for item in store.list_items() if item["date"] == "2026-10-22")
                move_request = Request(url + f"/api/items/{last['id']}", data=json.dumps({
                    "date": "2026-10-20", "expected_revision": last["revision"],
                }).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="PATCH")
                with urlopen(move_request) as response:
                    self.assertEqual(json.load(response)["repeat_until"], "2026-10-20")
                self.assertEqual({item["repeat_until"] for item in store.list_items() if item["series_id"] == repeated["id"]},
                                 {"2026-10-20"})
                second = next(item for item in store.list_items() if item["date"] == "2026-10-08")
                future_patch = Request(url + f"/api/items/{second['id']}", data=json.dumps({
                    "details": "공통 안건", "future": True, "expected_revision": second["revision"],
                }).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="PATCH")
                with urlopen(future_patch) as response:
                    self.assertEqual(json.load(response)["details"], "공통 안건")
                self.assertEqual([item["details"] for item in store.list_items() if item["series_id"] == repeated["id"]],
                                 ["", "공통 안건", "공통 안건", "공통 안건"])
                second = store.get_item(second["id"])
                stop_request = Request(url + f"/api/items/{second['id']}", data=json.dumps({
                    "expected_revision": second["revision"], "future": True,
                }).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="DELETE")
                with urlopen(stop_request) as response:
                    self.assertEqual(json.load(response)["deleted"], 3)
                with urlopen(url + "/logo.svg") as response:
                    self.assertEqual(response.status, 200)
                with urlopen(url + "/") as response:
                    html = response.read().decode("utf-8")
                self.assertLess(html.index('src="./schedule-conflicts.js"'), html.index('src="./app.js"'))
                with urlopen(url + "/schedule-conflicts.js") as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn(b"function timeOverlaps", response.read())
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
