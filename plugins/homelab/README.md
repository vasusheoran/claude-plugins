# Homelab Plugin

Claude Code plugin for managing and documenting the homelab — Proxmox, self-hosted services, Cloudflare tunnels, and infrastructure.

## Commands

| Command | Description |
|---------|-------------|
| `/homelab:handoff` | Pause: write a handoff to the central ~/handoffs git repo (`done` deletes it) |
| `/homelab:resume` | List paused handoffs in ~/handoffs, pick one, check drift, continue |

## Adding More Commands

Drop a new `.md` file into `commands/` with this frontmatter:

```markdown
---
description: One-line description shown in the command list
---

Your command instructions here...
```
