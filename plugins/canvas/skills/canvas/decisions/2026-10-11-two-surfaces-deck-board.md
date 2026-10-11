# 2026-10-11 — Canvas v2: two surfaces (Deck + Board)

Status: shipped. Design canvas + spec + implementation plan:
`plans/2026-10-11-canvas-two-surfaces/` (approved across two review rounds,
2026-10-11). Supersedes the five-mode model; absorbs the unimplemented
2026-09-05 decision-first spec.

The canvas became a reading surface when its job is deciding. v2 splits it by
what the reviewer is doing — answering or looking.

Decisions that shaped the change, and why:

- **Three surfaces replace five modes.** Deck (answering), Board (looking),
  doc (reading). plan and decide collapse into Deck; a plan is a gated Deck.
  mockup and diagram collapse into Board. The old kinds still render for
  legacy workspaces (kind detection accepts them; deck.js/board.js activate
  only on `data-canvas-kind` deck/board), so existing canvases keep working
  without conversion.

- **Deck presents, it does not re-model.** A Deck decision is the existing
  `section.block.question` with its `data-question-id` / `.qopt` contract;
  answers still land in `answers.json` through the same path. deck.js adds a
  stepper over that markup — one decision in focus, answered ones collapse to
  a ✓ row, upcoming ones dim — plus a progress rail and keyboard 1–9 picks.
  No new persistence.

- **Claude's pick is shown, marked by `data-lean`.** One `.qopt[data-lean]`
  per single-choice question renders a "Claude's pick" badge; an "accept the
  rest" button fills unanswered decisions with their leans. This reverses the
  2026-07-26 neutral-options rule: the lean is now machine-marked, never
  written into option prose, and "◇ You decide" accepts the visible pick.

- **Board is a transformed world, pins are comments with coordinates.**
  Frames are absolutely-positioned `data-frame-id` elements in `#world`;
  board.js gives pan, wheel-zoom-at-cursor, fit, and `#frame-id` deep links
  (the Deck's option thumbnails link into them). A pin is an ordinary comment
  with `pin: {frameId, x, y}` (world coordinates) — it rides the existing
  pending→sent→resolved lifecycle and the Send-to-Claude bundle. This brings
  back the point pins the 2026-07-26 ADR removed, now scoped to the Board.
  The pin composer floats fixed-centered rather than nesting in the scaled
  world, so it never clips.

- **Presence is read from the wait, not a new signal.** `canvas_wait` tracks
  its own open count; `/api/version` exposes `{waits, lastClosedAt}`. The
  chrome shows listening / applying / away from that — an honest state the
  daemon already knew.

- **Changed-dots reuse the activity feed.** The server already appends
  `page-updated` events on digest change. The client stamps a per-page
  last-visited time in localStorage and dots any page whose update postdates
  the visit. localStorage access is wrapped — private mode degrades to no
  dots, never an error.

- **Nav moves to a bottom action bar at every width.** A slim top bar holds
  the page title and a Pages control; the action bar (Comment, Comments,
  activity, presence, Send) sits in the thumb zone. Panels are bottom sheets
  on narrow screens; on desktop the Pages control opens as a dropdown under
  its chip. A Deck fires a one-shot Send prompt when its last question is
  answered.

- **Monochrome on white; LAN-reachable.** The palette collapsed to an
  ink/grey ladder on a white page (both themes). The daemon binds `0.0.0.0`
  via `--host` so another device on the home LAN can review — no auth, so
  trusted networks only.
