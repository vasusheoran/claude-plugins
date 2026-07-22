---
description: Plan a piece of work as a reviewable canvas artifact, get approval, then implement it by delegating work items to Opus/Sonnet subagents under strict TDD, with the main model as orchestrator and reviewer. Use when the user says "plan it out and use opus/sonnet to implement", "/foreman <task>", or any equivalent.
---

Run one task through the user's standard plan → approve → delegate → verify
loop. The main (orchestrating) model plans and reviews; Opus/Sonnet subagents
write the code. The user's preferred orchestrator is the top-tier session
model (Fable) — if the session is running on a lower-tier model, say so
before starting rather than silently orchestrating from it.

**Prose rule (all phases):** before writing any prose a human will read —
plan artifacts, ADRs, handoffs, PR text, doc updates, report-backs — invoke
the **anti-ai-writing** skill and apply it. Subagents inherit the rule: any
subagent prompt that has the agent writing docs or user-facing text must
include the anti-ai-writing constraints (paste the relevant rules; subagents
get no chat context). Spot-check their prose output against it in review,
same as TDD compliance.

## Phase 1 — Research (read-only)

Read the real files before writing a word of plan. Name actual files, symbols,
data shapes; never invent them. Delegate wide exploration to an Explore
subagent when useful. Make **no source edits** until approval.

## Phase 2 — Plan on canvas

Invoke the **canvas** skill in plan mode (workspace `canvas/<slug>/`) and
follow its lifecycle exactly — it owns the mechanics (two-step open, review
loop, approval gate); don't improvise around it. Plan discipline:

- Lead with reuse: what each step builds on before what it adds.
- Decide hard-to-reverse bets in the plan (wire formats, IDs, schema, contracts).

**Grill before you share.** Once the plan is drafted but before launching the
browser or giving the user the URL, invoke the **grill-me** skill on the
draft: generate the hard reviewer questions, answer them from code and
evidence, and fold the answers into the plan. What survives triage lands in
the artifact — the decision digest as a short section (one line per decision,
plain language, never the raw Q&A), and the genuine must-ask questions as
interactive question blocks with a recommended default. Everything else:
state the assumption and proceed. Ask the user only what grill-me could not
settle.

Then share the URL and **stop until the canvas reports
`approval.state == "approved"`** (`canvas_wait`). Apply comment feedback by
editing the artifact (stable block ids).

## Phase 3 — Implement via subagents (after approval only)

Split the plan into self-contained work items. For each, spawn an Agent with
an explicit `model` override:

- **sonnet** — mechanical / well-specified items (mirrors, adapters, plumbing,
  test scaffolds, refactors with a clear contract).
- **opus** — design-heavy or gnarly items (routing logic, tricky algorithms,
  cross-file surgery, anything where the contract leaves room for judgment).

Run independent items in parallel (one message, multiple Agent calls). Each
subagent prompt must contain: the exact files to touch, the contract
(inputs/outputs/invariants from the plan), the verification command, and the
TDD requirement below. Subagents get no chat context — make prompts
self-contained.

### Where subagents run

The default venue is the in-process Agent tool. When an item warrants its own
visible session — it's long-running, the user wants to watch or steer it, or
it needs an interactive terminal of its own — run it as a Claude session in a
separate **herdr** tab instead. The orchestrator stays in its own tab; the
prompt contract, model tiers, and TDD rules are identical in both venues.

Mechanics (herdr socket CLI; `herdr agent --help` for details):

    herdr tab create --workspace <ws-id> --cwd <project> \
        --label "foreman:<item>" --no-focus            # returns the tab id
    herdr agent start foreman-<item> --tab <tab-id> -- \
        claude --model <sonnet|opus> "<self-contained prompt>"

Find your own workspace id with `herdr pane current`. Monitor with
`herdr agent wait foreman-<item> --status idle --timeout <ms>` and review
output with `herdr agent read foreman-<item>`; follow-ups go via
`herdr agent send`. Spawned sessions keep the user's normal permission mode —
if one goes `blocked`, it's waiting on a permission prompt: tell the user
which tab needs a click rather than working around it. Leave the tab open
until the item's diff is reviewed and accepted, then `herdr tab close` it;
report tab labels so the user knows what's running where.

**TDD is non-negotiable** (user's global rule): behavior-level tests written
and shown failing first, then minimum implementation, never both in one pass.
Instruct every subagent accordingly and spot-check that they complied.

The orchestrator does not write implementation code; it reviews subagent
diffs, resolves conflicts, and re-dispatches items that came back wrong.

## Phase 4 — Verify & close

- Run the full relevant test suites yourself (don't trust subagent claims).
- Compare results against the plan's gates/artifacts; report honestly,
  including failures and skipped items.
- Decisions that shaped the outcome → dated ADR (append-only, supersede never
  edit). Update the plan banner to IMPLEMENTED with the date. No docs that
  restate code.
