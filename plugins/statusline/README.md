# statusline

Claude Code status line — shows model, 5-hour rate limit (progress bar), 7-day rate limit (%), and context window usage (%).

## Format

```
Claude Sonnet 4.6  5h:[████████░░░░░░░░░░░░] 42%  7d:18%  ctx:42%
```

## Install

```
/plugin install statusline
```

## Usage

```
/statusline:setup
```

Installs or reinstalls `~/.claude/statusline-command.sh` and wires it into `~/.claude/settings.json`.
