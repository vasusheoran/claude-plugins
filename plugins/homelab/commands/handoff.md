---
description: Pause the session — write a handoff to the central ~/handoffs repo that /resume can pick up later
---

Write a handoff so a fresh session (with none of this conversation) can resume the work. Works in any project. All handoffs live in one git repo, `~/handoffs/`, one folder per project.

## Steps

1. Work out the project name: in a git repo, `basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"` (this resolves worktrees to their main repo); otherwise `basename "$PWD"`.
2. Collect state: `git branch --show-current`, `git status --short`, `git log --oneline -5`. Skip if not a git repo.
3. `cd ~/handoffs && git pull -q` (skip the pull if there's no remote).
4. If a `status: paused` handoff in `~/handoffs/<project>/` covers the same topic as this session, update that file instead of creating a new one.
5. Otherwise write `~/handoffs/<project>/handoff-<topic-slug>--<YYYY-MM-DD>.md` using the template below (append `-2` if taken). Don't ask for a name: `/resume` lists handoffs, so nobody has to remember it.
6. `git add -A && git commit -m "pause: <project>/<topic>"`, then `git push` if a remote exists.
7. Print the path and the `next` line.

## Template

```markdown
---
status: paused
date: 2026-10-15T14:30         # local time
project: kuchbhi
topic: guard-ratelimit         # same as the filename slug
tags: [guard, control-plane]   # services/areas touched + reason (bug, research, deploy…)
cwd: /abs/path/session/ran/in  # worktree path if any
branch: feat/x
next: One concrete action the next session should do first
---

# <Topic>: handoff

## Goal
<!-- What we're trying to achieve, and what "done" looks like. -->

## Done
<!-- What changed this session and the result. Name actual files, IDs, hosts, URLs. -->

## State
<!-- Where things stand right now: uncommitted work, open PRs, running processes, deployed vs not, anything mid-flight. -->

## Decisions
<!-- Choices made and why, so the next session doesn't re-litigate them. -->

## Dead ends
<!-- What was tried and failed, and why. -->

## Open questions
<!-- Anything blocked on the user or unknown. -->

## Next
<!-- Ordered list. First item matches `next:` above. -->
```

## Rules

- Write for a reader with zero context: specifics (paths, commands, IDs, error text) over summaries.
- Bullets over paragraphs. Write "None" for empty sections rather than omitting them.
- Never put secrets in the file. Name where they live (e.g. a Vault path) instead.
- `/handoff done`: the work is finished. Fold anything durable into the project's own docs (ADR, TASKS, reference), then `git rm` the handoff, commit `done: <project>/<topic>`, and push. Git history is the archive.
