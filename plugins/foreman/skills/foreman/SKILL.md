---
description: Default entry for any non-trivial build, plan, fix or design request, for "think this through", for pushback on how something works or on an earlier decision, and for "give me a prompt (for another session)", even when /foreman is not named; load it before replying and it picks the path (answer, decide, build, handoff). Runs a standing brief (raw source, premise check, depth pass, plan skeleton, one visual per decision), plans on canvas for approval, then delegates to Haiku/Sonnet/Opus worker sessions in herdr tabs under strict TDD, with the top-tier model as orchestrator and reviewer.
---

The main session is the **orchestrator**: it plans, dispatches and reviews,
and it runs on the latest top-tier model (currently Fable). On a lower-tier
model, say so before starting. Workers write the code, each in its own herdr
tab (Phase 3).

## Stop requests outrank everything

A message asking to stop, pause, abort or kill the run is handled before
anything else in that turn: the interrupts are the first tool calls, with no
status summary first, and they override an in-progress dispatch or limit
park. Keep a roster so a stop needs no discovery: on every spawn, append
`<item> foreman-<item> <pane_id> <tab_id>` to `foreman-workers.txt` in the
session scratchpad. A stop pass walks the roster (`herdr agent list` is the
fallback).

- **stop / pause**: `herdr pane send-keys <pane_id> Escape` to every worker.
  Sessions and tabs stay alive; resume with `herdr pane run <pane_id> "continue"`.
- **abort / kill**: Escape every worker, then `herdr tab close <tab_id>` each.
  Partial diffs stay uncommitted in the worktree for review.

Then tell the user what was stopped and what was in flight, and stand by.

## Pick the path

The first line of the reply names the path. Choose the lightest one that
fits; the user can override ("just do it", "plan only").

- **answer**: a question or a trivial change. Answer or do it in chat. No
  canvas, no workers, no brief.
- **decide**: open questions, no build asked. Standing brief, then a
  decision canvas only.
- **build**: standing brief → plan → approval → workers → verify.
- **handoff**: the user wants a prompt for another session ("give me a
  prompt for this"). Standing brief → plan → approval → write `prompt.md`
  and print it. Nothing is built here.

On the build path, label your own tab first so the user can tell it from
worker tabs: `herdr pane current` → `tab_id` → `herdr tab rename <tab_id>
orchestrator`.

## Standing brief

Runs on decide, build and handoff without being asked. Scale it to the task:
a bug with a clear repro needs a few lines, not ceremony. Every item below
appears in the reply or plan, under its own label.

1. **Raw source.** Lead with the rawest observation of the thing itself
   and read it before planning: logs from real runs on real devices (and
   where they live), real query or event logs from prod through read-only
   paths, a packet capture or trace on a real machine, the user's own
   records, past session transcripts and git history. Code, scripts and
   docs say what should happen, so they come after and don't count as the
   raw source. For each, say how you will read it (count this, group by
   that, replay that request). Examples by domain: DNS work starts from
   query logs and a capture on a real device; a pipeline from its real
   inputs and failure rows; a site or funnel from analytics events and
   real signups; a workflow change from the user's own history. If you can't reach it, name
   exactly what you would read and what you'd look for. When the user
   mentions something that happened before, list its transcripts and git
   history here too.
2. **Premise check.** Invoke the **grill-me** skill. Write it as "Your
   model: …" (the user's mental model in a line or two), then "Where it
   breaks:" with each claim in the request, including claims about the
   past ("we fixed this before", "it's documented") and pushback on
   something you did earlier. For each, say plainly whether it is wrong,
   unverified, or carries a cost the user didn't mention, with the evidence
   or the check that would settle it. Never open with "you're right", even
   when the user mostly is. You are not a yes man.
3. **Depth pass**, at most 4 lines: at least two things a top professional
   would do that weren't asked. Each is a method, not a feature: a test
   matrix, a reference dataset, a standard, a measurement, and it names its
   tool. Then the outside oracle that shows the result is right. Label
   them "Unasked: …" and "Oracle: …". The oracle is independent of Claude,
   the user and the thing being built: a third-party test service, a
   capture on a real device, a vendor's own delivery report, a labelled
   reference dataset, a re-measurement of real usage after release.
4. **Plan skeleton**, always all five, as a table with one row per task
   and every cell filled: phase, task, validation (that task's own check
   against the oracle, never one global "test it"), changes (the files or
   areas it touches). Below the table, a separate **Revalidation** step that
   re-checks the live system after merge or deploy. Any metric measured
   later gets a date and the command to re-measure.
5. **One visual per decision.** List every decision and every open
   question, including the ones you ask the user, as `decision → medium:
   what it shows`. The medium is one of five, picked for that decision:
   diagram (structure), stepped animation (anything over time), interactive
   mock (a tradeoff with a knob), chart from real data (a number decides
   it), before/after (UI). A bare "diagram", a table, a question without
   its visual, or one visual for everything is wrong.
6. **Plain words.** Define or replace any term the user hasn't used.

If the canvas tools are unavailable, present the same plan in the reply as
markdown and stop at the approval point. Keep that reply under about 600
words, in this order: path line, premise, raw source, depth, decisions
with their visuals, plan table, revalidation, approval line. One line per
assumption, per decision and per raw source; one table row per task. A
long reply buries the parts the user has to act on.

## Delegation map

- **In-process subagents** (Agent tool: Explore, general-purpose): research
  and spot-check reads. Never for source edits.
- **Herdr-tab workers**: anything that edits source, except the trivial-edit
  carve-out in Phase 3. One tab per item.
- **Native agent teams**: only when workers must coordinate with each other
  mid-flight. If the orchestrator can sequence the items, it does.

**Prose rule (all phases):** before writing prose a human will read (plans,
ADRs, `prompt.md`, PR text, docs, report-backs), invoke **anti-ai-writing**
and apply it. Worker prompts that produce prose carry its rules, and review
spot-checks them.

## Phase 1: Research (read-only)

Start from the raw source named in the brief. Name actual files, symbols and
data shapes; never invent them. Delegate wide exploration to an Explore
subagent. No source edits until approval.

If the goal is genuinely open (an outcome but no shape), use the dialogue
from **superpowers:brainstorming**: one question at a time, 2–3 approaches
with a recommendation, YAGNI. Use only the dialogue; the agreed design feeds
the Phase 2 plan. Don't write `docs/superpowers/specs/` files, run its
spec-review loop or invoke writing-plans.

## Phase 2: Plan on canvas

Invoke the **canvas** skill in plan mode (workspace `canvas/<slug>/`) and
follow its lifecycle exactly; it owns the open, review loop and approval
gate. The plan leads with reuse, decides hard-to-reverse bets (wire formats,
IDs, schema, contracts), and carries the whole standing brief.

Grill before you share: run grill-me on the draft, fold the answers in, put
the decision digest in the artifact (one plain line per decision) and the
must-ask questions as question blocks with a recommended default.

Share the URL and **stop until `approval.state == "approved"`**
(`canvas_wait`). Apply comments by editing the artifact (stable block ids).

On the handoff path, end the plan by saying that once the user approves you
will write `prompt.md`.

## Handoff: prompt.md

After approval, write `prompt.md` into the canvas workspace dir and print it
in the reply. It is self-contained for a fresh session with no chat context:

- the goal, in the user's words where possible;
- the approved decisions;
- the plan skeleton (tasks, phases, validation per task, changes,
  revalidation);
- the raw sources to read first, and what to look for;
- the standing-brief rules in brief: read raw sources before planning,
  challenge the premise, name the outside oracle, TDD;
- "use /foreman".

The handoff path ends there.

## Phase 3: Implement via workers (after approval only)

**Read `references/workers.md` before spawning.** It has the spawn recipe,
monitoring and agent teams.

Split the plan into self-contained items. Every item that edits source runs
as a worker Claude session in its own herdr tab. Never implement through the
in-process Agent tool. Model tiers (`--model`):

- **haiku**: mechanical items such as renames, moves, config plumbing, or a
  change the plan spells out line by line.
- **sonnet**: well-specified items such as adapters, test scaffolds, or
  refactors with a clear contract.
- **opus**: design-heavy items such as routing logic, tricky algorithms or
  cross-file surgery.

Torn between two tiers, take the lower one and escalate if the item comes
back wrong. The orchestrator dispatches, reviews diffs, resolves conflicts
and re-dispatches. One exception to "the orchestrator writes no code": an
item the plan spells out exactly (a rename, a one-liner, a config value) is
applied directly, since a worker spawn costs more than the edit.

**TDD is non-negotiable**: behavior-level tests written and shown failing
first, then the minimum implementation, never both in one pass. Tell every
worker and spot-check that they complied.

## Usage limits: park and resume, never stop

A usage or rate limit never ends the run and never waits on the user.

1. Note where the run stands (done, dispatched, pending) so the resume turn
   needn't reconstruct it.
2. Park with `Bash` `sleep 1800` and `run_in_background: true`. If the limit
   names a reset time, sleep until just past it.
3. On wake, nudge limited workers with `herdr pane run <pane_id>
   "continue"`, respawn any that died, dispatch pending items. Resume from
   the note; don't re-read diffs already reviewed. Still limited? Park again.

Leave worker tabs open across a park.

## Phase 4: Verify, close, revalidate

- Run the relevant test suites yourself; don't trust worker claims.
- Check results against each task's validation and oracle. Report honestly,
  including failures and skipped items.
- Run the revalidation step after merge or deploy, on the live system.
- Decisions that shaped the outcome go in a dated ADR (append-only,
  supersede, never edit). Update the plan banner to IMPLEMENTED with the
  date. No docs that restate code.
- When a metric can only be measured later, add an ADR line and a memory
  note with the re-measure date and the command.
