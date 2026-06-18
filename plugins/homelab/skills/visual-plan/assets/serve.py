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
    comments.json   review comments (threaded via parentId; pin/quote anchors)
    answers.json    answers to inline question blocks
    approval.json   approve / request-changes decision

Endpoints:
    GET  /                              -> plan.html
    GET  /<file>                        -> static file inside --dir (no traversal)
    GET  /api/comments                  -> {"comments": [...]}
    POST /api/comments                  -> create a comment/reply (201)
    POST /api/comments/<id>/resolve     -> mark resolved
    POST /api/comments/<id>/reopen      -> mark open
    GET  /api/answers                   -> {"answers": [...]}
    POST /api/answers                   -> upsert one question's answer (201)
    GET  /api/approval                  -> {"state": ..., "note": ..., ...}
    POST /api/approval                  -> set approval decision
    GET  /api/version                   -> content digests for live refresh
"""

import argparse
import hashlib
import json
import secrets
import threading
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
            "quote": fields.get("quote"),
            "anchor": fields.get("anchor"),
            "body": fields.get("body", ""),
            "author": fields.get("author", "human"),
            "target": fields.get("target", "agent"),
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


def make_handler(plan_dir):
    plan_dir = Path(plan_dir).resolve()
    comments = CommentStore(plan_dir / "comments.json")
    answers = AnswerStore(plan_dir / "answers.json")
    approval = ApprovalStore(plan_dir / "approval.json")

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
            if path == "/api/version":
                return self._json(200, {
                    "plan": _digest(plan_dir / "plan.html"),
                    "comments": _digest(plan_dir / "comments.json"),
                    "answers": _digest(plan_dir / "answers.json"),
                    "approval": _digest(plan_dir / "approval.json"),
                })
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
                return self._json(201, comments.add(payload))
            if path.startswith("/api/comments/") and path.endswith("/resolve"):
                cid = path[len("/api/comments/"):-len("/resolve")]
                return self._json(200, {"ok": comments.resolve(cid)})
            if path.startswith("/api/comments/") and path.endswith("/reopen"):
                cid = path[len("/api/comments/"):-len("/reopen")]
                return self._json(200, {"ok": comments.reopen(cid)})
            if path == "/api/answers":
                return self._json(201, answers.upsert(payload))
            if path == "/api/approval":
                return self._json(200, approval.set(
                    payload.get("state"), payload.get("note", "")))
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
