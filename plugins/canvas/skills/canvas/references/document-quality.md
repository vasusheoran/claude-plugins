# Document quality

Every canvas artifact is a serious technical document, not marketing. Read this
before writing any body. The first section is the **shared authoring bar** that
applies to every surface (Deck, Board, doc); the last section is the
**deck anatomy** that applies to a gated plan deck.

---

# Shared authoring bar

## Blocks (classes in plan.css)

Every reviewable section is wrapped so it can be commented on:

```html
<section class="block" data-block-id="approach" data-block-label="Approach">
  ...
</section>
```

- `data-block-id` — unique, stable, kebab-case. **Never renumber on edits** —
  comments anchor to it.
- `data-block-label` — human label shown in the comment panel.

Building blocks:

| Need | Markup |
|------|--------|
| Settled choice | `<div class="callout decision"><span class="label">Decision</span> …</div>` |
| Risk / warning | `<div class="callout risk"><span class="label">Risk</span> …</div>` |
| Side note | `<div class="callout note"><span class="label">Note</span> …</div>` |
| Architecture / data flow / sequence | Pick the form from the chooser in `references/svg-diagrams.md` — `diagram.js` spec (sequence/flow), hand SVG (freeform), or the `<div class="diagram">` kit (`.row`, `.node` with `.t`/`.s`, `.arrow`, `.lane`/`.lane-title`) for a linear chain |
| Files touched | `<div class="file-tree">` with `.add` (new) / `.mod` (changed) spans |
| Code that needs explaining | `<div class="annotated"><pre>…</pre><div class="notes"><div class="note-item"><span class="ln">L3</span> …</div></div></div>` |
| Plain throwaway snippet | `<pre>…</pre>` or inline `<code>` |
| Before/after | `<div class="columns">` with two children, each `.col-title` + content |
| UI screen | `<div class="wf-frame">` — see `references/wireframe.md`, or a Board frame |

Reserve `annotated` for code that needs margin notes; use bare `<pre>` for
throwaway snippets. Use `diagram` for two-dimensional relationships, not a
left-to-right chain unless the relationship is genuinely sequential.

Inline `<style>`/`<script>` are allowed for a page's own styling and behavior
(clickable states, variant toggles, prototype logic). Two invariants hold on
every artifact: keep `comments.js` loaded, and don't remove or renumber elements
that carry `data-block-id`/`data-cmt-id` — your JS must not destroy them or their
comments detach.

## Component-level comments (Comment mode)

The nav carries the whole review UI, and there are two ways to anchor a
comment — you author no comment affordances either way.

- **Select text → quote.** Selecting three or more characters inside a block
  pops a small floating **💬 Comment** bubble next to the selection (the
  Google Docs pattern); clicking it opens the composer. No mode to enter —
  this works anywhere prose lives. A page whose own interaction depends on
  text selection can opt out with `<body data-select-comment="off">`.
- **Comment mode → click an element.** The reviewer enters it with the nav
  **💬 Comment** button or by pressing **C**; **Esc** exits. The mode is
  **sticky** — it stays on until Esc, so a reviewer can drop several comments
  in a row. While it's on, the cursor is an inspector-style picker; clicking
  an element anchors to it (snaps to the nearest `data-cmt-id`, else a
  generated path), outlined like a Figma/Vercel pin. This is how comments
  land on diagrams, wireframes, Board frames, and other non-text elements. On
  a Board, Comment mode drops an x/y pin instead (`references/modes.md`).

With Comment mode **off** and no text selected, the review UI touches no
artifact events at all — which is why interactive mockups and boards are safe
to click through without triggering the picker. A block with open comments
shows a small clickable **count chip** (top-right) that jumps to its thread in
the panel; that's display/navigation, not a creation affordance. If a
prototype needs the **C** key for its own behavior, opt out with
`<body data-comment-key="off">` (the nav button still works).

**Any element is pickable** — you don't have to tag anything. Tagging is only
about anchor stability. Give an element a stable `data-cmt-id` (+ optional
`data-cmt-label`) when you want a comment on it to survive your later edits:

```html
<div class="node" data-cmt-id="flow-ratelimit" data-cmt-label="Rate-limit mw">…</div>
<button class="wf-pill" data-cmt-id="signup-submit">Create account</button>
```

- A tagged element anchors as `[data-cmt-id="…"]` — **stable; never renumber it**,
  exactly like `data-block-id`. Picking anywhere inside it snaps the highlight and
  the anchor to the tagged element, so its children never produce brittle paths.
- An **untagged** element anchors by a generated CSS path
  (`[data-block-id="x"] > .row > .node:nth-of-type(3)`). That's convenient but
  brittle: if you edit that part of the artifact the path can drift, and the
  comment falls back to listing under its block. So **tag the things you know will
  be discussed** (diagram nodes, wireframe controls, file rows, board frames); free-pick the
  rest.
- `data-cmt-label` (optional) — the label shown in the panel; omit it and the
  element's trimmed text is used.

Composer: a single **Add** action drops the comment into the panel as a
**pending** draft, with edit and delete controls — nothing reaches Claude yet.
The reviewer repeats this for as many comments as they want, in any order,
editing or deleting drafts freely. Pressing **Send to Claude (N)** in the nav
opens a sheet that bundles the pending comments, the question answers, and —
on gated pages — an approve / request-changes decision, and submits all of it
as one event. The comment then moves from pending to sent, and its status
chip (Pending → Sent → Seen → Replied / Resolved) tracks what Claude has done
with it. You author none of this UI.

## Interactive question blocks

Author each genuinely-open decision as an **interactive question block** so the
user answers in the page; answers land in `answers.json` for you to read.
Question blocks are the Deck's primary surface — don't scatter them through a
document.

```html
<section class="block question" data-block-id="q-store"
         data-block-label="Where should state live?"
         data-question-id="store" data-question-mode="single">
  <h3>Where should state live?</h3>
  <p>Flat JSON matches what the rest of the code already does; SQLite earns
     its keep once queries are needed.</p>
  <div class="qopt" data-value="json" data-lean>Flat JSON</div>
  <div class="qopt" data-value="sqlite">SQLite</div>
</section>
```

The widget adds two synthetic rows to every choice question automatically —
never author them yourself:

- **✎ Other…** — expands an inline textarea; saving stores the typed text as
  the answer (`value: "__other__"` plus an `otherText` field in
  `answers.json`).
- **◇ You decide, Claude** — the existing `"__defer__"` behavior. Claude
  applies its own recommendation when reading answers.

Every question block states what it costs to undo, in the first sentences
of its prose (see "Decision first").

Clicking a selected option again unselects it (`value: null` = open again).

- `data-question-mode`: `single` (radio), `multi` (checkbox), or `freeform`
  (a textarea is rendered automatically — omit `.qopt` children).
- `data-question-id` must be unique and stable — answers key off it.
- **The lean is machine-marked, not written.** Add the bare `data-lean`
  attribute to exactly one `.qopt` on a single-choice question to mark
  Claude's pick; the badge renders from the attribute. Never write
  "(recommended)" or any other lean into option text — "You decide" means
  accepting the visible `data-lean` pick, and an option that editorializes in
  prose undermines that contract.

**Visual options.** An option that benefits from a side-by-side compare — a
layout choice, a placement choice — can carry a thumbnail and a longer
description instead of plain text:

```html
<div class="qopt opt" data-value="settings" data-lean>
  <div class="thumb"><!-- mini wireframe, inline SVG, or img --></div>
  <a class="goboard" href="board.html#frame-b">⤢ Board</a>
  <div class="meta">
    <div class="t">Inside Settings</div>
    <div class="d">Zero nav cost; two taps deep.</div>
  </div>
</div>
```

`.thumb` is optional — a hand-drawn mini-wireframe per `references/wireframe.md`
— as is the `.goboard` deep link into a companion Board page. `.meta .t`/`.d`
text counts toward the word budget like any other card content.

## Decision first

The first screen of every artifact is the decision card, before any
background. It holds three things: the question being decided, Claude's pick,
and what it costs to undo. Write the undo cost in plain words, one line, on
every decision card: "easy to undo later" for a two-way door, "hard to undo
once X ships" for a one-way door, naming X.

## Pick the medium

Choose the visual by what the reviewer has to understand, then build it so
they can comment on a part of it.

| The reviewer must understand | Use | Notes |
|------------------------------|-----|-------|
| How parts connect (structure) | Diagram | `references/svg-diagrams.md` |
| Something that happens over time | Stepped animation in SVG/CSS with step and play controls | Give each step its own stable `data-cmt-id` so a comment lands on one step |
| A tradeoff with a knob | Interactive: a slider or toggle that recomputes the outcome | Show the result next to the control |
| A decision that a number settles | Chart from real data | Cite the query or file the numbers came from, on the chart |
| A UI change | Before/after pair, or Board frames | `references/wireframe.md` |

No video files. Animated SVG/CSS steps do the same job, stay commentable, and
need no encoding. If prose is the only visual on a decision card, the card is
not done.

## Tone

- Plain words. Use the user's words. Define any other term in place the first
  time it appears, or replace it. Expand abbreviations. Read each card as if
  opening it cold, with no chat history: "each run is a full session up to the
  plan gate" means nothing to someone who never used "session" or "plan gate".
- Specifics over vague prose. No "make it work" placeholder steps.
- No hero copy, value props, or slogans.
- State the positive model directly. Never frame the artifact against absent
  context ("unlike the old version", "this revision…") — it must stand alone.
- Preserve the user's level of abstraction. If the idea is a broad framework,
  don't collapse it into the first concrete example — label examples as examples.

## Budgets

Deck 200 visible words, doc 600, Board exempt. `data-budget-words` on
`<body>` overrides the default for a specific page. The count is words in
`<main>` as rendered by default: a collapsed `<details>` counts only its
`<summary>` text, so detail hidden behind a toggle is budget-free. The meter
is a corner chip and never blocks saving or sending — it's a signal, not a
gate.

## Pre-handoff check

Before sharing the URL: open it yourself and confirm no overlapping/clipped
elements, no unreadable diagrams, adequate contrast, and no misleadingly
"active" controls in wireframes or board frames. The word meter reads green,
or you can say why it doesn't in chat. Fix the **shared CSS** if something
looks wrong globally — don't patch one artifact's markup.

---

# Deck anatomy

Applies to a **gated** Deck (plan = gated deck). It is **two pages**: a
one-screen gated `plan.html` carrying the decisions, and an ungated
`details.html` carrying the design that justifies them. The reviewer's job on
`plan.html` is answer-and-approve; reading everything is opt-in via the
Details tab.

## plan.html — the gated page (decisions)

Budget: one 1080p screen when possible; past ~2 screens, content moves to
`details.html`. Question blocks count toward the budget — prose doesn't get to
crowd them out. The page is, in order:

1. **Banner** — status, date, and a link to the details page:
   `<span>Full design: <a href="details.html">Details</a> tab</span>`.
2. **Title** — names the ask: "X — 3 decisions, then I build".
3. **Verdict strip** — one compact summary line or table: what's being built,
   the genuinely new part, how it ends.
4. **Decision cards** — every open decision, numbered, near the top, as
   question blocks; the lean sits on the picked `.qopt` via `data-lean`, with
   the argument for it in the card's prose. This is the page's payload — never
   park it at the bottom.
5. **Settled rows** — choices already made and not reopened, rendered as
   `callout decision` rows rather than question blocks, so the reviewer sees
   what's fixed versus what's still open.
6. **Ask block** — one short block: what approval unblocks — files/areas
   touched, anything needed from the reviewer, how the work runs.

That's the whole page. Architecture, diagrams, file trees, annotated code,
config/rule sketches, risk registers, and rollout plans render on
`details.html`, not here. A risk that argues a decision card's lean is one
sentence in that card's prose; the register stays in details.

## details.html — the ungated page (supporting design)

Copy `assets/canvas.html` → `details.html` — it already carries
`data-canvas-kind="doc"` and `data-approval="off"`. Its banner points back:
"SUPPORTING DETAIL — decisions live on the Plan tab". Order: **outcome &
scope** (done-means, non-goals) → **approach** (lead with reuse, settled
choices in `callout decision`) → **architecture** (one diagram per decision) →
**key changes** (file tree + annotated code) → **rollout & verification**
(end-to-end check, not just unit tests) → **risks** (`callout risk`). Comments
left here land in the same **Send to Claude** bundle as plan.html's.

A deck whose entire supporting design fits inside the one-screen budget can
stay a single `plan.html` — the split protects the decisions, it isn't
ceremony.

For complex plans, do a final pass: any undecided architecture, scope, UX,
data shape, rollout, or ownership question is either decided in
`details.html` (with rationale) or a decision card on `plan.html` with the
lean marked via `data-lean` — and `plan.html` still fits the budget.

The reviewer's **Approve / Request changes** decision (the approval gate) is a
fixed bar injected automatically — you don't author it; you read its result from
`approval.json`. It renders on `plan.html` only: `details.html` and other
non-gated artifacts declare `<body data-approval="off">`.
