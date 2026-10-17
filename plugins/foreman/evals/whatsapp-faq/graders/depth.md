---
type: llm
weight: 1
---

The reply lists at least two unrequested things a top professional would do, with specific methods or tools, and an outside oracle (not Claude, not the user) that would show the result works.

PASS example: It adds a fallback-to-human path and an intent-match accuracy test on real past messages, and uses a real WhatsApp sandbox number plus Meta's delivery status webhooks as the oracle.

FAIL example: It says 'test the bot' or relies on the user trying it.
