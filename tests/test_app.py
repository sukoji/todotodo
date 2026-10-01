import json
import os
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
    def test_electron_token_protects_shared_api(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(store, "DB_PATH", Path(folder) / "api.db"), patch.dict(os.environ, {"TODOTODO_TOKEN": "test-secret"}):
            store.init_db()
            server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_port}"
            try:
                with self.assertRaises(HTTPError) as error:
                    urlopen(url + "/api/items")
                self.assertEqual(error.exception.code, 401)
                request = Request(url + "/api/items", data=json.dumps({"title": "화면과 에이전트가 공유"}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"}, method="POST")
                with urlopen(request) as response:
                    self.assertEqual(response.status, 201)
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
                backup = {"format": "todotodo-v1", "items": store.list_items()}
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
                with urlopen(url + "/logo.svg") as response:
                    self.assertEqual(response.status, 200)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
