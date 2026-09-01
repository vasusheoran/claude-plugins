---
name: rebase
description: Use when rebasing the current feature branch onto an up-to-date integration branch (main/master/develop or an upstream fork's default) — "rebase onto main", "update my branch", "rebase before merge", resolving rebase conflicts, or catching a branch up to the latest base.
---

# git:rebase

Rebase the current feature branch onto a freshly-fetched integration branch, so
its commits replay on top of the latest base. Auto-detects the base branch and
whether this is a fork; never touches the integration branch itself.

**REQUIRED BACKGROUND:** read `$CLAUDE_PLUGIN_ROOT/references/context.md` — it
defines the context vars and the guardrails every step below depends on.

## Steps

1. **Resolve context** (see reference): `eval "$(bash "$CLAUDE_PLUGIN_ROOT/scripts/gitctx.sh")"`.
2. **Refuse the bad target.** If `$current_branch` equals `$default_branch` (or is
   empty/detached), STOP — you don't rebase the integration branch. Tell the user to
   check out a feature branch (or use `git:sync` to update the base).
3. **Clean tree.** `git status --porcelain`; if non-empty, offer `git stash push -u`
   and remember to pop after. Never discard.
4. **Fetch the base.** `git fetch $upstream_remote` (read-only).
5. **Rebase.** `git rebase $upstream_ref`.
6. **On conflict — STOP, don't guess.** Show `git status`, list conflicted files, and
   hand control to the user: they resolve, then `git rebase --continue`; or you abort
   with `git rebase --abort` on their say-so. Never auto-resolve or `-X theirs/ours`
   unless the user explicitly asks.
7. **Restore.** If you stashed in step 3, `git stash pop`.
8. **Offer the push.** If the branch was already pushed to `$push_remote`, its history
   diverged — offer exactly `git push --force-with-lease $push_remote $current_branch`,
   name the ref, and wait for yes. Never `push -f`. If it was never pushed, a normal
   push suffices.
9. **Report.** Show `git log --oneline -5` and `git status -sb`.

## Common mistakes

- Rebasing `$default_branch` — refuse (step 2).
- `git push -f` after rebase — clobbers teammates' work; only `--force-with-lease`.
- Auto-resolving conflicts — you'll pick wrong; stop and let the user decide.
- Rebasing a branch others share — warn first; rewriting shared history breaks them.
- Hard-coding `origin/main` — read `$upstream_ref`; in a fork it's `upstream/main`.
