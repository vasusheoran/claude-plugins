# Canvas v2 — Two Surfaces Implementation Plan

> **Status: IMPLEMENTED 2026-10-11** on branch `feat/canvas-v2` via /foreman (Waves 1–4 + docs). All suites green; Deck and Board verified in-browser. Awaiting review before merge to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the canvas skill around three surfaces — Deck (answering), Board (looking), doc (reading) — with mobile-first bottom-bar chrome, presence, changed-dots, and pin comments.

**Architecture:** Two new shared JS assets (`deck.js`, `board.js`) layer behavior over the existing question-block/comment machinery; `comments.js` gains a `canvas:state` DOM event as the single integration contract plus a rewritten nav; `serve.py`/`canvasd.py` gain only pin passthrough, new page kinds, and wait-count presence. Every new module has a pure, node-testable core exported the same way `comments.js` already does.

**Tech Stack:** stdlib Python 3 (http.server), vanilla ES5-style JS (matching comments.js), plain `node`/`python3` test scripts. Zero dependencies.

**Spec:** `plans/2026-10-11-canvas-two-surfaces/spec.md` (this dir). Visual reference: `deck.html`, `board.html`, `nav.html`, `interaction.html` in this dir.

## Global Constraints

- Repo: `~/.claude/plugins/marketplaces/vasusheoran-plugins`; the skill lives at `plugins/canvas/skills/canvas/` (symlinked as `~/.claude/skills/canvas`). All paths below are relative to `plugins/canvas/skills/canvas/`.
- Zero dependencies: stdlib Python + vanilla JS only. No npm, no pip, no CDN.
- Never hard-code hex in components — use `plan.css` tokens only (`--ink`, `--bg`, `--bg-soft`, `--line`, `--line-strong`, `--accent`, `--open`, `--resolved`). Palette is monochrome; do not add hue.
- `comments.js` must stay loaded on every artifact; JS must never remove or renumber `data-block-id` / `data-cmt-id` elements.
- Match comments.js style: IIFE, `var`, early `module.exports` of the pure core + `return` under node (see comments.js:96-104).
- All four existing suites stay green after every task: `node tests/test_comments.js`, `node tests/test_diagram.js`, `python3 tests/test_serve.py`, `python3 tests/test_canvasd.py`.
- `serve.py` is imported by canvasd at startup — changes to **either** `serve.py` or `server/canvasd.py` need `launchctl kickstart -k gui/$UID/com.claude.canvasd`. Pure asset files (css/js/html) are served live, no restart.
- Budgets: deck 200 / doc 600 / board exempt; `data-budget-words` overrides; meter never blocks.
- Legacy workspaces (kinds plan/mockup/diagram/decision/doc, no deck markup) must keep loading, commenting, and approving unchanged. `deck.js`/`board.js` activate **only** on `data-canvas-kind="deck"` / `"board"`.
- Commit after every task, in the plugins repo, message style `feat(canvas): …` / `test(canvas): …`.

## Review Focus

1. **Deck page with zero question blocks** — must render as a plain page (no rail, no crash) and must NOT fire the finish prompt; `deckModel([], …).allDone` must be `false`. Test pinned in Task 3.
2. **Deep link to a nonexistent frame** (`board.html#frame-zzz`) — board falls back to zoom-to-fit, no exception. Test pinned in Task 5.
3. **Pin whose frame was deleted from the page** — pin still renders at its world coords (world is the anchor, frame id is metadata); the comment stays reachable from the panel. Test pinned in Task 6.
4. **localStorage unavailable** (Safari private mode) — visited-tracking and changed-dots degrade to "no dots", nav still renders; `changedPages(activity, null)` treats every update as changed, and all storage access is try/catch-wrapped. Test pinned in Task 8.
5. **Presence payload absent** (old server, file:// fallback) — `presenceState(undefined, …)` returns `null` and the chip is simply not rendered; nav must not throw. Test pinned in Task 7.

---

### Task 1: New page kinds — deck & board

**Files:**
- Modify: `assets/serve.py:385` (`_PAGE_KINDS`)
- Modify: `assets/comments.js` (`tabIcon`, near `pageKind` at :88)
- Test: `tests/test_serve.py`, `tests/test_comments.js`

**Interfaces:**
- Consumes: `_list_pages(plan_dir)` (serve.py:388), `tabIcon(kind)`/`pageKind(pg)` (comments.js exports).
- Produces: pages payload entries may carry `kind: "deck" | "board"`; `tabIcon("deck") === "▦"`, `tabIcon("board") === "▧"`. Later tasks key activation off `<body data-canvas-kind="deck|board">`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_serve.py`, add (follow the file's existing unittest/assert style; it already builds temp workspaces for `_list_pages` tests):

```python
def test_list_pages_detects_deck_and_board_kinds(self):
    (self.dir / "plan.html").write_text(
        '<title>d</title><body data-canvas-kind="deck">')
    (self.dir / "b.html").write_text(
        '<title>b</title><body data-canvas-kind="board">')
    kinds = {p["file"]: p["kind"] for p in serve._list_pages(self.dir)}
    self.assertEqual(kinds["plan.html"], "deck")
    self.assertEqual(kinds["b.html"], "board")

def test_list_pages_legacy_kinds_still_pass(self):
    (self.dir / "m.html").write_text(
        '<title>m</title><body data-canvas-kind="mockup">')
    kinds = {p["file"]: p["kind"] for p in serve._list_pages(self.dir)}
    self.assertEqual(kinds["m.html"], "mockup")
```

In `tests/test_comments.js`, add:

```js
test("tabIcon knows the v2 kinds", () => {
  assert.strictEqual(tabIcon("deck"), "▦");
  assert.strictEqual(tabIcon("board"), "▧");
});
test("pageKind fallback unchanged for legacy servers", () => {
  assert.strictEqual(pageKind({ file: "plan.html" }), "plan");
  assert.strictEqual(pageKind({ file: "x.html" }), "doc");
});
```

- [ ] **Step 2: Run both to verify they fail**

Run: `python3 tests/test_serve.py && node tests/test_comments.js`
Expected: the new Python tests FAIL (kind falls back to plan/doc); the JS `tabIcon` test FAILS (unknown kind).

- [ ] **Step 3: Implement**

`assets/serve.py:385`: `_PAGE_KINDS = {"plan", "mockup", "diagram", "decision", "doc", "deck", "board"}`.

`assets/comments.js` — extend the `tabIcon` map with `deck: "▦"`, `board: "▧"` (keep every existing icon).

- [ ] **Step 4: Run all four suites** — expected: all PASS.

- [ ] **Step 5: Commit** — `feat(canvas): recognize deck and board page kinds`

---

### Task 2: `canvas:state` event — the integration contract

**Files:**
- Modify: `assets/comments.js` (after the state-loading block at :160-171 and inside `mergeAnswer` ~:246 and the poll at :1255)
- Test: `tests/test_comments.js`

**Interfaces:**
- Produces: `document` event `"canvas:state"` with `detail = { comments, answers, activity, pages, approval, version }` — fired after initial load, after every local answer/comment mutation, and after every poll that changed anything. `deck.js`, `board.js`, and the nav all consume this one event.
- Produces: pure helper `answeredValue(answer)` → display string for an answer (`otherText` when value is `__other__`, joined array for multi, else the value), exported.

- [ ] **Step 1: Write the failing test**

```js
const { answeredValue } = require("../assets/comments.js");
test("answeredValue renders scalars, multi, other, defer", () => {
  assert.strictEqual(answeredValue({ value: "json" }), "json");
  assert.strictEqual(answeredValue({ value: ["a", "b"] }), "a, b");
  assert.strictEqual(answeredValue({ value: "__other__", otherText: "hmm" }), "hmm");
  assert.strictEqual(answeredValue({ value: "__defer__" }), "you decide");
  assert.strictEqual(answeredValue(null), "");
});
```

- [ ] **Step 2: Run to verify it fails** — `node tests/test_comments.js` → FAIL (`answeredValue` not exported).

- [ ] **Step 3: Implement**

Add to the pure core (above the `module.exports` block) and export it:

```js
function answeredValue(a) {
  if (!a || a.value == null) return "";
  if (a.value === "__defer__" ||
      (Array.isArray(a.value) && a.value[0] === "__defer__")) return "you decide";
  if (a.value === "__other__") return a.otherText || "";
  return Array.isArray(a.value) ? a.value.join(", ") : String(a.value);
}
```

Add the emitter in the DOM section:

```js
function emitState() {
  try {
    document.dispatchEvent(new CustomEvent("canvas:state", { detail: {
      comments: state.comments, answers: state.answers,
      activity: state.activity, pages: state.pages,
      approval: state.approval, version: version,
    }}));
  } catch (e) { /* CustomEvent unavailable — nothing downstream */ }
}
```

Call `emitState()` (a) at the end of the initial load's `.then` (after the `Promise.all` at :160-171 resolves and first render runs), (b) at the end of `mergeAnswer`, (c) after a comment is created/edited/resolved locally (each place `state.comments` mutates then re-renders), (d) in the version poll whenever it refetched state.

- [ ] **Step 4: Run suites + eyeball** — all green; open any existing workspace page, in devtools `document.addEventListener("canvas:state", e => console.log(e.detail))` logs on load and on answering a question.

- [ ] **Step 5: Commit** — `feat(canvas): emit canvas:state as the shared client contract`

---

### Task 3: deck.js — stepper core and behavior

**Files:**
- Create: `assets/deck.js`
- Modify: `assets/serve.py` (`SHARED_ASSETS` — add `"deck.js"`)
- Modify: `assets/plan.css` (deck component classes, appended section `/* ---- deck (v2) ---- */`)
- Test: `tests/test_deck.js` (new)

**Interfaces:**
- Consumes: `canvas:state` event (Task 2); existing question blocks (`section.block.question[data-question-id]`, `.qopt[data-value]`); the existing qopt click behavior saves answers — deck.js **never** persists anything itself.
- Produces: pure `deckModel(questionIds, answers)` → `{ states: ("answered"|"current"|"upcoming")[], current: number /* -1 when none open */, answered: number, total: number, allDone: boolean }`; pure `isAnswered(answer)`. DOM: `data-lean` attribute on a `.qopt` renders the pick badge; `window.CanvasDeck = { refresh }`. Task 9's finish prompt keys off `deckModel(...).allDone`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_deck.js` (same harness pattern as test_comments.js):

```js
"use strict";
const assert = require("assert");
const { deckModel, isAnswered } = require("../assets/deck.js");
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed++; console.log("FAIL - " + name + "\n     " + e.message); }
}

test("isAnswered: scalars, arrays, empties", () => {
  assert.ok(isAnswered({ value: "a" }));
  assert.ok(isAnswered({ value: ["a"] }));
  assert.ok(isAnswered({ value: "__defer__" }));
  assert.ok(!isAnswered({ value: "" }));
  assert.ok(!isAnswered({ value: [] }));
  assert.ok(!isAnswered({ value: null }));
  assert.ok(!isAnswered(undefined));
});

test("first open question is current, later ones upcoming", () => {
  const m = deckModel(["q1", "q2", "q3"], [{ questionId: "q1", value: "x" }]);
  assert.deepStrictEqual(m.states, ["answered", "current", "upcoming"]);
  assert.strictEqual(m.current, 1);
  assert.strictEqual(m.answered, 1);
  assert.ok(!m.allDone);
});

test("all answered -> allDone, current -1", () => {
  const m = deckModel(["q1"], [{ questionId: "q1", value: "x" }]);
  assert.ok(m.allDone);
  assert.strictEqual(m.current, -1);
});

test("zero questions is NOT allDone (review focus #1)", () => {
  const m = deckModel([], []);
  assert.ok(!m.allDone);
  assert.strictEqual(m.total, 0);
});

test("multi and freeform answers count once non-empty (review focus)", () => {
  assert.deepStrictEqual(
    deckModel(["q"], [{ questionId: "q", value: ["a", "b"] }]).states, ["answered"]);
  assert.deepStrictEqual(
    deckModel(["q"], [{ questionId: "q", value: "typed text" }]).states, ["answered"]);
});

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails** — `node tests/test_deck.js` → FAIL (module not found).

- [ ] **Step 3: Implement `assets/deck.js`**

```js
/* deck.js — stepper presentation for data-canvas-kind="deck" pages.
 * Layers over the existing question blocks; persistence stays in comments.js.
 * Pure core exported for node tests, same pattern as comments.js. */
(function () {
  "use strict";

  function isAnswered(a) {
    if (!a || a.value == null) return false;
    return Array.isArray(a.value) ? a.value.length > 0 : String(a.value).length > 0;
  }

  function deckModel(questionIds, answers) {
    var byId = {};
    (answers || []).forEach(function (a) { byId[a.questionId] = a; });
    var open = -1;
    var states = questionIds.map(function (id, i) {
      if (isAnswered(byId[id])) return "answered";
      if (open === -1) { open = i; return "current"; }
      return "upcoming";
    });
    return {
      states: states, current: open,
      answered: states.filter(function (s) { return s === "answered"; }).length,
      total: questionIds.length,
      allDone: questionIds.length > 0 && open === -1,
    };
  }

  if (typeof window === "undefined" && typeof module !== "undefined") {
    module.exports = { deckModel: deckModel, isAnswered: isAnswered };
    return;
  }

  if (document.body.getAttribute("data-canvas-kind") !== "deck") return;

  var answers = [], focusOverride = null, railEl = null;

  function sections() {
    return [].slice.call(
      document.querySelectorAll("section.block.question[data-question-id]"));
  }
  function qids() {
    return sections().map(function (s) { return s.getAttribute("data-question-id"); });
  }
  function answerFor(qid) {
    return answers.filter(function (a) { return a.questionId === qid; })[0];
  }

  function ensureRail() {
    if (railEl || !sections().length) return;
    railEl = document.createElement("div");
    railEl.className = "deck-rail";
    var first = sections()[0];
    first.parentNode.insertBefore(railEl, first);
    var foot = document.createElement("div");
    foot.className = "deck-foot";
    foot.innerHTML =
      '<button class="deck-accept" type="button">Accept Claude’s picks for the rest</button>' +
      '<span class="deck-kbd-hint">1–9 pick · tap a ✓ row to reopen</span>';
    var last = sections()[sections().length - 1];
    last.parentNode.insertBefore(foot, last.nextSibling);
    foot.querySelector(".deck-accept").onclick = acceptRemaining;
  }

  function acceptRemaining() {
    sections().forEach(function (sec) {
      var qid = sec.getAttribute("data-question-id");
      if (isAnswered(answerFor(qid))) return;
      var lean = sec.querySelector(".qopt[data-lean]") || sec.querySelector(".qopt");
      if (lean) lean.click();                 // existing widget saves the answer
    });
  }

  function render() {
    var secs = sections();
    if (!secs.length) return;
    ensureRail();
    var m = deckModel(qids(), answers);
    secs.forEach(function (sec, i) {
      var st = m.states[i];
      if (focusOverride === i && st === "answered") st = "current";
      sec.classList.remove("deck-answered", "deck-current", "deck-upcoming");
      sec.classList.add("deck-" + (st === "answered" ? "answered"
        : st === "current" ? "current" : "upcoming"));
      var h = sec.querySelector("h2, h3");
      if (h && !h.__deckBound) {
        h.__deckBound = true;
        h.style.cursor = "pointer";
        h.addEventListener("click", function () { focusOverride = i; render(); });
      }
    });
    railEl.innerHTML =
      '<span class="deck-count">' + m.answered + " / " + m.total + " answered</span>" +
      m.states.map(function (s) {
        return '<span class="deck-seg ' + s + '"></span>';
      }).join("");
    document.body.classList.toggle("deck-done", m.allDone);
  }

  document.addEventListener("canvas:state", function (e) {
    answers = (e.detail && e.detail.answers) || [];
    focusOverride = null;                     // new data wins over a manual reopen
    render();
    maybeFinishPrompt();                      // defined in Task 9; no-op until then
  });

  document.addEventListener("keydown", function (e) {
    if (!/^[1-9]$/.test(e.key)) return;
    if (e.target.closest && e.target.closest("input,textarea")) return;
    var cur = document.querySelector("section.block.question.deck-current");
    if (!cur) return;
    var opt = cur.querySelectorAll(
      ":scope > .qopt, :scope .qopts > .qopt")[+e.key - 1];
    if (opt) opt.click();
  });

  var _finishShown = false;
  function maybeFinishPrompt() { /* body added in Task 9 */ }

  window.CanvasDeck = { refresh: render };
  render();
})();
```

- [ ] **Step 4: Append deck CSS to `assets/plan.css`** (tokens only; port the look from `deck.html` in this dir):

```css
/* ---- deck (v2) ---- */
.deck-rail { display: flex; align-items: center; gap: 8px; margin: 18px 0;
  font: 11px var(--mono); color: var(--muted); }
.deck-rail .deck-seg { height: 6px; flex: 1; border-radius: 3px;
  background: var(--bg-soft); border: 1px solid var(--line); }
.deck-rail .deck-seg.answered { background: var(--decision); border-color: var(--decision); }
.deck-rail .deck-seg.current { border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-ghost); }
section.block.question.deck-answered { border-color: var(--line);
  background: var(--bg-soft); }
section.block.question.deck-answered > h2::before,
section.block.question.deck-answered > h3::before {
  content: "✓ "; color: var(--decision); }
section.block.question.deck-answered > :not(h2):not(h3) { display: none; }
section.block.question.deck-upcoming { opacity: .55; }
section.block.question.deck-upcoming > :not(h2):not(h3) { display: none; }
section.block.question.deck-current { border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ghost); }
.qopt[data-lean] { position: relative; border-color: var(--accent-line); }
.qopt[data-lean]::after { content: "CLAUDE'S PICK"; position: absolute;
  top: 6px; right: 6px; font: 600 9px var(--mono); letter-spacing: .06em;
  color: var(--bg); background: var(--accent); border-radius: 4px;
  padding: 2px 6px; }
.deck-foot { display: flex; align-items: center; gap: 14px; margin: 18px 0;
  font: 11px var(--mono); color: var(--muted); }
.deck-foot .deck-accept { font: 12px var(--mono); border: 1px solid var(--accent);
  color: var(--accent); background: var(--accent-ghost); border-radius: 6px;
  padding: 6px 12px; cursor: pointer; }
```

Also in `assets/serve.py`, add `"deck.js"` to `SHARED_ASSETS`.

- [ ] **Step 5: Run tests** — `node tests/test_deck.js` PASS; all four existing suites PASS. Restart the daemon (`launchctl kickstart -k gui/$UID/com.claude.canvasd` — serve.py changed).

- [ ] **Step 6: Manual check** — copy `assets/canvas.html` into a scratch workspace, set `data-canvas-kind="deck"`, add two question blocks, load `deck.js` after `comments.js`: stepper renders, answering advances, keys 1–9 pick, Accept fills the rest.

- [ ] **Step 7: Commit** — `feat(canvas): deck.js stepper surface over question blocks`

---

### Task 4: Budget meter + comment-jump auto-expand (Sep-5 absorbed)

**Files:**
- Modify: `assets/comments.js`
- Test: `tests/test_comments.js`

**Interfaces:**
- Produces: pure `budgetFor(kind, overrideAttr)` → number|null (deck 200, doc 600, plan 200, decision 200, diagram 100, mockup/board null; numeric override wins), pure `wordCount(text)`; both exported. DOM: `.cmt-meter` chip bottom-right, `.over` past budget; clicking a comment chip inside closed `<details>` opens every ancestor first.

- [ ] **Step 1: Write the failing tests**

```js
const { budgetFor, wordCount } = require("../assets/comments.js");
test("budgetFor: kinds and override", () => {
  assert.strictEqual(budgetFor("deck", null), 200);
  assert.strictEqual(budgetFor("plan", null), 200);
  assert.strictEqual(budgetFor("doc", null), 600);
  assert.strictEqual(budgetFor("diagram", null), 100);
  assert.strictEqual(budgetFor("mockup", null), null);
  assert.strictEqual(budgetFor("board", null), null);
  assert.strictEqual(budgetFor("doc", "150"), 150);
});
test("wordCount splits on whitespace, ignores empties", () => {
  assert.strictEqual(wordCount("  one two\n three "), 3);
  assert.strictEqual(wordCount(""), 0);
  assert.strictEqual(wordCount(null), 0);
});
```

- [ ] **Step 2: Run to verify fails** — `node tests/test_comments.js` → FAIL (not exported).

- [ ] **Step 3: Implement**

Pure core (export both):

```js
var BUDGETS = { plan: 200, deck: 200, decision: 200, doc: 600, diagram: 100 };
function budgetFor(kind, overrideAttr) {
  var o = parseInt(overrideAttr, 10);
  if (!isNaN(o) && o > 0) return o;
  return BUDGETS.hasOwnProperty(kind) ? BUDGETS[kind] : null;
}
function wordCount(text) {
  if (!text) return 0;
  var m = String(text).trim().match(/\S+/g);
  return m ? m.length : 0;
}
```

DOM meter (in the widget init path, after first render):

```js
function visibleText() {
  var main = document.querySelector("main");
  if (!main) return "";
  var clone = main.cloneNode(true);
  clone.querySelectorAll("script, style, #cmt-nav").forEach(function (n) { n.remove(); });
  clone.querySelectorAll("details").forEach(function (d) {
    var s = d.querySelector("summary");
    d.replaceWith(s ? s.cloneNode(true) : "");   // budget = default view, open or not
  });
  return clone.textContent || "";
}
function renderMeter() {
  var kind = document.body.getAttribute("data-canvas-kind") || "doc";
  var budget = budgetFor(kind, document.body.getAttribute("data-budget-words"));
  if (budget == null) return;
  var words = wordCount(visibleText());
  var screens = Math.round(document.documentElement.scrollHeight /
                           window.innerHeight * 10) / 10;
  var el = document.getElementById("cmt-meter") || document.createElement("div");
  el.id = "cmt-meter"; el.className = "cmt-meter" + (words > budget ? " over" : "");
  el.textContent = words + " / " + budget + "w · ~" + screens + " screens";
  if (!el.parentNode) document.body.appendChild(el);
}
```

Call `renderMeter()` once on load. CSS in plan.css:

```css
.cmt-meter { position: fixed; right: 12px; bottom: 72px; z-index: 40;
  font: 10px var(--mono); color: var(--muted); background: var(--bg);
  border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; }
.cmt-meter.over { color: var(--risk); border-color: var(--risk); }
```

Auto-expand: in the existing scroll-to-anchor path (comment chip click / panel jump), before scrolling:

```js
for (var d = target.closest("details"); d; d = d.parentElement.closest("details"))
  d.open = true;
```

- [ ] **Step 4: Run suites** — all PASS. Open this dir's `interaction.html`: meter shows (doc 600); open `deck.html`: no meter (kind mockup).

- [ ] **Step 5: Commit** — `feat(canvas): visible-word budget meter + details auto-expand`

---

### Task 5: board.js — pan/zoom surface + board template

**Files:**
- Create: `assets/board.js`
- Create: `assets/board.html` (template)
- Modify: `assets/serve.py` (`SHARED_ASSETS` — add `"board.js"`)
- Modify: `assets/plan.css` (board chrome, appended `/* ---- board (v2) ---- */`)
- Test: `tests/test_board.js` (new)

**Interfaces:**
- Consumes: `<body data-canvas-kind="board">` with `#viewport > #world` and absolutely-positioned `[data-frame-id]` children.
- Produces: pure `zoomAt(t, mx, my, factor)`, `fitTransform(vw, vh, bounds, maxScale)`, `worldPoint(sx, sy, t)`, `boundsOf(frames, margin)` where `t = {s, tx, ty}`; exported. DOM: toolbar (Fit / − / % / + / 100%), drag-pan, wheel-zoom-at-cursor, deep link `#<frame-id>` zooms to the frame (unknown id → fit). `window.CanvasBoard = { getTransform, worldFromClient }` for Task 6.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_board.js` (same harness as test_deck.js):

```js
const { zoomAt, fitTransform, worldPoint, boundsOf } = require("../assets/board.js");

test("zoomAt keeps the cursor's world point fixed", () => {
  const t = { s: 1, tx: 0, ty: 0 };
  const t2 = zoomAt(t, 100, 50, 2);
  // world point under (100,50) before: (100,50); after must map back to (100,50)
  assert.strictEqual(Math.round(100 * t2.s + t2.tx), 100);
  assert.strictEqual(Math.round(50 * t2.s + t2.ty), 50);
  assert.strictEqual(t2.s, 2);
});

test("zoomAt clamps to [0.15, 3]", () => {
  assert.strictEqual(zoomAt({ s: 2.9, tx: 0, ty: 0 }, 0, 0, 2).s, 3);
  assert.strictEqual(zoomAt({ s: 0.2, tx: 0, ty: 0 }, 0, 0, 0.1).s, 0.15);
});

test("fitTransform centers the bounds", () => {
  const t = fitTransform(1000, 500, { x: 0, y: 0, w: 500, h: 500 }, 1.6);
  assert.strictEqual(t.s, 1);                       // limited by height
  assert.strictEqual(t.tx, 250);                    // centered horizontally
  assert.strictEqual(t.ty, 0);
});

test("worldPoint inverts the transform", () => {
  const t = { s: 2, tx: 10, ty: -4 };
  const w = worldPoint(110, 96, t);
  assert.deepStrictEqual(w, { x: 50, y: 50 });
});

test("boundsOf wraps frames with margin", () => {
  const b = boundsOf([{ x: 0, y: 0, w: 100, h: 100 },
                      { x: 300, y: 50, w: 100, h: 100 }], 40);
  assert.deepStrictEqual(b, { x: -40, y: -40, w: 480, h: 230 });
});

test("boundsOf of nothing is a unit box (fit never divides by zero)", () => {
  const b = boundsOf([], 40);
  assert.ok(b.w > 0 && b.h > 0);
});
```

- [ ] **Step 2: Run to verify fails** — `node tests/test_board.js` → FAIL (module not found).

- [ ] **Step 3: Implement `assets/board.js`**

```js
/* board.js — pan/zoom spatial surface for data-canvas-kind="board" pages. */
(function () {
  "use strict";
  var SMIN = 0.15, SMAX = 3;

  function zoomAt(t, mx, my, factor) {
    var ns = Math.min(SMAX, Math.max(SMIN, t.s * factor));
    return { s: ns, tx: mx - (mx - t.tx) * (ns / t.s),
             ty: my - (my - t.ty) * (ns / t.s) };
  }
  function fitTransform(vw, vh, b, maxScale) {
    var s = Math.min(vw / b.w, vh / b.h, maxScale || 1.6);
    return { s: s, tx: (vw - b.w * s) / 2 - b.x * s,
             ty: (vh - b.h * s) / 2 - b.y * s };
  }
  function worldPoint(sx, sy, t) {
    return { x: (sx - t.tx) / t.s, y: (sy - t.ty) / t.s };
  }
  function boundsOf(frames, margin) {
    margin = margin || 0;
    if (!frames.length) return { x: -margin, y: -margin,
      w: Math.max(1, 2 * margin), h: Math.max(1, 2 * margin) };
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    frames.forEach(function (f) {
      x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y);
      x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h);
    });
    return { x: x0 - margin, y: y0 - margin,
             w: (x1 - x0) + 2 * margin, h: (y1 - y0) + 2 * margin };
  }

  if (typeof window === "undefined" && typeof module !== "undefined") {
    module.exports = { zoomAt: zoomAt, fitTransform: fitTransform,
                       worldPoint: worldPoint, boundsOf: boundsOf };
    return;
  }

  if (document.body.getAttribute("data-canvas-kind") !== "board") return;
  var vp = document.getElementById("viewport");
  var world = document.getElementById("world");
  if (!vp || !world) return;

  var t = { s: 1, tx: 0, ty: 0 };
  function frames() {
    return [].slice.call(world.querySelectorAll("[data-frame-id]")).map(function (el) {
      return { el: el, x: el.offsetLeft, y: el.offsetTop,
               w: el.offsetWidth, h: el.offsetHeight };
    });
  }
  function apply() {
    world.style.transform =
      "translate(" + t.tx + "px," + t.ty + "px) scale(" + t.s + ")";
    var z = document.getElementById("board-zlvl");
    if (z) z.textContent = Math.round(t.s * 100) + "%";
  }
  function fit() {
    var r = vp.getBoundingClientRect();
    t = fitTransform(r.width, r.height, boundsOf(frames(), 60), 1.6);
    apply();
  }
  function focusFrame(id) {
    var f = frames().filter(function (x) {
      return x.el.getAttribute("data-frame-id") === id; })[0];
    if (!f) { fit(); return; }                    // unknown id → fit (review focus #2)
    var r = vp.getBoundingClientRect();
    t = fitTransform(r.width, r.height,
      { x: f.x - 80, y: f.y - 80, w: f.w + 160, h: f.h + 160 }, 2);
    apply();
    f.el.classList.add("board-focus");
  }

  var bar = document.createElement("div");
  bar.className = "board-toolbar";
  bar.innerHTML = '<button type="button" id="board-fit">⛶ Fit</button>' +
    '<button type="button" id="board-zo">−</button>' +
    '<span id="board-zlvl">100%</span>' +
    '<button type="button" id="board-zi">+</button>' +
    '<button type="button" id="board-z100">100%</button>';
  vp.appendChild(bar);
  bar.querySelector("#board-fit").onclick = fit;
  bar.querySelector("#board-z100").onclick = function () { t.s = 1; apply(); };
  function center(f) {
    var r = vp.getBoundingClientRect();
    t = zoomAt(t, r.width / 2, r.height / 2, f); apply();
  }
  bar.querySelector("#board-zi").onclick = function () { center(1.25); };
  bar.querySelector("#board-zo").onclick = function () { center(0.8); };

  vp.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = vp.getBoundingClientRect();
    t = zoomAt(t, e.clientX - r.left, e.clientY - r.top,
               Math.exp(-e.deltaY * 0.0015));
    apply();
  }, { passive: false });

  var drag = null;
  vp.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".board-toolbar, .board-pin")) return;
    drag = { x: e.clientX, y: e.clientY };
    vp.classList.add("panning");
    vp.setPointerCapture(e.pointerId);
  });
  vp.addEventListener("pointermove", function (e) {
    if (!drag) return;
    t.tx += e.clientX - drag.x; t.ty += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    apply();
  });
  vp.addEventListener("pointerup", function () {
    drag = null; vp.classList.remove("panning");
  });

  window.CanvasBoard = {
    getTransform: function () { return t; },
    worldFromClient: function (cx, cy) {
      var r = vp.getBoundingClientRect();
      return worldPoint(cx - r.left, cy - r.top, t);
    },
    refresh: apply, fit: fit,
  };

  if (location.hash) focusFrame(location.hash.slice(1)); else fit();
})();
```

- [ ] **Step 4: `assets/board.html` template + CSS**

`assets/board.html` — minimal scaffold (header comment explains frames; one commented-out example frame):

```html
<!DOCTYPE html>
<!-- board scaffold: copy into the workspace as <name>.html. Frames are
     absolutely-positioned children of #world carrying data-frame-id (unique,
     stable — pins and deep links anchor to it). Deep link: <page>.html#<frame-id>.
     Author frame innards as plain HTML/SVG; keep comments.js first, board.js last. -->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BOARD TITLE</title>
  <link rel="stylesheet" href="plan.css" />
</head>
<body data-approval="off" data-canvas-kind="board">
  <div id="viewport"><div id="world">
    <!-- <div class="board-frame" data-frame-id="frame-a"
          style="left:0; top:0; width:220px; height:420px;">
           <span class="board-flabel">A · variant name</span>
           …frame content…
         </div> -->
  </div></div>
  <script src="comments.js"></script>
  <script src="board.js"></script>
</body>
</html>
```

plan.css additions:

```css
/* ---- board (v2) ---- */
body[data-canvas-kind="board"] { overflow: hidden; }
body[data-canvas-kind="board"] #viewport { position: fixed; inset: 46px 0 56px 0;
  cursor: grab; overflow: hidden; background: var(--bg-soft);
  background-image: radial-gradient(
    color-mix(in oklab, var(--ink) 14%, transparent) 1px, transparent 1px);
  background-size: 24px 24px; touch-action: none; }
body[data-canvas-kind="board"] #viewport.panning { cursor: grabbing; }
body[data-canvas-kind="board"] #world { position: absolute; top: 0; left: 0;
  transform-origin: 0 0; }
.board-frame { position: absolute; background: var(--bg);
  border: 1.5px solid var(--line-strong); border-radius: 8px; }
.board-frame.board-focus { border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ghost); }
.board-flabel { position: absolute; top: -24px; left: 0;
  font: 11px var(--mono); color: var(--muted); white-space: nowrap; }
.board-toolbar { position: absolute; z-index: 30; top: 10px; left: 10px;
  display: flex; gap: 6px; align-items: center; background: var(--bg);
  border: 1px solid var(--line-strong); border-radius: 8px; padding: 4px 6px;
  font: 12px var(--mono); }
.board-toolbar button { font: 12px var(--mono); color: var(--ink);
  background: transparent; border: 1px solid var(--line); border-radius: 5px;
  padding: 3px 8px; cursor: pointer; }
```

Add `"board.js"` to `SHARED_ASSETS` in `assets/serve.py`.

- [ ] **Step 5: Run tests + restart daemon** — `node tests/test_board.js` PASS, all suites PASS, `launchctl kickstart -k gui/$UID/com.claude.canvasd`.

- [ ] **Step 6: Manual check** — copy board.html into a scratch workspace with two frames: drag/wheel/Fit/deep-link all behave; `#frame-zzz` falls back to fit.

- [ ] **Step 7: Commit** — `feat(canvas): board.js pan/zoom surface + board template`

---

### Task 6: Pin comments on the Board

**Files:**
- Modify: `assets/serve.py:106-137` (`CommentStore.add` — pin passthrough)
- Modify: `assets/comments.js` (composer: accept preset fields; expose `window.CanvasReview.composeWith`)
- Modify: `assets/board.js` (render pins from state; place pins)
- Modify: `assets/plan.css` (`.board-pin`)
- Test: `tests/test_serve.py`, `tests/test_board.js`

**Interfaces:**
- Consumes: `canvas:state` (comments list), `CanvasBoard.worldFromClient` (Task 5).
- Produces: comment records may carry `pin: { frameId: string, x: number, y: number }` (world coords); `window.CanvasReview.composeWith(anchorEl, presetFields)` opens the normal composer and merges `presetFields` into the created comment. Pin elements: `.board-pin[data-comment-id]`, `.resolved` when the comment is resolved.

- [ ] **Step 1: Write the failing tests**

`tests/test_serve.py`:

```python
def test_comment_add_preserves_pin(self):
    store = serve.CommentStore(self.dir / "comments.json")
    c = store.add({"body": "b", "page": "b.html",
                   "pin": {"frameId": "frame-a", "x": 12.5, "y": 40}})
    self.assertEqual(c["pin"], {"frameId": "frame-a", "x": 12.5, "y": 40})
    stored = store.list()[0]
    self.assertEqual(stored["pin"]["frameId"], "frame-a")

def test_comment_add_without_pin_has_no_pin_key(self):
    store = serve.CommentStore(self.dir / "comments.json")
    c = store.add({"body": "b"})
    self.assertNotIn("pin", c)
```

`tests/test_board.js` — export and test the pin filter:

```js
const { pagePins } = require("../assets/board.js");
test("pagePins keeps only this page's pinned, keyed by state", () => {
  const pins = pagePins([
    { id: "c1", page: "b.html", state: "sent", pin: { frameId: "f", x: 1, y: 2 } },
    { id: "c2", page: "b.html", state: "resolved", pin: { frameId: "gone", x: 3, y: 4 } },
    { id: "c3", page: "b.html", state: "sent" },               // no pin
    { id: "c4", page: "other.html", state: "sent", pin: { frameId: "f", x: 0, y: 0 } },
  ], "b.html");
  assert.strictEqual(pins.length, 2);                          // c2 kept (review focus #3)
  assert.strictEqual(pins[1].resolved, true);
});
```

- [ ] **Step 2: Run to verify fails** — python test FAILS (`pin` dropped by the whitelist); node test FAILS (`pagePins` not exported).

- [ ] **Step 3: Implement**

`serve.py` `CommentStore.add`, after the `target` passthrough block:

```python
        if isinstance(fields.get("pin"), dict):
            comment["pin"] = {"frameId": str(fields["pin"].get("frameId", "")),
                              "x": float(fields["pin"].get("x", 0)),
                              "y": float(fields["pin"].get("y", 0))}
```

`board.js` pure core addition (export it):

```js
  function pagePins(comments, page) {
    return (comments || []).filter(function (c) {
      return c.page === page && c.pin;
    }).map(function (c) {
      return { id: c.id, x: c.pin.x, y: c.pin.y, body: c.body,
               resolved: c.state === "resolved" };
    });
  }
```

`comments.js`: find the function that opens the composer for a picked element (the one Comment-mode click calls — search `".cmt-composer"`); factor its open step into `openComposer(anchorEl, preset)` where `preset` is merged into the `createComment(fields)` payload on save. Then expose:

```js
window.CanvasReview = window.CanvasReview || {};
window.CanvasReview.composeWith = function (anchorEl, preset) {
  openComposer(anchorEl, preset || {});
};
```

`board.js` DOM: on `canvas:state`, re-render pins into `#world`:

```js
  var curPage = location.pathname.split("/").pop() || "plan.html";
  function renderPins(comments) {
    [].slice.call(world.querySelectorAll(".board-pin")).forEach(function (p) { p.remove(); });
    pagePins(comments, curPage).forEach(function (p, i) {
      var el = document.createElement("div");
      el.className = "board-pin" + (p.resolved ? " resolved" : "");
      el.setAttribute("data-comment-id", p.id);
      el.style.left = p.x + "px"; el.style.top = p.y + "px";
      el.textContent = String(i + 1);
      el.title = p.body;
      world.appendChild(el);
    });
  }
  document.addEventListener("canvas:state", function (e) {
    renderPins((e.detail && e.detail.comments) || []);
  });
  vp.addEventListener("dblclick", function (e) {
    if (e.target.closest(".board-pin, .board-toolbar")) return;
    var w = window.CanvasBoard.worldFromClient(e.clientX, e.clientY);
    var frame = e.target.closest("[data-frame-id]");
    window.CanvasReview.composeWith(frame || world, {
      pin: { frameId: frame ? frame.getAttribute("data-frame-id") : "",
             x: Math.round(w.x), y: Math.round(w.y) },
    });
  });
```

plan.css:

```css
.board-pin { position: absolute; z-index: 20; width: 26px; height: 26px;
  cursor: pointer; background: var(--open); color: var(--bg);
  border: 2px solid var(--bg); border-radius: 50% 50% 50% 4px;
  display: flex; align-items: center; justify-content: center;
  font: 600 11px var(--mono); transform: translate(-4px, -22px); }
.board-pin.resolved { background: var(--resolved); }
```

- [ ] **Step 4: Run all suites + restart daemon** — PASS, kickstart.

- [ ] **Step 5: Manual check** — scratch board workspace: double-click a frame → composer opens; save → pin appears; resolve via `canvas_resolve` → pin greys on next poll.

- [ ] **Step 6: Commit** — `feat(canvas): x/y pin comments on board surfaces`

---

### Task 7: Presence — daemon wait tracking + client state

**Files:**
- Modify: `assets/serve.py` (Handler class presence attrs; `/api/version` payload)
- Modify: `server/canvasd.py:227-256` (`canvas_wait` wraps `bus.wait`)
- Modify: `assets/comments.js` (pure `presenceState`, exported)
- Test: `tests/test_canvasd.py`, `tests/test_comments.js`

**Interfaces:**
- Produces: `/api/version` response gains `"presence": {"waits": int, "lastClosedAt": iso-string|null}`; pure `presenceState(presence, activity)` → `null | {state: "listening"} | {state: "applying"} | {state: "away", lastSeen}`. Task 8's nav renders the chip from this.

- [ ] **Step 1: Write the failing tests**

`tests/test_canvasd.py` (follow its existing pattern for building a registry + handler class):

```python
def test_version_payload_carries_presence(self):
    # handler class fresh: zero waits, never closed
    body = self.get_json("/api/version")
    self.assertEqual(body["presence"], {"waits": 0, "lastClosedAt": None})

def test_canvas_wait_tracks_open_waits(self):
    # a wait with timeout=0 returns immediately but must bump then release
    cls = self.handler_cls
    canvasd_tools["canvas_wait"]["fn"]({"dir": str(self.ws), "since": 10**9,
                                        "timeout": 0})
    self.assertEqual(cls.presence["waits"], 0)          # released
    self.assertIsNotNone(cls.presence["lastClosedAt"])  # stamped
```

`tests/test_comments.js`:

```js
const { presenceState } = require("../assets/comments.js");
test("presenceState: null payload -> null (review focus #5)", () => {
  assert.strictEqual(presenceState(undefined, []), null);
  assert.strictEqual(presenceState(null, []), null);
});
test("presenceState: open wait -> listening", () => {
  assert.deepStrictEqual(
    presenceState({ waits: 1, lastClosedAt: null }, []), { state: "listening" });
});
test("presenceState: picked-up after last ack -> applying", () => {
  const a = [{ kind: "picked-up", at: "2026-10-11T10:00:00" },
             { kind: "acked", at: "2026-10-11T09:00:00" }];
  assert.deepStrictEqual(
    presenceState({ waits: 0, lastClosedAt: "x" }, a), { state: "applying" });
});
test("presenceState: otherwise away with lastSeen", () => {
  assert.deepStrictEqual(
    presenceState({ waits: 0, lastClosedAt: "2026-10-11T10:05:00" },
                  [{ kind: "acked", at: "2026-10-11T10:00:00" }]),
    { state: "away", lastSeen: "2026-10-11T10:05:00" });
});
```

- [ ] **Step 2: Run to verify fails** — both suites FAIL on the new tests.

- [ ] **Step 3: Implement**

`serve.py` — in `make_handler`, give the Handler class a shared presence dict and include it in the `/api/version` response:

```python
    presence = {"waits": 0, "lastClosedAt": None}
    presence_lock = threading.Lock()
    # inside class Handler: expose for canvasd
    #   presence = presence ; presence_lock = presence_lock
    # in the /api/version branch, add to the payload:
    #   "presence": dict(presence)
```

(Attach `presence`/`presence_lock` as class attributes exactly like `comments`, `bus` etc. are already attached.)

`server/canvasd.py` `canvas_wait` — wrap the existing `cls.bus.wait(...)` call:

```python
        with cls.presence_lock:
            cls.presence["waits"] += 1
        try:
            r = cls.bus.wait(since=since, kinds=kinds, timeout=timeout)
        finally:
            with cls.presence_lock:
                cls.presence["waits"] -= 1
                cls.presence["lastClosedAt"] = serve._now()
```

`comments.js` pure core (export):

```js
function presenceState(presence, activity) {
  if (!presence) return null;
  if (presence.waits > 0) return { state: "listening" };
  var pick = null, ack = null;
  (activity || []).forEach(function (ev) {
    if (ev.kind === "picked-up") pick = ev.at;
    if (ev.kind === "acked") ack = ev.at;
  });
  if (pick && (!ack || ack < pick)) return { state: "applying" };
  return { state: "away", lastSeen: presence.lastClosedAt || null };
}
```

- [ ] **Step 4: Run all suites + restart daemon** — PASS, kickstart.

- [ ] **Step 5: Commit** — `feat(canvas): presence from open canvas_wait, exposed via /api/version`

---

### Task 8: Nav v2 — bottom bar everywhere, sheets, changed-dots

**Files:**
- Modify: `assets/comments.js` (`renderNav` :1023-1073, `openSendPopover` :1080, panel/feed open paths; pure `changedPages`)
- Modify: `assets/plan.css` (nav v2 chrome; replaces the old `.cmt-nav` rules)
- Test: `tests/test_comments.js`

**Interfaces:**
- Consumes: `presenceState` (Task 7), `tabIcon`/`pageKind` (Task 1), existing `state.pages` / `sentOpenOnPage` / `openCount` / `sendCount` / activity.
- Produces: pure `changedPages(activity, visits)` → `{ [file]: true }`, exported. DOM at every width: top bar `#cmt-top` (page title + `Pages ▾` chip), bottom bar `#cmt-nav` (💬, Comments n, 🔔, presence chip, Send); `.cmt-sheet` bottom-sheet container used by pages list, comments panel, activity feed, and send popover; `window.CanvasReview.openSend()` opens the send sheet (Task 9 consumes). Approval badge moves inside the send sheet header. Visited tracking: localStorage `"cmt-visited::" + apiBase(location.pathname)` as `{ [file]: isoTime }`, written on every page load, all access try/catch-wrapped.

- [ ] **Step 1: Write the failing tests**

```js
const { changedPages } = require("../assets/comments.js");
test("changedPages flags pages updated after last visit", () => {
  const activity = [
    { kind: "page-updated", at: "2026-10-11T10:00:00",
      refs: { pages: ["a.html", "b.html"] } },
    { kind: "acked", at: "2026-10-11T11:00:00" },
  ];
  assert.deepStrictEqual(
    changedPages(activity, { "a.html": "2026-10-11T10:30:00" }),
    { "b.html": true });
});
test("changedPages with no visit store flags everything (review focus #4)", () => {
  const activity = [{ kind: "page-updated", at: "t",
                      refs: { pages: ["a.html"] } }];
  assert.deepStrictEqual(changedPages(activity, null), { "a.html": true });
});
test("changedPages ignores malformed events", () => {
  assert.deepStrictEqual(changedPages([{ kind: "page-updated" }, null], {}), {});
});
```

- [ ] **Step 2: Run to verify fails** — FAIL (not exported).

- [ ] **Step 3: Implement the pure helper** (export):

```js
function changedPages(activity, visits) {
  var out = {};
  (activity || []).forEach(function (ev) {
    if (!ev || ev.kind !== "page-updated" || !ev.refs || !ev.refs.pages) return;
    ev.refs.pages.forEach(function (p) {
      if (!visits || !visits[p] || visits[p] < ev.at) out[p] = true;
    });
  });
  return out;
}
```

- [ ] **Step 4: Rewrite the nav DOM**

Replace `renderNav` with the two-bar layout (keep every existing handler contract: Comment toggles pick mode, Comments opens the panel, 🔔 opens the feed, Send opens the send UI):

```js
  function visitedStore() {
    try { return JSON.parse(localStorage.getItem(
      "cmt-visited::" + apiBase(location.pathname)) || "{}"); }
    catch (e) { return null; }
  }
  function markVisited() {
    try {
      var v = visitedStore() || {};
      v[curPage] = new Date().toISOString();
      localStorage.setItem("cmt-visited::" + apiBase(location.pathname),
                           JSON.stringify(v));
    } catch (e) { /* private mode — dots degrade, nothing breaks */ }
  }

  function presenceChipHtml() {
    var p = presenceState(version.presence, state.activity);
    if (!p) return "";
    if (p.state === "listening")
      return '<span class="cmt-presence"><span class="dot pulse"></span>listening</span>';
    if (p.state === "applying")
      return '<span class="cmt-presence"><span class="dot"></span>applying ✍</span>';
    var seen = p.lastSeen ? " · " + p.lastSeen.slice(11, 16) : "";
    return '<span class="cmt-presence away"><span class="dot off"></span>away' +
           escapeHtml(seen) + "</span>";
  }

  function renderNav() {
    var changed = changedPages(state.activity, visitedStore());
    var others = (state.pages || []).filter(function (p) { return p.file !== curPage; });
    var anyBadge = others.some(function (p) {
      return changed[p.file] || sentOpenOnPage(p.file) > 0; });

    var top = document.getElementById("cmt-top") || document.createElement("div");
    top.id = "cmt-top"; top.className = "cmt-top";
    var cur = (state.pages || []).filter(function (p) { return p.file === curPage; })[0];
    top.innerHTML =
      '<span class="cmt-top-title">' +
        escapeHtml((cur && cur.title) || document.title || curPage) + "</span>" +
      '<button class="cmt-pages-chip" id="cmt-pages">Pages ▾' +
        (anyBadge ? '<span class="chg"></span>' : "") + "</button>";
    if (!top.parentNode) document.body.appendChild(top);
    top.querySelector("#cmt-pages").onclick = function () { openPagesSheet(changed); };

    var nav = document.getElementById("cmt-nav") || document.createElement("div");
    nav.id = "cmt-nav"; nav.className = "cmt-nav cmt-bottom";
    var n = sendCount(state.comments);
    nav.innerHTML =
      '<button class="cmt-nav-btn cmt-mode' + (pickMode ? " active" : "") +
        '" id="cmt-mark" title="Comment — C, or long-press on touch">💬</button>' +
      '<button class="cmt-nav-btn" id="cmt-comments">🗨 <span class="count">' +
        openCount() + "</span></button>" +
      '<button class="cmt-nav-btn cmt-bell" id="cmt-bell">🔔' +
        '<span class="cmt-bell-dot"></span></button>' +
      presenceChipHtml() +
      '<button class="cmt-btn primary cmt-send" id="cmt-send"' +
        ((approvalOff() && n === 0) ? " disabled" : "") + ">Send" +
        (n ? " (" + n + ")" : "") + " ↑</button>";
    if (!nav.parentNode) document.body.appendChild(nav);
    // Rebind exactly the four handlers from the old renderNav
    // (comments.js:1064-1072): bell → toggleFeed(), #cmt-mark →
    // setPickMode(!pickMode), #cmt-comments → toggle #cmt-panel,
    // #cmt-send → openSendPopover(). Copy those lines verbatim.
  }
```

`openPagesSheet(changed)` builds a `.cmt-sheet` listing every page: `tabIcon(kind)` + title + open-comment badge + `changed[file]` dot, current row marked, rows are `<a>` with `tabHref(...)`. Convert `openSendPopover` to render inside a `.cmt-sheet` (same radios/summary/actions; approval badge text becomes the sheet's header line) and expose `window.CanvasReview.openSend = openSendPopover`. Give the existing comments panel and activity feed a `cmt-sheet` presentation class on open. Call `markVisited()` once on load. Long-press (600 ms `pointerdown`/`pointerup` timer on touch) enters pick mode for one pick.

- [ ] **Step 5: plan.css — nav v2 chrome** (replace the old `.cmt-nav` top-strip rules):

```css
.cmt-top { position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  height: 46px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
  background: var(--bg); border-bottom: 1px solid var(--line); }
.cmt-top-title { font: 600 13px var(--sans); color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmt-pages-chip { margin-left: auto; flex: none; font: 11px var(--mono);
  border: 1px solid var(--line-strong); border-radius: 999px; padding: 4px 10px;
  color: var(--ink); background: var(--bg-soft); cursor: pointer; }
.cmt-pages-chip .chg { display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; background: var(--open); margin-left: 5px; }
.cmt-nav.cmt-bottom { position: fixed; left: 0; right: 0; bottom: 0; top: auto;
  z-index: 40; height: 56px; display: flex; align-items: center; gap: 6px;
  padding: 0 10px calc(env(safe-area-inset-bottom, 0px)); background: var(--bg);
  border-top: 1px solid var(--line); }
.cmt-nav.cmt-bottom .cmt-nav-btn { height: 40px; min-width: 42px;
  border-radius: 9px; }
.cmt-nav.cmt-bottom .cmt-send { margin-left: auto; height: 40px;
  border-radius: 10px; padding: 0 16px; }
.cmt-presence { display: inline-flex; align-items: center; gap: 6px;
  font: 11px var(--mono); color: var(--muted); border: 1px solid var(--line);
  border-radius: 999px; padding: 4px 10px; }
.cmt-presence .dot { width: 7px; height: 7px; border-radius: 50%;
  background: var(--ink); }
.cmt-presence .dot.pulse { animation: cmt-pulse 2s infinite; }
.cmt-presence .dot.off { background: var(--resolved); }
@keyframes cmt-pulse { 50% { opacity: .25; } }
.cmt-sheet { position: fixed; left: 50%; transform: translateX(-50%);
  bottom: 0; z-index: 60; width: 100%; max-width: 520px; background: var(--bg);
  border: 1px solid var(--line-strong); border-bottom: none;
  border-radius: 16px 16px 0 0; padding: 10px 14px
  calc(14px + env(safe-area-inset-bottom, 0px)); max-height: 70vh;
  overflow: auto; box-shadow: 0 -8px 30px rgba(0,0,0,.14); }
.cmt-scrim { position: fixed; inset: 0; z-index: 55; background: rgba(0,0,0,.25); }
main.plan { padding-top: 56px; padding-bottom: 72px; }
```

- [ ] **Step 6: Run all suites + manual check** — suites PASS. Open this dir's canvas on desktop and phone (`http://<lan-ip>:8618/...`): both bars render, Pages sheet lists all five pages, editing a page from another session puts a dot on its row, presence chip flips to "listening" while a `canvas_wait` is open.

- [ ] **Step 7: Commit** — `feat(canvas): nav v2 — bottom bar everywhere, sheets, changed-dots, presence chip`

---

### Task 9: Deck finish prompt

**Files:**
- Modify: `assets/deck.js` (fill `maybeFinishPrompt`)
- Test: `tests/test_deck.js`

**Interfaces:**
- Consumes: `deckModel(...).allDone` (Task 3), `window.CanvasReview.openSend()` (Task 8), `sendCount` via the `canvas:state` detail.
- Produces: pure `shouldPrompt(prevDone, nowDone, alreadyShown)` → boolean, exported.

- [ ] **Step 1: Write the failing test**

```js
const { shouldPrompt } = require("../assets/deck.js");
test("shouldPrompt fires exactly on the false->true edge, once", () => {
  assert.ok(shouldPrompt(false, true, false));
  assert.ok(!shouldPrompt(true, true, false));   // already done at load
  assert.ok(!shouldPrompt(false, true, true));   // already shown this load
  assert.ok(!shouldPrompt(false, false, false));
});
```

- [ ] **Step 2: Run to verify fails** — FAIL (not exported).

- [ ] **Step 3: Implement**

```js
  function shouldPrompt(prevDone, nowDone, alreadyShown) {
    return !prevDone && nowDone && !alreadyShown;
  }
  // exports: add shouldPrompt to the module.exports object

  var _prevDone = null;   // null until the first canvas:state settles a baseline
  function maybeFinishPrompt() {
    var m = deckModel(qids(), answers);
    if (_prevDone === null) { _prevDone = m.allDone; return; }  // never on load
    if (shouldPrompt(_prevDone, m.allDone, _finishShown)) {
      _finishShown = true;
      if (window.CanvasReview && window.CanvasReview.openSend)
        window.CanvasReview.openSend();
    }
    _prevDone = m.allDone;
  }
```

- [ ] **Step 4: Run tests** — `node tests/test_deck.js` PASS; all suites PASS.

- [ ] **Step 5: Manual check** — scratch deck: answering the last question opens the send sheet once; dismissing and re-answering does not re-open it.

- [ ] **Step 6: Commit** — `feat(canvas): one-shot send prompt when a deck completes`

---

### Task 10: Templates — gated-deck skeleton + scaffold notes

**Files:**
- Modify: `assets/template.html` (full body replacement)
- Modify: `assets/canvas.html` (header comment: surfaces + when to use board.html)

**Interfaces:**
- Consumes: deck classes (Task 3), question-block contract, meter (Task 4).
- Produces: `canvas_open(mode:"plan")` seeds a gated deck.

- [ ] **Step 1: Rewrite `assets/template.html` body** (keep the existing `<head>` asset links; set `<body data-canvas-kind="deck">`, no `data-approval="off"`; load `deck.js` after `comments.js`):

```html
<body data-canvas-kind="deck">
  <main class="plan">
    <div class="banner">
      <span class="status draft">PLAN — awaiting review</span>
      <span>Created YYYY-MM-DD</span><span>Author: Claude</span>
    </div>
    <h1>PLAN TITLE</h1>

    <!-- verdict strip: 3-4 label/value chips; exactly one .accent -->
    <section class="block" data-block-id="verdict" data-block-label="Verdict">
      <div class="verdict">
        <div class="chip"><div class="l">Problem</div><div class="v">…</div></div>
        <div class="chip accent"><div class="l">Proposal</div><div class="v">…</div></div>
      </div>
    </section>

    <!-- one decision card per open question; data-lean marks your pick -->
    <section class="block question" data-block-id="q-example"
             data-block-label="Example decision"
             data-question-id="example" data-question-mode="single">
      <h3>1 · The question?</h3>
      <p>One or two lines of context — the argument lives here, never in option text.</p>
      <div class="qopt" data-value="a">Option A — one line</div>
      <div class="qopt" data-value="b" data-lean>Option B — one line</div>
    </section>

    <!-- settled: decisions already made; collapsed rationale -->
    <section class="block" data-block-id="settled" data-block-label="Settled">
      <h3>Settled</h3>
      <details><summary>Decision one-liner</summary><p>Why, in 1-3 sentences.</p></details>
    </section>

    <section class="block" data-block-id="ask" data-block-label="The ask">
      <h3>The ask</h3>
      <p>Answer the questions (defer any), comment, approve.</p>
    </section>
  </main>
  <script src="comments.js"></script>
  <script src="deck.js"></script>
</body>
```

Add the verdict and settled CSS to plan.css if Task 3 didn't (`.verdict`, `.chip`, `.chip .l/.v`, `.chip.accent`, `.settled details/summary` with the ✓-prefix rule — port from this dir's `plan.html` inline styles, tokens only).

- [ ] **Step 2: Update `assets/canvas.html`'s header comment** — surfaces are deck/board/doc; copy `board.html` (not this file) for a board; this scaffold is for docs and freeform pages; mention `data-budget-words`.

- [ ] **Step 3: Manual check** — `canvas_open` a fresh scratch dir with `mode:"plan"`: seeded page shows banner → verdict → example card with pick badge → settled → ask, meter green, gate present.

- [ ] **Step 4: Commit** — `feat(canvas): seed gated-deck template; scaffold notes for three surfaces`

---

### Task 11: References + SKILL.md rewrite

**Files:**
- Modify: `references/modes.md`, `references/document-quality.md`, `references/wireframe.md`, `SKILL.md`

No tests — docs. Follow the spec's §4 exactly:

- [ ] **Step 1: `references/modes.md`** — rewrite around three surfaces: Deck (answering; gate = plan-deck; budget 200), Board (looking; frames, pins, deep links; no budget), doc (reading; 600). Table gains a Budget column. Legacy note: old kinds render as before; don't convert old workspaces.
- [ ] **Step 2: `references/document-quality.md`** — plan-mode structure → deck anatomy (banner → verdict → decision cards → settled → ask); question-block section gains the visual-option markup (`.qopt` with `.thumb`/`.meta`, `data-lean`); **replace** the options-render-neutral rule: the lean is machine-marked via `data-lean`, never written into option prose; "You decide" = accept the visible lean. Budgets section: the numbers, collapsed text is budget-free, "meter green or say why in chat" joins the pre-handoff check.
- [ ] **Step 3: `references/wireframe.md`** — add board-frame authoring (absolute-positioned `data-frame-id` divs, `.board-flabel`, deep links) and note deck thumbnails are hand-drawn minis v1.
- [ ] **Step 4: `SKILL.md`** — modes table → surfaces table (deck/board/doc + Budget column); Authoring section: deck contract (question blocks + `data-lean`), board frames/pins, meter, one line each; Setup section adds the `--host 0.0.0.0` install variant with the trusted-LAN caveat. Keep overall length — cut what references now cover.
- [ ] **Step 5: Commit** — `docs(canvas): references + SKILL.md for the three-surface model`

---

### Task 12: Acceptance sweep

**Files:** none (verification only)

- [ ] **Step 1: All suites** — `node tests/test_comments.js && node tests/test_deck.js && node tests/test_board.js && node tests/test_diagram.js && python3 tests/test_serve.py && python3 tests/test_canvasd.py` — all PASS.
- [ ] **Step 2: Fresh deck** — seed a scratch workspace via `canvas_open mode:"plan"`; answer by keyboard; finish prompt appears; Send bundles answers + approval; `canvas_wait` wakes with them.
- [ ] **Step 3: Fresh board** — copy `board.html`, add two frames; pan/zoom/fit; dbl-click drops a pin → send → `canvas_resolve` → pin greys.
- [ ] **Step 4: Legacy** — open `plans/2026-09-05-canvas-decision-first/` and this dir: every page renders, comments and approval still work, no deck/board JS activates.
- [ ] **Step 5: Phone** — open the scratch deck at `http://<lan-ip>:8618/...`: two bars, sheets, long-press comment, 40px targets.
- [ ] **Step 6: Commit anything the sweep fixed** — `fix(canvas): acceptance sweep fixes`, then update `spec.md` status line to "IMPLEMENTED <date>".
