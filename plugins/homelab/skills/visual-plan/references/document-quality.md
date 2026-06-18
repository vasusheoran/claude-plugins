# Document quality

The plan is a serious technical document, not marketing. Read this before
writing the body. Adapted from agent-native `/visual-plan`'s document-quality
bar, retargeted at the HTML blocks in `assets/plan.css`.

## Structure

Lead with **outcome**, then approach, then mechanics. A good order:

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
6. **Open questions** — a single block at the **bottom**. Never scatter
   questions through the document.

## Tone

- Specifics over vague prose. No "make it work" placeholder steps.
- No hero copy, value props, or slogans.
- State the positive model directly. Never frame the plan against absent context
  ("unlike the old version", "this revision…") — it must stand alone.
- Preserve the user's level of abstraction. If the idea is a broad framework,
  don't collapse it into the first concrete example — label examples as examples.

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
| Architecture / data flow | `<div class="diagram">` with `.row`, `.node` (`.t` title, `.s` subtitle), `.arrow`, `.lane`/`.lane-title` |
| Files touched | `<div class="file-tree">` with `.add` (new) / `.mod` (changed) spans |
| Code that needs explaining | `<div class="annotated"><pre>…</pre><div class="notes"><div class="note-item"><span class="ln">L3</span> …</div></div></div>` |
| Plain throwaway snippet | `<pre>…</pre>` or inline `<code>` |
| Before/after | `<div class="columns">` with two children, each `.col-title` + content |
| UI screen | `<div class="wf-frame">` — see `references/wireframe.md` |

Reserve `annotated` for code that needs margin notes; use bare `<pre>` for
throwaway snippets. Use `diagram` for two-dimensional relationships, not a
left-to-right chain unless the relationship is genuinely sequential.

## Component-level comments (the "mark" picker)

The top nav carries the whole review UI — **mark · Comments · Submit review** —
so you don't author any comment affordances. Clicking **mark** turns the cursor
into an element picker (inspector-style): hovering highlights whatever element is
under it, and a click anchors a comment to that exact element, outlined like a
Figma/Vercel preview pin. **Any element is pickable** — you don't have to tag
anything.

Tagging is only about anchor stability. Give an element a stable `data-cmt-id`
(+ optional `data-cmt-label`) when you want a comment on it to survive your later
edits to the plan:

```html
<div class="node" data-cmt-id="flow-ratelimit" data-cmt-label="Rate-limit mw">…</div>
<button class="wf-pill" data-cmt-id="signup-submit">Create account</button>
```

- A tagged element anchors as `[data-cmt-id="…"]` — **stable; never renumber it**,
  exactly like `data-block-id`. Picking anywhere inside it snaps the highlight and
  the anchor to the tagged element, so its children never produce brittle paths.
- An **untagged** element anchors by a generated CSS path
  (`[data-block-id="x"] > .row > .node:nth-of-type(3)`). That's convenient but
  brittle: if you edit that part of the plan the path can drift, and the comment
  falls back to listing under its block. So **tag the things you know will be
  discussed** (diagram nodes, wireframe controls, file rows); free-pick the rest.
- `data-cmt-label` (optional) — the label shown in the panel; omit it and the
  element's trimmed text is used.

Composer: each comment is either **Add comment** (a note) or **Submit** (sent to
Claude as an action item). Clicking away closes the composer and keeps whatever
was typed as a draft. A single **Submit review** records approval — `approved`
when no open *Submit*-to-Claude comments remain, else `changes-requested`; the
agent then acknowledges the submission and the nav shows "acknowledged by Claude".
You author none of this UI.

## Open questions (interactive)

Author each genuinely-open decision as an **interactive question block** so the
user answers in the page; answers land in `answers.json` for you to read. Keep
them together near the bottom — don't scatter questions through the document.

```html
<section class="block question" data-block-id="q-store"
         data-block-label="Where should state live?"
         data-question-id="store" data-question-mode="single">
  <h3>Where should plan state live?</h3>
  <div class="qopt" data-value="json">Flat JSON (recommended — simplest)</div>
  <div class="qopt" data-value="sqlite">SQLite (only if we need queries)</div>
</section>
```

- `data-question-mode`: `single` (radio), `multi` (checkbox), or `freeform`
  (a textarea is rendered automatically — omit `.qopt` children).
- `data-question-id` must be unique and stable — answers key off it.
- Put a **recommended default in the option text** so the user can approve by
  silence.
- For complex plans, do a final pass: any undecided architecture, scope, UX,
  data shape, rollout, or ownership question must either be decided in the plan
  (with rationale) or appear as a question block with a recommended default.

The reviewer's **Approve / Request changes** decision (the approval gate) is a
fixed bar injected automatically — you don't author it; you read its result from
`approval.json`.

## Pre-handoff check

Before sharing the URL: open it yourself and confirm no overlapping/clipped
elements, no unreadable diagrams, adequate contrast, and no misleadingly
"active" controls in wireframes. Fix the **shared CSS** if something looks
wrong globally — don't patch one plan's markup.
