---
description: Generate a homelab session handoff document in docs/
---

Generate a structured handoff document summarising this homelab session.

## Steps

1. Run `git diff --name-status HEAD` and `git status --short` to collect file changes.
2. Run `git log --oneline -5` for recent commit context.
3. Review the conversation context for: services configured, IPs/configs changed, issues encountered, commands run on Proxmox/LXCs, and what was documented.
4. **Determine the output file:**
   - Use the naming convention: `handoff-<service(s)>--<YYYY-MM-DD>.md`
     - e.g. `handoff-cloudflare-n8n--2026-05-27.md`, `handoff-proxmox-setup--2026-05-27.md`
   - Ask the user using AskUserQuestion with two options:
     - **Suggested name** — show the suggested filename in the option description
     - **Custom name** — the user provides their own filename via the "Other" free-text option
   - All files go in the `docs/` directory (create it if it doesn't exist).
5. Write the handoff document to the chosen path with the sections below.

## Required Sections

```markdown
# Homelab Session Handoff — {YYYY-MM-DD}

## What Was Done
<!-- One subsection per service/task. For each: what changed, why, and result. -->

## Infrastructure State
<!-- Current known IPs, services, and their status after this session. Only include what was touched or verified. -->

## What Worked
<!-- Approaches, commands, or patterns that were effective. -->

## What Didn't Work
<!-- Dead ends, failed approaches, permission issues, things to avoid next time. -->

## Known Issues
<!-- Bugs, misconfigurations, TODOs, or unresolved problems. -->

## Files Changed
<!-- List from git diff/status. Group by area if useful (homelab docs, plugin, config). -->

## What's Next
<!-- Prioritised list of follow-up tasks for the next session. -->
```

## Rules

- Be concise — bullet points over paragraphs.
- Include actual IPs, CTIDs, hostnames, and service names — this is an ops doc, specifics matter.
- If a service is now reachable via a public URL, note it explicitly.
- If there are no changes to report for a section, write "None" rather than omitting it.
- Always create the `docs/` directory if it doesn't exist.
