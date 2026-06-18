#!/usr/bin/env python3
"""Local server for a visual plan — stdlib only, no pip installs.

Serves a self-contained HTML plan AND a tiny comment API so a reviewer can
click a block, leave a comment, and have it persisted to comments.json next to
the plan. The agent then reads comments.json (the local analog of the hosted
`get-plan-feedback` loop), revises the plan, and the reviewer reloads.

Usage:
    python3 serve.py [--dir .] [--port 8000] [--open]

Endpoints:
    GET  /                       -> plan.html
    GET  /<file>                 -> static file inside --dir (no traversal)
    GET  /api/comments           -> {"comments": [...]}
    POST /api/comments           -> create a comment, returns it (201)
    POST /api/comments/<id>/resolve -> mark a comment resolved
"""

import argparse
import json
import secrets
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class CommentStore:
    """JSON-file-backed comment list. Single-process; guarded by a lock."""

    def __init__(self, path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def _read(self):
        if not self.path.exists():
            return {"comments": []}
        try:
            return json.loads(self.path.read_text() or "{}") or {"comments": []}
        except json.JSONDecodeError:
            return {"comments": []}

    def _write(self, data):
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(self.path)

    def list(self):
        return self._read().get("comments", [])

    def add(self, fields):
        comment = {
            "id": "c-" + secrets.token_hex(6),
            "blockId": fields.get("blockId", ""),
            "blockLabel": fields.get("blockLabel", ""),
            "quote": fields.get("quote"),
            "body": fields.get("body", ""),
            "author": fields.get("author", "human"),
            "target": fields.get("target", "agent"),
            "status": "open",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            data = self._read()
            data.setdefault("comments", []).append(comment)
            self._write(data)
        return comment

    def resolve(self, comment_id):
        with self._lock:
            data = self._read()
            for c in data.get("comments", []):
                if c["id"] == comment_id:
                    c["status"] = "resolved"
                    self._write(data)
                    return True
        return False


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
    store = CommentStore(plan_dir / "comments.json")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # quiet

        def _send_json(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.split("?", 1)[0] == "/api/comments":
                return self._send_json(200, {"comments": store.list()})
            target = safe_path(plan_dir, self.path)
            if target is None:
                return self.send_error(403, "Forbidden")
            if not target.is_file():
                return self.send_error(404, "Not found")
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type",
                             CONTENT_TYPES.get(target.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                payload = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self._send_json(400, {"error": "invalid json"})

            if path == "/api/comments":
                return self._send_json(201, store.add(payload))
            if path.startswith("/api/comments/") and path.endswith("/resolve"):
                cid = path[len("/api/comments/"):-len("/resolve")]
                return self._send_json(200, {"ok": store.resolve(cid)})
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
    print("Comments persist to comments.json — Ctrl-C to stop.")
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
