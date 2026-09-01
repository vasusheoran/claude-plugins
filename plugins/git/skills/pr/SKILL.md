---
name: pr
description: Use when pushing the current branch and opening a pull request — "open a PR", "raise a PR", "push and create a pull request", "PR against main/upstream". Targets the correct base (the canonical repo in a fork model) and pushes to the right remote.
---

# git:pr

Push the current feature branch to `$push_remote` and open a PR against the
integration branch — the canonical repo when this is a fork.

**REQUIRED BACKGROUND:** read `$CLAUDE_PLUGIN_ROOT/references/context.md` for the
context vars and guardrails.

## Steps

1. **Resolve context:** `eval "$(bash "$CLAUDE_PLUGIN_ROOT/scripts/gitctx.sh")"`.
2. **Guard the base branch.** If `$current_branch` equals `$default_branch`, STOP — you
   don't PR the integration branch into itself. Offer `git:branch` to move the work.
3. **Confirm the commits.** Show `git log --oneline $upstream_ref..$current_branch` so
   the user sees exactly what the PR will contain. If empty, there's nothing to PR.
4. **Push with tracking:** `git push -u $push_remote $current_branch`. If the remote
   branch exists and diverged (after a rebase), use `--force-with-lease` and confirm.
5. **Open the PR.** Use `gh pr create`. Base and head depend on the model:
   - **Direct** (`$fork_mode`=false): `gh pr create --base $default_branch`.
   - **Fork** (`$fork_mode`=true): PR the fork's branch into the canonical repo.
     Determine the canonical `owner/repo` from `git remote get-url $upstream_remote`
     and pass `--repo <owner/repo> --base $default_branch`; `gh` infers the fork head.
   Draft the title/body from the commits; keep it factual. Load the repo's PR template
   if one exists (`.github/PULL_REQUEST_TEMPLATE*`).
6. **Report** the PR URL `gh` prints.

## Common mistakes

- PRing against `origin/main` in a fork — the base is the *canonical* repo; step 5.
- Force-pushing without `--force-with-lease` — never; can drop others' commits.
- Inventing a summary — describe only what the diff/commits actually change.
- Skipping the repo's PR template or required checks — honor them.
