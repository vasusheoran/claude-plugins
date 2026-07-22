---
description: Interrogate your own draft — plan, design, decision, or nontrivial answer — before presenting it. Generate the questions a demanding reviewer would ask, answer them yourself from code and evidence, fold the answers back in, and surface only the decisions that matter. Ask the user only what evidence cannot settle. Use before presenting any plan or design, when foreman reaches its grill step, or when the user says "/grill-me".
---

Grill your own draft the way a skeptical senior reviewer would, then answer
the grilling yourself. The output is a better draft plus a short decision
digest — not a transcript of self-doubt.

Run this after a draft exists and before the user sees it. Grilling a blank
page produces generic questions; grill something concrete.

## 1. Generate the questions

Write down 8–15 questions against the draft. Pull from whichever of these
apply; skip dimensions with nothing real behind them:

- Assumptions: what does the draft assume about current behavior that you
  have not read in the code?
- Contracts: inputs, outputs, schemas, wire formats, IDs — anything
  hard to reverse once shipped.
- Edge cases and failure modes: empty, concurrent, restarted mid-way,
  partial write, stale state.
- Compatibility: existing data, existing callers, migration, rollback.
- Security and permissions: who can reach this, what does it leak.
- Verification: how will you know it worked; what test proves the contract.
- Operations: restart, logs, config, what breaks at 3am.
- Scope: what is deliberately not being done, and does the draft say so.

No theater. A question you already know the answer to, invented to look
thorough, wastes the reader's trust. Every question must be one you could
plausibly get wrong.

## 2. Answer them yourself

Answer each question with evidence, not vibes:

- Prefer the code: read the file, run a read-only command, cite what you
  found (`file:line`, command output). "Probably" means you haven't checked.
- Knowledge answers are fine where code cannot decide (library semantics,
  protocol rules) — name the source you're relying on.
- An answer that changes the draft is the good outcome. Edit the draft
  immediately; that question is now resolved and needs no mention.

## 3. Triage

Each question ends in exactly one bucket:

1. **Resolved** — evidence settled it. Fix the draft, say nothing.
2. **Decision** — real options existed and you picked one. Goes in the digest.
3. **Must-ask** — you cannot decide: it's a user preference, the wrong guess
   is costly or externally visible, and evidence cannot settle it.

The must-ask bar is high: ask if and only if a sensible default does not
exist. "I'd rather the user confirm" is not a reason; recommend the default
and proceed. Never re-ask something the user already decided.

## 4. Present

The user sees two things, both short:

- **Decision digest** — at most 7 lines, one per decision: what you chose
  and why, in plain language. No jargon from your working notes, no raw Q&A
  dump. If a decision needs more than a line, it may belong in must-ask.
- **Must-ask questions** — batched, not dribbled: one AskUserQuestion call
  (max 4, recommended option first) or, when a canvas plan is open,
  question blocks in the plan with a recommended default marked.

Keep the full question list in your working notes (or a collapsed section of
the canvas artifact) in case the user wants to see the grilling — but never
lead with it. Overwhelming the reader with your process defeats the point:
the grilling is for you; the digest is for them.
