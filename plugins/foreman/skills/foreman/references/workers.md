# Worker mechanics

Read this before spawning a worker. SKILL.md decides what to dispatch; this
file is how.

## Spawning a worker

herdr socket CLI (`herdr agent --help` for details). Start the worker, then
move its pane into its own labeled tab:

    herdr agent start foreman-<item> --workspace <ws-id> \
        --cwd <worktree-or-project> --no-focus -- \
        claude --model <haiku|sonnet|opus> --permission-mode auto \
        --setting-sources user,local "<self-contained prompt>"
    sleep 2   # the new agent takes a moment to show up in the list
    pane_id=$(herdr agent list | jq -r '.result.agents[] | select(.name=="foreman-<item>") | .pane_id')
    herdr pane move "$pane_id" --new-tab --workspace <ws-id> \
        --label foreman-<item> --no-focus
    # new tab id: .result.move_result.created_tab.tab_id
    # append "<item> foreman-<item> <pane_id> <tab_id>" to the stop roster

Two traps, both verified:

- A tab label containing `:` makes `herdr pane move` fail with a usage
  error. Use `foreman-<item>`.
- The output of `herdr agent start` does not parse as one JSON document in a
  script. Take the pane id from `herdr agent list` as above.

Find your own workspace id with `herdr pane current`. Do not use
`herdr tab create` + `agent start --tab`: that leaves a stray empty shell
pane in the tab and ignores the tab's cwd. Dispatch independent items in
parallel, one tab each, and tell the user the tab labels as you spawn them.

**Git worktree.** When the feature lives in a git worktree, pass the
worktree path as `--cwd`; it sets both the worker's working directory and
the tab cwd. No worktree → the project root. Trivial edits the orchestrator
applies itself land in the same worktree via `git -C <worktree>` or absolute
paths; the orchestrator's own tab stays on the main checkout (a live
session's cwd is fixed at launch).

**`--setting-sources user,local`** drops the project CLAUDE.md from each
worker (a large per-spawn token load; verified 2026-07-26) and keeps
subscription OAuth and local permission rules. Do not use `--bare`: it
disables OAuth and the worker starts logged out. So the worker prompt must
carry every repo rule the item touches. Each prompt is self-contained
(workers get no chat context): the exact files to touch, the contract
(inputs, outputs, invariants), the verification command, the TDD rule, and
the anti-ai-writing rules if the item writes prose. Give each worker only
its item's slice of the plan.

## Monitoring

- Wait with `herdr agent wait foreman-<item> --status idle --timeout <ms>`.
  Waiting costs nothing; don't poll with reads.
- Review the work through `git diff`, never the transcript. Read the pane
  only to spot-check TDD compliance or prose, capped:
  `herdr agent read foreman-<item> --source visible --lines 60`
  (`--source recent` can come back empty).
- Follow-ups go through `herdr pane run <pane_id> "<text>"`. `agent send`
  types without pressing Enter, so a send-only nudge never lands.
- Workers run in auto mode. If one still goes `blocked` (the classifier
  denied something), tell the user which tab needs a click rather than
  working around it.
- Close the tab with `herdr tab close <tab_id>` once its diff is reviewed
  and accepted.

## Agent teams

Default to one tab per worker. Use native Claude Code agent teams only when
workers must coordinate with each other mid-flight (shared task list or
mailbox) and the orchestrator can't sequence them instead.

Teams work under herdr with a bridge (verified 2026-07-26, Claude Code
v2.1.206). In tmux teammate mode with no surrounding tmux, the lead creates
a dedicated tmux server: socket `claude-swarm-<lead-pid>` in
`/tmp/tmux-$(id -u)/`, session `claude-swarm`, one window `swarm-view` with
one split pane per teammate. Nothing shows in herdr on its own.

1. Spawn the lead like any worker, adding `--env
   CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and `--env TERM_PROGRAM=`
   (blank). herdr panes inherit `TERM_PROGRAM=iTerm.app`; with it set the
   lead stops on an iTerm2-vs-tmux picker. Pass `--teammate-mode tmux` on
   the `claude` argv.
2. When the lead's status line prints `View teammates: tmux -L
   claude-swarm-<pid> a`, open one watch tab for the team:

       herdr agent start swarm-view --workspace <ws-id> --no-focus -- \
           tmux -L claude-swarm-<pid> attach -t claude-swarm
       # pane id from `herdr agent list` (name=="swarm-view")
       herdr pane move <pane_id> --new-tab --workspace <ws-id> \
           --label teams-swarm-view --no-focus

   Missed the status line? `ls /tmp/tmux-$(id -u)/` and take the newest
   `claude-swarm-*`. The teammate list at the bottom of the lead's TUI is
   an inline viewer, not where teammates run.
3. Cleanup: the swarm server dies with the lead and the attach tab dies
   with the server. Remove stale socket files in `/tmp/tmux-<uid>/`; if a
   swarm outlives its lead, `tmux -L claude-swarm-<pid> kill-server`.
