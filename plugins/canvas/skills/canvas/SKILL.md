---
description: Build a local canvas of reviewable HTML artifacts — implementation plans, UI mockups and prototypes, decision docs, architecture/flow diagrams, and freeform docs — served locally so the user sees, comments on, and approves them in a browser before you act. Fully offline (stdlib Python + vanilla JS), no cloud, no accounts, no dependencies.
---

A **canvas** is a per-topic workspace of self-contained HTML artifacts the user
reviews in a browser, all served by one stdlib `serve.py` that captures inline
comments, answers, and approvals. Everything is local — no npm, no accounts,
nothing leaves the machine.

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

## Workspace setup

One workspace per topic. Default `canvas/<slug>/` (check it in), or a scratch dir
(`/tmp/canvas/<slug>/`) if it shouldn't be tracked. Copy the assets in
**verbatim** — the workspace is a self-contained snapshot, never referenced from
the skill dir. Copy `template.html` as `plan.html` for a plan; copy `canvas.html`
for any other artifact (rename freely — `mockup-a.html`, `options.html`). One
workspace holds many artifacts, all served as tabs.

```bash
ASSETS=<this-skill-dir>/assets
mkdir -p canvas/<slug>
cp "$ASSETS"/{serve.py,plan.css,comments.js,diagram.js} canvas/<slug>/
cp "$ASSETS"/template.html canvas/<slug>/plan.html   # plan mode
cp "$ASSETS"/canvas.html   canvas/<slug>/mockup-a.html   # any other artifact
```

`diagram.js` renders sequence/flow diagrams from JSON specs; copy it alongside
the others and, in any artifact that uses a diagram spec, load it with
`<script src="diagram.js">` (after `comments.js`). See `references/svg-diagrams.md`.

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
  a linear chain via the div kit.
- **Gate.** Non-plan artifacts declare `<body data-approval="off">` (already in
  `canvas.html`). Plan pages carry the gate — leave it off, or remove
  `data-approval="off"` if you started from `canvas.html`.

## Serve, then push-review

Start the server in the **background** and give the user the URL:

```bash
python3 canvas/<slug>/serve.py --dir canvas/<slug> --port 8000 --open &
```

(`--open` tries a browser; drop it on headless hosts and share
`http://127.0.0.1:8000/`.) The browser lists every `*.html` as a tab and
live-refreshes on its own by polling `/api/version` — that's the browser's job,
not yours.

**The default review loop is push, and serving without a watcher is a bug.**
Immediately after serving, start this background watcher — it long-polls
`/api/wait`, and on an approval it **POSTs the ack itself before exiting**, so
the reviewer's "awaiting Claude…" flips to "acknowledged" within the same push
flow (not whenever you get around to it):

```bash
B=http://127.0.0.1:8000
R=$(curl -s "$B/api/wait?since=<cursor>&timeout=540&events=agent")
if [ "$(printf %s "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["event"])')" = "approval" ]; then
  D=$(curl -s $B/api/approval | python3 -c 'import sys,json;print(json.load(sys.stdin)["decidedAt"])')
  curl -s -X POST $B/api/ack -d "{\"decidedAt\":\"$D\",\"by\":\"Claude\",\"message\":\"picked up — on it\"}" >/dev/null
fi
printf %s "$R"
```

It prints `{"cursor": N, "event": "comment"|"approval"|null}`. On any wake
(event fired) or timeout (`event:null`), read the state files, act, then
**relaunch it with `since=<cursor>`** so you don't re-fire on the same events
(first launch: `since=0`, or the cursor from a `timeout=0` probe). Use
`events=any` to also wake on answers/notes. Send a follow-up ack with a real
message once you've actually read the feedback — the auto-ack only confirms
pickup.

**State files** to read (next to the artifacts) before editing, after any pause,
and before your final response:

- **`comments.json`** — review comments: `blockId`, `blockLabel`, optional
  `quote`/`anchor` (pinned `{x,y}` %), `componentId`/`componentLabel` (a marked
  element), `parentId` (replies → threads), `body`, `status`, `target` (`agent`
  = act on it, `human` = context), and **`page`** (which artifact —
  defaults to `plan.html`). Reviewers can resolve/reopen from the page.
- **`answers.json`** — inline question-block answers, one per `questionId`
  (`value` is a string for `single`/`freeform`, an array for `multi`). How open
  decisions settle. A `value` of `"__defer__"` (or `["__defer__"]`) means the
  reviewer delegated the choice — apply your recommended default and say so;
  `null`/empty means they unselected and the question is open again.
- **`approval.json`** — `state` is `null` / `"approved"` /
  `"changes-requested"`, with an optional `note`. Plan-mode gate.
- **`ack.json`** — your acknowledgement, keyed to a submission's `decidedAt`.

To iterate: apply changes by editing the referenced artifact (keep block ids
stable so comments stay anchored); optionally set addressed agent-targeted
comments to `"status":"resolved"`. No reload needed — the browser refreshes
itself. Summarize what changed and anything still needing a decision.

## The approval gate (plan mode)

For plan artifacts, `approval.json` **is** the gate: only start writing code once
`state` is `"approved"`. A clean approval / LGTM with no open *Submit*-to-Claude
comments is the cue to stop planning and implement; open agent-targeted comments
keep you in the loop. Planning stays read-only until then (see
`references/modes.md`).

## file:// fallback

If the user opened an artifact as a bare `file://` (no server), all state lives
in their browser's localStorage instead. Ask them to click **Copy feedback JSON**
in the panel and paste it back, then apply it the same way.

## Notes

- **No dependencies.** `serve.py`, `plan.css`, `comments.js`, `diagram.js` are
  stdlib/vanilla only. Anything with `python3` and a browser runs this.
- **Localhost-only** bind (`127.0.0.1`). Nothing leaves the machine.
- **Fix shared assets, not one workspace.** If look/structure/behavior is wrong,
  fix `plan.css` / `comments.js` / `diagram.js` / the templates / the reference
  docs — don't hand-patch one stored artifact. Turn feedback into better guidance.
- **Gitignore state files** (`comments.json`, `answers.json`, `approval.json`,
  `ack.json`) if checking a workspace into the repo — they're review state, not
  the artifact.
- **Run the tests** after changing `serve.py`: `python3 tests/test_serve.py`.
