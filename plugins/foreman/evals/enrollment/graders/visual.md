---
type: llm
weight: 1
---

For each open decision the reply names the specific visual it would show, chosen for that decision (diagram, stepped animation, interactive, chart from real data, before/after). One generic 'a diagram' for everything fails.

PASS example: Enrollment flow per OS -> sequence diagram; ipv6 check results -> before/after table from a real machine; live-monitoring scope -> clickable site/org tree mock.

FAIL example: It names no visuals, or only says it will draw a diagram of the plan.
