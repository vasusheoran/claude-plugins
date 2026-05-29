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

### `statusline`

Claude Code status line — model, 5h rate limit (progress bar), 7d rate limit (%), context window usage (%).

| Command | Description |
|---------|-------------|
| `/statusline:setup` | Install or reinstall the status line script and wire it into settings |

**Install individually:**
```
/plugin install statusline
```

---

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
    ├── homelab/
    │   ├── .claude-plugin/
    │   │   └── plugin.json
    │   ├── README.md
    │   └── commands/
    │       └── handoff.md
    └── statusline/
        ├── .claude-plugin/
        │   └── plugin.json
        ├── README.md
        └── skills/
            └── setup/
                └── SKILL.md
```
