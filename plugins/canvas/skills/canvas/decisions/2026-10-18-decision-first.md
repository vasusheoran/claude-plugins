# 2026-10-18 — Decision first: canvas authoring rules

Status: shipped. Evals: `plugins/canvas/evals/` (`smoke-fixture`, `retry-flow`).

The user's statement of canvas's job: "Default job of canvas is to help me make
better and faster decisions. It does that visually: graphics, videos, html,
interactives is up to you to decide." The authoring rules now say that
directly.

Evidence, from 48 canvas workspaces (2026-10-18):

- When a page showed Claude's pick, the user took it 34 of 39 times. 13 more
  answers were "you decide" and 5 were overrides. Picking is cheap.
- 22 of 99 top-level comments were confusion. One, on a plan card that said
  "Each run is a full session up to the plan gate": "I don't understand this."
- One workspace took 12 send rounds. Another grew to 13 pages.

What changed, and why:

- **Every artifact opens with the decision ask.** The question, Claude's pick,
  and what it costs to undo come before background. The user mostly accepts the
  pick, so the first screen should let them do that with full understanding.
- **A "pick the medium" chooser.** Structure gets a diagram, time gets a
  stepped animation, a tradeoff with a knob gets a slider, a number gets a
  chart from real data, a UI gets before/after. Prose alone no longer
  completes a decision card.
- **No video files.** The user chose animated SVG/CSS steps over video. Steps
  carry stable `data-cmt-id` values, so a comment lands on one step, which a
  video cannot offer.
- **Plain-words rule in Tone.** Use the user's words, define or replace
  anything else, expand abbreviations, and read each card cold. This answers
  the confusion comments.
- **Reversibility on every decision card.** One line in plain words, "easy to
  undo later" or "hard to undo once X ships".
- **Page discipline.** A page is added only for a new decision or a new visual;
  otherwise the page is updated in place. This targets the 12-round and
  13-page workspaces.

Checked by two eval cases with five graders each (decision-first, visual,
plain-words, reversibility, budget). Run: `claude plugin eval . --runs 1
--ablation none --allow-tools Write --judge-model sonnet` from `plugins/canvas`.
The previous skill scored 0 of 10. After the change: 8 of 10, one run each.

- Plain-words fails in the eval more often than the pages deserve. The judge
  reads the whole run (`focus: trace`), skill text included. The same page
  text given to Sonnet on its own passed, with no undefined terms found.
- A hard cap of two cards per page passed the budget grader but would split
  an ordinary three-decision plan across pages. The rule caps words instead
  (about 200 per page, 90 per card), and retry-flow's two-decision page with a
  slider runs over. That trade is deliberate.
