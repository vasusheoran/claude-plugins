# Document quality

Every canvas artifact is a serious technical document, not marketing. Read this
before writing any body. The first section is the **shared authoring bar** that
applies to every mode (plan, mockup, decide, diagram, doc); the last section is
the **plan-mode structure** that applies only to plan artifacts.

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
| UI screen | `<div class="wf-frame">` — see `references/wireframe.md` |

Reserve `annotated` for code that needs margin notes; use bare `<pre>` for
throwaway snippets. Use `diagram` for two-dimensional relationships, not a
left-to-right chain unless the relationship is genuinely sequential.

Inline `<style>`/`<script>` are allowed for a page's own styling and behavior
(clickable states, variant toggles, prototype logic). Two invariants hold on
every artifact: keep `comments.js` loaded, and don't remove or renumber elements
that carry `data-block-id`/`data-cmt-id` — your JS must not destroy them or their
comments detach.

## Component-level comments (Comment mode)

The top nav carries the whole review UI, and there are two ways to anchor a
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
  land on diagrams, wireframes, and other non-text elements.

With Comment mode **off** and no text selected, the review UI touches no
artifact events at all — which is why interactive mockups are safe to click
through without triggering the picker. A block with open comments shows a
small clickable **count chip** (top-right) that jumps to its thread in the
panel; that's display/navigation, not a creation affordance. If a prototype
needs the **C** key for its own behavior, opt out with
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
  be discussed** (diagram nodes, wireframe controls, file rows); free-pick the
  rest.
- `data-cmt-label` (optional) — the label shown in the panel; omit it and the
  element's trimmed text is used.

Composer: a single **Add** action drops the comment into the panel as a
**pending** draft, with edit and delete controls — nothing reaches Claude yet.
The reviewer repeats this for as many comments as they want, in any order,
editing or deleting drafts freely. Pressing **Send to Claude (N)** in the nav
opens a popover that bundles the pending comments, the question answers, and
— on gated pages — an approve / request-changes decision, and submits all of
it as one event. The comment then moves from pending to sent, and its status
chip (Pending → Sent → Seen → Replied / Resolved) tracks what Claude has done
with it. You author none of this UI.

## Interactive question blocks

Author each genuinely-open decision as an **interactive question block** so the
user answers in the page; answers land in `answers.json` for you to read. In a
**decide** artifact these are the primary surface; in a **plan** they collect
near the bottom (see Open questions). Don't scatter questions through a document.

```html
<section class="block question" data-block-id="q-store"
         data-block-label="Where should state live?"
         data-question-id="store" data-question-mode="single">
  <h3>Where should state live?</h3>
  <p>Flat JSON is simplest and matches what the rest of the code already does;
     SQLite only earns its keep once we need queries.</p>
  <div class="qopt" data-value="json">Flat JSON</div>
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

Clicking a selected option again unselects it (`value: null` = open again).

- `data-question-mode`: `single` (radio), `multi` (checkbox), or `freeform`
  (a textarea is rendered automatically — omit `.qopt` children).
- `data-question-id` must be unique and stable — answers key off it.
- **Options render neutral.** Don't write "(recommended)" or any other lean
  into option text — the You-decide row never reveals which way Claude would
  go, and an option that editorializes undermines that. Put the argument for
  a default in the prose above the options instead.

## Tone

- Specifics over vague prose. No "make it work" placeholder steps.
- No hero copy, value props, or slogans.
- State the positive model directly. Never frame the artifact against absent
  context ("unlike the old version", "this revision…") — it must stand alone.
- Preserve the user's level of abstraction. If the idea is a broad framework,
  don't collapse it into the first concrete example — label examples as examples.

## Pre-handoff check

Before sharing the URL: open it yourself and confirm no overlapping/clipped
elements, no unreadable diagrams, adequate contrast, and no misleadingly
"active" controls in wireframes. Fix the **shared CSS** if something looks wrong
globally — don't patch one artifact's markup.

---

# Plan-mode structure

Applies to **plan** artifacts only. Lead with **outcome**, then approach, then
mechanics. A good order:

1. **Outcome & scope** — what "done" means, who it's for, the smallest first
   cut. State in-scope *and* explicit non-goals.
2. **Approach** — lead with reuse (existing files/symbols), then the new delta.
   Put settled choices in a `callout decision`.
3. **Architecture** — only if relationships need a spatial explanation. One
   diagram per decision; prefer grouped regions / layers / before-after panels
   over a single left-to-right chain.
4. **Key changes** — file tree + annotated code for the genuinely new/changed
   parts. Don't exhaustively list every file.
5. **Risks & verification** — `callout risk` for what could go wrong + an
   end-to-end check that exercises the real workflow, not just unit tests.
6. **Open questions** — a single block at the **bottom**, built from interactive
   question blocks (above). Never scatter questions through the plan.

For complex plans, do a final pass: any undecided architecture, scope, UX, data
shape, rollout, or ownership question must either be decided in the plan (with
rationale) or appear as a question block with a recommended default.

The reviewer's **Approve / Request changes** decision (the approval gate) is a
fixed bar injected automatically — you don't author it; you read its result from
`approval.json`. It applies to plan-mode pages (and any artifact where you drop
`data-approval="off"`); non-gated artifacts declare `<body data-approval="off">`.
