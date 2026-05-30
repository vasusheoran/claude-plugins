---
description: Install or update the Claude Code status line — shows model, 5h rate limit (bar), 7d rate limit (%), and context usage (%)
---

Install or reconfigure the Claude Code status line script.

## Status line format

```
Claude Sonnet 4.6  5h:[████████░░░░░░░░░░░░] 42%  7d:18%  ctx:42%
```

Fields (in order):
- **model** — display name of the active model
- **5h** — 5-hour rate limit as a 20-char colored progress bar + percentage (green <50%, yellow <80%, red ≥80%)
- **7d** — 7-day weekly rate limit as percentage only
- **ctx** — context window usage as percentage only

Rate limit fields only appear when the API returns them (claude.ai subscription plans).

## Steps

1. Write the script below to `~/.claude/statusline-command.sh`.
2. Ensure `~/.claude/settings.json` has `statusLine` pointing to it.
3. Confirm both files were written correctly.

## Script

Write exactly this to `~/.claude/statusline-command.sh`:

```bash
#!/usr/bin/env bash
input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "unknown"')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

if [ -n "$used" ]; then
  pct=$(printf "%.0f" "$used")
  reset=$'\033[0m'

  ctx_str="ctx:${pct}%"

  # Rate limits — 5-hour with progress bar, 7-day percentage only
  five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
  week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
  rate_str=""
  if [ -n "$five_pct" ]; then
    five_n=$(printf "%.0f" "$five_pct")
    five_filled=$(( five_n * 20 / 100 ))
    five_bar=""
    for i in $(seq 1 $five_filled); do five_bar="${five_bar}█"; done
    for i in $(seq $((five_filled + 1)) 20); do five_bar="${five_bar}░"; done
    if [ "$five_n" -lt 50 ]; then
      five_color=$'\033[32m'
    elif [ "$five_n" -lt 80 ]; then
      five_color=$'\033[33m'
    else
      five_color=$'\033[31m'
    fi
    rate_str="5h:${five_color}[${five_bar}]${reset} ${five_n}%"
  fi
  if [ -n "$week_pct" ]; then
    week_n=$(printf "%.0f" "$week_pct")
    [ -n "$rate_str" ] && rate_str="${rate_str}  "
    rate_str="${rate_str}7d:${week_n}%"
  fi

  if [ -n "$rate_str" ]; then
    printf "%s  %s  %s" "$model" "$rate_str" "$ctx_str"
  else
    printf "%s  %s" "$model" "$ctx_str"
  fi
else
  printf "%s" "$model"
fi
```

## Settings

Ensure `~/.claude/settings.json` contains:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash /home/vasu/.claude/statusline-command.sh"
  }
}
```

If the file already has other keys, merge — do not overwrite them.

## Rules

- Use the Write tool to write the script file, not Bash echo/heredoc.
- After writing, confirm the script is executable or note that `bash` invocation doesn't require it.
- Do not add extra fields or modify the format unless the user explicitly asks.
