#!/usr/bin/env python3
"""Local server for a visual plan — stdlib only, no pip installs.

Serves a self-contained HTML plan plus a small review API so a reviewer can,
entirely offline:
  - comment on a block, a text selection, or a pinned point (threads + replies)
  - resolve / reopen comments from the page
  - answer inline question blocks (single / multi / freeform)
  - approve the plan or request changes (the explicit approval gate)
and have all of it persisted to JSON next to the plan. The agent reads those
files (the local analog of the hosted `get-plan-feedback` loop), revises the
plan, and the browser live-refreshes.

Usage:
    python3 serve.py [--dir .] [--port 8000] [--open]

Persisted files (next to plan.html):
    comments.json   review comments (threaded via parentId; pin/quote anchors;
                    page field anchors comment to a specific HTML artifact,
                    defaulting to "plan.html")
    answers.json    answers to inline question blocks
    approval.json   approve / request-changes decision

Endpoints:
    GET  /                              -> plan.html
    GET  /<file>                        -> static file inside --dir (no traversal)
    GET  /api/comments                  -> {"comments": [...]}
    POST /api/comments                  -> create a comment/reply (201); page field
                                           defaults to "plan.html"
    POST /api/comments/<id>/resolve     -> mark resolved
    POST /api/comments/<id>/reopen      -> mark open
    GET  /api/answers                   -> {"answers": [...]}
    POST /api/answers                   -> upsert one question's answer (201)
    GET  /api/approval                  -> {"state": ..., "note": ..., ...}
    POST /api/approval                  -> set approval decision
    GET  /api/version                   -> content digests for live refresh
    GET  /api/pages                     -> {"pages": [{"file": ..., "title": ...}]}
    GET  /api/wait?since=N&timeout=S&events=agent|any
                                        -> long-poll; blocks until a qualifying
                                           event (comment to agent, approval, or
                                           any event when events=any) or timeout;
                                           returns {"cursor": int, "event": str|None}
"""

import argparse
import hashlib
import json
import re
import secrets
import threading
import time
import urllib.parse
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _now():
    return datetime.now(timezone.utc).isoformat()


class _JsonFile:
    """Lock-guarded JSON file with a default-empty shape."""

    def __init__(self, path, default):
        self.path = Path(path)
        self._default = default
        self._lock = threading.Lock()

    def read(self):
        if not self.path.exists():
            return json.loads(json.dumps(self._default))  # deep copy
        try:
            return json.loads(self.path.read_text() or "{}") or \
                json.loads(json.dumps(self._default))
        except json.JSONDecodeError:
            return json.loads(json.dumps(self._default))

    def write(self, data):
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(self.path)


def _state_of(comment):
    """The comment's lifecycle state, deriving it from a legacy v1 `status`
    when the v2 `state` field is absent (read-time mapping; never rewrites)."""
    if "state" in comment:
        return comment["state"]
    return "resolved" if comment.get("status") == "resolved" else "sent"


class CommentStore(_JsonFile):
    def __init__(self, path):
        super().__init__(path, {"comments": []})

    def list(self):
        # Fill in the derived state for legacy entries at read time; read()
        # returns a fresh parse each call, so this never touches the file.
        comments = self.read().get("comments", [])
        for c in comments:
            c.setdefault("state", _state_of(c))
        return comments

    def add(self, fields):
        # Reviewer comments are born pending drafts; claude replies are sent.
        author = fields.get("author", "human")
        state = "sent" if author == "claude" else "pending"
        comment = {
            "id": "c-" + secrets.token_hex(6),
            "parentId": fields.get("parentId"),
            "blockId": fields.get("blockId", ""),
            "blockLabel": fields.get("blockLabel", ""),
            "componentId": fields.get("componentId"),
            "componentLabel": fields.get("componentLabel"),
            "quote": fields.get("quote"),
            "anchor": fields.get("anchor"),
            "body": fields.get("body", ""),
            "author": author,
            "page": fields.get("page", "plan.html"),
            "state": state,
            "createdAt": _now(),
        }
        if state == "sent":
            comment["sentAt"] = _now()
        # The retired v1 fields aren't written on new comments, but a legacy
        # client that still sends them gets them stored (state governs).
        if "status" in fields:
            comment["status"] = fields["status"]
        if "target" in fields:
            comment["target"] = fields["target"]
        with self._lock:
            data = self.read()
            data.setdefault("comments", []).append(comment)
            self.write(data)
        return comment

    def _set_state(self, comment_id, state, legacy_status):
        with self._lock:
            data = self.read()
            for c in data.get("comments", []):
                if c["id"] == comment_id:
                    c["state"] = state
                    if "status" in c:  # keep a stale reader in sync
                        c["status"] = legacy_status
                    self.write(data)
                    return True
        return False

    def resolve(self, comment_id):
        return self._set_state(comment_id, "resolved", "resolved")

    def reopen(self, comment_id):
        # A reopened comment goes back in front of the agent, not to a draft.
        return self._set_state(comment_id, "sent", "open")

    def edit(self, comment_id, body):
        """Edit a comment's body — pending drafts only. True if applied."""
        with self._lock:
            data = self.read()
            for c in data.get("comments", []):
                if c["id"] == comment_id:
                    if _state_of(c) != "pending":
                        return False
                    c["body"] = body
                    c["editedAt"] = _now()
                    self.write(data)
                    return True
        return False

    def delete(self, comment_id):
        """Remove a comment — pending drafts only. True if removed."""
        with self._lock:
            data = self.read()
            comments = data.get("comments", [])
            for i, c in enumerate(comments):
                if c["id"] == comment_id:
                    if _state_of(c) != "pending":
                        return False
                    del comments[i]
                    self.write(data)
                    return True
        return False

    def submit_pending(self):
        """Flip every pending draft to sent; return the newly sent comments."""
        now = _now()
        sent = []
        with self._lock:
            data = self.read()
            for c in data.get("comments", []):
                if c.get("state") == "pending":
                    c["state"] = "sent"
                    c["sentAt"] = now
                    if "status" in c:
                        c["status"] = "open"
                    sent.append(c)
            if sent:
                self.write(data)
        return sent


class AnswerStore(_JsonFile):
    def __init__(self, path):
        super().__init__(path, {"answers": []})

    def list(self):
        return self.read().get("answers", [])

    def upsert(self, fields):
        answer = {
            "questionId": fields.get("questionId", ""),
            "questionLabel": fields.get("questionLabel", ""),
            "mode": fields.get("mode", "single"),
            "value": fields.get("value"),
            "answeredAt": _now(),
        }
        with self._lock:
            data = self.read()
            answers = [a for a in data.get("answers", [])
                       if a.get("questionId") != answer["questionId"]]
            answers.append(answer)
            data["answers"] = answers
            self.write(data)
        return answer


class ApprovalStore(_JsonFile):
    def __init__(self, path):
        super().__init__(path, {"state": None, "note": "", "decidedAt": None})

    def get(self):
        return self.read()

    def set(self, state, note=""):
        data = {"state": state, "note": note, "decidedAt": _now()}
        with self._lock:
            self.write(data)
        return data


class AckStore(_JsonFile):
    """The agent's acknowledgement of a submission. Durable so the reviewer's
    confirmation reflects that the agent actually saw it — not a UI flash. Keyed
    by the submission's decidedAt so a fresh submit shows 'awaiting' until acked."""

    def __init__(self, path):
        super().__init__(path, {"decidedAt": None, "by": None,
                                "message": "", "ackedAt": None})

    def get(self):
        return self.read()

    def set(self, decided_at, by="Claude", message=""):
        data = {"decidedAt": decided_at, "by": by, "message": message,
                "ackedAt": _now()}
        with self._lock:
            self.write(data)
        return data


class ActivityStore(_JsonFile):
    """Server-appended, append-only feed rendered by the browser (bell/feed).
    Kinds: submitted, picked-up, replied, resolved, page-updated, acked."""

    def __init__(self, path):
        super().__init__(path, {"events": []})

    def list(self):
        return self.read().get("events", [])

    def append(self, kind, summary, refs=None):
        event = {"at": _now(), "kind": kind, "summary": summary, "refs": refs}
        with self._lock:
            data = self.read()
            data.setdefault("events", []).append(event)
            self.write(data)
        return event


class EventBus:
    """In-memory event bus for server-push notifications (long-poll via /api/wait).

    notify(kind) -> seq: append an event, return its monotonically increasing
        integer sequence number (starting at 1). Keeps at most 200 events.
    wait(since, kinds=None, timeout=540) -> {"cursor": int, "event": str|None}:
        block until an event exists with seq > since and kind in kinds (None
        means any kind), or until timeout. Returns immediately if a qualifying
        event already exists. cursor is always the latest seq at return time.
    """

    _MAX_EVENTS = 200

    def __init__(self):
        self._lock = threading.Condition(threading.Lock())
        self._events = []  # list of (seq, kind)
        self._seq = 0

    def notify(self, kind):
        """Append an event of the given kind; return its seq."""
        with self._lock:
            self._seq += 1
            self._events.append((self._seq, kind))
            if len(self._events) > self._MAX_EVENTS:
                self._events = self._events[-self._MAX_EVENTS:]
            self._lock.notify_all()
            return self._seq

    def wait(self, since, kinds=None, timeout=540):
        """Block until a qualifying event or timeout.

        Returns {"cursor": latest_seq, "event": kind_or_None}.
        kinds=None means accept any kind.
        """
        with self._lock:
            deadline = time.monotonic() + timeout

            while True:
                # Check for a qualifying event already in the buffer.
                for seq, kind in self._events:
                    if seq > since and (kinds is None or kind in kinds):
                        return {"cursor": self._seq, "event": kind}

                # How long until timeout?
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return {"cursor": self._seq, "event": None}

                self._lock.wait(timeout=remaining)


# The only files the shared-asset fallback may serve. Workspaces used to carry
# copies of these; canvasd passes assets_dir so they resolve to the skill's
# shared copy when the workspace has none (a workspace file always wins).
SHARED_ASSETS = {"plan.css", "comments.js", "diagram.js"}


def safe_path(root, url_path, assets_dir=None):
    """Resolve url_path to a file inside root, or None if it escapes.

    With assets_dir set, an allowlisted asset name missing from root falls
    back to assets_dir. The escape check runs first — a traversal attempt
    never reaches the fallback.
    """
    root = Path(root).resolve()
    rel = url_path.split("?", 1)[0].lstrip("/")
    if rel in ("", "/"):
        default = root / "plan.html"
        if default.exists():
            return default
        # Mockup/doc workspaces have no plan.html — serve the first page
        # (_list_pages order: plan.html first, then alphabetical) instead of 404.
        pages = _list_pages(root)
        return (root / pages[0]["file"]) if pages else default
    target = (root / rel).resolve()
    if root != target and root not in target.parents:
        return None
    if assets_dir and rel in SHARED_ASSETS and not target.exists():
        return Path(assets_dir) / rel
    return target


def _digest(path):
    path = Path(path)
    if not path.exists():
        return None
    return hashlib.sha1(path.read_bytes()).hexdigest()[:12]


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
}


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_KIND_RE = re.compile(r"<body[^>]*\bdata-canvas-kind=[\"']([a-zA-Z]+)[\"']",
                      re.IGNORECASE)
_PAGE_KINDS = {"plan", "mockup", "diagram", "decision", "doc"}


def _list_pages(plan_dir):
    """List *.html files directly in plan_dir, plan.html first then alphabetical.

    Returns a list of {"file", "title", "kind"} dicts. Title comes from the
    first <title>…</title> tag (falls back to the filename). Kind comes from
    the <body data-canvas-kind="…"> attribute (one of plan/mockup/diagram/
    decision/doc); default when absent is "plan" for plan.html, else "doc".
    """
    html_files = sorted(
        p.name for p in plan_dir.iterdir()
        if p.is_file() and p.suffix.lower() == ".html"
    )
    # plan.html sorts first
    if "plan.html" in html_files:
        html_files.remove("plan.html")
        html_files = ["plan.html"] + html_files

    pages = []
    for name in html_files:
        try:
            snippet = (plan_dir / name).read_text(errors="replace")[:8192]
        except OSError:
            snippet = ""
        m = _TITLE_RE.search(snippet)
        title = m.group(1).strip() if m else ""
        km = _KIND_RE.search(snippet)
        kind = km.group(1).lower() if km else ""
        if kind not in _PAGE_KINDS:
            kind = "plan" if name == "plan.html" else "doc"
        pages.append({"file": name, "title": title or name, "kind": kind})
    return pages


def make_handler(plan_dir, assets_dir=None):
    plan_dir = Path(plan_dir).resolve()
    comments = CommentStore(plan_dir / "comments.json")
    answers = AnswerStore(plan_dir / "answers.json")
    approval = ApprovalStore(plan_dir / "approval.json")
    ack = AckStore(plan_dir / "ack.json")
    activity = ActivityStore(plan_dir / "activity.json")
    bus = EventBus()

    # Last-seen page digests for server-side page-updated detection. Lazily
    # initialized on the first /api/version (no event emitted then); a later
    # poll that sees a digest change appends one page-updated activity event.
    # Lock-guarded compare-and-set so concurrent polls can't double-append.
    _pages = {"digests": None}
    _pages_lock = threading.Lock()

    def _page_digests():
        return {p.name: _digest(p) for p in plan_dir.glob("*.html")}

    def _detect_page_updates(current):
        with _pages_lock:
            prev = _pages["digests"]
            if prev is None:
                _pages["digests"] = current
                return
            changed = sorted(f for f, d in current.items() if prev.get(f) != d)
            if changed:
                _pages["digests"] = current
                activity.append("page-updated", ", ".join(changed) + " updated",
                                {"pages": changed})

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # quiet

        def _json(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                return json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return None

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/comments":
                return self._json(200, {"comments": comments.list()})
            if path == "/api/answers":
                return self._json(200, {"answers": answers.list()})
            if path == "/api/approval":
                return self._json(200, approval.get())
            if path == "/api/ack":
                return self._json(200, ack.get())
            if path == "/api/activity":
                return self._json(200, {"events": activity.list()})
            if path == "/api/version":
                pages = _page_digests()
                _detect_page_updates(pages)
                return self._json(200, {
                    "plan": _digest(plan_dir / "plan.html"),
                    "comments": _digest(plan_dir / "comments.json"),
                    "answers": _digest(plan_dir / "answers.json"),
                    "approval": _digest(plan_dir / "approval.json"),
                    "ack": _digest(plan_dir / "ack.json"),
                    "activity": _digest(plan_dir / "activity.json"),
                    "pages": pages,
                })
            if path == "/api/pages":
                return self._json(200, {"pages": _list_pages(plan_dir)})
            if path == "/api/wait":
                qs = self.path.split("?", 1)[1] if "?" in self.path else ""
                params = urllib.parse.parse_qs(qs)
                since = int(params.get("since", ["0"])[0])
                raw_timeout = float(params.get("timeout", ["540"])[0])
                timeout = max(0.0, min(600.0, raw_timeout))
                events_param = params.get("events", ["agent"])[0]
                if events_param == "any":
                    kinds = None
                else:
                    # "agent" default: a batch submission or an approval
                    # decision (the transition path for the old widget).
                    kinds = {"submission", "approval"}
                result = bus.wait(since=since, kinds=kinds, timeout=timeout)
                return self._json(200, result)
            target = safe_path(plan_dir, self.path, assets_dir=assets_dir)
            if target is None:
                return self.send_error(403, "Forbidden")
            if not target.is_file():
                return self.send_error(404, "Not found")
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type",
                             CONTENT_TYPES.get(target.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            payload = self._body()
            if payload is None:
                return self._json(400, {"error": "invalid json"})

            if path == "/api/comments":
                # Drafts (pending) and claude replies (sent) are both silent:
                # the batch Send fires the one submission event; the browser
                # picks up replies by polling /api/version.
                return self._json(201, comments.add(payload))
            if path.startswith("/api/comments/") and path.endswith("/resolve"):
                cid = path[len("/api/comments/"):-len("/resolve")]
                return self._json(200, {"ok": comments.resolve(cid)})
            if path.startswith("/api/comments/") and path.endswith("/reopen"):
                cid = path[len("/api/comments/"):-len("/reopen")]
                return self._json(200, {"ok": comments.reopen(cid)})
            if path.startswith("/api/comments/") and path.endswith("/edit"):
                cid = path[len("/api/comments/"):-len("/edit")]
                return self._json(
                    200, {"ok": comments.edit(cid, payload.get("body", ""))})
            if path.startswith("/api/comments/") and path.endswith("/delete"):
                cid = path[len("/api/comments/"):-len("/delete")]
                return self._json(200, {"ok": comments.delete(cid)})
            if path == "/api/submit":
                submitted = comments.submit_pending()
                decision = payload.get("decision")
                if decision is not None:
                    approval.set(decision, payload.get("note", ""))
                n = len(submitted)
                summary = f"sent {n} item{'' if n == 1 else 's'}"
                if decision:
                    label = {"changes-requested": "changes requested",
                             "approved": "approved"}.get(decision, decision)
                    summary += f" — {label}"
                ev = activity.append(
                    "submitted", summary,
                    {"comments": [c["id"] for c in submitted],
                     "decision": decision})
                bus.notify("submission")
                return self._json(200, {"submitted": submitted,
                                        "submittedAt": ev["at"],
                                        "approval": approval.get()})
            if path == "/api/answers":
                answer = answers.upsert(payload)
                bus.notify("answer")
                return self._json(201, answer)
            if path == "/api/approval":
                result = approval.set(
                    payload.get("state"), payload.get("note", ""))
                bus.notify("approval")
                return self._json(200, result)
            if path == "/api/ack":
                return self._json(200, ack.set(
                    payload.get("decidedAt"), payload.get("by", "Claude"),
                    payload.get("message", "")))
            return self.send_error(404, "Not found")

    # canvasd's MCP tools act on the same stores and EventBus the browser
    # posts to (shared locks; wait/notify must share one bus) — expose them.
    Handler.plan_dir = plan_dir
    Handler.comments = comments
    Handler.answers = answers
    Handler.approval = approval
    Handler.ack = ack
    Handler.activity = activity
    Handler.bus = bus
    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=".", help="plan directory")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--open", action="store_true", help="open browser")
    args = ap.parse_args()

    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.dir))
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"Serving {Path(args.dir).resolve()} at {url}")
    print("Comments/answers/approval persist next to plan.html — Ctrl-C to stop.")
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
