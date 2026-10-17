---
description: Challenge the user's premise and your own draft (plan, design, decision, nontrivial answer, or a spec/plan/doc the user shares) before anyone builds on it. Restate the user's mental model, test its assumptions against evidence, generate the questions a demanding reviewer would ask, answer them from code and data, and surface only the decisions that matter. Use before presenting any plan or design, at foreman's premise check, when reviewing a shared spec or plan, or when the user says "think this through", "don't be a yes man", "challenge my assumptions", "grill yourself", "/grill-me" or "/grillme".
---

Grill the premise and the draft the way a skeptical senior reviewer would,
then answer the grilling yourself. The output is a better draft plus a short
digest, not a transcript of self-doubt. Grill something concrete: a draft,
a request, or a doc.

**Shared doc?** When the input is a spec, RFC or plan the user shares, read
the whole doc first; don't grill from a skim.

## 1. Map and question

Map the consequential decisions and their dependencies (B only matters if A
is chosen, C contradicts D). Then write 8–15 questions, starting with these
two:

- **Premise.** Restate the user's mental model in one or two lines. List
  what in the request is an assumption rather than a fact. Test each
  against evidence and say plainly where it breaks or is unverified, or
  what it costs that the user didn't mention.
- **Raw source.** Is there primary data (prod data, logs, captures, real
  devices, past transcripts, git history) that settles this and hasn't been
  read?

Then whichever of these apply:

- Assumptions about current behavior you haven't read in the code.
- Contracts: inputs, outputs, schemas, wire formats, IDs.
- Edge cases: empty, concurrent, restarted mid-way, partial write, stale state.
- Compatibility: existing data and callers, migration, rollback.
- Security: who can reach this, what it leaks.
- Verification: what outside check proves it worked.
- Operations: restart, logs, config, what breaks at 3am.
- Scope: what is deliberately left out, and whether the draft says so.

Every question must be one you could plausibly get wrong. A question
invented to look thorough wastes the reader's trust.

## 2. Answer them yourself

Answer with evidence, not vibes. Settle these from the code before asking
anyone:

- existence: does the table, column, endpoint or pattern the draft names
  exist?
- collisions: migration numbers, routes, env vars, keys already taken;
- data flow: does the source actually hold the field the plan groups or
  filters on?
- numbers: is a threshold realistic against a real figure?
- auth: does the router carry the guard the draft assumes?

Cite what you found (`file:line`, command output). "Probably" means you
haven't checked. Knowledge answers are fine where code can't decide; name
the source. An answer that changes the draft is the good outcome: edit the
draft. Resolve upstream decisions before the ones that depend on them.

## 3. Triage

Each question lands in one bucket:

1. **Resolved**: evidence settled it. Fix the draft.
2. **Decision**: real options existed and you picked one. Goes in the digest.
3. **Must-ask**: a user preference where the wrong guess is costly and
   evidence can't settle it.

Ask only when no sensible default exists. Never re-ask what the user
already decided.

## 4. Present

- **Premise**: "Your model: …" then "Where it breaks: …", said plainly
  with the evidence. Never open with "you're right".
- **Decision digest**: at most 7 lines, one per decision, what you chose
  and why in plain words.
- **Must-ask questions**: batched in one AskUserQuestion call (max 4,
  recommended option first) or, with a canvas plan open, question blocks
  with a recommended default.

Keep the full question list in working notes or a collapsed canvas section;
never lead with it.

Stop before implementation. This skill ends at a tightened plan and
answered questions; wait for the go-ahead to build.
