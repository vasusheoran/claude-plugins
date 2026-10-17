---
type: llm
weight: 1
---

The reply lists at least two things a top professional would do that the user did not ask for, with specific methods or tools, and names an outside oracle (not Claude, not the user) that shows the result is right.

PASS example: It proposes a clean-VM matrix per OS, a dnsleaktest-style external check, and `dig`/`nslookup` against a public resolver as the oracle that DNS really goes through Zaksha.

FAIL example: It says 'test thoroughly' or 'add checks', or the only verifier is the agent or the user eyeballing it.
