# Wireframe quality

Read before authoring any UI screen. Adapted from agent-native `/visual-plan`'s
wireframe bar, retargeted at hand-authored HTML/CSS using the `wf-*` classes in
`assets/plan.css`. Author wireframes only for UI/product plans — skip them for
architecture, backend, data, or copy-only plans.

## Realism

- **Real product content** — actual labels, plausible counts and dates. No lorem
  ipsum, no "Button 1".
- **Match the real app.** If the plan touches an existing UI, inspect the current
  shell/components first and reproduce its chrome at the same density — sidebars,
  toolbars, overflow menus in their real places. Don't invent a permanent
  inspector panel; model secondary surfaces (popover, sheet, side panel, loading,
  error) as separate frames.
- **Fill the frame top-to-bottom** with realistic content; avoid large empty
  bands.

## Layout

- Compose with inline `flex`/`grid`. Give rows meaningful padding (≥14px) and
  gaps so nothing sits flush against borders.
- Use `class="wf-spacer"` (flex:1) in chrome bars to push trailing actions to the
  edge. Span chrome bars full-width; don't center them.
- Pin a bottom bar by letting the scrolling body take `flex:1` and making the bar
  the last child of the frame.
- Use `white-space: nowrap` on rows meant to stay single-line.

## Use the tokens and helpers

- Colors via the CSS variables (`--ink`, `--line`, `--accent`, `--muted`, …) —
  **never hard-code hex**, so themes stay consistent.
- Helper classes: `.wf-frame` (`.browser` / `.app` adds a chrome strip),
  `.wf-chrome`, `.wf-body`, `.wf-card`, `.wf-pill`, `.wf-muted`, `.wf-spacer`,
  `.wf-cap` (caption under a frame).
- Reviewers can comment on any control via the **mark** picker, but give the
  controls you expect to be discussed a stable `data-cmt-id`
  (+ optional `data-cmt-label`) so their comments survive your edits — see
  `document-quality.md` › Component-level comments. Keep the id stable across
  revisions.
- No decorative drop shadows or fake depth — separate with spacing, borders, and
  labels.

## Keep screens clean

- A wireframe is the **product screen only**. Don't embed architecture notes,
  arrows, data contracts, or callout prose inside the screen. Put those in the
  document body or a separate `diagram` block.
- Don't show desktop *and* mobile unless responsive behavior actually differs.

## Before/after

- Wrap two `wf-frame`s in a `columns` block; label each via `.col-title` in the
  column header, never inside the frame HTML.
- Keep identical frame sizing, padding, and density across both states unless the
  change itself alters them. Preserve unchanged controls in both so the delta is
  obvious, and place new affordances where the implementation will actually put
  them.

## Example

```html
<div class="wf-frame app">
  <div class="wf-chrome">
    <strong>Inbox</strong>
    <span class="wf-spacer"></span>
    <span class="wf-pill">Filter</span>
    <span class="wf-pill">+ New</span>
  </div>
  <div class="wf-body">
    <div class="wf-card">
      <strong>Acme Inc</strong> · <span class="wf-muted">2 hours ago</span>
      <div class="wf-muted">Renewal due — 3 open items</div>
    </div>
  </div>
</div>
<div class="wf-cap">Inbox, default state</div>
```
