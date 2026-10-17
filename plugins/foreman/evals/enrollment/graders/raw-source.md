---
type: llm
weight: 1
---

The reply names the rawest primary source a top professional would start from and how it would read it: the real installer logs and failed-enrollment records from actual devices, packet captures of DNS on a real Windows/Linux/Mac machine, or the user's own enrollment records. Reading docs or the existing README does not count.

PASS example: It would read installer logs from real failed Windows installs and run a packet capture on a real machine to see which resolver answers (v4 vs v6), and says what it looks for in each.

FAIL example: It plans to read the product docs or the current install script only, or says to 'look at the installer'.
