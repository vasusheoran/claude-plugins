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
