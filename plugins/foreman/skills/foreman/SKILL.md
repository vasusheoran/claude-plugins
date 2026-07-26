---
description: Plan a piece of work as a reviewable canvas artifact, get approval, then implement it by delegating work items to worker Claude sessions (Haiku/Sonnet/Opus) in their own herdr tabs under strict TDD, with the latest top-tier model as orchestrator and reviewer. Use when the user says "plan it out and use opus/sonnet to implement", "/foreman <task>", or any equivalent.
---

Run one task through the user's standard plan → approve → delegate → verify
loop. The main session is the **orchestrator**: it plans, dispatches, and
reviews, and it must run on the latest top-tier model (currently Fable) — if
the session is on a lower-tier model, say so before starting rather than
silently orchestrating from it. Workers write the code, each visible in its
own herdr tab (Phase 3).

**First act — label your own tab.** Rename the tab this session runs in so
the user can tell it from the worker tabs: `herdr pane current` → take the
`tab_id` → `herdr tab rename <tab_id> orchestrator`.

## Stop requests — outrank everything

A user message asking to stop, pause, abort, or kill the run is handled
before anything else in that turn: the interrupts are the first tool calls
— no status summary first — and they override an in-progress dispatch or
limit park. Keep a roster so a stop needs no discovery: on every spawn,
append `<item> foreman-<item> <pane_id> <tab_id>` to `foreman-workers.txt`
in the session scratchpad; a stop pass walks the roster (`herdr agent list`
is the fallback if it's missing).

Two levels:

- **stop / pause** — `herdr pane send-keys <pane_id> Escape` to every
  worker. Turns interrupt mid-flight; sessions and tabs stay alive. Resume
  later with `herdr pane run <pane_id> "continue"`.
- **abort / kill** — Escape every worker, then `herdr tab close <tab_id>`
  each. Partial diffs stay uncommitted in the worktree for review.

After either, tell the user what was stopped and what was in flight, then
stand by.

## Delegation map

Three mechanisms, one rule each:

- **In-process subagents** (Agent tool: Explore, general-purpose) — research,
  exploration, spot-check reads. Findings return straight into orchestrator
  context: no tab, no session-startup cost, nothing to scrape back. Never
  for source edits.
- **Herdr-tab workers** — anything that edits source, except the trivial-edit
  carve-out in Phase 3. One tab per item, visible and steerable.
- **Native agent teams** — only when workers must coordinate with *each
  other* mid-flight (shared task list / mailbox, e.g. two agents negotiating
  an interface both build against). If the orchestrator can sequence the
  items instead, it should — the orchestrator is the coordinator.

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

**Underspecified task? Brainstorm before planning.** If the goal or approach
is genuinely open — the request names an outcome but not what to build —
invoke the **superpowers:brainstorming** skill for its dialogue: clarify
purpose, constraints, and success criteria one question at a time, propose
2–3 approaches with a recommendation, YAGNI ruthlessly. Use only that
dialogue, then stop: the agreed design feeds the Phase 2 canvas plan, which
replaces brainstorming's own artifacts and gates — do not write
`docs/superpowers/specs/` files, do not run its spec-review loop, and do
not invoke writing-plans. A task that arrives well-specified (clear
contract, known shape) skips this step.

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

When torn between two tiers, take the lower one and escalate only if the
item comes back wrong — a redo on sonnet costs less than defaulting to opus.

The orchestrator dispatches, reviews worker diffs, resolves conflicts, and
re-dispatches items that come back wrong. One exception to "the orchestrator
writes no code": an item the plan already spells out exactly — a rename, a
one-liner, a config value — is applied directly by the orchestrator, because
a worker spawn pays a full session startup that dwarfs such an edit.
Anything with room for judgment still goes to a worker tab.

### Spawning a worker

Mechanics (herdr socket CLI; `herdr agent --help` for details). Two commands
per worker — start it, then move its pane into its own labeled tab:

    herdr agent start foreman-<item> --workspace <ws-id> \
        --cwd <project> --no-focus -- \
        claude --model <haiku|sonnet|opus> --permission-mode auto \
        --setting-sources user,local "<self-contained prompt>"
    # → note the pane_id in the result
    herdr pane move <pane_id> --new-tab --label "foreman:<item>" --no-focus
    # → append "<item> foreman-<item> <pane_id> <tab_id>" to the stop roster

`--setting-sources user,local` drops the project CLAUDE.md from each worker
(a large per-spawn token load; verified 2026-07-26) while keeping
subscription OAuth and the local auto-mode/permission rules. Do NOT use
`--bare` for this — it disables OAuth entirely and the worker starts logged
out. Consequence: the worker prompt must carry every repo rule the item
touches (TDD, gates, conventions, verification command) — which it already
must, since workers get no chat context. Give each worker only its item's
slice of the plan, never the whole plan.

Find your own workspace id with `herdr pane current`. Do NOT use
`herdr tab create` + `agent start --tab` — that leaves a stray empty shell
pane in the tab and ignores the tab's cwd; the start-then-move sequence
yields a clean single-pane tab. Dispatch independent items in parallel — one
tab each — and report the tab labels as you spawn them so the user knows
what's running where. Each worker prompt must be self-contained (workers get
no chat context): the exact files to touch, the contract
(inputs/outputs/invariants from the plan), the verification command, and the
TDD requirement below.

Monitor with `herdr agent wait foreman-<item> --status idle --timeout <ms>`
— waiting costs nothing; don't poll with reads. Review the *work* via
`git diff`, never by reading the transcript; read the pane only to
spot-check TDD compliance or prose rules, capped
(`herdr agent read foreman-<item> --source visible --lines 60`;
`--source recent` can come back empty). Follow-ups go via
`herdr pane run <pane_id> "<text>"` — `agent send` types text without
pressing Enter, so a send-only nudge never lands. Workers run in **auto mode**
(`--permission-mode auto` above) so they don't stall on routine permission
prompts while the user is away. If one still goes `blocked` — the auto-mode
classifier denied something — tell the user which tab needs a click rather
than working around it.
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

## Usage limits — park and resume, never stop

A usage or rate limit (yours or a worker's) never ends the run and never
waits on the user. When one hits:

1. Note where the run stands — items done, dispatched, still pending — so
   the resume turn doesn't have to reconstruct it.
2. Park with a background timer: `Bash` `sleep 1800` with
   `run_in_background: true` (foreground sleep is blocked; the background
   command re-invokes you when it exits). If the limit message names a reset
   time, sleep until just past that instead of the default 30 min.
3. On wake, retry: nudge limited workers with
   `herdr pane run <pane_id> "continue"`, respawn any that died, dispatch
   the next pending items. Resume from the state note — don't re-read
   files or diffs already reviewed. Still limited? Park again. Repeat
   until work flows.

Cadence is deliberately loose — 30 min or longer is fine. The goal is that
when limits reset the run picks itself back up while the user is away, not
that it resumes on the exact minute. Leave worker tabs open across a park:
a limited worker resumes with a nudge; it doesn't need a fresh spawn.

## Phase 4 — Verify & close

- Run the full relevant test suites yourself (don't trust worker claims).
- Compare results against the plan's gates/artifacts; report honestly,
  including failures and skipped items.
- Decisions that shaped the outcome → dated ADR (append-only, supersede never
  edit). Update the plan banner to IMPLEMENTED with the date. No docs that
  restate code.
