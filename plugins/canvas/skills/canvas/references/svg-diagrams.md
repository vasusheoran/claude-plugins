# SVG diagrams

Read before authoring any hand-drawn diagram — for the **diagram** mode and for
architecture sections inside a plan. The div-based `diagram` kit in `plan.css`
(`.row`/`.node`/`.arrow`/`.lane`) is for a mostly-linear chain; reach for inline
SVG when the relationship is genuinely two-dimensional.

## When SVG over the div kit

- **2-D relationships** — a thing points at two others, or two things converge.
- **Lanes / swimlanes** — rows that mean something (client / edge / origin).
- **Fan-in / fan-out** — one node to many, or many to one.
- **Non-adjacent edges** — an arrow that skips a column or loops back.

If it reads as a left-to-right sequence, use the div kit and skip SVG.

## Authoring

- **Inline `<svg>`** in the artifact body, inside a `block`. Set a `viewBox`
  (e.g. `viewBox="0 0 640 360"`) and no fixed width so it scales; let CSS cap it.
- **Tokens, never hex.** Fill and stroke via the CSS variables from `plan.css`:
  `var(--ink)`, `var(--line)`, `var(--line-strong)`, `var(--accent)`,
  `var(--muted)`, `var(--bg-soft)`. Set them as attributes or in a scoped
  `<style>`. A hard-coded `#333` breaks theming — don't.
- **Fonts.** Use `font-family: var(--sans)` (or `var(--mono)` for code labels).

## Layout discipline

- **Grid the coordinates.** Place nodes on a mental grid — columns at 40, 220,
  400, 580; rows at 60, 160, 260. Consistent x/y beats eyeballing.
- **Consistent node size and spacing.** Pick one box size (e.g. 140×56) and reuse
  it; equal gaps between columns and rows.
- **Orthogonal edges.** Prefer straight or right-angled paths (`M … L … L …`)
  over diagonals across the canvas. Route around nodes, not through them.
- **Arrowheads via `<marker>`.** Define one marker in `<defs>` and reference it
  with `marker-end`; don't draw arrowhead triangles by hand per edge.
- **Labels never overlap edges.** Put an edge label on a short offset with a
  small `var(--bg)` backing rect if it must cross a line. Node labels are
  centered `text` inside the node.
- **Readable at 100% zoom.** No text below ~12px. If it doesn't fit, it's too
  dense — split it.
- **One diagram per decision.** Don't cram the whole architecture into one SVG;
  a diagram answers one question.

## Reviewer anchors

Wrap each node in a `<g>` and put the comment-anchor attributes on the group, so
a reviewer's **mark** pin snaps to the whole node, not a child `<rect>`:

```html
<g data-cmt-id="edge-worker" data-cmt-label="Edge worker">…rect + text…</g>
```

- `data-cmt-id` — stable, kebab-case; **never renumber** across edits (same rule
  as `data-block-id`). Anchors survive when you redraw the diagram.
- `data-cmt-label` — optional panel label; omit and the node text is used.

Tag the nodes and edges you expect to be discussed; reviewers can still free-pick
anything.

## Worked example

A 5–8 node service diagram with lanes, one shared arrowhead marker, a tagged
node group, and a labelled edge:

```html
<section class="block" data-block-id="arch" data-block-label="Request path">
  <svg viewBox="0 0 640 320" role="img" aria-label="Request path"
       style="max-width:640px; font-family:var(--sans); font-size:13px">
    <defs>
      <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="var(--line-strong)"/>
      </marker>
    </defs>

    <!-- lane labels -->
    <text x="12" y="52" fill="var(--muted)">client</text>
    <text x="12" y="152" fill="var(--muted)">edge</text>
    <text x="12" y="252" fill="var(--muted)">origin</text>

    <!-- nodes: reuse 140x48 boxes -->
    <g data-cmt-id="browser" data-cmt-label="Browser">
      <rect x="90" y="28" width="140" height="48" rx="8"
            fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="160" y="57" text-anchor="middle" fill="var(--ink)">Browser</text>
    </g>
    <g data-cmt-id="edge-worker" data-cmt-label="Edge worker">
      <rect x="90" y="128" width="140" height="48" rx="8"
            fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="160" y="157" text-anchor="middle" fill="var(--ink)">Edge worker</text>
    </g>
    <g data-cmt-id="cache" data-cmt-label="Cache">
      <rect x="410" y="128" width="140" height="48" rx="8"
            fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="480" y="157" text-anchor="middle" fill="var(--ink)">Cache</text>
    </g>
    <g data-cmt-id="origin" data-cmt-label="Origin API">
      <rect x="90" y="228" width="140" height="48" rx="8"
            fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="160" y="257" text-anchor="middle" fill="var(--ink)">Origin API</text>
    </g>
    <g data-cmt-id="db" data-cmt-label="Database">
      <rect x="410" y="228" width="140" height="48" rx="8"
            fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="480" y="257" text-anchor="middle" fill="var(--ink)">Database</text>
    </g>

    <!-- orthogonal edges via the shared marker -->
    <path d="M160,76 L160,128" fill="none" stroke="var(--line-strong)"
          marker-end="url(#arw)"/>
    <path d="M230,152 L410,152" fill="none" stroke="var(--line-strong)"
          marker-end="url(#arw)"/>
    <path d="M160,176 L160,228" fill="none" stroke="var(--line-strong)"
          marker-end="url(#arw)"/>
    <path d="M230,252 L410,252" fill="none" stroke="var(--line-strong)"
          marker-end="url(#arw)"/>

    <!-- edge label on an offset, with a backing rect so it clears the line -->
    <rect x="270" y="138" width="70" height="18" fill="var(--bg)"/>
    <text x="278" y="151" fill="var(--muted)">miss</text>
  </svg>
  <div class="wf-cap">Request path — cache miss falls through to origin</div>
</section>
```

Same terse realism bar as `wireframe.md`: real node names, no filler, tokens not
hex, one question per diagram.
