---
type: llm
weight: 1
---

The reply lists at least two unrequested things a top professional would do, with specific methods or tools (e.g. public suffix list handling, CDN ownership data, label-count distribution), and an outside oracle (not Claude, not the user).

PASS example: It uses the Public Suffix List to split registrable domains, and checks CDN mapping against a public ASN/CNAME-chain lookup as an independent source.

FAIL example: It says 'handle edge cases' or the only check is the user reviewing the dashboard.
