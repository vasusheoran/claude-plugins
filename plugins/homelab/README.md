# Homelab Plugin

Claude Code plugin for managing and documenting the homelab — Proxmox, self-hosted services, Cloudflare tunnels, and infrastructure.

## Commands

| Command | Description |
|---------|-------------|
| `/homelab:handoff` | Generate a session handoff document summarising what was done, what changed, and what's next |

## Adding More Commands

Drop a new `.md` file into `commands/` with this frontmatter:

```markdown
---
description: One-line description shown in the command list
---

Your command instructions here...
```
