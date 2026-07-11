---
description: Build a local canvas of reviewable HTML artifacts — implementation plans, UI mockups and prototypes, decision docs, architecture/flow diagrams, and freeform docs — served by the local canvasd daemon so the user sees, comments on, and approves them in a browser before you act. Fully offline (stdlib Python + vanilla JS), no cloud, no accounts, no dependencies.
---

A **canvas** is a per-topic workspace of HTML artifacts the user reviews in a
browser. One local daemon (**canvasd**, 127.0.0.1 only) serves every canvas on
one stable port and exposes the `canvas_*` MCP tools you drive it with:
`canvas_open`, `canvas_wait`, `canvas_feedback`, `canvas_resolve`,
`canvas_ack`, `canvas_export`. Nothing leaves the machine.

## When to use / when to skip

Use it when a task is better as a reviewable artifact than a chat paragraph:
planning multi-file/risky/ambiguous work, showing UI mockups or a clickable
prototype, deciding between options, drawing an architecture or flow, or writing
a doc the user should comment on. Skip it for trivial, unambiguous work — typos,
one-line fixes, a single well-specified function — and just do it. Never pad an
artifact with filler.

## Modes

Pick a mode from the task; ceremony scales per mode. Full per-mode rules
(what it contains, what "done" means, the plan discipline) are in
`references/modes.md` — read it.

| Task | Mode | Reference | Gate |
|------|------|-----------|------|
| Plan work before code | plan | `document-quality.md`, `wireframe.md`, `svg-diagrams.md` | **required** |
| UI variants / prototype | mockup | `wireframe.md` | off |
| Choose between options | decide | `document-quality.md` | optional |
| Architecture / flow in 2-D | diagram | `svg-diagrams.md` | off |
| Freeform reviewable doc | doc | `document-quality.md` | off |

## Workspace lifecycle

One workspace per topic: `canvas/<slug>/` under the project (check it in), or
`/tmp/canvas/<slug>/` if it shouldn't be tracked. Open it with the tool,
passing the **absolute** dir:

- `canvas_open(dir, mode)` creates the dir if needed and seeds the mode's
  starting page on first open — `mode:"plan"` → `plan.html` (carries the
  approval gate), `mode:"canvas"` → `canvas.html` (ungated). It registers the
  workspace and returns `{url, key, pages, feedback}` — **give the user the
  url**. Reopening is idempotent and surfaces any pending feedback.
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
- **Inline CSS/JS is allowed** — use the `<style>`/`<script>` slots for styling,
  clickable states, variant toggles, working prototypes. Two invariants: (1)
  keep `comments.js` loaded on every artifact; (2) your JS must not remove or
  renumber anchored elements (`data-block-id`/`data-cmt-id`) or their comments
  detach. `plan.css` stays the shared base — link it first.
- **Diagrams.** Pick the form from the chooser in `references/svg-diagrams.md` —
  sequence/flow via a `diagram.js` JSON spec, freeform architecture via hand SVG,
  a linear chain via the div kit. Load `diagram.js` after `comments.js` in any
  artifact that uses a spec.
- **Gate.** Non-plan artifacts declare `<body data-approval="off">` (already in
  `canvas.html`). Plan pages carry the gate — leave it off, or remove
  `data-approval="off"` if you started from `canvas.html`.

## The review loop

**The default loop is push.** Immediately after surfacing the URL, block on:

    canvas_wait(dir, since, timeout?, events?)

First call `since=0`; every call returns a `cursor` — pass it back as `since`
on the next call so nothing re-fires. It returns when the reviewer submits a
comment to the agent or an approval decision (`event: "comment" | "approval"`),
or on timeout (`event: null` — just call it again; the default 50 s window
stays under Claude Code's ~60 s MCP tool-call timeout, and the cursor makes
re-calling lossless). `events:"any"` also wakes
on answers and notes. On an approval it **auto-acknowledges pickup** so the
reviewer's "awaiting Claude…" flips immediately.

On any wake, the result carries the open agent-targeted comments, answers, and
approval state. Act on it:

- Apply changes by editing the referenced artifact (keep block ids stable so
  comments stay anchored). The browser refreshes itself.
- `canvas_resolve(dir, comment_ids)` for comments you've addressed.
- `canvas_ack(dir, message)` with a real message once you've actually read and
  applied a submission — the auto-ack only confirms pickup.
- `canvas_feedback(dir)` reads the full state any time without blocking — use
  it before editing, after any pause, and before your final response.

Feedback semantics (state also persists as JSON files next to the artifacts —
gitignore `comments.json`, `answers.json`, `approval.json`, `ack.json` if the
workspace is checked in):

- **Comments**: `target: "agent"` = act on it; `"human"` = context. `parentId`
  threads replies; `page` says which artifact (defaults to `plan.html`).
- **Answers** (inline question blocks): one per `questionId`. A value of
  `"__defer__"` (or `["__defer__"]`) means the reviewer delegated the choice —
  apply your recommended default and say so; `null`/empty means unselected,
  the question is open again.
- **Approval**: `state` is `null` / `"approved"` / `"changes-requested"`, with
  an optional `note`.

## The approval gate (plan mode)

For plan artifacts the approval **is** the gate: only start writing code once
`canvas_wait`/`canvas_feedback` reports `approval.state == "approved"`. A clean
approval with no open *Submit*-to-Claude comments is the cue to stop planning
and implement; open agent-targeted comments keep you in the loop. Planning
stays read-only until then (see `references/modes.md`).

## Archival export

`canvas_export(dir)` writes self-contained copies of every page (shared assets
inlined) to `<dir>/export/` — use it when a finished artifact should be
checked in or shared as a standalone snapshot that outlives the daemon.

## Setup & operations

- **One-time install** (macOS): `python3 <skill-dir>/server/canvasd.py install`
  writes and bootstraps a launchd agent (KeepAlive + RunAtLoad, port 8618,
  logs at `~/.claude/canvas/canvasd.log`), then register the endpoint once:
  `claude mcp add --transport http --scope user canvas http://127.0.0.1:8618/mcp`
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
