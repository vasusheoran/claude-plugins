---
description: Turn a text plan into a self-contained, reviewable HTML plan (diagrams, file maps, annotated code, wireframes, open questions) served locally with a tiny stdlib Python server that captures inline review comments — no cloud, no accounts, no dependencies.
---

Build an implementation plan as a **scannable HTML document the user reviews in a
browser before any code is written**, then iterate on it from their inline
comments. This is a fully-local adaptation of the planning discipline from
agent-native `/visual-plan`, with all hosted/MCP machinery replaced by
self-contained HTML + a stdlib `serve.py`. No npm, no accounts, no plan content
leaves the machine.

## When to use

Use it when the plan is better as a reviewable artifact than a chat paragraph:
multi-file, ambiguous, risky, architecture-heavy, data-heavy, or UI-heavy work,
or any modest change where the user should **see, comment on, and approve a
direction before code**. Skip it for trivial, unambiguous work — typos, one-line
fixes, a single well-specified function — and just make the change. Never pad a
plan with filler; never ship a single-step plan.

## Plan discipline (do this before authoring)

- **Research first.** Read the real files, schemas, helpers, and patterns. Name
  actual files, symbols, and data shapes — never invent them. Delegate wide
  exploration to a sub-agent when useful.
- **Lead with reuse.** For each step, name what it reuses (existing files,
  schema, components, helpers) before what it adds, so the plan explains the
  genuinely new delta.
- **Decide hard-to-reverse bets first.** Call out the choices expensive to undo
  once data or callers depend on them — wire format, public ids, data-model
  shape, auth/ownership — and get those right in the plan. Then scope to the
  smallest first cut that proves the approach, stating what's in and what's
  deferred.
- **Planning is read-only.** Make no source edits while building or reviewing the
  plan. Start editing only after the user approves the direction.
- **Clarify vs. assume.** Don't ask *how* to build it — present the approach and
  options in the plan. Ask a clarifying question only when an ambiguity would
  change the design and you can't resolve it from the code; batch 2–4 via the
  normal ask-user-question flow. Otherwise state the assumption and proceed, and
  keep anything unresolved in the single bottom **Open questions** block.
- **The plan stands alone.** A reviewer opening it cold — no chat history —
  should understand it. No "unlike the previous version" / "this revision"
  language. State the positive model directly.
- **The plan is the approval gate.** After serving it, ask the user to review and
  approve before you write code, and name which files/areas the work touches.
  Presenting the plan + requesting sign-off *is* the approval step.

Read `references/document-quality.md` before writing the document body and
`references/wireframe.md` before authoring any UI wireframe.

## Authoring workflow

1. **Create the plan folder.** Default `plans/<slug>/` (check it into the repo),
   or `/tmp/visual-plans/<slug>/` if it should not be tracked. Copy the four
   assets in verbatim from this skill's `assets/` directory (use its real
   absolute path) — never hand-edit them:
   ```bash
   ASSETS=<this-skill-dir>/assets
   mkdir -p plans/<slug>
   cp "$ASSETS"/{serve.py,plan.css,comments.js} plans/<slug>/
   cp "$ASSETS"/template.html plans/<slug>/plan.html
   ```
2. **Author `plan.html`** from the template. Content only — CSS/JS stay in the
   shared assets. Every reviewable section is
   `<section class="block" data-block-id="..." data-block-label="...">`. Block ids
   must be **unique and stable** — never renumber them on edits, because comments
   anchor to them. Use the building blocks in `references/document-quality.md`
   (callouts, diagrams, annotated code, file tree, wireframes, columns). Author
   each genuinely-open decision as an **interactive question block** (see the
   template and `references/document-quality.md`) so the user answers inline.
3. **Surface it.** Start the server and give the user the URL:
   ```bash
   python3 plans/<slug>/serve.py --dir plans/<slug> --port 8000 --open
   ```
   (`--open` tries to open a browser; drop it on headless hosts and just share
   `http://127.0.0.1:8000/`.) Then ask the user to review and approve.
4. **For high-stakes plans** (architecture, backend, data-model, migration,
   multi-file), run one cheap adversarial self-review pass *after* surfacing it,
   while the user reads — look for implicit hard-to-reverse decisions, unanchored
   steps, option-menus that should commit to one choice, and filler. Apply
   clear-cut fixes; route genuine judgment calls into the Open questions block.

## The review loop

The local analog of agent-native's `get-plan-feedback`. The reviewer interacts
in the browser; the server persists everything to three JSON files next to the
plan, which **you read** to revise:

- **`comments.json`** — review comments. Each has `blockId`, `blockLabel`, an
  optional `quote` (text selection) or `anchor` (`{x,y}` % of a pinned point),
  `parentId` (set on replies → threads), `body`, `status`, and `target` (`agent`
  = act on it; `human` = context only). The reviewer adds them three ways: hover
  a block and click 💬, select text to quote it, or **Alt-click** any point
  (e.g. on a diagram/wireframe) to pin a comment there. They can reply, and
  **resolve/reopen from the page** (you don't have to hand-edit status anymore,
  though you still can).
- **`answers.json`** — answers to the inline question blocks, one per
  `questionId` (`value` is a string for `single`/`freeform`, an array for
  `multi`). This is how open decisions get settled.
- **`approval.json`** — the explicit gate: `state` is `null`, `"approved"`, or
  `"changes-requested"`, with an optional `note`. The reviewer sets it with a
  single **Submit review**; state is derived from intent (`approved` when no open
  *Submit*-to-Claude comments remain, else `changes-requested`).
- **`ack.json`** — your acknowledgement of a submission, keyed to its
  `decidedAt`, so the reviewer's "acknowledged by Claude" confirmation reflects
  that you actually saw it, not a UI flash. POST `/api/ack`
  (`{decidedAt, by, message}`) the moment you pick up a submission.

To iterate:

1. **Read all four files** before editing, after any pause, and before your
   final response. Treat `approval.json` as the gate — only start writing code
   once `state` is `"approved"`. A **clean approval / LGTM with no open
   *Submit*-to-Claude comments is the cue to stop planning and implement**; only
   open agent-targeted comments keep you in the review loop.
2. Apply changes by editing `plan.html` for the referenced blocks. Keep block
   ids stable so existing comments/pins/quotes stay anchored. Optionally set
   addressed agent-targeted comments to `"status":"resolved"` in `comments.json`.
3. **No reload needed** — the page polls and auto-refreshes: editing `plan.html`
   reloads it; new comments/answers/approval/ack update live. Just summarize what
   you changed and anything still needing a decision.

To react without being pinged, you can run a tiny background poller over
`/api/version` (the digests for `comments`/`answers`/`approval`) that wakes you on
change; have it POST the ack on trigger so the confirmation lands within a poll.

If the user opened the file as a bare `file://` (no server), all state lives in
their browser's localStorage instead; ask them to click **Copy feedback JSON** in
the panel and paste it back, then apply it the same way.

## Notes

- **No dependencies.** `serve.py`, `plan.css`, `comments.js` are stdlib/vanilla
  only. Anything with `python3` and a browser can run this.
- **Bind is localhost-only** (`127.0.0.1`). The plan never leaves the machine.
- **If a plan's look or structure is wrong, fix the shared assets** (`plan.css`,
  `comments.js`, `template.html`) and the reference docs — don't hand-patch one
  stored plan. Turn feedback into better guidance.
- **State files** (`comments.json`, `answers.json`, `approval.json`, `ack.json`)
  are written next to `plan.html`. If checking the plan into the repo, consider
  gitignoring them — they're review state, not the plan itself.
- `tests/test_serve.py` covers the review API (comments/threads/resolve-reopen,
  answers, approval, ack, version); run `python3 tests/test_serve.py` after
  changing `serve.py`.
