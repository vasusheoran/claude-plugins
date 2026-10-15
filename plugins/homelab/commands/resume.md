---
description: Resume paused work — list handoffs in ~/handoffs, pick one, check drift, continue
argument-hint: "[all | search words]"
---

Resume work from a handoff written by `/handoff`. Handoffs live in the git repo `~/handoffs/<project>/`.

## Steps

1. `cd ~/handoffs && git pull -q` (skip if there's no remote).
2. Build the candidate list from files with `status: paused` in their frontmatter:
   - No argument: only the current project's folder (project name derived as in `/handoff`). If it's empty, fall back to all projects.
   - `all`: every project.
   - Any other words: every project, keeping files whose filename or frontmatter (`topic`, `tags`, `next`) match any of the words.
3. Pick:
   - Exactly one candidate: use it.
   - Several: ask with AskUserQuestion, newest four as options. Label = topic, description = `project · date · next`. If there are more than four, list the rest in your message so "Other" can name one.
   - None: say so and show `ls ~/handoffs/*/` so the user can see what exists.
4. Read the chosen file fully. If its `cwd` differs from the current directory, tell the user and suggest `cd`-ing there (or recreating the worktree) before continuing.
5. Check drift: compare `branch` with `git branch --show-current`, run `git status --short` and `git log --oneline --since="<date>"`. Note anything that no longer matches the State section.
6. Report in a few lines: goal, where it stands, drift, and the `next` action. Ask before anything outward-facing; otherwise start on `next`.

The file stays `paused` while you work. When pausing again, `/handoff` updates this same file. When the work is finished, `/handoff done` removes it.
