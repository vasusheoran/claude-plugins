---
name: cleanup
description: Use when tidying local branches after merges — "clean up branches", "delete merged branches", "prune stale branches", "remove old local branches", or pruning remote-tracking refs that point at deleted remotes. Only removes branches already merged into the integration branch, and confirms first.
---

# git:cleanup

Prune stale remote-tracking refs and delete local branches that are fully merged
into the integration branch. Conservative by default: only merged branches, never
the current or integration branch, always confirm.

**REQUIRED BACKGROUND:** read `$CLAUDE_PLUGIN_ROOT/references/context.md` for the
context vars and guardrails.

## Steps

1. **Resolve context:** `eval "$(bash "$CLAUDE_PLUGIN_ROOT/scripts/gitctx.sh")"`.
2. **Prune dead remote refs:** `git fetch --prune $upstream_remote`
   (and `$push_remote` too if `$fork_mode` is true).
3. **List merged local branches**, excluding the integration and current branch:
   ```bash
   git branch --merged $upstream_ref | sed 's/^[* ] //' \
     | grep -vxE "$default_branch|$current_branch"
   ```
4. **Show the list and confirm.** Present the exact branches to the user. Delete only
   after an explicit yes. Never assume.
5. **Delete (safe flag):** `git branch -d <branch>` per confirmed branch. `-d` refuses
   anything not merged — do NOT reach for `-D` to override that; an unmerged branch that
   looks stale may hold unpushed work. If `-d` refuses, surface it and ask.
6. **Squash-merged branches.** `--merged` misses branches merged via squash/rebase (the
   commits differ). Don't guess — mention that such branches won't appear, and only
   force-delete one if the user names it and confirms the PR is merged.
7. **Report** what was pruned and deleted.

## Common mistakes

- `git branch -D` to force-delete "stale-looking" branches — may destroy unpushed work;
  stick to `-d` unless the user explicitly confirms a specific branch.
- Deleting the integration or current branch — excluded in step 3.
- Assuming `--merged` catches squash-merged PRs — it doesn't (step 6).
