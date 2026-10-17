---
type: llm
weight: 1
---

The reply contains a plan skeleton with tasks, phases, validation per task, files or areas changed, and revalidation after deploy. Judge by explicit labels in the reply: it must have a validation stated for each task (not one global 'test it' line) AND a separate step about re-checking after deploy/release on the live system. If either is missing, FAIL, even if tasks and phases are present.

PASS example: Phases (FAQ content, bot webhook, subscriptions) each with tasks, a check, the services touched, and a post-deploy test message round trip.

FAIL example: A flat task list with no validation or no post-deploy step.
