# Modes

A canvas holds one or more reviewable HTML artifacts. Each artifact runs in a
**mode** that scales the ceremony to the task. Pick the mode from the task type,
start from the named template, read the named references, and hold the artifact
to the mode's "done" bar.

| Mode | Use for | Template | Read | Gate | Question blocks | Self-review |
|------|---------|----------|------|------|-----------------|-------------|
| **plan** | implementation plans before code | `template.html` → `plan.html` | `document-quality.md`, `wireframe.md`, `svg-diagrams.md` | **required** | encouraged | required for high-stakes |
| **mockup** | UI variants, clickable prototypes | `canvas.html` | `wireframe.md`, `document-quality.md` (shared bar) | off | optional | recommended |
| **decide** | choosing between options | `canvas.html` | `document-quality.md` (shared bar) | optional | **primary** | recommended |
| **diagram** | architecture / flows in 2-D | `canvas.html` | `svg-diagrams.md`, `document-quality.md` (shared bar) | off | optional | optional |
| **doc** | freeform reviewable notes | `canvas.html` | `document-quality.md` (shared bar) | off | optional | optional |

Non-gated artifacts declare `<body data-approval="off">` (already set in
`canvas.html`). Plan-mode pages carry the gate — leave `data-approval` off the
body, or remove it if you started from `canvas.html`.

---

## plan

**When.** The plan is better as a reviewable artifact than a chat paragraph:
multi-file, ambiguous, risky, architecture-heavy, data-heavy, or UI-heavy work,
or any modest change where the user should **see, comment on, and approve a
direction before code**. Skip trivial, unambiguous work — typos, one-line fixes,
a single well-specified function — and just make the change. Never pad a plan
with filler; never ship a single-step plan.

**Contains.** The full plan structure from `document-quality.md`:
outcome & scope → approach → architecture → key changes → risks & verification →
open questions. Diagrams via the div kit or hand-authored SVG; wireframes for
UI plans.

**Start from** `template.html`, copied to `plan.html`. **Read**
`document-quality.md` before the body, `wireframe.md` before any UI screen,
`svg-diagrams.md` before any hand-authored diagram.

**Done** when the plan stands alone, every open decision is settled or a question
block, and `approval.json` reads `"approved"`.

### Plan discipline (do this before authoring)

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

**High-stakes plans** (architecture, backend, data-model, migration, multi-file)
get one cheap adversarial self-review pass *after* surfacing, while the user
reads — look for implicit hard-to-reverse decisions, unanchored steps,
option-menus that should commit to one choice, and filler. Apply clear-cut fixes;
route genuine judgment calls into the Open questions block.

---

## mockup

**When.** The user needs to see UI: layout variants, a clickable prototype, a
before/after, a state exploration. Preferred over ASCII sketches for anything
visual.

**Contains.** One or more `wf-frame` screens with real product content; inline
`<style>`/`<script>` for clickable states and variant toggles when interaction
makes the review sharper. Model secondary states that interaction would hide
(popover, error, loading) as separate frames so they stay reviewable.

**Start from** `canvas.html`, renamed per variant (`mockup-a.html`,
`mockup-b.html`). **Read** `wireframe.md`; the shared authoring bar in
`document-quality.md` still applies.

Interactive mockups are safe: the review UI only listens while Comment mode is
on, so a reviewer clicking through a prototype never trips the comment picker.

**Done** when every frame reads as a real screen (no lorem, no dead controls
that look live), variants are labelled, and the reviewer can comment on any
control.

---

## decide

**When.** The task is a choice between options — a library, an approach, a
schema, a rollout — and you want the decision captured, not just discussed.

**Contains.** An options matrix (a `columns` block or a table: option × criteria)
and one or more **interactive question blocks** as the primary surface; the
question blocks are how the decision gets recorded in `answers.json`. Put a
recommended default in the option text so the user can approve by silence.

**Start from** `canvas.html`. **Read** the shared authoring bar in
`document-quality.md`.

**Gate optional** — turn it on (drop `data-approval="off"`) only when you want an
explicit sign-off on the chosen option, not just an answer.

**Done** when the answer lands in `answers.json` (and, if gated,
`approval.json`).

---

## diagram

**When.** You need to show relationships in two dimensions — architecture, data
flow, lanes, fan-in/fan-out, a sequence — where a left-to-right chain is too
flat.

**Contains.** One diagram per decision. Prefer a `diagram.js` JSON spec for a
sequence (actors over time) or flow (branching logic) — it emits token-styled SVG
with `data-cmt-id` anchors for you. Use a hand-authored inline `<svg>` for
freeform architecture/topology, tokens via `var(--ink)` etc., nodes tagged
`data-cmt-id`. Pick the form from the chooser at the top of `svg-diagrams.md`.

**Start from** `canvas.html`. **Read** `svg-diagrams.md` (the chooser picks
diagram.js vs. hand SVG vs. the div kit). For a diagram.js spec, load
`diagram.js` in the artifact after `comments.js`.

**Done** when the diagram is readable at 100% zoom, labels don't overlap edges,
and the discussable nodes/participants are anchored (automatic for diagram.js
specs, hand-tagged for SVG).

---

## doc

**When.** A reviewable freeform document — a decision record, a spec, release
notes, a walkthrough — that's better read and commented on in a browser than
pasted into chat.

**Contains.** Prose and the shared building blocks (callouts, file trees,
annotated code, tables). Structure is up to the document; the shared authoring
bar still holds.

**Start from** `canvas.html`. **Read** the shared authoring bar in
`document-quality.md`.

**Done** when it stands alone and reads cleanly at the pre-handoff check.
