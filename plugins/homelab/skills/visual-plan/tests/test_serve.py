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


# ---------------------------------------------------------------------------
# Threads, reopen, and pin/quote anchors
# ---------------------------------------------------------------------------

class ThreadAndAnchorTests(TmpDirCase):
    def test_top_level_comment_has_null_parent(self):
        store = serve.CommentStore(self.tmp / "comments.json")
        c = store.add({"blockId": "a", "body": "x"})
        self.assertIsNone(c["parentId"])

    def test_reply_links_to_parent(self):
        store = serve.CommentStore(self.tmp / "comments.json")
        parent = store.add({"blockId": "a", "body": "top"})
        reply = store.add({"blockId": "a", "body": "re", "parentId": parent["id"]})
        self.assertEqual(reply["parentId"], parent["id"])

    def test_reopen_sets_status_open(self):
        store = serve.CommentStore(self.tmp / "comments.json")
        c = store.add({"blockId": "a", "body": "x"})
        store.resolve(c["id"])
        self.assertIs(store.reopen(c["id"]), True)
        self.assertEqual(store.list()[0]["status"], "open")

    def test_reopen_unknown_id_is_false(self):
        store = serve.CommentStore(self.tmp / "comments.json")
        self.assertIs(store.reopen("nope"), False)

    def test_add_preserves_pin_anchor(self):
        store = serve.CommentStore(self.tmp / "comments.json")
        c = store.add({"blockId": "diagram", "body": "here",
                       "anchor": {"x": 40, "y": 55}})
        self.assertEqual(c["anchor"], {"x": 40, "y": 55})


# ---------------------------------------------------------------------------
# AnswerStore: inline question answers (their question-form analog)
# ---------------------------------------------------------------------------

class AnswerStoreTests(TmpDirCase):
    def test_empty(self):
        self.assertEqual(serve.AnswerStore(self.tmp / "answers.json").list(), [])

    def test_upsert_creates_with_timestamp(self):
        s = serve.AnswerStore(self.tmp / "answers.json")
        a = s.upsert({"questionId": "q1", "questionLabel": "Q",
                      "mode": "single", "value": "sqlite"})
        self.assertEqual(a["value"], "sqlite")
        self.assertTrue(a["answeredAt"])
        self.assertEqual(len(s.list()), 1)

    def test_upsert_replaces_same_question(self):
        s = serve.AnswerStore(self.tmp / "answers.json")
        s.upsert({"questionId": "q1", "value": "a"})
        s.upsert({"questionId": "q1", "value": "b"})
        self.assertEqual([x["value"] for x in s.list()], ["b"])

    def test_persist_reload(self):
        p = self.tmp / "answers.json"
        serve.AnswerStore(p).upsert({"questionId": "q1", "value": "a"})
        self.assertEqual(serve.AnswerStore(p).list()[0]["value"], "a")


# ---------------------------------------------------------------------------
# ApprovalStore: the explicit approval gate
# ---------------------------------------------------------------------------

class ApprovalStoreTests(TmpDirCase):
    def test_unset_state_is_none(self):
        self.assertIsNone(
            serve.ApprovalStore(self.tmp / "approval.json").get()["state"])

    def test_set_and_get(self):
        s = serve.ApprovalStore(self.tmp / "approval.json")
        s.set("approved", "lgtm")
        g = s.get()
        self.assertEqual(g["state"], "approved")
        self.assertEqual(g["note"], "lgtm")
        self.assertTrue(g["decidedAt"])

    def test_persist_reload(self):
        p = self.tmp / "approval.json"
        serve.ApprovalStore(p).set("changes-requested", "fix x")
        self.assertEqual(serve.ApprovalStore(p).get()["state"],
                         "changes-requested")


# ---------------------------------------------------------------------------
# New HTTP endpoints: replies/reopen, answers, approval, version (live-refresh)
# ---------------------------------------------------------------------------

class NewHttpTests(TmpDirCase):
    def setUp(self):
        super().setUp()
        (self.tmp / "plan.html").write_text("<h1>plan</h1>")
        self.httpd, port = _start_server(self.tmp)
        self.base = f"http://127.0.0.1:{port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def test_reply_then_reopen(self):
        _, parent = _req("POST", f"{self.base}/api/comments",
                         {"blockId": "a", "body": "top"})
        status, reply = _req("POST", f"{self.base}/api/comments",
                             {"blockId": "a", "body": "re", "parentId": parent["id"]})
        self.assertEqual(status, 201)
        self.assertEqual(reply["parentId"], parent["id"])
        _req("POST", f"{self.base}/api/comments/{parent['id']}/resolve")
        status, _ = _req("POST", f"{self.base}/api/comments/{parent['id']}/reopen")
        self.assertEqual(status, 200)
        _, listing = _req("GET", f"{self.base}/api/comments")
        top = [c for c in listing["comments"] if c["id"] == parent["id"]][0]
        self.assertEqual(top["status"], "open")

    def test_answers_roundtrip(self):
        status, _ = _req("POST", f"{self.base}/api/answers",
                         {"questionId": "datastore", "mode": "single", "value": "sqlite"})
        self.assertEqual(status, 201)
        _, data = _req("GET", f"{self.base}/api/answers")
        self.assertEqual(data["answers"][0]["value"], "sqlite")

    def test_approval_roundtrip(self):
        _, empty = _req("GET", f"{self.base}/api/approval")
        self.assertIsNone(empty["state"])
        status, _ = _req("POST", f"{self.base}/api/approval",
                         {"state": "approved", "note": "ship it"})
        self.assertEqual(status, 200)
        _, data = _req("GET", f"{self.base}/api/approval")
        self.assertEqual(data["state"], "approved")

    def test_version_changes_after_comment(self):
        _, v1 = _req("GET", f"{self.base}/api/version")
        self.assertIn("plan", v1)
        self.assertIn("comments", v1)
        _req("POST", f"{self.base}/api/comments", {"blockId": "a", "body": "hi"})
        _, v2 = _req("GET", f"{self.base}/api/version")
        self.assertNotEqual(v1["comments"], v2["comments"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
