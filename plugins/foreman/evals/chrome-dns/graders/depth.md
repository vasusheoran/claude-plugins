---
type: llm
weight: 1
---

The reply lists at least two unrequested things a top professional would do, with specific methods or tools (e.g. captive-portal detection, DoH policy via registry, testing on a flight or a simulated captive portal), and an outside oracle (not Claude, not the user).

PASS example: It tests with Chrome's own net-internals and a captive-portal simulator, using the OS-level `Resolve-DnsName` and a public resolver as the independent oracle.

FAIL example: It says 'test the exceptions' with no named tool, or only the user confirms.
