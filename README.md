# claude-plugins

Personal [Claude Code](https://claude.ai/code) plugins by [@vasusheoran](https://github.com/vasusheoran).

## Install

### Add this marketplace

```
/plugin marketplace add https://github.com/vasusheoran/claude-plugins
```

### Install a plugin

```
/plugin install homelab
```

### Reload after updates

```
/reload-plugins
```

---

## Plugins

### `homelab`

Homelab infrastructure management — Proxmox, self-hosted services, Cloudflare tunnels.

| Command | Description |
|---------|-------------|
| `/homelab:handoff` | Generate a session handoff doc summarising what changed, current infra state, and what's next |

**Install individually:**
```
/plugin install homelab
```

---

## Adding a New Plugin

1. Create a directory under `plugins/<your-plugin-name>/`
2. Add `.claude-plugin/plugin.json` with name, description, author
3. Add commands in `commands/<name>.md` and/or skills in `skills/<name>/SKILL.md`
4. Update `marketplace.json` with the new plugin entry and latest commit SHA
5. Push and run `/reload-plugins`

## Structure

```
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json       ← marketplace registration
├── README.md
└── plugins/
    └── homelab/               ← homelab plugin
        ├── .claude-plugin/
        │   └── plugin.json
        ├── README.md
        └── commands/
            └── handoff.md
```
