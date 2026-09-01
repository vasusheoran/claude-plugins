# git:* shared context — per-repo config & guardrails

Every `git:*` skill starts by resolving the repo's workflow context, then applies
the same safety rules. This file is the single source of truth for both; the
skills link here instead of restating it.

## Resolving context (run this first, always)

```bash
eval "$(bash "$CLAUDE_PLUGIN_ROOT/scripts/gitctx.sh")"
# If $CLAUDE_PLUGIN_ROOT is unset, find the script relative to this plugin:
#   eval "$(bash "$(dirname "$(find ~/.claude -path '*plugins/git/scripts/gitctx.sh' | head -1)")/gitctx.sh")"
```

That exports these shell vars for the rest of the skill:

| Var | Meaning |
|---|---|
| `$default_branch` | integration branch — `main` / `master` / `develop` / … |
| `$upstream_remote` | remote holding the canonical branch (`origin`, or `upstream` in a fork) |
| `$push_remote` | remote your feature branches are pushed to (usually `origin`) |
| `$fork_mode` | `true` when `upstream_remote` != `push_remote` |
| `$upstream_ref` | `$upstream_remote/$default_branch` — what you rebase/branch onto |
| `$current_branch` | checked-out branch (`''` if detached) |

Each value is an explicit `git config claudegit.*` key if set, else auto-detected.
Never hard-code `main`/`origin` in a skill — read these vars.

## Per-repo overrides (git config keys)

Detection is right for almost every repo. Override only when it guesses wrong or
you want a non-default (run once per clone; lives in `.git/config`, not shared):

```bash
git config claudegit.defaultbranch  develop     # e.g. GitFlow integration branch
git config claudegit.upstreamremote upstream     # force the canonical remote
git config claudegit.pushremote     origin        # where feature branches go
git config claudegit.forkmode       true          # force fork behaviour
```

`git config --get-regexp '^claudegit\.'` shows what a repo has set.

## Guardrails (apply to every git:* skill)

1. **Inspect before mutating.** Run `git status --porcelain`, `git branch --show-current`,
   and `git fetch` (read-only) before any command that rewrites history or moves refs.
2. **Never rewrite the integration branch.** Refuse to rebase, reset, or force-push
   `$default_branch` or any branch someone else may have pulled.
3. **No bare force-push.** Only ever `git push --force-with-lease`, and only after
   telling the user which ref moves and getting a yes. Never `push -f`.
4. **Clean tree first.** If `git status --porcelain` is non-empty, stop and offer to
   stash (`git stash push -u`) — never silently discard or commit the user's changes.
5. **Honor CLAUDE.md worktree rule.** In repos whose CLAUDE.md keeps the main checkout
   on the integration branch (e.g. bastion), do feature work in a worktree, not here.
6. **Report, don't assume.** After acting, show the resulting `git status -sb` /
   `git log --oneline -3` so the user sees the real state.
