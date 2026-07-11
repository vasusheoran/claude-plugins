"""Behavior tests for canvasd — the single canvas daemon.

Contract under test here (M0): the /mcp endpoint speaks enough stateless
streamable-HTTP MCP for a tools-only server — initialize, the initialized
notification, ping, tools/list, tools/call — and fails safely on garbage.

Stdlib only (no pytest). Run:  python3 tests/test_canvasd.py
"""

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER))

import canvasd  # noqa: E402


def _post(url, payload, raw=None):
    """POST JSON (or raw bytes) and return (status, parsed-or-None)."""
    data = raw if raw is not None else json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream"})
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read()
            return resp.status, json.loads(body) if body.strip() else None
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, json.loads(body) if body.strip() else None


def _rpc(url, method, params=None, id=1):
    msg = {"jsonrpc": "2.0", "method": method}
    if id is not None:
        msg["id"] = id
    if params is not None:
        msg["params"] = params
    return _post(url, msg)


class McpEndpointCase(unittest.TestCase):
    """Spin up canvasd on an ephemeral port for each test class."""

    @classmethod
    def setUpClass(cls):
        cls.httpd = canvasd.build_server(port=0)
        cls.url = f"http://127.0.0.1:{cls.httpd.server_address[1]}/mcp"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()


class InitializeTests(McpEndpointCase):
    def test_initialize_echoes_protocol_and_declares_tools(self):
        status, resp = _rpc(self.url, "initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "0"},
        })
        self.assertEqual(status, 200)
        self.assertEqual(resp["id"], 1)
        result = resp["result"]
        self.assertEqual(result["protocolVersion"], "2025-06-18")
        self.assertIn("tools", result["capabilities"])
        self.assertEqual(result["serverInfo"]["name"], "canvasd")

    def test_initialized_notification_gets_202_and_no_body(self):
        status, resp = _rpc(self.url, "notifications/initialized", id=None)
        self.assertEqual(status, 202)
        self.assertIsNone(resp)

    def test_ping_returns_empty_result(self):
        status, resp = _rpc(self.url, "ping")
        self.assertEqual(status, 200)
        self.assertEqual(resp["result"], {})


CANVAS_TOOLS = {"canvas_open", "canvas_wait", "canvas_feedback",
                "canvas_resolve", "canvas_ack", "canvas_export"}


class ToolsTests(McpEndpointCase):
    def test_tools_list_is_exactly_the_canvas_tools(self):
        status, resp = _rpc(self.url, "tools/list")
        self.assertEqual(status, 200)
        tools = resp["result"]["tools"]
        self.assertEqual({t["name"] for t in tools}, CANVAS_TOOLS)
        for t in tools:
            self.assertTrue(t["description"])
            self.assertEqual(t["inputSchema"]["type"], "object")
            self.assertIn("dir", t["inputSchema"]["properties"])

    def test_tools_call_unknown_tool_is_tool_error_not_crash(self):
        status, resp = _rpc(self.url, "tools/call",
                            {"name": "no-such-tool", "arguments": {}})
        self.assertEqual(status, 200)
        self.assertTrue(resp["result"]["isError"])

    def test_tool_exception_becomes_isError_result(self):
        # a wrong argument shape must not 500 the daemon
        status, resp = _rpc(self.url, "tools/call",
                            {"name": "canvas_feedback", "arguments": None})
        self.assertEqual(status, 200)
        self.assertTrue(resp["result"]["isError"])


class ProtocolSafetyTests(McpEndpointCase):
    def test_parse_error_returns_minus_32700(self):
        status, resp = _post(self.url, None, raw=b"{not json")
        self.assertEqual(resp["error"]["code"], -32700)

    def test_unknown_method_returns_minus_32601(self):
        status, resp = _rpc(self.url, "resources/list")
        self.assertEqual(resp["error"]["code"], -32601)

    def test_get_on_mcp_is_405(self):
        req = urllib.request.Request(self.url, method="GET")
        try:
            with urllib.request.urlopen(req) as resp:
                code = resp.status
        except urllib.error.HTTPError as e:
            code = e.code
        self.assertEqual(code, 405)


class TmpDirCase(unittest.TestCase):
    def setUp(self):
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _json_req(method, url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, json.loads(r.read() or b"null")


# ---------------------------------------------------------------------------
# Registry: dir -> stable key, persisted across daemon restarts
# ---------------------------------------------------------------------------

class RegistryTests(TmpDirCase):
    def test_same_dir_registers_to_same_key(self):
        reg = canvasd.Registry(self.tmp / "registry.json")
        ws = self.tmp / "proj" / "canvas" / "my-plan"
        ws.mkdir(parents=True)
        self.assertEqual(reg.register(ws), reg.register(ws))

    def test_key_is_readable_and_url_safe(self):
        reg = canvasd.Registry(self.tmp / "registry.json")
        ws = self.tmp / "proj" / "canvas" / "my-plan"
        ws.mkdir(parents=True)
        key = reg.register(ws)
        self.assertIn("my-plan", key)
        self.assertNotIn("/", key)

    def test_distinct_dirs_get_distinct_keys(self):
        reg = canvasd.Registry(self.tmp / "registry.json")
        a = self.tmp / "a" / "canvas" / "plan"
        b = self.tmp / "b" / "canvas" / "plan"  # same slug, different path
        a.mkdir(parents=True)
        b.mkdir(parents=True)
        self.assertNotEqual(reg.register(a), reg.register(b))

    def test_registry_survives_restart(self):
        path = self.tmp / "registry.json"
        ws = self.tmp / "ws"
        ws.mkdir()
        key = canvasd.Registry(path).register(ws)
        reg2 = canvasd.Registry(path)
        self.assertEqual(str(reg2.dir_of(key)), str(ws.resolve()))


# ---------------------------------------------------------------------------
# Workspace routing: /w/<key>/… serves pages + the review API per workspace
# ---------------------------------------------------------------------------

class WorkspaceRoutingCase(TmpDirCase):
    def setUp(self):
        super().setUp()
        self.assets = self.tmp / "assets"
        self.assets.mkdir()
        (self.assets / "plan.css").write_text("/* shared css */")
        self.httpd = canvasd.build_server(
            port=0,
            registry_path=self.tmp / "registry.json",
            assets_dir=self.assets)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.ws = self.tmp / "proj" / "canvas" / "demo"
        self.ws.mkdir(parents=True)
        (self.ws / "plan.html").write_text("<h1>demo plan</h1>")
        self.key = self.httpd.registry.register(self.ws)

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()


class WorkspaceRoutingTests(WorkspaceRoutingCase):
    def test_serves_workspace_page(self):
        status, body = _get(f"{self.base}/w/{self.key}/plan.html")
        self.assertEqual(status, 200)
        self.assertIn(b"demo plan", body)

    def test_workspace_root_serves_plan_html(self):
        status, body = _get(f"{self.base}/w/{self.key}/")
        self.assertEqual(status, 200)
        self.assertIn(b"demo plan", body)

    def test_unknown_key_is_404(self):
        status, _ = _get(f"{self.base}/w/nope-000000/plan.html")
        self.assertEqual(status, 404)

    def test_api_roundtrip_persists_next_to_workspace(self):
        status, created = _json_req(
            "POST", f"{self.base}/w/{self.key}/api/comments",
            {"blockId": "approach", "body": "tighten"})
        self.assertEqual(status, 201)
        self.assertTrue(created["id"])
        on_disk = json.loads((self.ws / "comments.json").read_text())
        self.assertEqual(on_disk["comments"][0]["body"], "tighten")

    def test_shared_asset_fallback_serves_skill_css(self):
        status, body = _get(f"{self.base}/w/{self.key}/plan.css")
        self.assertEqual(status, 200)
        self.assertIn(b"shared css", body)

    def test_index_lists_registered_workspaces(self):
        status, body = _get(f"{self.base}/")
        self.assertEqual(status, 200)
        self.assertIn(self.key.encode(), body)

    def test_event_buses_are_isolated_per_workspace(self):
        other = self.tmp / "proj" / "canvas" / "other"
        other.mkdir(parents=True)
        (other / "plan.html").write_text("<h1>other</h1>")
        other_key = self.httpd.registry.register(other)

        _json_req("POST", f"{self.base}/w/{self.key}/api/comments",
                  {"blockId": "x", "body": "wake A", "target": "agent"})

        _, got_b = _json_req(
            "GET", f"{self.base}/w/{other_key}/api/wait?since=0&timeout=0.1")
        self.assertIsNone(got_b["event"])

        _, got_a = _json_req(
            "GET", f"{self.base}/w/{self.key}/api/wait?since=0&timeout=0.1")
        self.assertEqual(got_a["event"], "comment")


# ---------------------------------------------------------------------------
# The canvas_* tools, called the way a session calls them: JSON-RPC over /mcp
# ---------------------------------------------------------------------------

class McpToolsCase(WorkspaceRoutingCase):
    def setUp(self):
        super().setUp()
        (self.assets / "template.html").write_text(
            "<html><head><link rel=\"stylesheet\" href=\"plan.css\" /></head>"
            "<body>PLAN TEMPLATE<script src=\"comments.js\"></script>"
            "</body></html>")
        (self.assets / "canvas.html").write_text(
            "<html><body>CANVAS TEMPLATE"
            "<script src=\"comments.js\"></script></body></html>")
        (self.assets / "comments.js").write_text("// shared js")
        self.mcp = f"{self.base}/mcp"

    def call(self, name, args):
        status, resp = _rpc(self.mcp, "tools/call",
                            {"name": name, "arguments": args})
        assert status == 200, status
        result = resp["result"]
        payload = json.loads(result["content"][0]["text"]) \
            if not result.get("isError") else result["content"][0]["text"]
        return result.get("isError", False), payload


class CanvasOpenTests(McpToolsCase):
    def test_open_creates_registers_and_returns_url(self):
        ws = self.tmp / "proj" / "canvas" / "fresh"
        err, out = self.call("canvas_open", {
            "dir": str(ws), "mode": "plan", "open_browser": False})
        self.assertFalse(err)
        self.assertIn("/w/", out["url"])
        self.assertIn("PLAN TEMPLATE", (ws / "plan.html").read_text())
        self.assertFalse((ws / "plan.css").exists())   # no asset copies
        self.assertFalse((ws / "comments.js").exists())
        self.assertEqual([p["file"] for p in out["pages"]], ["plan.html"])
        status, body = _get(out["url"])
        self.assertEqual(status, 200)

    def test_reopen_is_idempotent_and_never_clobbers(self):
        ws = self.tmp / "proj" / "canvas" / "twice"
        _, first = self.call("canvas_open", {
            "dir": str(ws), "mode": "plan", "open_browser": False})
        (ws / "plan.html").write_text("EDITED BY CLAUDE")
        err, second = self.call("canvas_open", {
            "dir": str(ws), "mode": "plan", "open_browser": False})
        self.assertFalse(err)
        self.assertEqual(first["key"], second["key"])
        self.assertEqual((ws / "plan.html").read_text(), "EDITED BY CLAUDE")

    def test_open_canvas_mode_copies_canvas_template(self):
        ws = self.tmp / "proj" / "canvas" / "mock"
        err, out = self.call("canvas_open", {
            "dir": str(ws), "mode": "canvas", "open_browser": False})
        self.assertFalse(err)
        self.assertIn("CANVAS TEMPLATE", (ws / "canvas.html").read_text())

    def test_open_surfaces_existing_feedback(self):
        _json_req("POST", f"{self.base}/w/{self.key}/api/comments",
                  {"blockId": "b", "body": "pending note"})
        err, out = self.call("canvas_open", {
            "dir": str(self.ws), "open_browser": False})
        self.assertFalse(err)
        bodies = [c["body"] for c in out["feedback"]["comments"]]
        self.assertIn("pending note", bodies)


class CanvasFeedbackTests(McpToolsCase):
    def test_feedback_reads_full_state_and_cursor(self):
        _json_req("POST", f"{self.base}/w/{self.key}/api/comments",
                  {"blockId": "b", "body": "see this", "target": "agent"})
        _json_req("POST", f"{self.base}/w/{self.key}/api/answers",
                  {"questionId": "q1", "mode": "single", "value": "a"})
        err, out = self.call("canvas_feedback", {"dir": str(self.ws)})
        self.assertFalse(err)
        self.assertEqual(out["comments"][0]["body"], "see this")
        self.assertEqual(out["answers"][0]["questionId"], "q1")
        self.assertIsInstance(out["cursor"], int)
        self.assertGreaterEqual(out["cursor"], 1)

    def test_feedback_on_missing_dir_is_error(self):
        err, msg = self.call("canvas_feedback",
                             {"dir": str(self.tmp / "no-such-dir")})
        self.assertTrue(err)


class CanvasWaitTests(McpToolsCase):
    def test_wait_returns_buffered_agent_event(self):
        _json_req("POST", f"{self.base}/w/{self.key}/api/comments",
                  {"blockId": "b", "body": "act on this", "target": "agent"})
        err, out = self.call("canvas_wait", {
            "dir": str(self.ws), "since": 0, "timeout": 0.2})
        self.assertFalse(err)
        self.assertEqual(out["event"], "comment")
        bodies = [c["body"] for c in out["comments"]]
        self.assertIn("act on this", bodies)

    def test_wait_times_out_with_null_event(self):
        err, out = self.call("canvas_wait", {
            "dir": str(self.ws), "since": 0, "timeout": 0.1})
        self.assertFalse(err)
        self.assertIsNone(out["event"])
        self.assertIsInstance(out["cursor"], int)

    def test_wait_auto_acks_an_approval(self):
        _json_req("POST", f"{self.base}/w/{self.key}/api/approval",
                  {"state": "approved", "note": "ship it"})
        err, out = self.call("canvas_wait", {
            "dir": str(self.ws), "since": 0, "timeout": 0.2})
        self.assertFalse(err)
        self.assertEqual(out["event"], "approval")
        self.assertEqual(out["approval"]["state"], "approved")
        ack = json.loads((self.ws / "ack.json").read_text())
        self.assertEqual(ack["decidedAt"], out["approval"]["decidedAt"])
        self.assertEqual(ack["by"], "Claude")


class CanvasResolveAckTests(McpToolsCase):
    def test_resolve_marks_comments_resolved(self):
        _, created = _json_req(
            "POST", f"{self.base}/w/{self.key}/api/comments",
            {"blockId": "b", "body": "fix me"})
        err, out = self.call("canvas_resolve", {
            "dir": str(self.ws), "comment_ids": [created["id"], "c-nope"]})
        self.assertFalse(err)
        self.assertTrue(out["resolved"][created["id"]])
        self.assertFalse(out["resolved"]["c-nope"])
        on_disk = json.loads((self.ws / "comments.json").read_text())
        self.assertEqual(on_disk["comments"][0]["status"], "resolved")

    def test_ack_keys_to_latest_submission(self):
        _json_req("POST", f"{self.base}/w/{self.key}/api/approval",
                  {"state": "changes-requested", "note": "nits"})
        err, out = self.call("canvas_ack", {
            "dir": str(self.ws), "message": "applied all three"})
        self.assertFalse(err)
        ack = json.loads((self.ws / "ack.json").read_text())
        self.assertEqual(ack["message"], "applied all three")
        approval = json.loads((self.ws / "approval.json").read_text())
        self.assertEqual(ack["decidedAt"], approval["decidedAt"])


class CanvasExportTests(McpToolsCase):
    def test_export_inlines_shared_assets(self):
        ws = self.tmp / "proj" / "canvas" / "exp"
        self.call("canvas_open", {
            "dir": str(ws), "mode": "plan", "open_browser": False})
        (self.assets / "plan.css").write_text("/* shared css */")
        err, out = self.call("canvas_export", {"dir": str(ws)})
        self.assertFalse(err)
        exported = Path(out["exported"][0]).read_text()
        self.assertIn("/* shared css */", exported)
        self.assertIn("// shared js", exported)
        self.assertNotIn('href="plan.css"', exported)
        self.assertNotIn('src="comments.js"', exported)

    def test_export_prefers_workspace_copies(self):
        ws = self.tmp / "proj" / "canvas" / "expl"
        self.call("canvas_open", {
            "dir": str(ws), "mode": "plan", "open_browser": False})
        (ws / "plan.css").write_text("/* local css */")
        err, out = self.call("canvas_export", {"dir": str(ws)})
        self.assertFalse(err)
        exported = Path(out["exported"][0]).read_text()
        self.assertIn("/* local css */", exported)


# ---------------------------------------------------------------------------
# launchd installer: plist generation is pure and testable; the `install`
# subcommand writes it and bootstraps the agent.
# ---------------------------------------------------------------------------

class WaitDefaultsTests(unittest.TestCase):
    def test_default_wait_stays_under_client_tool_timeout(self):
        # Claude Code kills MCP tool calls at ~60 s by default (measured:
        # 45 s returns, 70 s times out). The default must stay below that;
        # sessions with a raised MCP_TOOL_TIMEOUT can pass a bigger timeout,
        # capped server-side.
        self.assertLessEqual(canvasd.WAIT_DEFAULT_TIMEOUT, 55)
        self.assertLessEqual(canvasd.WAIT_MAX_TIMEOUT, 590)


class LaunchdPlistTests(unittest.TestCase):
    def test_plist_pins_interpreter_script_port_and_keepalive(self):
        xml = canvasd.launchd_plist(port=8618)
        self.assertIn("com.claude.canvasd", xml)
        self.assertIn(sys.executable, xml)
        self.assertIn(str(Path(canvasd.__file__).resolve()), xml)
        self.assertIn("<string>8618</string>", xml)
        self.assertIn("<key>KeepAlive</key>", xml)
        self.assertIn("<key>RunAtLoad</key>", xml)

    def test_plist_logs_under_claude_canvas(self):
        xml = canvasd.launchd_plist(port=8618)
        self.assertIn("canvasd.log", xml)


if __name__ == "__main__":
    unittest.main(verbosity=2)
