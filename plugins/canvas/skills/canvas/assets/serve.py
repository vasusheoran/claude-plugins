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


class CommentStore(_JsonFile):
    def __init__(self, path):
        super().__init__(path, {"comments": []})

    def list(self):
        return self.read().get("comments", [])

    def add(self, fields):
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
            "author": fields.get("author", "human"),
            "target": fields.get("target", "agent"),
            "page": fields.get("page", "plan.html"),
            "status": "open",
            "createdAt": _now(),
        }
        with self._lock:
            data = self.read()
            data.setdefault("comments", []).append(comment)
            self.write(data)
        return comment

    def _set_status(self, comment_id, status):
        with self._lock:
            data = self.read()
            for c in data.get("comments", []):
                if c["id"] == comment_id:
                    c["status"] = status
                    self.write(data)
                    return True
        return False

    def resolve(self, comment_id):
        return self._set_status(comment_id, "resolved")

    def reopen(self, comment_id):
        return self._set_status(comment_id, "open")


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


def safe_path(root, url_path):
    """Resolve url_path to a file inside root, or None if it escapes."""
    root = Path(root).resolve()
    rel = url_path.split("?", 1)[0].lstrip("/")
    if rel in ("", "/"):
        return root / "plan.html"
    target = (root / rel).resolve()
    if root != target and root not in target.parents:
        return None
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


def _list_pages(plan_dir):
    """List *.html files directly in plan_dir, plan.html first then alphabetical.

    Returns a list of {"file": name, "title": title_or_filename} dicts.
    Title is extracted from the first <title>…</title> tag in the file (case-
    insensitive, whitespace-trimmed); falls back to the filename if absent.
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
    _title_re = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
    for name in html_files:
        try:
            snippet = (plan_dir / name).read_text(errors="replace")[:4096]
        except OSError:
            snippet = ""
        m = _title_re.search(snippet)
        title = m.group(1).strip() if m else ""
        pages.append({"file": name, "title": title or name})
    return pages


def make_handler(plan_dir):
    plan_dir = Path(plan_dir).resolve()
    comments = CommentStore(plan_dir / "comments.json")
    answers = AnswerStore(plan_dir / "answers.json")
    approval = ApprovalStore(plan_dir / "approval.json")
    ack = AckStore(plan_dir / "ack.json")
    bus = EventBus()

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
            if path == "/api/version":
                return self._json(200, {
                    "plan": _digest(plan_dir / "plan.html"),
                    "comments": _digest(plan_dir / "comments.json"),
                    "answers": _digest(plan_dir / "answers.json"),
                    "approval": _digest(plan_dir / "approval.json"),
                    "ack": _digest(plan_dir / "ack.json"),
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
                    # "agent" default: comment and approval
                    kinds = {"comment", "approval"}
                result = bus.wait(since=since, kinds=kinds, timeout=timeout)
                return self._json(200, result)
            target = safe_path(plan_dir, self.path)
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
                comment = comments.add(payload)
                if comment.get("target") == "agent":
                    bus.notify("comment")
                return self._json(201, comment)
            if path.startswith("/api/comments/") and path.endswith("/resolve"):
                cid = path[len("/api/comments/"):-len("/resolve")]
                return self._json(200, {"ok": comments.resolve(cid)})
            if path.startswith("/api/comments/") and path.endswith("/reopen"):
                cid = path[len("/api/comments/"):-len("/reopen")]
                return self._json(200, {"ok": comments.reopen(cid)})
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
