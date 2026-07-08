# Design brief: "Canvas" — a local plan-review instrument

> Status: INPUT — paste this whole document into a Claude design session.
> Created 2026-07-09. The deliverable it produces gets ported by hand into
> `plugins/canvas/skills/canvas/assets/plan.css` (+ SVG token usage in `diagram.js`).

## What this is

Canvas is a fully-offline review tool: an AI coding agent authors HTML artifacts —
implementation plans, UI mockups, decision docs, sequence/flow diagrams — into a local
workspace, serves them on localhost, and a single human reviews them in a browser:
commenting, answering inline questions, and approving before the agent writes code.
The audience is one technical person reading serious engineering documents. The page's
job: make a dense technical document effortless to *read*, and make *reviewing* it feel
like operating a precise instrument — not using a SaaS app.

Design the whole visual system: the document vocabulary AND the injected review chrome.
Behavior, DOM structure, and class/attribute names are fixed; you own everything visual.

## Surfaces to design (with every state)

**Document vocabulary** (the artifact content):
- Status banner: `DRAFT — awaiting review` / `APPROVED — shipped 2026-07-08 (commit e3ffdf2)`
- Prose: h1/h2/h3, paragraphs, inline `code`, tables, lists
- Callouts: Decision (settled choice), Risk (+mitigation), Note — each label + body
- Annotated code: dark code pane + right margin-notes column keyed by line (`L3 why this signature`)
- File tree: mono list with `+ added` / `~ modified` markers
- Wireframe kit: browser/app frames, chrome bar, cards, pills (mockups live inside docs)
- Before/after two-column layout
- Interactive question blocks: radio/checkbox/freeform options, one marked
  "(recommended — …)", selected + saved states
- Diagrams: SVG sequence diagrams (participant boxes, dashed lifelines, solid call /
  dashed return arrows, labels) and flowcharts (rect steps, diamond decisions, pill
  start nodes, orthogonal edges with yes/no labels). They inherit the same CSS tokens —
  the palette must make them legible.
- Inline diagram error box (bad spec): states what's wrong, plainly

**Review chrome** (injected by JS, fixed to top):
- Nav bar: workspace tabs on the left (e.g. `plan · ux-mockup · diagram-samples`,
  current highlighted, horizontal overflow), then: **Comment** toggle button,
  **Comments** button with open count, spacer, approval cluster.
- Comment mode — the core interaction. Idle → a one-time subtle nudge until first use →
  **armed** (button active, crosshair cursor, hovering snaps a highlight overlay to the
  target element). This arming moment is the natural home for your signature: the page
  should visibly change temperament — reading vs. reviewing.
- Composer popover, three anchor flavors shown in its header: element (`Architecture ›
  Rate-limit mw`), pinned point (`📍 62%, 31% of Wake flow`), quote (`❝ the approval
  decision stays workspace-wide ❞`). Textarea + two actions: `Add comment` (a note) /
  `Submit` (an action item for Claude).
- Comments panel (slide-in): header `Review · 4 open`, an `all pages` filter toggle,
  threaded items (author, anchor context, body, replies, `Resolve`/`Reopen`), resolved
  items quieted, items from other pages carry a small page tag.
- Open-comment chip on a block: `2 ●`, top-right, quiet; click jumps to the panel.
- Anchored-comment feedback in the document: point pins, quote highlights, a hairline
  outline on commented elements.
- Approval cluster states: nothing yet → `2 for Claude → changes requested` /
  `no open items → approved` hint + `note (optional)` field + `Submit review` →
  `submitted · awaiting Claude…` → `✓ acknowledged by Claude — on it`. That last
  handshake deserves a considered moment; it's the emotional payoff of the loop.

## Hard constraints

- **Fully offline. Zero external requests** — no webfonts, no CDNs, no images. System
  font stacks only (you may build a characterful stack, e.g. distinct display/mono
  treatment, but it must be locally available on macOS).
- Single light theme first; include a dark theme achieved purely by swapping the token
  values below. All colors in the entire system (including SVG diagrams) derive from
  these custom properties — redefine their *values* freely, never hard-code hex in
  components, and keep exactly these names:
  `--ink --muted --line --line-strong --bg --bg-soft --accent --decision --decision-bg
   --risk --risk-bg --note --note-bg --open --resolved --mono --sans`
- Content column ~880px, desktop-first, must hold together at 900px width.
- `prefers-reduced-motion` respected; visible keyboard focus everywhere; the Comment
  toggle is also keyboard-driven (`C` to arm, `Esc` to exit) — show both in the button's
  affordance/title, not as a separate legend.
- The tone of every string is already set (see copy above) — reuse it verbatim; errors
  and empty states direct, never apologize. Empty panel: "No comments yet. Click
  💬 Comment (or press C), then click an element, Alt-click to pin a point, or select
  text to quote it."

## Direction

Quiet, technical, precise — closer to a well-set engineering notebook or an
oscilloscope than to a marketing site or a generic SaaS dashboard. It should feel
inevitable for *this* subject: documents that decide what code gets written. Avoid the
stock AI looks (cream + serif + terracotta; black + acid accent; fake broadsheet).
Spend your boldness once — the moment Comment mode arms — and keep everything else
disciplined. Reading comfort beats density everywhere except the chrome, which should
stay compact and stay out of the document's way.

## Deliverable

One self-contained HTML file (inline CSS/JS, no external requests) that is a living
spec I can port into a real stylesheet:

1. A token sheet at the top: the palette (named swatches + hex for light and dark),
   the type scale with roles/weights, spacing rhythm.
2. Every surface above rendered with realistic content (use this brief's own subject
   matter — the review loop, the plan blocks — as the demo content; no lorem ipsum).
3. All interactive states either live (small inline JS toggles are welcome — e.g. an
   actual working Comment-mode toggle with the highlight overlay) or laid out
   side-by-side and labelled.
4. Both themes visible (toggle or split), reduced-motion handled.

I will translate this into the production stylesheet by hand — so exact values, not
vibes: name every hex, size, weight, and easing you use.
