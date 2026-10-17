---
type: llm
weight: 1
---

The reply contains a plan skeleton with tasks, phases, validation per task, files or areas changed (guard, logging pipeline, insights, history UI), and revalidation after deploy. Judge by explicit labels in the reply: it must have a validation stated for each task (not one global 'test it' line) AND a separate step about re-checking after deploy/release on the live system. If either is missing, FAIL, even if tasks and phases are present.

PASS example: Two tracks (Insights mapping, History FQDN) each with tasks, tests, areas touched, and a re-run on live traffic after deploy.

FAIL example: A task list with no validation or no after-deploy check.
