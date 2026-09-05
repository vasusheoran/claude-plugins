# Canvas decision-first — implementation spec

Status: APPROVED 2026-09-05 (canvas in this dir; answers in `answers.json`).
Implement in a fresh session. No daemon (`server/canvasd.py`) changes.
The skill lives at `plugins/canvas/skills/canvas/` in this repo (symlinked as
`~/.claude/skills/canvas`). After asset changes: restart not needed (assets are
served live); after test additions run them.

## Problem being solved

Canvas artifacts became essays in HTML: recent gated plan pages run 600–1,400
words of paragraph prose with the questions buried at the bottom. The skill's
"one 1080p screen" rule is unmeasured, visual forms are opt-in, and context is
interleaved with decisions. Goal: pages that get answers, where reading is
opt-in per decision.

## Approved decisions

1. Visible-word budget for plan/decide pages: **200**.
2. `details.html` **stays**, demoted to overflow for genuinely deep design
   (diagrams, annotated code, file trees). Most plans become single-page.
3. doc mode budgeted at **600** visible words. diagram: 100. mockup: exempt.
4. Enforcement is a **visible meter, never a blocker** (user chose meter over
   lint gate).
5. Scope: **all five modes**.

## 1. Components → `assets/plan.css`

Promote the four components prototyped in `proto.css` (this dir) into the
shared `plan.css`, keeping the prototype class names (`.verdict`, `.chip`,
`.dcard`, `.lean`, `details.why`, `.settled`, `.delta`) minus the file's
"proto" framing comment. Match plan.css's existing token usage — the prototype
already uses only existing custom properties; verify dark theme by eye on both
pages in this dir.

- `.verdict` — chip row replacing the summary paragraph. Chips are
  label-over-value; `.chip.accent` marks the fix/decision chip.
- `.dcard` — a modifier on `section.block.question`: adds border, the `.lean`
  slot (one-line recommendation with an auto "LEAN" label), and a collapsed
  `details.why` for evidence. Existing `.qopt` behavior untouched.
- `.settled` — stack of `<details>` rows: ✓-prefixed one-line summary,
  collapsed rationale body.
- `.delta` — before → after stat pair (`.side` / `.side.after` / `.arr`).
- `.meter` — fixed bottom-right chip; `.meter.over` = risk colors. (Moves to
  the nav if trivially doable in comments.js; bottom-right is acceptable.)

## 2. Budget meter → `assets/comments.js`

Port `proto.js` (this dir) into comments.js so every canvas page gets it
without a per-page script tag. Behavior, exactly as prototyped:

- Count = words in `<main>` visible by default: remove `script`/`style`,
  reduce every `<details>` to its `<summary>` **regardless of current open
  state** (budget measures the default view, not what the reviewer expanded).
- Budget resolution: `body[data-budget-words]` override, else by
  `data-canvas-kind`: plan 200, decision 200, doc 600, diagram 100,
  mockup none (no meter rendered).
- Render `"{words} / {budget}w · ~{screens} screens"`; screens =
  scrollHeight/innerHeight rounded to 0.1. Add `.over` when words > budget.
  Never blocks anything.
- Recompute on DOM mutations is NOT required; on-load only.

## 3. Comment jump auto-expand → `assets/comments.js`

When a comment chip click or panel jump scrolls to an anchor that sits inside
one or more closed `<details>`, set `open` on each ancestor `details` first,
then scroll. Without this, comments on collapsed content are unreachable.

## 4. Templates

- `assets/template.html` (seeds `plan.html`): replace the body skeleton with
  the approved anatomy — banner → h1 → verdict block → one example `.dcard`
  (lean + collapsed why + neutral qopts) → `.settled` block → ask block.
  Keep existing head/asset links and `data-canvas-kind="plan"`. Add
  short HTML comments naming each slot so an authoring model fills rather
  than invents.
- `assets/canvas.html`: add a commented-out verdict strip + settled block to
  copy from; keep it otherwise minimal.
- The two pages in this dir are the visual reference for how finished pages
  should look.

## 5. Reference rewrites

`references/document-quality.md`:
- Replace the "Plan-mode structure" section with the decision-first anatomy,
  applying to every gated/decide page: **verdict strip → decision cards →
  settled rows → ask**. Root-cause narration, evidence, and settled rationale
  are never top-level prose blocks — each lives collapsed (`details.why` /
  settled row body) under the card it supports, or on `details.html`.
- Add a content-type → component table making components mandatory defaults:
  summary → verdict strip · open decision → dcard · made decision → settled
  row · before/after → delta · relationships → diagram · UI → wf-frame.
  A visible paragraph is the justified exception, ≤2 sentences.
- Budgets section: the numbers above; collapsed text is budget-free; the
  pre-handoff check gains "meter green, or say in chat why not".
- Keep: blocks/anchors, comment-mode, question-block, neutral-options rules.
  The lean now goes in the `.lean` slot (drop "argue the lean in prose"
  phrasing in favor of the slot).

`references/modes.md`: add a Budget column to the mode table; rewrite the
plan-mode "Contains" to the new anatomy; decide mode = dcards as primary
surface; doc mode = lead sections visible, depth in collapsed `<details>`,
600 budget; diagram 100; mockup exempt.

`SKILL.md`: update the Authoring section (anatomy + components in one short
paragraph, meter mention) and the modes table (Budget column). Keep length —
trim what the references now cover.

## 6. Tests

`tests/test_comments.js` additions (follow existing test style):
- meter counts summaries but not closed-details bodies; ignores a
  runtime-opened details (open attribute present) the same as closed.
- budget default by kind + `data-budget-words` override; `.over` class when
  exceeded; no meter on mockup kind.
- comment jump into a closed `details` opens all ancestor details.

Run: `node tests/test_comments.js` (and the other three suites — must stay
green). Then restart the daemon
(`launchctl kickstart -k gui/$UID/com.claude.canvasd`) only if canvasd.py was
touched (it shouldn't be).

## 7. Acceptance

- Reopen this dir's canvas: both pages render identically minus the now-
  redundant `proto.css`/`proto.js` links (leave the files; they're the spec's
  record).
- Seed a fresh plan workspace from the new template: page shows the anatomy
  slots and a green meter out of the box.
- Word-count check used during authoring here, for reference:
  strip script/style, reduce details to summary, count `<main>` words.
