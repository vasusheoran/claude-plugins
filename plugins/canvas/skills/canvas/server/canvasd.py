#!/usr/bin/env python3
"""canvasd — the single canvas daemon. Stdlib only, 127.0.0.1 only.

One long-lived process serves, on one fixed port:
    POST /mcp        stateless streamable-HTTP MCP endpoint — every Claude
                     Code session shares it. Tools: canvas_open, canvas_wait,
                     canvas_feedback, canvas_resolve, canvas_ack, canvas_export
    /w/<key>/…       every registered canvas workspace: pages + review API,
                     with shared review assets served by fallback so
                     workspaces carry no copies
    GET /            index of registered canvases

Workspaces are registered by absolute directory (canvas_open passes it); the
key -> dir map persists in ~/.claude/canvas/registry.json so a daemon restart
keeps every URL working.

Per-workspace request handling is serve.py's, verbatim: make_handler() builds
a handler class closed over that workspace's stores + EventBus, and canvasd
delegates /w/<key>/… requests to it after stripping the prefix. The tools act
on those same store instances and the same bus — one lock, one event stream,
whether a write comes from the browser or from a session.

Usage:
    python3 canvasd.py [--port 8618]

Contract tests: python3 tests/test_canvasd.py
"""

import argparse
import hashlib
import importlib.util
import json
import re
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_PORT = 8618
PROTOCOL_FALLBACK = "2025-06-18"
SERVER_INFO = {"name": "canvasd", "version": "0.2.0"}

_SKILL_DIR = Path(__file__).resolve().parent.parent
_ASSETS_DIR = _SKILL_DIR / "assets"
DEFAULT_REGISTRY = Path.home() / ".claude" / "canvas" / "registry.json"

# Claude Code kills MCP tool calls at ~60 s unless MCP_TOOL_TIMEOUT is raised,
# so the default blocking window stays under it; the cursor makes re-calling
# lossless. The max serves clients that did raise their timeout.
WAIT_DEFAULT_TIMEOUT = 50.0
WAIT_MAX_TIMEOUT = 590.0


def _load_serve():
    """Import serve.py (the per-workspace server) from the sibling assets dir."""
    spec = importlib.util.spec_from_file_location(
        "canvas_serve", _ASSETS_DIR / "serve.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


serve = _load_serve()


# ---------------------------------------------------------------------------
# Registry: absolute workspace dir -> stable, URL-safe key (persisted)
# ---------------------------------------------------------------------------

class Registry:
    def __init__(self, path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._dirs = {}      # key -> str(resolved dir)
        self._handlers = {}  # key -> serve.py Handler class (stores + bus)
        self._load()

    def _load(self):
        try:
            data = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            data = {}
        dirs = data.get("workspaces", {})
        if isinstance(dirs, dict):
            self._dirs = {str(k): str(v) for k, v in dirs.items()}

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps({"workspaces": self._dirs}, indent=2))
        tmp.replace(self.path)

    @staticmethod
    def key_for(ws_dir):
        d = Path(ws_dir).resolve()
        slug = re.sub(r"[^A-Za-z0-9._-]", "-", d.name) or "canvas"
        return f"{slug}-{hashlib.sha1(str(d).encode()).hexdigest()[:6]}"

    def register(self, ws_dir):
        d = Path(ws_dir).resolve()
        key = self.key_for(d)
        with self._lock:
            if self._dirs.get(key) != str(d):
                self._dirs[key] = str(d)
                self._save()
        return key

    def dir_of(self, key):
        d = self._dirs.get(key)
        return Path(d) if d else None

    def handler_for(self, key, assets_dir):
        """The serve.py handler class for this workspace, built once so its
        EventBus and store locks live as long as the daemon."""
        with self._lock:
            cls = self._handlers.get(key)
            if cls is None and key in self._dirs:
                cls = serve.make_handler(self._dirs[key],
                                         assets_dir=assets_dir)
                self._handlers[key] = cls
            return cls

    def items(self):
        return dict(self._dirs)


# ---------------------------------------------------------------------------
# The canvas_* tools
# ---------------------------------------------------------------------------

def _dir_schema(extra_props=None, extra_required=()):
    props = {"dir": {
        "type": "string",
        "description": "Absolute path of the canvas workspace directory "
                       "(e.g. <project>/canvas/<slug>)."}}
    props.update(extra_props or {})
    return {"type": "object", "properties": props,
            "required": ["dir", *extra_required]}


def _cursor(cls):
    # EventBus.wait with an unreachable `since` returns immediately with the
    # latest sequence number and no event.
    return cls.bus.wait(since=10 ** 9, kinds=None, timeout=0)["cursor"]


def _open_agent_comments(cls):
    # Open items for the agent: sent (not pending drafts, not resolved) and
    # authored by the reviewer (claude's own replies are excluded).
    return [c for c in cls.comments.list()
            if c.get("state") == "sent" and c.get("author") != "claude"]


def _pending_drafts(cls):
    # Unsent drafts (any author), so a session can see the reviewer is
    # mid-draft; kept separate from the actionable "comments" list.
    return [c for c in cls.comments.list() if c.get("state") == "pending"]


def _state(cls):
    return {"comments": _open_agent_comments(cls),
            "pending": _pending_drafts(cls),
            "answers": cls.answers.list(),
            "approval": cls.approval.get(),
            "ack": cls.ack.get(),
            "cursor": _cursor(cls)}


def _latest_submitted(cls):
    subs = [e for e in cls.activity.list() if e.get("kind") == "submitted"]
    return subs[-1] if subs else None


def make_tools(registry, assets_dir, base_url):
    """Build the tool table. base_url is a thunk (the port is only known
    after bind)."""
    assets_dir = Path(assets_dir)

    def _ws(args):
        d = Path(str(args["dir"])).expanduser()
        if not d.is_dir():
            raise ValueError(f"not a canvas workspace directory: {d}")
        key = registry.register(d)
        return key, registry.handler_for(key, assets_dir)

    def canvas_open(args):
        d = Path(str(args["dir"])).expanduser()
        mode = args.get("mode", "plan")
        if mode not in ("plan", "canvas"):
            raise ValueError(f"mode must be 'plan' or 'canvas', got {mode!r}")
        d.mkdir(parents=True, exist_ok=True)
        seeded = False
        if not any(p.suffix.lower() == ".html"
                   for p in d.iterdir() if p.is_file()):
            template = "template.html" if mode == "plan" else "canvas.html"
            page = "plan.html" if mode == "plan" else "canvas.html"
            (d / page).write_text((assets_dir / template).read_text())
            seeded = True
        key, cls = _ws({"dir": str(d)})
        pages = serve._list_pages(d.resolve())
        url = f"{base_url()}/w/{key}/"
        if pages:
            url += pages[0]["file"]
        # A just-seeded workspace holds only the blank template — never show
        # that to the reviewer. Explicit open_browser overrides either way.
        open_browser = args.get("open_browser")
        if open_browser is None:
            open_browser = not seeded
        browser_opened = False
        if open_browser:
            try:
                webbrowser.open(url)
                browser_opened = True
            except Exception:
                pass
        result = {"url": url, "key": key, "dir": str(d.resolve()),
                  "seeded": seeded, "browser_opened": browser_opened,
                  "pages": pages, "feedback": _state(cls)}
        if seeded and not browser_opened:
            result["note"] = (
                "Seeded a blank starting template; the browser was NOT "
                "opened. Author the page(s), then call canvas_open again — "
                "that call opens the reviewer's browser, and only then "
                "share the url.")
        return result

    def canvas_wait(args):
        _, cls = _ws(args)
        since = int(args.get("since", 0))
        timeout = min(float(args.get("timeout", WAIT_DEFAULT_TIMEOUT)),
                      WAIT_MAX_TIMEOUT)
        kinds = None if args.get("events") == "any" else {"submission",
                                                          "approval"}
        r = cls.bus.wait(since=since, kinds=kinds, timeout=timeout)
        approval = cls.approval.get()
        submission = _latest_submitted(cls)
        pickup = "picked up — reading the feedback now"
        if r["event"] == "submission" and submission:
            # Pickup ack keyed to the submitted activity event, so the
            # reviewer's "awaiting Claude…" flips in the same flow; a
            # substantive canvas_ack follows once feedback is applied.
            if cls.ack.get().get("decidedAt") != submission["at"]:
                cls.ack.set(submission["at"], "Claude", pickup)
                cls.activity.append("picked-up", pickup)
        elif r["event"] == "approval" and approval.get("decidedAt"):
            # Legacy approval path: pages still running the old widget POST
            # /api/approval directly; auto-ack keyed on approval.decidedAt.
            if cls.ack.get().get("decidedAt") != approval["decidedAt"]:
                cls.ack.set(approval["decidedAt"], "Claude", pickup)
        return {"cursor": r["cursor"], "event": r["event"],
                "approval": approval,
                "submission": ({"refs": submission["refs"],
                                "at": submission["at"]}
                               if submission else None),
                "comments": _open_agent_comments(cls),
                "answers": cls.answers.list()}

    def canvas_feedback(args):
        _, cls = _ws(args)
        return _state(cls)

    def canvas_reply(args):
        _, cls = _ws(args)
        comment_id = str(args["comment_id"])
        parent = next((c for c in cls.comments.list()
                       if c["id"] == comment_id), None)
        if parent is None:
            raise ValueError(f"no such comment: {comment_id}")
        reply = cls.comments.add({
            "parentId": comment_id,
            "blockId": parent.get("blockId", ""),
            "blockLabel": parent.get("blockLabel", ""),
            "page": parent.get("page", "plan.html"),
            "author": "claude",
            "body": str(args.get("message", "")),
        })
        body = parent.get("body", "") or ""
        quoted = body if len(body) <= 40 else body[:40] + "…"
        cls.activity.append("replied", f'replied to "{quoted}"',
                            {"comment": comment_id, "reply": reply["id"]})
        return reply

    def canvas_resolve(args):
        _, cls = _ws(args)
        ids = args.get("comment_ids") or []
        resolved = {cid: cls.comments.resolve(cid) for cid in ids}
        n = sum(1 for ok in resolved.values() if ok)
        if n:  # skip the event when nothing actually resolved
            cls.activity.append(
                "resolved", f"resolved {n} comment{'' if n == 1 else 's'}",
                {"comments": [cid for cid, ok in resolved.items() if ok]})
        return {"resolved": resolved}

    def canvas_ack(args):
        _, cls = _ws(args)
        decided_at = cls.approval.get().get("decidedAt")
        message = str(args.get("message", ""))
        result = cls.ack.set(decided_at, "Claude", message)
        cls.activity.append("acked", message)
        return result

    def canvas_export(args):
        _, cls = _ws(args)
        d = cls.plan_dir

        def read_asset(name):
            p = d / name
            if not p.exists():
                p = assets_dir / name
            return p.read_text() if p.exists() else ""

        pages = args.get("pages") or [p["file"] for p in serve._list_pages(d)]
        out_dir = d / "export"
        out_dir.mkdir(exist_ok=True)
        exported = []
        for page in pages:
            html = (d / page).read_text()
            css = read_asset("plan.css")
            html = re.sub(r"<link[^>]*plan\.css[^>]*>",
                          lambda m, c=css: "<style>\n" + c + "\n</style>",
                          html, count=1)
            for js in ("comments.js", "diagram.js"):
                code = read_asset(js)
                html = re.sub(
                    rf'<script src="{js}"></script>',
                    lambda m, c=code: "<script>\n" + c + "\n</script>",
                    html, count=1)
            out = out_dir / page
            out.write_text(html)
            exported.append(str(out))
        return {"exported": exported}

    return {
        "canvas_open": {
            "description":
                "Open (creating if needed) a canvas workspace and get its "
                "review URL. On first open it seeds the starting template and "
                "does NOT launch the browser (the page is blank; seeded=true "
                "in the result) — author your pages, then call canvas_open "
                "again: it launches the reviewer's browser at the first page. "
                "Share the url with the user only once the pages are authored. "
                "Returns url, key, pages (each with file, title, and kind: "
                "plan|mockup|diagram|decision|doc), seeded, browser_opened, "
                "and current feedback state.",
            "inputSchema": _dir_schema({
                "mode": {"type": "string", "enum": ["plan", "canvas"],
                         "description": "plan = gated plan template (default);"
                                        " canvas = ungated artifact template."},
                "open_browser": {"type": "boolean",
                                 "description": "Force the browser open (true) "
                                                "or closed (false). Default: "
                                                "open unless this call seeded "
                                                "the blank template."}}),
            "fn": canvas_open,
        },
        "canvas_wait": {
            "description":
                "Block until the reviewer sends a review batch (one submission "
                "event covering comments + answers + an optional decision) or "
                "the timeout passes. Auto-acknowledges the pickup. Returns "
                "cursor, event (submission|approval|null), approval state, the "
                "latest submission (refs+at, or null), open reviewer comments "
                "(sent, unresolved), and answers. Re-call with the returned "
                "cursor as `since`.",
            "inputSchema": _dir_schema({
                "since": {"type": "integer",
                          "description": "Event cursor from the previous call "
                                         "(0 on first call)."},
                "timeout": {"type": "number",
                            "description": "Seconds to block (default 50 — "
                                           "stays under Claude Code's ~60 s "
                                           "MCP tool timeout; max 590 for "
                                           "sessions with MCP_TOOL_TIMEOUT "
                                           "raised)."},
                "events": {"type": "string", "enum": ["agent", "any"],
                           "description": "agent = comments/approvals only "
                                          "(default); any = also answers and "
                                          "notes."}}),
            "fn": canvas_wait,
        },
        "canvas_feedback": {
            "description":
                "Read a workspace's full review state without blocking: open "
                "reviewer comments, unsent pending drafts (so you can tell the "
                "reviewer is mid-draft), answers, approval, ack, and the "
                "current event cursor.",
            "inputSchema": _dir_schema(),
            "fn": canvas_feedback,
        },
        "canvas_reply": {
            "description":
                "Post a threaded reply (author 'claude', immediately visible) "
                "under a reviewer comment — for 'done, see the new section 3' "
                "or a counter-question — instead of burying the response in "
                "chat. The parent comment must exist. Returns the created "
                "reply comment.",
            "inputSchema": _dir_schema(
                {"comment_id": {"type": "string",
                                "description": "Id of the comment to reply to."},
                 "message": {"type": "string",
                             "description": "The reply body."}},
                extra_required=("comment_id", "message")),
            "fn": canvas_reply,
        },
        "canvas_resolve": {
            "description":
                "Mark addressed review comments as resolved. Returns per-id "
                "success.",
            "inputSchema": _dir_schema(
                {"comment_ids": {"type": "array",
                                 "items": {"type": "string"}}},
                extra_required=("comment_ids",)),
            "fn": canvas_resolve,
        },
        "canvas_ack": {
            "description":
                "Send a substantive acknowledgement for the latest review "
                "submission once its feedback has been read and applied.",
            "inputSchema": _dir_schema(
                {"message": {"type": "string"}},
                extra_required=("message",)),
            "fn": canvas_ack,
        },
        "canvas_export": {
            "description":
                "Write self-contained archival copies of workspace pages to "
                "<dir>/export/, with the shared review assets inlined.",
            "inputSchema": _dir_schema({
                "pages": {"type": "array", "items": {"type": "string"},
                          "description": "Pages to export (default: all)."}}),
            "fn": canvas_export,
        },
    }


def tool_specs(tools):
    return [{"name": name,
             "description": t["description"],
             "inputSchema": t["inputSchema"]}
            for name, t in tools.items()]


# ---------------------------------------------------------------------------
# JSON-RPC dispatch (stateless: no Mcp-Session-Id, no SSE)
# ---------------------------------------------------------------------------

def _tool_result(payload, is_error=False):
    text = payload if isinstance(payload, str) else json.dumps(payload, indent=2)
    result = {"content": [{"type": "text", "text": text}]}
    if is_error:
        result["isError"] = True
    return result


def dispatch(msg, tools=None):
    """Handle one JSON-RPC message. Returns (http_status, response_or_None)."""
    tools = {} if tools is None else tools
    method = msg.get("method")
    params = msg.get("params") or {}
    is_notification = "id" not in msg
    mid = msg.get("id")

    if method == "initialize":
        result = {
            "protocolVersion": params.get("protocolVersion", PROTOCOL_FALLBACK),
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": tool_specs(tools)}
    elif method == "tools/call":
        name = params.get("name")
        tool = tools.get(name)
        if tool is None:
            result = _tool_result(f"unknown tool: {name!r}", is_error=True)
        else:
            try:
                args = params.get("arguments") or {}
                result = _tool_result(tool["fn"](args))
            except Exception as e:  # a broken tool must not kill the daemon
                result = _tool_result(f"{type(e).__name__}: {e}", is_error=True)
    elif is_notification:
        return 202, None  # e.g. notifications/initialized — accept silently
    else:
        return 200, {"jsonrpc": "2.0", "id": mid,
                     "error": {"code": -32601,
                               "message": f"method not found: {method}"}}

    if is_notification:
        return 202, None
    return 200, {"jsonrpc": "2.0", "id": mid, "result": result}


PARSE_ERROR = {"jsonrpc": "2.0", "id": None,
               "error": {"code": -32700, "message": "parse error"}}


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

_WS_ROUTE = re.compile(r"^/w/([A-Za-z0-9._-]+)(/.*)?$")


def _index_card(key, ws_dir):
    """One hub card per registered canvas. Reads the workspace's JSON files
    best-effort — a broken or half-written workspace must never 500 the hub."""
    import html
    d = Path(ws_dir)
    title, pages_html = key, ""
    open_count, approval_state = 0, None
    try:
        pages = serve._list_pages(d)
        if pages:
            title = pages[0]["title"]
        pages_html = ", ".join(
            f'{html.escape(p["file"])} <span class="kind">{p["kind"]}</span>'
            for p in pages)
    except Exception:
        pass
    try:
        comments = json.loads((d / "comments.json").read_text()).get(
            "comments", [])
        open_count = sum(
            1 for c in comments
            if c.get("author") != "claude"
            and (c.get("state")
                 or ("resolved" if c.get("status") == "resolved" else "sent"))
            == "sent")
    except Exception:
        pass
    try:
        approval_state = json.loads(
            (d / "approval.json").read_text()).get("state")
    except Exception:
        pass
    return (
        f'<li class="card"><a href="/w/{key}/">{html.escape(title)}</a>'
        f'<div class="pages">{pages_html}</div>'
        f'<div class="meta"><span>{open_count} open</span>'
        f'<span class="approval">{html.escape(approval_state or "no decision")}'
        f'</span></div>'
        f'<div class="dir">{html.escape(str(ws_dir))}</div></li>')


def _index_html(registry):
    cards = "".join(_index_card(key, ws_dir)
                    for key, ws_dir in sorted(registry.items().items()))
    style = (
        "body{font:14px system-ui,sans-serif;margin:2rem;color:#222}"
        "h1{font-size:1.3rem}ul{list-style:none;padding:0;display:grid;"
        "gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}"
        ".card{border:1px solid #ddd;border-radius:8px;padding:.75rem 1rem}"
        ".card a{font-weight:600;text-decoration:none;color:#0b5}"
        ".pages{color:#555;margin:.35rem 0;font-size:13px}"
        ".kind{color:#888;font-size:11px}"
        ".meta{display:flex;gap:1rem;font-size:12px;color:#666}"
        ".approval{font-weight:600}"
        ".dir{color:#aaa;font-size:11px;margin-top:.35rem;word-break:break-all}")
    return ("<!DOCTYPE html><html><head><meta charset='utf-8'>"
            f"<title>canvasd</title><style>{style}</style></head><body>"
            f"<h1>canvasd</h1><ul>{cards or '<li>no canvases yet</li>'}</ul>"
            "</body></html>")


def make_handler(registry, assets_dir, tools):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # quiet

        # _json/_body match serve.py's handler helpers so its unbound
        # do_GET/do_POST run against this instance when we delegate.
        def _json(self, code, obj):
            body = b"" if obj is None else json.dumps(obj).encode()
            self.send_response(code)
            if body:
                self.send_header("Content-Type",
                                 "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _body(self):
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                return json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return None

        def _delegate(self, method):
            """Route /w/<key>/… into that workspace's serve.py handler."""
            m = _WS_ROUTE.match(self.path)
            cls = registry.handler_for(m.group(1), assets_dir)
            if cls is None:
                return self.send_error(404, "Unknown canvas")
            self.path = m.group(2) or "/"
            return getattr(cls, method)(self)

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path == "/mcp":
                length = int(self.headers.get("Content-Length", 0) or 0)
                raw = self.rfile.read(length) if length else b""
                try:
                    msg = json.loads(raw or b"")
                except json.JSONDecodeError:
                    return self._json(200, PARSE_ERROR)
                if not isinstance(msg, dict):
                    return self._json(200, PARSE_ERROR)
                code, resp = dispatch(msg, tools)
                return self._json(code, resp)
            if _WS_ROUTE.match(path):
                return self._delegate("do_POST")
            return self.send_error(404, "Not found")

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/mcp":
                # No server-push: clients that probe for an SSE stream get a
                # clean 405 and fall back to plain request/response.
                return self.send_error(405, "Method not allowed")
            if path in ("", "/"):
                body = _index_html(registry).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if _WS_ROUTE.match(path):
                return self._delegate("do_GET")
            return self.send_error(404, "Not found")

        def do_DELETE(self):
            # Session teardown from spec-following clients; we are stateless.
            if self.path.split("?", 1)[0] == "/mcp":
                return self._json(200, None)
            return self.send_error(404, "Not found")

    return Handler


def build_server(port=DEFAULT_PORT, host="127.0.0.1",
                 registry_path=None, assets_dir=None):
    registry = Registry(registry_path or DEFAULT_REGISTRY)
    assets = Path(assets_dir) if assets_dir else _ASSETS_DIR
    tools = {}  # filled after bind — canvas_open needs the bound port
    httpd = ThreadingHTTPServer((host, port),
                                make_handler(registry, assets, tools))
    bound = httpd.server_address[1]
    tools.update(make_tools(registry, assets,
                            lambda: f"http://{host}:{bound}"))
    httpd.registry = registry
    return httpd


# ---------------------------------------------------------------------------
# launchd installer (macOS): KeepAlive + RunAtLoad, logs under ~/.claude/canvas
# ---------------------------------------------------------------------------

LAUNCHD_LABEL = "com.claude.canvasd"


def launchd_plist(port=DEFAULT_PORT):
    import sys
    log = Path.home() / ".claude" / "canvas" / "canvasd.log"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
 "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{sys.executable}</string>
    <string>{Path(__file__).resolve()}</string>
    <string>--port</string>
    <string>{port}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"""


def install(port=DEFAULT_PORT):
    import os
    import subprocess
    (Path.home() / ".claude" / "canvas").mkdir(parents=True, exist_ok=True)
    plist = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_text(launchd_plist(port))
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", domain, str(plist)],
                   capture_output=True)  # replace an older agent, if any
    subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
    print(f"launchd agent installed: {plist}")
    print(f"daemon: http://127.0.0.1:{port}/  (mcp at /mcp)")
    print("register once:  claude mcp add --transport http --scope user "
          f"canvas http://127.0.0.1:{port}/mcp")
    print(f"after code changes:  launchctl kickstart -k {domain}/{LAUNCHD_LABEL}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", nargs="?", default="run",
                    choices=["run", "install"],
                    help="run the daemon (default) or install the launchd "
                         "agent that keeps it alive")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = ap.parse_args()
    if args.command == "install":
        return install(port=args.port)
    httpd = build_server(port=args.port)
    print(f"canvasd on http://127.0.0.1:{httpd.server_address[1]}/ (mcp at /mcp)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
