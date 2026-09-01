# git plugin

Day-to-day git workflow skills, invoked as `git:<skill>`.

| Skill | Does |
|---|---|
| `git:rebase` | Rebase the current feature branch onto a fresh integration branch |
| `git:sync` | Fast-forward the local integration branch to its remote |
| `git:branch` | Start a feature branch off an up-to-date base |
| `git:pr` | Push the branch and open a PR against the correct base |
| `git:cleanup` | Prune dead remote refs and delete merged local branches |

## Per-repo context

Skills never hard-code `main`/`origin`. `scripts/gitctx.sh` resolves each repo's
context — integration branch, upstream/push remotes, fork-vs-direct — from
`git config claudegit.*` keys (explicit override) with auto-detection as fallback.
See [`references/context.md`](references/context.md) for the vars, the override
keys, and the shared safety guardrails.

Override examples (per clone; `git config --get-regexp '^claudegit\.'` to inspect):

```bash
git config claudegit.defaultbranch  develop
git config claudegit.upstreamremote upstream
git config claudegit.forkmode       true
```

## Tests

```bash
bash tests/test_gitctx.sh   # resolver behaviour: direct / master / fork / overrides
```
