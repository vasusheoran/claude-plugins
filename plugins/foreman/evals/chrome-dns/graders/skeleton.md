---
type: llm
weight: 1
---

The reply contains a plan skeleton with tasks, phases, validation per task, files or areas changed (agent, org settings, control plane, docs), and revalidation after deploy. Judge by explicit labels in the reply: it must have a validation stated for each task (not one global 'test it' line) AND a separate step about re-checking after deploy/release on the live system. If either is missing, FAIL, even if tasks and phases are present.

PASS example: Phases (document the fix, exception list, fallback logic) each with tasks, validation, areas touched, and a post-deploy check on a real Windows machine.

FAIL example: Tasks listed without validation or without post-deploy revalidation.
