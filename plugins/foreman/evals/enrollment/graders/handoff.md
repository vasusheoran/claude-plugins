---
type: llm
weight: 1
---

The user asked 'Give me a prompt for this'. After presenting the plan the reply offers to write a prompt.md (approved plan plus the brief) once the user approves, rather than only dumping a prompt inline or ignoring the request. PASS needs the literal file name prompt.md offered as a step after the user approves the plan. Pasting a prompt inline, or asking clarifying questions, without that offer is a FAIL.

PASS example: It ends with: once you approve I will write prompt.md containing the approved plan and the checks, for you to paste into another session.

FAIL example: It pastes a prompt inline with no approval step, or never mentions a prompt file or the handoff.
