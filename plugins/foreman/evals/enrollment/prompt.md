---
max_turns: 30
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch]
---

Test context: you have no access to the codebase, production data, or the canvas tools in this session. Where you would read code or data, name exactly what you would read and why, then continue as if planning. Present any plan in your reply and stop at the point where you would wait for the user's approval. Product context: Zaksha is a DNS-based content-filtering SaaS (Go control plane, a DNS resolver called guard, a React PWA, device agents on Windows/macOS/Linux/Android/iOS).

Now lets work on enrollment. We need to support windows/linux/mac. Currently for windows we download msi pack and installer script. Let use commands that will do so and set it up. We need thorough checks on trivias we encountered while setting this up like ipv6 etc, this can be a test to check all expected settings are correct and report so.

Then the command downloads the binary, installs. We also provide option to enterprise user for live monitoring per site/org level. They can dig and verify it works.

Give me a prompt for this.
