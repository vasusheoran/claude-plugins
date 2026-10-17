---
type: llm
weight: 1
---

The reply contains a plan skeleton with all four: tasks, phases, a validation step per task, the files or areas changed, and a revalidation step after deploy. Judge by explicit labels in the reply: it must have a validation stated for each task (not one global 'test it' line) AND a separate step about re-checking after deploy/release on the live system. If either is missing, FAIL, even if tasks and phases are present.

PASS example: A table or list gives tasks by phase, each with its own validation, the areas touched (installer script, agent, control plane, monitoring UI) and a post-deploy re-check on real machines.

FAIL example: It lists tasks with no per-task validation, or omits the post-deploy revalidation.
