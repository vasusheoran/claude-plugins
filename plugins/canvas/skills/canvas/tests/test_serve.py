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

    def test_add_preserves_component_fields(self):
        # A comment can anchor to a specific element (data-cmt-id) and choose
        # whether it is just a note ("human") or an action item ("agent").
        c = serve.CommentStore(self.tmp / "comments.json").add({
            "blockId": "dataflow",
            "blockLabel": "Data flow",
            "componentId": "submit",
            "componentLabel": "Submit button",
            "target": "human",
            "body": "rename this box",
        })
        self.assertEqual(c["componentId"], "submit")
        self.assertEqual(c["componentLabel"], "Submit button")
        self.assertEqual(c["target"], "human")

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
        # resolve() both sides: macOS tempdirs live behind a /var symlink
        self.assertEqual(serve.safe_path(self.tmp, "/plan.html"),
                         (self.tmp / "plan.html").resolve())

    def test_blocks_traversal(self):
        self.assertIsNone(serve.safe_path(self.tmp, "/../../etc/passwd"))

    def test_root_is_plan_html(self):
        self.assertEqual(serve.safe_path(self.tmp, "/"),
                         (self.tmp / "plan.html").resolve())


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
# AckStore: the agent's acknowledgement of a submission (durable, not a UI flash)
# ---------------------------------------------------------------------------

class AckStoreTests(TmpDirCase):
    def test_unset_ack_is_empty(self):
        a = serve.AckStore(self.tmp / "ack.json").get()
        self.assertIsNone(a["ackedAt"])
        self.assertIsNone(a["decidedAt"])

    def test_set_records_the_acknowledged_submission(self):
        s = serve.AckStore(self.tmp / "ack.json")
        a = s.set("2026-06-18T21:10:48Z", by="Claude", message="seen, acting")
        self.assertEqual(a["decidedAt"], "2026-06-18T21:10:48Z")
        self.assertEqual(a["by"], "Claude")
        self.assertEqual(a["message"], "seen, acting")
        self.assertTrue(a["ackedAt"])

    def test_persist_reload(self):
        p = self.tmp / "ack.json"
        serve.AckStore(p).set("2026-06-18T21:10:48Z")
        self.assertEqual(serve.AckStore(p).get()["decidedAt"], "2026-06-18T21:10:48Z")


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

    def test_ack_roundtrip(self):
        _, empty = _req("GET", f"{self.base}/api/ack")
        self.assertIsNone(empty["ackedAt"])
        status, _ = _req("POST", f"{self.base}/api/ack",
                         {"decidedAt": "2026-06-18T21:10:48Z", "message": "on it"})
        self.assertEqual(status, 200)
        _, data = _req("GET", f"{self.base}/api/ack")
        self.assertEqual(data["decidedAt"], "2026-06-18T21:10:48Z")
        self.assertEqual(data["message"], "on it")

    def test_version_includes_ack(self):
        _, v = _req("GET", f"{self.base}/api/version")
        self.assertIn("ack", v)

    def test_version_changes_after_comment(self):
        _, v1 = _req("GET", f"{self.base}/api/version")
        self.assertIn("plan", v1)
        self.assertIn("comments", v1)
        _req("POST", f"{self.base}/api/comments", {"blockId": "a", "body": "hi"})
        _, v2 = _req("GET", f"{self.base}/api/version")
        self.assertNotEqual(v1["comments"], v2["comments"])


# ---------------------------------------------------------------------------
# Workspace pages: /api/pages lists every HTML artifact for the tab nav
# ---------------------------------------------------------------------------

def _start_threading_server(plan_dir):
    """Like _start_server but multi-threaded, so a blocking /api/wait request
    does not starve the POST that is supposed to fire it."""
    from http.server import ThreadingHTTPServer
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), serve.make_handler(plan_dir))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


class PagesApiTests(TmpDirCase):
    def setUp(self):
        super().setUp()
        (self.tmp / "plan.html").write_text(
            "<html><head><title>My Plan</title></head><body>p</body></html>")
        (self.tmp / "mockup.html").write_text(
            "<html><head><title>Mockup A</title></head><body>m</body></html>")
        (self.tmp / "notes.txt").write_text("not a page")
        self.httpd, port = _start_server(self.tmp)
        self.base = f"http://127.0.0.1:{port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def test_lists_only_html_with_plan_first(self):
        status, data = _req("GET", f"{self.base}/api/pages")
        self.assertEqual(status, 200)
        self.assertEqual([p["file"] for p in data["pages"]],
                         ["plan.html", "mockup.html"])

    def test_titles_come_from_title_tag(self):
        _, data = _req("GET", f"{self.base}/api/pages")
        by_file = {p["file"]: p["title"] for p in data["pages"]}
        self.assertEqual(by_file["plan.html"], "My Plan")
        self.assertEqual(by_file["mockup.html"], "Mockup A")

    def test_title_falls_back_to_filename(self):
        (self.tmp / "raw.html").write_text("<body>no title</body>")
        _, data = _req("GET", f"{self.base}/api/pages")
        by_file = {p["file"]: p["title"] for p in data["pages"]}
        self.assertEqual(by_file["raw.html"], "raw.html")


# ---------------------------------------------------------------------------
# Page-keyed comments: multi-artifact workspaces anchor comments per page
# ---------------------------------------------------------------------------

class PageFieldTests(TmpDirCase):
    def test_comment_persists_page(self):
        c = serve.CommentStore(self.tmp / "comments.json").add(
            {"blockId": "a", "body": "x", "page": "mockup.html"})
        self.assertEqual(c["page"], "mockup.html")

    def test_page_defaults_to_plan_html(self):
        # Back-compat: state written by older clients (no page field) must
        # keep anchoring to the single plan page.
        c = serve.CommentStore(self.tmp / "comments.json").add(
            {"blockId": "a", "body": "x"})
        self.assertEqual(c["page"], "plan.html")

    def test_http_roundtrip_keeps_page(self):
        (self.tmp / "plan.html").write_text("p")
        httpd, port = _start_server(self.tmp)
        try:
            base = f"http://127.0.0.1:{port}"
            _req("POST", f"{base}/api/comments",
                 {"blockId": "a", "body": "x", "page": "flow.html"})
            _, listing = _req("GET", f"{base}/api/comments")
            self.assertEqual(listing["comments"][0]["page"], "flow.html")
        finally:
            httpd.shutdown()
            httpd.server_close()


# ---------------------------------------------------------------------------
# EventBus: the push mechanism behind /api/wait
# ---------------------------------------------------------------------------

class EventBusTests(unittest.TestCase):
    def test_notify_returns_increasing_cursors(self):
        bus = serve.EventBus()
        self.assertLess(bus.notify("comment"), bus.notify("approval"))

    def test_wait_returns_immediately_for_past_event(self):
        bus = serve.EventBus()
        bus.notify("approval")
        got = bus.wait(since=0, timeout=1)
        self.assertEqual(got["event"], "approval")
        self.assertGreater(got["cursor"], 0)

    def test_wait_times_out_with_null_event(self):
        bus = serve.EventBus()
        got = bus.wait(since=0, timeout=0.05)
        self.assertIsNone(got["event"])

    def test_wait_filters_kinds(self):
        # An "answer" event must not satisfy a waiter that only listens for
        # comment/approval — it keeps waiting and times out.
        bus = serve.EventBus()
        bus.notify("answer")
        got = bus.wait(since=0, kinds={"comment", "approval"}, timeout=0.05)
        self.assertIsNone(got["event"])
        got = bus.wait(since=0, kinds=None, timeout=0.05)
        self.assertEqual(got["event"], "answer")

    def test_wait_blocks_until_notified(self):
        bus = serve.EventBus()
        threading.Timer(0.1, lambda: bus.notify("comment")).start()
        got = bus.wait(since=0, timeout=5)
        self.assertEqual(got["event"], "comment")


# ---------------------------------------------------------------------------
# /api/wait: what wakes the agent (decided in the canvas-rework plan review:
# Submit review + Submit-to-Claude comments fire; notes and answers do not,
# unless the watcher opts in with events=any)
# ---------------------------------------------------------------------------

class WaitApiTests(TmpDirCase):
    def setUp(self):
        super().setUp()
        (self.tmp / "plan.html").write_text("p")
        self.httpd, port = _start_threading_server(self.tmp)
        self.base = f"http://127.0.0.1:{port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def test_timeout_returns_null_event_and_cursor(self):
        status, got = _req("GET", f"{self.base}/api/wait?since=0&timeout=0.1")
        self.assertEqual(status, 200)
        self.assertIsNone(got["event"])
        self.assertIn("cursor", got)

    def test_agent_comment_fires_wait(self):
        def later():
            _req("POST", f"{self.base}/api/comments",
                 {"blockId": "a", "body": "do this", "target": "agent"})
        threading.Timer(0.1, later).start()
        _, got = _req("GET", f"{self.base}/api/wait?since=0&timeout=5")
        self.assertEqual(got["event"], "comment")

    def test_human_note_does_not_fire_wait(self):
        _req("POST", f"{self.base}/api/comments",
             {"blockId": "a", "body": "just a note", "target": "human"})
        _, got = _req("GET", f"{self.base}/api/wait?since=0&timeout=0.1")
        self.assertIsNone(got["event"])

    def test_approval_fires_wait(self):
        _req("POST", f"{self.base}/api/approval", {"state": "approved"})
        _, got = _req("GET", f"{self.base}/api/wait?since=0&timeout=1")
        self.assertEqual(got["event"], "approval")

    def test_answers_fire_only_with_events_any(self):
        _req("POST", f"{self.base}/api/answers",
             {"questionId": "q1", "mode": "single", "value": "a"})
        _, got = _req("GET", f"{self.base}/api/wait?since=0&timeout=0.1")
        self.assertIsNone(got["event"])
        _, got = _req("GET",
                      f"{self.base}/api/wait?since=0&timeout=1&events=any")
        self.assertEqual(got["event"], "answer")

    def test_cursor_advances_past_delivered_events(self):
        _req("POST", f"{self.base}/api/approval", {"state": "approved"})
        _, first = _req("GET", f"{self.base}/api/wait?since=0&timeout=1")
        self.assertEqual(first["event"], "approval")
        _, second = _req("GET",
                         f"{self.base}/api/wait?since={first['cursor']}&timeout=0.1")
        self.assertIsNone(second["event"])


# ---------------------------------------------------------------------------
# Shared-asset fallback: workspaces stop carrying copies of the review assets;
# canvasd passes assets_dir and the server falls back to the skill's shared
# copy for exactly plan.css / comments.js / diagram.js — nothing else, and
# only when the workspace has no file of its own.
# ---------------------------------------------------------------------------

class AssetFallbackTests(TmpDirCase):
    def setUp(self):
        super().setUp()
        self.ws = self.tmp / "ws"
        self.ws.mkdir()
        (self.ws / "plan.html").write_text("<h1>p</h1>")
        self.assets = self.tmp / "assets"
        self.assets.mkdir()
        (self.assets / "plan.css").write_text("/* shared */")
        (self.assets / "comments.js").write_text("// shared")
        (self.assets / "secret.txt").write_text("not servable")

    def test_missing_workspace_asset_falls_back_to_shared(self):
        got = serve.safe_path(self.ws, "/plan.css", assets_dir=self.assets)
        self.assertEqual(got.resolve(), (self.assets / "plan.css").resolve())

    def test_workspace_copy_wins_over_shared(self):
        (self.ws / "plan.css").write_text("/* local */")
        got = serve.safe_path(self.ws, "/plan.css", assets_dir=self.assets)
        self.assertEqual(got.resolve(), (self.ws / "plan.css").resolve())

    def test_only_allowlisted_names_fall_back(self):
        got = serve.safe_path(self.ws, "/secret.txt", assets_dir=self.assets)
        # not allowlisted: resolves into the workspace (a miss -> 404), never
        # into the shared dir
        self.assertEqual(got.resolve(), (self.ws / "secret.txt").resolve())

    def test_traversal_still_blocked_with_assets_dir(self):
        self.assertIsNone(serve.safe_path(
            self.ws, "/../../etc/passwd", assets_dir=self.assets))

    def test_no_fallback_without_assets_dir(self):
        got = serve.safe_path(self.ws, "/plan.css")
        self.assertEqual(got.resolve(), (self.ws / "plan.css").resolve())

    def test_http_serves_fallback_asset(self):
        httpd = HTTPServer(("127.0.0.1", 0),
                           serve.make_handler(self.ws, assets_dir=self.assets))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            base = f"http://127.0.0.1:{httpd.server_address[1]}"
            with urllib.request.urlopen(f"{base}/plan.css", timeout=5) as r:
                self.assertEqual(r.status, 200)
                self.assertIn(b"/* shared */", r.read())
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(f"{base}/secret.txt", timeout=5)
            self.assertEqual(ctx.exception.code, 404)
        finally:
            httpd.shutdown()
            httpd.server_close()


class HandlerExposureTests(TmpDirCase):
    """canvasd's MCP tools operate on the same stores and EventBus the browser
    talks to — make_handler exposes them on the returned class."""

    def test_make_handler_exposes_stores_bus_and_dir(self):
        cls = serve.make_handler(self.tmp)
        for attr in ("comments", "answers", "approval", "ack", "bus",
                     "plan_dir"):
            self.assertTrue(hasattr(cls, attr), attr)
        cls.comments.add({"blockId": "x", "body": "via class"})
        on_disk = json.loads((self.tmp / "comments.json").read_text())
        self.assertEqual(on_disk["comments"][0]["body"], "via class")


if __name__ == "__main__":
    unittest.main(verbosity=2)
