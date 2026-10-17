import json
import os
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import brief_metrics as bm  # noqa: E402


def ms(y, m, d, h=12):
    return int(datetime(y, m, d, h).timestamp() * 1000)


class Tmp(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)

    def write(self, rel, content):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content if isinstance(content, str) else json.dumps(content))
        return p


class PromptTests(Tmp):
    def hist(self, rows, raw_extra=""):
        lines = [json.dumps({"display": d, "timestamp": t}) for d, t in rows]
        p = self.write("history.jsonl", "\n".join(lines) + "\n" + raw_extra)
        return str(p)

    def stats(self, rows, since=None, raw_extra=""):
        return bm.prompt_stats(self.hist(rows, raw_extra), since)

    def phrase(self, text):
        s = self.stats([(text, ms(2026, 10, 1))])
        return {k: v["count"] for k, v in s["phrases"].items()}

    def test_worker_prompts_excluded(self):
        s = self.stats([("Read /tmp/x.md", ms(2026, 10, 1)),
                        ("When your current task", ms(2026, 10, 1)),
                        ("You are a worker", ms(2026, 10, 1)),
                        ("hello", ms(2026, 10, 2))])
        self.assertEqual(s["count"], 1)

    def test_unparseable_lines_skipped(self):
        s = self.stats([("hi", ms(2026, 10, 1))], raw_extra="not json\n{bad\n")
        self.assertEqual(s["count"], 1)

    def test_first_last_dates(self):
        s = self.stats([("a", ms(2026, 7, 5)), ("b", ms(2026, 10, 18))])
        self.assertEqual((s["first"], s["last"]), ("2026-07-05", "2026-10-18"))

    def test_since_inclusive(self):
        s = self.stats([("a", ms(2026, 10, 1, 0)), ("b", ms(2026, 10, 2)),
                        ("c", ms(2026, 9, 30, 23))], since="2026-10-01")
        self.assertEqual(s["count"], 2)

    def test_rate_per_100(self):
        rows = [("give me a prompt", ms(2026, 10, 1))] + [("x", ms(2026, 10, 1))] * 3
        s = self.stats(rows)
        self.assertEqual(s["phrases"]["give_me_a_prompt"]["per100"], 25.0)

    def test_counted_once_per_prompt(self):
        self.assertEqual(self.phrase("yes man yes man")["yes_man"], 1)

    def test_give_me_a_prompt(self):
        for t in ["Give me a prompt", "give me the prompt", "prompt for do it", "a prompt i can paste"]:
            self.assertEqual(self.phrase(t)["give_me_a_prompt"], 1, t)

    def test_yes_man(self):
        self.assertEqual(self.phrase("stop being a Yes Man")["yes_man"], 1)

    def test_think_through(self):
        for t in ["think this through", "think it real hard", "think android through", "think about this hard"]:
            self.assertEqual(self.phrase(t)["think_through"], 1, t)

    def test_grill(self):
        for t in ["grill yourself", "grill me", "grillme", "/grillme"]:
            self.assertEqual(self.phrase(t)["grill"], 1, t)

    def test_visual(self):
        for t in ["explain this visual", "show me a visual", "do it visually"]:
            self.assertEqual(self.phrase(t)["visual"], 1, t)

    def test_deeper(self):
        self.assertEqual(self.phrase("a deeper version please")["deeper"], 1)

    def test_foreman(self):
        for t in ["/foreman x", "use foreman"]:
            self.assertEqual(self.phrase(t)["foreman"], 1, t)

    def test_no_false_positive(self):
        self.assertTrue(all(v == 0 for v in self.phrase("plain text").values()))


class CanvasTests(Tmp):
    PAGE = ('<div data-question-id="q1"><button class="x qopt" data-lean data-value="a">A</button>'
            '<button class="qopt" data-value="b">B</button></div>'
            '<div data-question-id="q2"><button class="qopt" data-value="c">C</button></div>')

    def ws(self, name="w1", page=PAGE, answers=None, comments=None, activity=None):
        self.write(f"{name}/p.html", page)
        if answers is not None:
            self.write(f"{name}/answers.json", answers)
        if comments is not None:
            self.write(f"{name}/comments.json", comments)
        if activity is not None:
            self.write(f"{name}/activity.json", activity)

    def stats(self, since=None):
        return bm.canvas_stats(str(self.root / "*") + "/", since)

    def ans(self, *pairs):
        return {"answers": [{"questionId": q, "value": v} for q, v in pairs]}

    def test_classification(self):
        self.ws(answers=self.ans(("q1", "a"), ("q1", "b"), ("q1", "__defer__"),
                                 ("q1", "__other__"), ("q2", "c")))
        a = self.stats()["answers"]
        self.assertEqual(a, {"lean": 1, "override": 1, "defer": 1, "other": 1, "no_lean": 1})

    def test_list_value_unwrapped(self):
        self.ws(answers=self.ans(("q1", ["a"]), ("q1", ["__defer__"])))
        a = self.stats()["answers"]
        self.assertEqual((a["lean"], a["defer"]), (1, 1))

    def test_lean_found_across_html_files(self):
        self.ws(answers=self.ans(("q9", "z")))
        self.write("w1/other.html", '<i data-question-id="q9"><b class="qopt" data-lean data-value="z"></b></i>')
        self.assertEqual(self.stats()["answers"]["lean"], 1)

    def test_comments(self):
        self.ws(comments={"comments": [
            {"body": "Why this?", "createdAt": "2026-10-01T00:00:00Z"},      # confused ('?' first)
            {"body": "I think no", "createdAt": "2026-10-01T00:00:00Z"},     # premise
            {"text": "do the thing", "createdAt": "2026-10-01T00:00:00Z"},   # directive via text fallback
            {"body": "reply", "parentId": "x"},                              # not top-level
            {"body": "ok", "author": "claude-opus"},                         # not human
        ]})
        self.assertEqual(self.stats()["comments"], {"directive": 1, "confused": 1, "premise": 1})

    def test_comments_plain_list(self):
        self.ws(comments=[{"body": "go"}])
        self.assertEqual(self.stats()["comments"]["directive"], 1)

    def test_activity_median_max_pages(self):
        ev = lambda n: {"events": [{"kind": "submitted", "at": "2026-10-01T00:00:00Z"}] * n
                        + [{"kind": "other"}]}
        self.ws("a", activity=ev(1))
        self.ws("b", activity=ev(3))
        self.ws("c", activity=ev(0))
        self.write("b/q.html", "<p/>")
        s = self.stats()
        self.assertEqual((s["submitted_median"], s["submitted_max"]), (2, 3))
        self.assertEqual(s["max_pages"], 2)

    def test_since_filters(self):
        self.ws(answers={"answers": [
            {"questionId": "q1", "value": "a", "answeredAt": "2026-09-01T00:00:00Z"},
            {"questionId": "q1", "value": "a", "answeredAt": "2026-10-05T00:00:00Z"}]},
            comments=[{"body": "go", "createdAt": "2026-09-01T00:00:00Z"}],
            activity={"events": [{"kind": "submitted", "at": "2026-09-01T00:00:00Z"}]})
        s = self.stats(since="2026-10-01")
        self.assertEqual(s["answers"]["lean"], 1)
        self.assertEqual(s["comments"]["directive"], 0)
        self.assertEqual(s["submitted_max"], 0)

    def test_malformed_files_tolerated(self):
        self.ws(answers="{nope", comments="[[", activity="x")
        s = self.stats()
        self.assertEqual(sum(s["answers"].values()), 0)
        self.assertEqual(sum(s["comments"].values()), 0)

    def test_wrong_shape_tolerated(self):
        self.ws(answers=[1, 2], comments={"comments": "x"}, activity={"events": [1]})
        self.assertEqual(sum(self.stats()["answers"].values()), 0)


class CliTests(Tmp):
    def test_json_cli(self):
        h = self.write("h.jsonl", json.dumps({"display": "yes man", "timestamp": ms(2026, 10, 1)}) + "\n")
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            bm.main(["--history", str(h), "--canvas-glob", str(self.root / "none/*/"), "--json"])
        d = json.loads(buf.getvalue())
        self.assertEqual(d["prompts"]["phrases"]["yes_man"]["count"], 1)

    def test_text_cli(self):
        h = self.write("h.jsonl", json.dumps({"display": "hi", "timestamp": ms(2026, 10, 1)}) + "\n")
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            bm.main(["--history", str(h), "--canvas-glob", str(self.root / "none/*/")])
        self.assertIn("yes_man", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
