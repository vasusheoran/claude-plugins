# Canvas v2 — two surfaces (Deck + Board) — implementation spec

Status: IMPLEMENTED 2026-10-11 on branch `feat/canvas-v2` (all 12 plan tasks;
ADR `decisions/2026-10-11-two-surfaces-deck-board.md`). Design APPROVED
2026-10-11 across two review rounds (canvas in this dir; answers in
`answers.json`).
The skill lives at `plugins/canvas/skills/canvas/` in this repo (symlinked as
`~/.claude/skills/canvas`). Asset changes are served live; `server/canvasd.py`
changes need `launchctl kickstart -k gui/$UID/com.claude.canvasd`.
`deck.html` and `board.html` in this dir are the visual reference — the
shipped surfaces should look and behave like them.

## Problem

Canvas artifacts read like essays; deciding means reading. The reviewer's two
jobs — answering and looking — are served by one scrolling document form.

## Approved decisions (from this dir's canvas)

1. **Taxonomy: replace.** The five modes collapse into three surfaces:
   **Deck** (replaces plan + decide; plan = gated deck), **Board** (replaces
   mockup + diagram), **doc** (unchanged, stays budgeted).
2. **Lean shown.** Claude's pick is visible on option cards (badge) with an
   "accept remaining picks" action. This supersedes the neutral-options rule.
3. **Deck focus: stepper.** One decision expanded; answered collapse to ✓
   rows (click to reopen); upcoming dimmed. Progress rail on top.
4. **Board pins.** Comments on the Board are x/y pins, Figma-style.

Settled (from the canvas, reopen only via Vasu): Sep-5 decision-first spec is
absorbed, not pre-implemented; zero dependencies stays (stdlib Python +
vanilla JS); thumbnails are hand-drawn minis v1 (iframe snapshots later);
public packaging is a later phase. Palette already shipped 2026-10-11:
**monochrome, both themes** — pure-white page (`--bg #ffffff`,
`--bg-soft #f1f2f4`) and every hue token (accent/decision/risk/note/open)
collapsed to the ink/grey ladder; callouts differ by grey depth, review state
by ink vs `--resolved` grey. Components still never hard-code hex.

## 1. Deck

**Markup contract: unchanged.** A deck decision is today's
`section.block.question` (same `data-question-id` / `data-question-mode` /
`.qopt[data-value]`; answers land in `answers.json`; synthetic Other/You-decide
rows keep working). Deck is a presentation+behavior layer, not a new data
model. New optional authoring inside a `.qopt`:

```html
<div class="qopt opt" data-value="settings" data-lean>
  <div class="thumb"><!-- mini wireframe / svg / img --></div>
  <a class="goboard" href="board.html#frame-b">⤢ Board</a>
  <div class="meta"><div class="t">Inside Settings</div>
    <div class="d">Zero nav cost; two taps deep.</div></div>
</div>
```

- `data-lean` marks Claude's pick (exactly one per single-mode question; the
  badge renders from it — never write "recommended" in option text).
  "You decide" = accept the visible lean; semantics of `__defer__` unchanged.
- Questions without `.opt` children render as today (plain rows, freeform
  textarea) inside the same stepper card.

**deck.js (new shared asset, loaded after comments.js):** activates on
`body[data-canvas-kind="deck"]`. Behavior, exactly as in `deck.html`:
stepper focus (current / answered-✓-row / upcoming-dim), progress rail
(auto-built from the question blocks, injected after the verdict block),
keyboard 1–9 picks on the focused card, click ✓ row to reopen, "accept
remaining picks" button, all-answered state lights the existing Send-to-Claude
bar. Selection writes through the existing answer-saving path in comments.js —
do not duplicate persistence.

**Page anatomy** (template order): banner → h1 → verdict strip → rail
(injected) → decision cards → settled rows → ask. Gated decks keep the
approval UI; `data-canvas-kind="deck"` + absence of `data-approval="off"`
defines a plan-deck.

**Components → plan.css** (names from the reference pages): `.verdict`/`.chip`,
`.dk` states, `.opts`/`.opt`/`.thumb`/`.meta`/`.lean-badge`, `.rail`,
`.settled`, and the `.mini` wireframe kit. Port from `deck.html`/`plan.html`
inline styles; tokens only, verify dark theme by eye.

**Budgets (absorbed from Sep-5):** visible-word meter in comments.js — deck
200, doc 600, board exempt; `data-budget-words` overrides; count = words in
`<main>` visible by default (details reduced to summary; `.opt .meta` text
counts, it's the card's words). Meter is a corner chip, never blocks.
Comment-jump auto-expands ancestor `<details>` (Sep-5 §3).

## 2. Board

**board.js (new shared asset):** activates on
`body[data-canvas-kind="board"]`. Port from `board.html`: viewport+world
pan/zoom (drag, wheel-to-cursor, Fit/100%/±, zoom % readout), dotted ground,
zoom-to-fit on load, deep link `#<frame-id>` zooms to and highlights that
frame. Frames are author-positioned absolutely in `#world` with
`data-frame-id` (doubles as the comment anchor id). Frame innards are plain
HTML/SVG — the `.mini`/phone kit, diagram.js output, stickies all welcome.

**Pins = comments with coordinates.** Extend the comment record with optional
`pin: {frameId, x, y}` (world coords). comments.js/board.js: on a board,
Comment mode (C) switches to crosshair — click drops a pin and opens the
existing comment composer; pins render from comments.json on load, colored by
state (open amber / resolved grey), click toggles the thread popover; pins
pan/zoom with the world. Pins ride the existing pending→sent→resolved
lifecycle and the Send-to-Claude bundle untouched. canvasd stores comment
objects as-is — if it strips unknown fields, the minimal schema change is
allowed this round (unlike Sep-5, daemon edits are permitted; restart after).

**Board template** (`assets/board.html`): toolbar + hint + viewport/world +
one commented-out example frame; `data-approval="off"`,
`data-canvas-kind="board"`.

## 2b. Review chrome & interaction loop (approved 2026-10-11, second round)

Visual reference: `nav.html` and `interaction.html` in this dir. Approved:
nav-desktop = **bottom-everywhere**; nav-mobile deferred → Claude's lean
**two-bar** applies; presence = **three-state**, change markers =
**page-dots**, finish prompt = **yes** (all three explicitly confirmed in
the 2026-10-11 03:53 re-approval).

**Nav (comments.js rewrite of renderNav): identical chrome at every width.**
- Slim top bar: current page title + a **Pages ▾** chip (badge-dot when any
  other page has open comments or changes). Tapping opens the pages sheet:
  one row per page — kind, full title, open-comment badge, changed-dot.
- Bottom action bar (thumb zone, 40px+ targets, safe-area inset):
  💬 Comment · Comments(n) · 🔔 · presence chip · **Send** (primary,
  rightmost, count badge). Replaces today's single top row everywhere.
- All panels (comments panel, activity feed, send popover, pages list)
  become bottom sheets — same component at every width, max-width ~520px
  centered on large screens, drag-down or scrim-tap to dismiss.
- The long latest-activity sentence leaves the bar; it lives in the 🔔 feed.
- Touch comment mode: long-press an element = C-then-click; selection
  quoting unchanged.
- Approval badge (gated pages) moves into the Send sheet header.

**Presence chip** — honest state from the daemon, which knows whether a
`canvas_wait` is currently blocking on this workspace:
- `● Claude is listening` (pulse) — a wait is open.
- `✍ Applying your feedback` — submission picked up (auto-ack) but no
  substantive ack yet.
- `○ Away · last seen HH:MM` — no wait open; Send still queues.
canvasd: track open waits per workspace + last-wait-closed timestamp; expose
in the state payload. No new protocol for the client beyond reading it.

**Changed-dots** — per-page "edited since you last looked": the server
already appends `page-updated` activity events (with the changed page list)
when page digests change — no new daemon mechanism. Client stores
last-visited time per page in localStorage; dot renders where a
`page-updated` event for that page postdates the visit, clears on visit. Claude-side contract (SKILL.md): after
an edit round, the ack names the pages touched — dots show *where*, ack says
*what*.

**Deck finish prompt** — when the last open question on a deck gets a
non-empty answer, show the send sheet pre-filled ("All N answered · M
comments ride along"); "Keep reviewing" dismisses; never auto-send, never
re-prompt after dismiss (per page-load).

**LAN hosting — already shipped 2026-10-11.** launchd agent reinstalled with
`--host 0.0.0.0` (the daemon already supported it + advertises the LAN IP in
returned URLs). No auth — trusted home LAN only. SKILL.md setup section
documents the `--host 0.0.0.0` install variant and the caveat.

## 3. Templates & seeding

- `assets/template.html` (seeded by `canvas_open mode:"plan"`): becomes the
  gated-deck skeleton — banner → h1 → verdict slot → one example visual-option
  question card → settled block → ask block, with HTML comments naming each
  slot. `data-canvas-kind="deck"`.
- `assets/canvas.html`: stays the doc scaffold; its header comment now lists
  deck/board/doc and when to copy `board.html` instead.
- canvasd page-kind detection: map `data-canvas-kind` deck/board/doc for the
  tab strip (accept legacy kinds from old workspaces; don't break them —
  old pages keep rendering as plain docs with comments working).

## 4. References & SKILL.md

- `references/modes.md`: rewrite around three surfaces (+legacy note). Deck =
  answering surface (gate optional), Board = looking surface, doc = reading
  surface with 600 budget. Mode table gains Budget column (deck 200 / doc 600
  / board —).
- `references/document-quality.md`: plan-mode structure → deck anatomy;
  question-block section gains the visual-option markup + `data-lean` rule
  (replace the options-render-neutral rule with: lean is machine-marked via
  `data-lean`, never prose); keep blocks/anchors/comment-mode rules.
- `references/wireframe.md`: add the `.mini` kit and board-frame authoring.
- `SKILL.md`: modes table → surfaces table; authoring section mentions deck
  contract, board frames/pins, meter. Keep current length.

## 5. Tests

Follow existing suites' style; all four current suites stay green.

- `tests/test_deck.js` (node, jsdom-free DOM stub like test_comments.js):
  stepper state transitions, rail counts, keyboard pick, accept-remaining
  picks only unanswered, reopen resets state, lean badge renders only with
  `data-lean`, answers persist through the existing save path (spy).
- `tests/test_board.js`: zoom-at-cursor math (pure functions — export them),
  fit bounds, deep-link transform, pin world→screen mapping, pin lifecycle
  class from comment state.
- `tests/test_comments.js` additions: meter counting rules + kinds (Sep-5 §6),
  ancestor-details auto-expand, pin field round-trip; nav v2 — pages-sheet
  rows (badge/changed-dot logic from mtime vs stored last-visit), presence
  chip state from the daemon payload, finish-prompt fires once per load only
  when the last question is answered.
- `tests/test_canvasd.py`: kind detection for deck/board; comment POST
  preserves `pin`; pages payload carries mtimes; wait-tracking flag flips
  with an open/closed canvas_wait.

## 6. Acceptance

- Seed a fresh `mode:"plan"` workspace: gated deck skeleton with green meter;
  pick options by keyboard; Send to Claude bundles answers+approval.
- Copy board template, add two frames: pan/zoom/fit work; drop a pin, send it,
  resolve it from the MCP side; pin greys out.
- This dir's three pages still render correctly (they keep their inline
  styles; no dependency on the new classes).
- Old workspaces (Sep-5 dir, any `plan.html` with legacy kinds) still load,
  comment, and approve.

## Out of scope (explicitly)

Iframe-snapshot thumbnails, board frame drag-rearranging by the reviewer,
multi-canvas "decision inbox", public packaging/install docs, dark-mode
palette changes.
