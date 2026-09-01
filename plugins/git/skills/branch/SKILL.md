---
name: branch
description: Use when starting a new feature branch off an up-to-date base — "create a branch", "start a feature branch", "new branch off main/upstream", "branch for this work". Fetches the latest integration branch first so the new branch isn't based on stale history.
---

# git:branch

Create a feature branch from the latest `$upstream_ref` — fetch first so it starts
from current history, not whatever the local repo happens to have.

**REQUIRED BACKGROUND:** read `$CLAUDE_PLUGIN_ROOT/references/context.md` for the
context vars and guardrails.

## Steps

1. **Resolve context:** `eval "$(bash "$CLAUDE_PLUGIN_ROOT/scripts/gitctx.sh")"`.
2. **Get a name.** If the user gave one, use it; else propose a `feat/<slug>` from the
   task. Keep the repo's existing convention if branches reveal one (`fix/`, `chore/`).
3. **Clean tree.** `git status --porcelain`; if non-empty, offer to stash before
   switching so changes aren't stranded on the old branch.
4. **Fetch the base:** `git fetch $upstream_remote`.
5. **Create from the fresh base:** `git switch -c <name> $upstream_ref`.
   (`git checkout -b <name> $upstream_ref` on older git.)
6. **Worktree check.** If this repo's CLAUDE.md keeps the main checkout pinned to the
   integration branch (e.g. bastion → `scripts/wt.sh new <name>`), prefer a worktree
   over branching in place — mention it and follow the repo's rule.
7. **Report:** confirm the new branch and its base with `git status -sb`.

## Common mistakes

- Branching off stale local `$default_branch` without fetching — step 4 avoids basing
  work on old history.
- Branching off the current feature branch by accident — always base on `$upstream_ref`
  unless the user explicitly wants to stack on the current branch.
- Ignoring a repo's worktree workflow — step 6.
