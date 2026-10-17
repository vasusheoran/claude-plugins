# Surfaces

A canvas holds one or more reviewable HTML artifacts. Each artifact runs on one
of three **surfaces** that scale the ceremony to the task: Deck for answering,
Board for looking, doc for reading. Pick the surface from the task type, start
from the named template, read the named references, and hold the artifact to
the surface's "done" bar.

| Surface | Use for | Template | Read | Gate | Primary content | Budget |
|---------|---------|----------|------|------|------------------|--------|
| **Deck** | decisions, plans, choices between options | `template.html` → `plan.html` | `document-quality.md`, `wireframe.md`, `svg-diagrams.md` | optional (plan = gated deck) | question blocks | 200 words |
| **Board** | UI variants, prototypes, architecture, flow | `board.html` | `wireframe.md`, `svg-diagrams.md` | off | frames + pins | none |
| **doc** | freeform reviewable notes | `canvas.html` | `document-quality.md` (shared bar) | off | prose + blocks | 600 words |

Non-gated artifacts declare `<body data-approval="off">` (already set in
`canvas.html` and `board.html`). A deck carries the gate when it needs explicit
sign-off before code; drop `data-approval="off"` for a gated deck, or remove it
if you started from `canvas.html`.

---

## Deck — answering

**When.** The reviewer's job is to decide something: an implementation plan
before code, a choice between options, any open question better answered in
the page than argued in chat. Skip it for trivial, unambiguous work — typos,
one-line fixes, a single well-specified function — and just make the change.

**Contains.** One or more `section.block.question` cards — the markup contract
is unchanged from before (`data-question-id`, `data-question-mode`,
`.qopt[data-value]`; answers land in `answers.json`; synthetic Other/You-decide
rows still work). Question blocks are the deck's primary surface, not an
add-on: don't scatter them through a document. Options that need a visual
compare use the `.qopt` thumb/meta markup (`references/document-quality.md`);
exactly one option per single-choice question can carry `data-lean` to mark
Claude's pick — the badge renders from the attribute, never from prose.

**Decision first.** The first card on the page is the decision: the question,
Claude's pick (`data-lean`), and one plain line on what it costs to undo.
Background follows, or moves to a second page. Pick each visual by the
"Pick the medium" chooser in `document-quality.md`.

**Page discipline.** Add a page only for a new decision or a new visual.
Otherwise update the existing page in place, keeping block ids stable.
Reviewers lose time to page sprawl, not to long pages.

**Plan = gated deck.** A deck that needs sign-off before code keeps the
one-screen budget, puts every open decision near the top as a question block,
and ends with a short block naming what approval unblocks. The full recipe —
page order, the `details.html` split for supporting design — is "Plan-mode
structure" in `document-quality.md`.

**Start from** `template.html`, copied to `plan.html` for a gated deck, or
`canvas.html` with `data-canvas-kind="deck"` for an ungated one. **Read**
`document-quality.md` before the body, `wireframe.md` before any option
thumbnail or UI screen, `svg-diagrams.md` before any hand-authored diagram.

**Done** when every open decision is either answered in `answers.json`, a
`settled` row, or an unanswered question block; the word meter is green (or
the overage is explained in chat); and, for a gated deck, `approval.json`
reads `"approved"`.

### Deck discipline (do this before authoring)

- **Research first.** Read the real files, schemas, helpers, and patterns. Name
  actual files, symbols, and data shapes — never invent them. Delegate wide
  exploration to a sub-agent when useful.
- **Lead with reuse.** For each step, name what it reuses before what it adds,
  so the deck explains the genuinely new delta.
- **Decide hard-to-reverse bets first.** Call out the choices expensive to undo
  once data or callers depend on them — wire format, public ids, data-model
  shape, auth/ownership — and get those right. Then scope to the smallest first
  cut that proves the approach, stating what's in and what's deferred.
- **Authoring a deck is read-only.** Make no source edits while building or
  reviewing it. Start editing only after the user answers or approves.
- **Clarify vs. assume.** Don't ask *how* to build it — present the approach
  and options as question blocks with `data-lean` on the pick. Ask a
  clarifying question only when an ambiguity would change the design and you
  can't resolve it from the code; batch 2–4 via the normal ask-user-question
  flow. Otherwise mark the lean and proceed, and keep anything unresolved as a
  question block.
- **The deck stands alone.** A reviewer opening it cold — no chat history —
  should understand it. No "unlike the previous version" / "this revision"
  language. State the positive model directly.

**High-stakes decks** (architecture, backend, data-model, migration,
multi-file) get one cheap adversarial self-review pass *after* surfacing,
while the user reads — look for implicit hard-to-reverse decisions, unanchored
steps, option sets that should commit to one choice, filler, and content past
the budget. Apply clear-cut fixes; route genuine judgment calls into a
question block.

---

## Board — looking

**When.** The reviewer's job is to look at something spatial: UI variants, a
clickable prototype, a before/after, architecture, a flow, a sequence — any
relationship a left-to-right scroll flattens.

**Contains.** Absolutely-positioned frames inside `#viewport > #world`, each
carrying a stable `data-frame-id` (the comment anchor and the deep-link
target: `page.html#frame-id`). Frame innards are plain HTML/SVG — the `wf-*`
kit, `diagram.js` output, hand-authored SVG, stickies. No word budget; the
board is judged on layout and pan/zoom behavior, not prose length.

**Pins.** Comments on a board are x/y pins, not block comments — drop one by
double-clicking a frame (or anywhere on the world) while composing. Pins
anchor to world coordinates plus a `frameId`; they survive a frame being
deleted or moved, and stay reachable from the comment panel.

**Start from** `board.html`, with `data-canvas-kind="board"` already set.
**Read** `wireframe.md` for frame authoring (realism, layout, the `wf-*`
tokens) and `svg-diagrams.md` for diagram frames.

**Done** when every frame reads as a real screen or a readable diagram (no
lorem, no dead controls that look live), the Fit view shows the whole board
without clipping, and deep links land on the right frame.

---

## doc — reading

**When.** A reviewable freeform document — a decision record, a spec, release
notes, a walkthrough — read and commented on in a browser rather than pasted
into chat.

**Contains.** Prose and the shared building blocks (callouts, file trees,
annotated code, tables). Structure is up to the document; the shared
authoring bar in `document-quality.md` still holds. Budget: 600 visible words
(the word meter counts `<main>` as rendered by default — collapsed `<details>`
count only their summary).

**Start from** `canvas.html` — its seeded `data-canvas-kind="doc"` matches
this surface already. **Read** the shared authoring bar in
`document-quality.md`.

**Done** when it stands alone, reads cleanly at the pre-handoff check, and the
word meter is green or the overage is explained in chat.

---

## Legacy

Workspaces seeded before this rewrite may carry the old kinds —
`plan` / `mockup` / `diagram` / `decision` — on `data-canvas-kind`. They keep
loading, taking comments, and (for `plan`) approving exactly as before;
`deck.js` and `board.js` only activate on `data-canvas-kind="deck"` /
`"board"` and leave everything else alone. Don't convert an old workspace to
the new kinds just to match this doc — new work uses the three surfaces above,
old work keeps working as it is.
