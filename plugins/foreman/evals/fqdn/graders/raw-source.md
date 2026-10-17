---
type: llm
weight: 1
---

The reply names the rawest primary source: real query logs from guard / the logs DB for a real tenant, or packet captures of real resolutions, and says how it would read it (e.g. count distinct FQDNs per registrable domain).

PASS example: It would pull a day of real guard query logs and group by registrable domain to see how many subdomain FQDNs exist, and where blocks hit.

FAIL example: It would read the DNS RFCs or the guard README.
