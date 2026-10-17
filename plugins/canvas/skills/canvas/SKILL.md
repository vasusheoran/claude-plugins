---
description: Help the user make better, faster decisions by showing them, visually, in a local canvas of reviewable HTML pages. Every page opens with the decision being asked, Claude's pick, and what it costs to undo. Covers implementation plans, UI mockups and prototypes, decision docs, architecture/flow diagrams, and freeform docs, served by the local canvasd daemon so the user sees, comments on, and approves them in a browser before you act. Fully offline (stdlib Python + vanilla JS), no cloud, no accounts, no dependencies.
---

A canvas exists to help the user make better and faster decisions, and it does
that visually: diagrams, animated steps, interactives, charts. The user takes
Claude's pick most of the time, so picking is cheap. Understanding is the
cost, and every artifact is built to remove it. **Every artifact opens with the
decision ask** (what is being decided, Claude's pick, what it costs to undo)
before any background.

A **canvas** is a per-topic workspace of HTML artifacts the user reviews in a
browser. One local daemon (**canvasd**, 127.0.0.1 only) serves every canvas on
one stable port and exposes the `canvas_*` MCP tools you drive it with:
`canvas_open`, `canvas_wait`, `canvas_feedback`, `canvas_resolve`,
`canvas_reply`, `canvas_ack`, `canvas_export`. Nothing leaves the machine.

## When to use / when to skip

Use it when a task is better as a reviewable artifact than a chat paragraph:
planning multi-file/risky/ambiguous work, showing UI mockups or a clickable
prototype, deciding between options, drawing an architecture or flow, or writing
a doc the user should comment on. Skip it for trivial, unambiguous work — typos,
one-line fixes, a single well-specified function — and just do it. Never pad an
artifact with filler.

## Surfaces

Pick a surface from the task; ceremony scales per surface. Full per-surface
rules (what it contains, what "done" means, the deck discipline) are in
`references/modes.md` — read it.

| Task | Surface | Reference | Gate | Budget |
|------|---------|-----------|------|--------|
| Decisions, plans, choices between options | Deck | `document-quality.md`, `wireframe.md`, `svg-diagrams.md` | optional (plan = gated deck) | 200w |
| UI variants, prototype, architecture, flow | Board | `wireframe.md`, `svg-diagrams.md` | off | none |
| Freeform reviewable doc | doc | `document-quality.md` | off | 600w |

Workspaces seeded before this rewrite may still carry the old kinds
(`plan`/`mockup`/`diagram`/`decision`) — they keep loading, commenting, and
approving unchanged; don't convert them.

## Workspace lifecycle

One workspace per topic: `canvas/<slug>/` under the project (check it in), or
`/tmp/canvas/<slug>/` if it shouldn't be tracked. Open it with the tool,
passing the **absolute** dir:

- `canvas_open(dir, mode)` creates the dir if needed and seeds the mode's
  starting page on first open — `mode:"plan"` → `plan.html` (carries the
  approval gate), `mode:"canvas"` → `canvas.html` (ungated). A first open
  returns `seeded: true` and does **not** launch the browser — the page is
  still the blank template, so **don't give the user the url yet**. Author
  the page(s), then call `canvas_open` again: it launches the reviewer's
  browser at the first page (`browser_opened: true`), and **that** is the
  moment to give the user the url. Reopening is idempotent and surfaces any
  pending feedback — pass `open_browser: false` when you're only checking
  feedback, so reviewers don't collect extra tabs.
- **No assets are copied.** The daemon serves the shared `plan.css` /
  `comments.js` / `diagram.js` to every workspace (a workspace-local copy
  would win, but don't make one — fix the shared asset instead).
- More artifacts in the same workspace: copy
  `<skill-dir>/assets/canvas.html` to `canvas/<slug>/<name>.html`
  (`mockup-a.html`, `options.html`, …) and author it. All pages appear as
  tabs; the browser live-refreshes on its own.

## Authoring

Author each artifact from its template. Rules (full detail in
`references/document-quality.md`):

- **Blocks.** Every reviewable section is
  `<section class="block" data-block-id="…" data-block-label="…">`. Ids are
  **unique and stable** — never renumber on edits; comments anchor to them. Tag
  discussable elements with a stable `data-cmt-id`.
- **Deck.** Decisions are `section.block.question[data-question-id]` cards
  with `.qopt[data-value]` options; mark Claude's pick with the bare
  `data-lean` attribute on exactly one option per single-choice question —
  never in prose. `deck.js` (loaded after `comments.js`) layers the stepper
  and keyboard picks over the cards; it never persists anything itself.
- **Board.** Frames are absolutely-positioned `[data-frame-id]` children of
  `#viewport > #world` (template: `board.html`); `board.js` gives pan/zoom,
  Fit, and deep links (`page.html#frame-id`), and renders x/y pin comments
  from `comments.json`.
- **Decision first.** Read `references/document-quality.md` before writing the
  body. The first thing on the page is the decision card. A one-line status
  banner may sit above it; a title block or problem summary may not. A card has this
  shape, in this order: the question as its heading; one line starting "My
  pick:" with the choice; one line starting "Undo:" in plain words ("easy to
  undo later, it's a setting" or "hard to undo once X ships"); the visual;
  options. Background goes after the cards or on a second page. Every card
  carries its own "My pick:" and "Undo:" lines.
- **Pick the medium.** Every decision gets a visual, chosen by what the
  reviewer must grasp: structure → diagram; anything over time → stepped
  SVG/CSS animation with Step and Play controls, each step a stable
  `data-cmt-id` (prose or a static table is not enough); a tradeoff with a knob
  → a slider that recomputes the outcome; a number decides it → a chart from
  real data, citing its source; UI → before/after. No video files. Chooser:
  `references/document-quality.md` ("Pick the medium").
- **Plain words.** Write for a product owner reading cold. Use the user's
  words. Any term the user did not use (a protocol, an acronym, a pattern name,
  an internal word like "teardown", "API", "config", "jitter") is defined in a
  few words in brackets where it first appears, or replaced with plain words
  ("a setting" for "config"). Expand abbreviations. If a sentence needs the
  chat history to make sense, rewrite it.
- **One screen.** The decision page stays near 200 visible words, counting
  text inside diagrams and button labels. A gated deck may carry more cards
  (deck.js shows one at a time), but each card stays near 90 words. Reasoning,
  evidence, edge cases and lists of examples go on a second page
  (`details.html`) or inside a collapsed `<details>`. Count before you write
  the file; trim until it fits.
- **Budget meter.** A corner chip shows visible words against the surface's
  budget (deck 200 / doc 600 / Board none); it's a signal, never a block.
- **Inline CSS/JS is allowed** — use the `<style>`/`<script>` slots for styling,
  clickable states, variant toggles, working prototypes. Two invariants: (1)
  keep `comments.js` loaded on every artifact; (2) your JS must not remove or
  renumber anchored elements (`data-block-id`/`data-cmt-id`) or their comments
  detach. `plan.css` stays the shared base — link it first.
- **Diagrams.** Pick the form from the chooser in `references/svg-diagrams.md` —
  sequence/flow via a `diagram.js` JSON spec, freeform architecture via hand SVG,
  a linear chain via the div kit. Load `diagram.js` after `comments.js` in any
  artifact that uses a spec.
- **Gate.** Non-gated artifacts declare `<body data-approval="off">` (already
  in `canvas.html` and `board.html`). A gated deck carries the gate — leave it
  off, or remove `data-approval="off"` if you started from `canvas.html`.

## The review loop

**The default loop is push.** Immediately after surfacing the URL, block on:

    canvas_wait(dir, since, timeout?, events?)

First call `since=0`; every call returns a `cursor` — pass it back as `since`
on the next call so nothing re-fires. The reviewer drafts comments and answers
at their own pace — those are visible via `canvas_feedback` but don't wake you.
`canvas_wait` wakes on a **submission** event: the reviewer pressed
**Send to Claude**, bundling every pending comment, all question answers, and
(on gated pages) an approve / request-changes decision into one event. Legacy
per-comment and per-approval wakes still fire the same way for older
workspaces. On timeout it returns `event: null` — just call it again; the
default 50 s window stays under Claude Code's ~60 s MCP tool-call timeout, and
the cursor makes re-calling lossless. On a submission it **auto-acknowledges
pickup** so the reviewer's "awaiting Claude…" flips immediately.

On any wake, the result carries the submitted batch: comments, answers, and
the decision (if any). Act on it:

- Apply changes by editing the referenced artifact (keep block ids stable so
  comments stay anchored). The browser refreshes itself.
- `canvas_resolve(dir, comment_ids)` for comments you've addressed.
- `canvas_reply(dir, comment_id, message)` to answer a specific reviewer
  comment in-thread — use it for "done, see section 3" or a counter-question,
  instead of only saying it in chat.
- `canvas_ack(dir, message)` with a real message once you've actually read and
  applied a submission — the auto-ack only confirms pickup.
- `canvas_feedback(dir)` reads the full state any time without blocking — use
  it before editing, after any pause, and before your final response.

Feedback semantics (state also persists as JSON files next to the artifacts —
gitignore `comments.json`, `answers.json`, `approval.json`, `ack.json`,
`activity.json` if the workspace is checked in):

- **Comments**: `state` is `"pending" | "sent" | "resolved"`. Pending drafts
  are visible via `canvas_feedback` but are not action items yet — the
  reviewer hasn't sent them. Act only on `sent` comments. `parentId` threads
  replies; `page` says which artifact (defaults to `plan.html`).
- **Answers** (inline question blocks): one per `questionId`. A value of
  `"__defer__"` (or `["__defer__"]`) means the reviewer delegated the choice —
  apply your recommended default and say so. A value of `"__other__"` carries
  the reviewer's own answer in the `otherText` field. `null`/empty means
  unselected, the question is open again.
- **Approval**: `state` is `null` / `"approved"` / `"changes-requested"`, with
  an optional `note`.

## The approval gate (gated deck)

For a gated deck the approval **is** the gate: only start writing code once
`canvas_wait`/`canvas_feedback` reports `approval.state == "approved"`. A clean
approval with no open `sent` comments is the cue to stop planning and
implement; open sent comments keep you in the loop. Planning stays read-only
until then (see `references/modes.md`).

## Archival export

`canvas_export(dir)` writes self-contained copies of every page (shared assets
inlined) to `<dir>/export/` — use it when a finished artifact should be
checked in or shared as a standalone snapshot that outlives the daemon.

## Setup & operations

- **One-time install** (macOS): `python3 <skill-dir>/server/canvasd.py install`
  writes and bootstraps a launchd agent (KeepAlive + RunAtLoad, port 8618,
  logs at `~/.claude/canvas/canvasd.log`), then register the endpoint once:
  `claude mcp add --transport http --scope user canvas http://127.0.0.1:8618/mcp`
- **LAN-reachable install**: `python3 <skill-dir>/server/canvasd.py install --host 0.0.0.0`
  binds every interface instead of just loopback, so a phone or another
  machine on the same network can open the canvas URL. There's no auth —
  only do this on a trusted home/office LAN, never on a shared or public
  network.
- **If the `canvas_*` tools are missing in a session**: the daemon is down or
  unregistered. Re-run the install command, then `/mcp` to reconnect.
- **After changing `server/canvasd.py` or the shared assets**, restart the
  daemon: `launchctl kickstart -k gui/$UID/com.claude.canvasd` (new asset
  files are picked up live; Python code needs the restart).
- **Fix shared assets, not one workspace.** If look/structure/behavior is
  wrong, fix `plan.css` / `comments.js` / `diagram.js` / the templates / the
  reference docs — never hand-patch one workspace's copy.
- **file:// fallback**: if an artifact is somehow opened without the daemon,
  `comments.js` keeps review state in localStorage and offers a **Copy
  feedback JSON** button — ask the user to paste it back.
- **Tests** (run after changing the corresponding code):
  `python3 tests/test_serve.py`, `python3 tests/test_canvasd.py`,
  `node tests/test_comments.js`, `node tests/test_diagram.js`.
