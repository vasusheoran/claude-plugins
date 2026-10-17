---
max_turns: 30
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch]
---

Test context: you have no access to the codebase, production data, or the canvas tools in this session. Where you would read code or data, name exactly what you would read and why, then continue as if planning. Present any plan in your reply and stop at the point where you would wait for the user's approval. Product context: Zaksha is a DNS-based content-filtering SaaS (Go control plane, a DNS resolver called guard, a React PWA, device agents on Windows/macOS/Linux/Android/iOS).

Chrome has its own DNS client that ignores Windows' setting -  we saw this "Secure DNS" earlier and fixed it somehow. I dont remember how though. It should be documented somewhere.
The failures are at the edges - We should give exceptions. These can be configured at org level. Like zaksha being one. Others would be hotel login page etc. This would guide that if zaksha is not reachable then we use public dns for these exceptions. This can be very well taken to home too. We saw this exact failure in malaysia airlines when connecting to in flight system "mhconnect.malaysiaairlines.com".
