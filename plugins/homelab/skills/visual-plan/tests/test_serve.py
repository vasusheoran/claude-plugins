"""Behavior tests for the visual-plan local server (serve.py).

These describe the contract of the comment round-trip — the local analog of
the hosted `get-plan-feedback` loop: a browser POSTs a comment, it is persisted
to comments.json next to the plan, and the agent reads it back to revise.

Stdlib only (no pytest). Run:  python3 tests/test_serve.py
"""

import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer
from pathlib import Path

# serve.py lives in ../assets and is copied next to each plan at runtime.
ASSETS = Path(__file__).resolve().parent.parent / "assets"
sys.path.insert(0, str(ASSETS))

import serve  # noqa: E402  (import after sys.path tweak)


class TmpDirCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()


# ---------------------------------------------------------------------------
# CommentStore: the persistence contract
# ---------------------------------------------------------------------------

class CommentStoreTests(TmpDirCase):
    def test_empty_store_lists_nothing(self):
        store = serve.CommentStore(self.tmp / "comments.json")
        self.assertEqual(store.list(), [])

    def test_add_persists_to_disk(self):
        path = self.tmp / "comments.json"
        serve.CommentStore(path).add({"blockId": "approach", "body": "tighten"})
        on_disk = json.loads(path.read_text())
        self.assertEqual(len(on_disk["comments"]), 1)
        self.assertEqual(on_disk["comments"][0]["body"], "tighten")

    def test_add_assigns_id_and_defaults(self):
        c = serve.CommentStore(self.tmp / "comments.json").add(
            {"blockId": "approach", "body": "x"})
        self.assertTrue(c["id"])
        self.assertEqual(c["status"], "open")
        self.assertEqual(c["target"], "agent")
        self.assertTrue(c["createdAt"])

    def test_add_preserves_anchor_fields(self):
        c = serve.CommentStore(self.tmp / "comments.json").add({
            "blockId": "schema",
            "blockLabel": "Data model",
            "quote": "user_id is a string",
            "body": "should be uuid",
        })
        self.assertEqual(c["blockId"], "schema")
        self.assertEqual(c["blockLabel"], "Data model")
        self.assertEqual(c["quote"], "user_id is a string")

    def test_comments_survive_reload(self):
        path = self.tmp / "comments.json"
        serve.CommentStore(path).add({"blockId": "a", "body": "first"})
        reloaded = serve.CommentStore(path)
        self.assertEqual([c["body"] for c in reloaded.list()], ["first"])

    def test_resolve_marks_status(self):
        store = serve.CommentStore(self.tmp / "comments.json")
        c = store.add({"blockId": "a", "body": "fix"})
        self.assertIs(store.resolve(c["id"]), True)
        self.assertEqual(store.list()[0]["status"], "resolved")

    def test_resolve_unknown_id_is_false(self):
        store = serve.CommentStore(self.tmp / "comments.json")
        self.assertIs(store.resolve("nope"), False)


# ---------------------------------------------------------------------------
# Path safety: static serving must not escape the plan directory
# ---------------------------------------------------------------------------

class SafePathTests(TmpDirCase):
    def test_allows_normal_file(self):
        (self.tmp / "plan.html").write_text("hi")
        self.assertEqual(serve.safe_path(self.tmp, "/plan.html"),
                         self.tmp / "plan.html")

    def test_blocks_traversal(self):
        self.assertIsNone(serve.safe_path(self.tmp, "/../../etc/passwd"))

    def test_root_is_plan_html(self):
        self.assertEqual(serve.safe_path(self.tmp, "/"), self.tmp / "plan.html")


# ---------------------------------------------------------------------------
# HTTP integration: the real browser round-trip
# ---------------------------------------------------------------------------

def _start_server(plan_dir):
    httpd = HTTPServer(("127.0.0.1", 0), serve.make_handler(plan_dir))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def _req(method, url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, json.loads(r.read() or b"null")


class HttpTests(TmpDirCase):
    def test_post_then_get_roundtrip(self):
        (self.tmp / "plan.html").write_text("<h1>plan</h1>")
        httpd, port = _start_server(self.tmp)
        try:
            base = f"http://127.0.0.1:{port}"
            status, created = _req("POST", f"{base}/api/comments",
                                   {"blockId": "approach", "body": "narrow scope"})
            self.assertEqual(status, 201)
            self.assertTrue(created["id"])
            status, listing = _req("GET", f"{base}/api/comments")
            self.assertEqual(status, 200)
            self.assertTrue(any(c["body"] == "narrow scope"
                                for c in listing["comments"]))
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_serves_plan_at_root(self):
        (self.tmp / "plan.html").write_text("<h1>plan</h1>")
        httpd, port = _start_server(self.tmp)
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/", timeout=5) as r:
                self.assertEqual(r.status, 200)
                self.assertIn(b"<h1>plan</h1>", r.read())
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_blocks_traversal(self):
        (self.tmp / "plan.html").write_text("x")
        httpd, port = _start_server(self.tmp)
        try:
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/../../etc/passwd", timeout=5)
            self.assertIn(ctx.exception.code, (403, 404))
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
