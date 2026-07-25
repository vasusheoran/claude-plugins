---
description: Plan a piece of work as a reviewable canvas artifact, get approval, then implement it by delegating work items to worker Claude sessions (Haiku/Sonnet/Opus) in their own herdr tabs under strict TDD, with the latest top-tier model as orchestrator and reviewer. Use when the user says "plan it out and use opus/sonnet to implement", "/foreman <task>", or any equivalent.
---

Run one task through the user's standard plan → approve → delegate → verify
loop. The main session is the **orchestrator**: it plans, dispatches, and
reviews, and it must run on the latest top-tier model (currently Fable) — if
the session is on a lower-tier model, say so before starting rather than
silently orchestrating from it. Workers write the code, each visible in its
own herdr tab (Phase 3).

**Prose rule (all phases):** before writing any prose a human will read —
plan artifacts, ADRs, handoffs, PR text, doc updates, report-backs — invoke
the **anti-ai-writing** skill and apply it. Workers inherit the rule: any
worker prompt that has the agent writing docs or user-facing text must
include the anti-ai-writing constraints (paste the relevant rules; workers
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

## Phase 3 — Implement via workers (after approval only)

Split the plan into self-contained work items. **Every item that edits source
runs as a worker Claude session in its own herdr tab** — one tab per worker,
so the user can watch and steer each one live. Never run implementation
through the in-process Agent tool; that tool is reserved for quick read-only
helpers (Phase 1 exploration, spot-check reads) whose output only the
orchestrator needs.

Worker model tiers (pass via `--model`):

- **haiku** — trivial mechanical items: renames, moves, config plumbing,
  applying a change the plan already spells out line by line.
- **sonnet** — well-specified items: mirrors, adapters, test scaffolds,
  refactors with a clear contract.
- **opus** — design-heavy or gnarly items: routing logic, tricky algorithms,
  cross-file surgery, anything where the contract leaves room for judgment.

The orchestrator writes no implementation code: it dispatches, reviews
worker diffs, resolves conflicts, and re-dispatches items that come back
wrong.

### Spawning a worker

Mechanics (herdr socket CLI; `herdr agent --help` for details). Two commands
per worker — start it, then move its pane into its own labeled tab:

    herdr agent start foreman-<item> --workspace <ws-id> \
        --cwd <project> --no-focus -- \
        claude --model <haiku|sonnet|opus> "<self-contained prompt>"
    # → note the pane_id in the result
    herdr pane move <pane_id> --new-tab --label "foreman:<item>" --no-focus

Find your own workspace id with `herdr pane current`. Do NOT use
`herdr tab create` + `agent start --tab` — that leaves a stray empty shell
pane in the tab and ignores the tab's cwd; the start-then-move sequence
yields a clean single-pane tab. Dispatch independent items in parallel — one
tab each — and report the tab labels as you spawn them so the user knows
what's running where. Each worker prompt must be self-contained (workers get
no chat context): the exact files to touch, the contract
(inputs/outputs/invariants from the plan), the verification command, and the
TDD requirement below.

Monitor with `herdr agent wait foreman-<item> --status idle --timeout <ms>`;
review output with `herdr agent read foreman-<item> --source visible`
(`--source recent` can come back empty; `visible` reads the pane as shown);
follow-ups go via `herdr agent send`. Workers keep the user's normal
permission mode — if one goes `blocked`, it's waiting on a permission
prompt: tell the user which tab needs a click rather than working around it.
Leave the tab open until the item's diff is reviewed and accepted, then
`herdr tab close` it.

### Agent teams

The same visibility rule applies to teams-shaped work. Default to the
tab-per-worker pattern above; reach for native Claude Code agent teams only
when their shared task list / mailbox coordination is genuinely required.

Native teams DO work under herdr, but need a bridge (verified 2026-07-26,
Claude Code v2.1.206). In tmux teammate mode with no surrounding tmux, the
team lead creates a **dedicated tmux server**: socket
`claude-swarm-<lead-pid>` (in `/tmp/tmux-$(id -u)/`), session `claude-swarm`,
one window `swarm-view` with one split pane per teammate — nothing shows up
in herdr on its own. So:

1. Spawn the team-lead session like any worker (start-then-move recipe) with
   two extra env vars: `--env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and
   `--env TERM_PROGRAM=` (blank). The blank matters: herdr panes inherit
   `TERM_PROGRAM=iTerm.app` from the login terminal, and with it set the
   lead stops on an interactive iTerm2-vs-tmux picker instead of going
   straight to tmux. Pass `--teammate-mode tmux` on the `claude` argv.
2. Once the lead reports teammates started (its status line prints the
   socket: `View teammates: tmux -L claude-swarm-<pid> a`), open one watch
   tab for the whole team:

       herdr agent start swarm-view --workspace <ws-id> --no-focus -- \
           tmux -L claude-swarm-<pid> attach -t claude-swarm
       herdr pane move <pane_id> --new-tab --label "teams:swarm-view" --no-focus

   Teammates are split panes in that single window, so it's one tab per
   team, not per teammate. Find the socket with `ls /tmp/tmux-$(id -u)/`
   (newest `claude-swarm-*`) if you didn't catch the status line. Note the
   lead's own TUI also lists teammates at the bottom (`⏺ main / ◯ <name>`,
   the agents panel) — that's an inline viewer inside the lead's screen,
   not where teammates run; the swarm-view tab is the live side-by-side
   view.
3. Cleanup: the swarm server dies with the lead, and the attach pane (and
   its tab) dies with the server. Stale socket files can linger in
   `/tmp/tmux-<uid>/` — remove them; if a swarm session outlives its lead,
   `tmux -L claude-swarm-<pid> kill-server`.

**TDD is non-negotiable** (user's global rule): behavior-level tests written
and shown failing first, then minimum implementation, never both in one pass.
Instruct every worker accordingly and spot-check that they complied.

## Phase 4 — Verify & close

- Run the full relevant test suites yourself (don't trust worker claims).
- Compare results against the plan's gates/artifacts; report honestly,
  including failures and skipped items.
- Decisions that shaped the outcome → dated ADR (append-only, supersede never
  edit). Update the plan banner to IMPLEMENTED with the date. No docs that
  restate code.
