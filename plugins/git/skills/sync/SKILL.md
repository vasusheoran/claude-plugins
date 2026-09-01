---
name: sync
description: Use when updating the local integration branch to match its remote — "sync main", "pull latest", "update main/master", "get up to date with upstream", or fast-forwarding the default branch before branching or rebasing. In a fork, also updates your fork's copy of the default branch.
---

# git:sync

Fast-forward the local integration branch to the latest `$upstream_ref`. Pure
fast-forward — never a merge commit, never a rebase of local work.

**REQUIRED BACKGROUND:** read `$CLAUDE_PLUGIN_ROOT/references/context.md` for the
context vars and guardrails.

## Steps

1. **Resolve context:** `eval "$(bash "$CLAUDE_PLUGIN_ROOT/scripts/gitctx.sh")"`.
2. **Fetch + prune:** `git fetch --prune $upstream_remote`.
3. **Update the local default branch without checking it out** (keeps the user on
   their feature branch): `git fetch $upstream_remote $default_branch:$default_branch`.
   - This only succeeds as a fast-forward. If it's rejected, the local
     `$default_branch` has diverged (someone committed to it locally) — STOP, show
     `git log --oneline $default_branch ^$upstream_ref`, and ask before doing anything
     destructive. Do not reset it silently.
   - If `$current_branch` *is* `$default_branch`, use `git merge --ff-only $upstream_ref`
     instead so the working tree updates.
4. **Fork mode — refresh your fork's copy.** If `$fork_mode` is `true`, push the
   updated branch to your fork: `git push $push_remote $default_branch:$default_branch`.
   Confirm first if it would move a ref others use.
5. **Report:** `git log --oneline -3 $default_branch`.

## Common mistakes

- Merging upstream into a dirty default branch — this skill is fast-forward only;
  divergence is an error to surface, not to paper over with a merge.
- Rebasing/force-updating the default branch — never; that's not syncing.
- Forgetting fork mode — in a fork, syncing only the local branch leaves your fork's
  default stale; step 4 keeps them aligned.
