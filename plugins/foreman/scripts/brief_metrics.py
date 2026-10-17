#!/usr/bin/env python3
"""Re-measure standing-brief retyping (history.jsonl) and canvas decision-page usage."""
import argparse
import glob
import json
import os
import re
import statistics
from datetime import datetime
from pathlib import Path

WORKER_PREFIXES = ("Read /", "When your current", "You are ")

PHRASES = {
    "give_me_a_prompt": r"give me (a|the) prompt|prompt (for|to) (do|start|run)|prompt i can",
    "yes_man": r"yes man",
    "think_through": r"think (this|it|about this|android) (through|hard|real hard)|think this through|think about (this|it) hard",
    "grill": r"grill (yourself|ourselves)|grill ?me|/grillme",
    "visual": r"(explain|show).{0,30}visual|visually",
    "deeper": r"deeper version",
    "foreman": r"/?foreman",
}
PHRASES = {k: re.compile(v, re.I) for k, v in PHRASES.items()}

CONFUSED = re.compile(r"lost|confus|don.?t (get|understand)|what (is|does)|unclear|explain|\?", re.I)
PREMISE = re.compile(r"why|instead|should(n.?t)?|do we need|not right|wrong|i think", re.I)


def _load(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def prompt_stats(history, since=None):
    cutoff = datetime.strptime(since, "%Y-%m-%d").timestamp() * 1000 if since else None
    counts = dict.fromkeys(PHRASES, 0)
    n, stamps = 0, []
    try:
        lines = Path(os.path.expanduser(history)).read_text().splitlines()
    except OSError:
        lines = []
    for line in lines:
        try:
            row = json.loads(line)
            text, ts = row["display"], row["timestamp"]
        except (ValueError, KeyError, TypeError):
            continue
        if not isinstance(text, str) or not isinstance(ts, (int, float)):
            continue
        if text.startswith(WORKER_PREFIXES) or (cutoff is not None and ts < cutoff):
            continue
        n += 1
        stamps.append(ts)
        for k, rx in PHRASES.items():
            counts[k] += bool(rx.search(text))
    day = lambda t: datetime.fromtimestamp(t / 1000).strftime("%Y-%m-%d")
    return {
        "count": n,
        "first": day(min(stamps)) if stamps else None,
        "last": day(max(stamps)) if stamps else None,
        "phrases": {k: {"count": c, "per100": round(100 * c / n, 2) if n else 0.0}
                    for k, c in counts.items()},
    }


def _leans(ws):
    leans = {}
    for html in Path(ws).glob("*.html"):
        try:
            text = html.read_text()
        except OSError:
            continue
        for chunk in text.split('data-question-id="')[1:]:
            qid = chunk.split('"', 1)[0]
            for tag in re.findall(r"<[^>]*>", chunk):
                if re.search(r'class="[^"]*qopt', tag) and re.search(r"\bdata-lean\b", tag):
                    m = re.search(r'data-value="([^"]*)"', tag)
                    if m:
                        leans[qid] = m.group(1)
    return leans


def _items(data, key):
    if isinstance(data, dict):
        data = data.get(key)
    return [x for x in data if isinstance(x, dict)] if isinstance(data, list) else []


def _keep(ts, since):
    return not since or not isinstance(ts, str) or ts[:10] >= since


def canvas_stats(pattern, since=None):
    answers = dict.fromkeys(("lean", "override", "defer", "other", "no_lean"), 0)
    comments = dict.fromkeys(("directive", "confused", "premise"), 0)
    submitted, max_pages = [], 0
    for ws in sorted(glob.glob(os.path.expanduser(pattern))):
        if not os.path.isdir(ws):
            continue
        max_pages = max(max_pages, len(list(Path(ws).glob("*.html"))))
        leans = _leans(ws)
        for a in _items(_load(Path(ws) / "answers.json"), "answers"):
            if not _keep(a.get("answeredAt"), since):
                continue
            v = a.get("value")
            if isinstance(v, list):
                v = v[0] if v else None
            lean = leans.get(a.get("questionId"))
            if v == "__defer__":
                answers["defer"] += 1
            elif v == "__other__":
                answers["other"] += 1
            elif lean is None:
                answers["no_lean"] += 1
            else:
                answers["lean" if v == lean else "override"] += 1
        for c in _items(_load(Path(ws) / "comments.json"), "comments"):
            if c.get("parentId") or str(c.get("author") or "").startswith("claude"):
                continue
            if not _keep(c.get("createdAt"), since):
                continue
            body = str(c.get("body") or c.get("text") or "")
            kind = "confused" if CONFUSED.search(body) else "premise" if PREMISE.search(body) else "directive"
            comments[kind] += 1
        n = sum(1 for e in _items(_load(Path(ws) / "activity.json"), "events")
                if e.get("kind") == "submitted" and _keep(e.get("at"), since))
        if n:
            submitted.append(n)
    return {
        "answers": answers,
        "comments": comments,
        "submitted_median": statistics.median(submitted) if submitted else 0,
        "submitted_max": max(submitted, default=0),
        "max_pages": max_pages,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--history", default="~/.claude/history.jsonl")
    ap.add_argument("--canvas-glob", default="~/workspace/vasu/*/canvas/*/")
    ap.add_argument("--since", help="YYYY-MM-DD, inclusive")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    p, c = prompt_stats(a.history, a.since), canvas_stats(a.canvas_glob, a.since)
    if a.json:
        print(json.dumps({"prompts": p, "canvas": c}, indent=2))
        return
    print(f"prompts: {p['count']}  ({p['first']}..{p['last']})")
    for k, v in p["phrases"].items():
        print(f"  {k:18} {v['count']:5}  {v['per100']:6.2f}/100")
    print("answers: " + "  ".join(f"{k}={v}" for k, v in c["answers"].items()))
    print("comments: " + "  ".join(f"{k}={v}" for k, v in c["comments"].items()))
    print(f"submitted per workspace: median={c['submitted_median']} max={c['submitted_max']}")
    print(f"max pages per workspace: {c['max_pages']}")


if __name__ == "__main__":
    main()
