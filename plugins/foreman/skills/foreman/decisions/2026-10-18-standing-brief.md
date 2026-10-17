# 2026-10-18 — Standing brief, paths, and foreman as the default entry

Status: shipped. Plan and review: canvas `foreman-brief` (approved 2026-10-18).
Evals: `plugins/foreman/evals/` (4 cases, 25 graders). Re-measure tool:
`plugins/foreman/scripts/brief_metrics.py`.

The user kept typing the same instructions on top of their requests. Counted
from 4,628 prompts in `~/.claude/history.jsonl` (5 Jul to 18 Oct 2026): "give
me a prompt for another session" 49, "don't be a yes man" 15, "think this
through" 13 (9 without /foreman), "grill yourself" 12, "explain visually" 9,
"use /foreman", often with "if required", about 70. The skills now do these
things without being asked.

Decisions:

- **foreman is the default entry and picks a path.** answer, decide, build or
  handoff, named on the first line of the reply. The "if required" in "use
  /foreman if required" was the user delegating that choice. The risk is a
  heavy path on a small ask; "just do it" overrides it.
- **Standing brief on every non-answer path.** Raw source first, premise
  check, a depth pass (unasked methods plus an outside oracle), a five-part
  plan skeleton, one visual per decision, plain words. It scales down for a
  bug with a clear repro.
- **The premise check lives in grill-me.** grill-me used to question only
  Claude's draft. "Don't be a yes man" is aimed at the user's own mental
  model, and 9 of 13 "think this through" prompts had no /foreman, so the
  check belongs in the skill that runs either way. The project skill
  `/grillme` was merged in and deleted.
- **Handoff writes prompt.md.** The most repeated request. After approval
  the plan becomes a self-contained `prompt.md` in the canvas workspace.
- **Worker mechanics moved to `references/workers.md`.** SKILL.md went from
  257 to about 210 lines while gaining the brief. Two recipe bugs were fixed
  on the way: a tab label containing ":" breaks `herdr pane move`, and the
  `herdr agent start` output isn't one JSON document, so the pane id comes
  from `herdr agent list`.
- **Tests are evals built from real prompts.** The four cases are the user's
  own prompts with the brief stripped out. Before the change: 1 of 25 graders
  passed (the one prompt that named /foreman loaded the skill). After: 24 of
  25 with `--judge-model sonnet`, one run per case. The default Haiku judge
  gave a single word per vote, and its results varied from run to run (18 to
  20 of 23 across three runs, a different set failing each time), so these
  suites are judged by Sonnet.

Revalidation: on 2026-11-01, run `python3 plugins/foreman/scripts/brief_metrics.py
--since 2026-10-19` and compare with the baseline above. Expected: the brief
phrases near zero per 100 prompts, "give me a prompt" down, and confusion
comments under 22 of 99. A miss means the wording didn't take; start from the
eval cases.
