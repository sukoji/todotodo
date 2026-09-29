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
                with urlopen(url + "/logo.svg") as response:
                    self.assertEqual(response.status, 200)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
