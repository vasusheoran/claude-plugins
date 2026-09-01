#!/usr/bin/env bash
# gitctx.sh — resolve this repo's git-workflow context for the git:* skills.
#
# Prints shell-friendly key=value lines to stdout:
#   default_branch=main         integration branch (main/master/develop/…)
#   upstream_remote=origin      remote that holds the canonical branch
#   push_remote=origin          remote feature branches are pushed to
#   fork_mode=false             true when upstream_remote != push_remote
#   upstream_ref=origin/main    <upstream_remote>/<default_branch>
#   current_branch=feat/x       checked-out branch ('' if detached)
#
# Resolution order for every value: an explicit `git config claudegit.*` key
# wins; otherwise it is auto-detected. Set overrides per clone, e.g.:
#   git config claudegit.defaultbranch master
#   git config claudegit.upstreamremote upstream
#   git config claudegit.pushremote origin
#   git config claudegit.forkmode true
set -u

cfg() { git config --get "$1" 2>/dev/null; }
have_remote() { git remote | grep -qx "$1"; }
ref_exists() { git show-ref --verify -q "refs/remotes/$1"; }

# --- upstream remote: config → an 'upstream' remote if present → origin ---
upstream_remote="$(cfg claudegit.upstreamremote)"
if [ -z "$upstream_remote" ]; then
  if have_remote upstream; then upstream_remote=upstream; else upstream_remote=origin; fi
fi

# --- push remote: config → origin if present → first remote ---
push_remote="$(cfg claudegit.pushremote)"
if [ -z "$push_remote" ]; then
  if have_remote origin; then push_remote=origin; else push_remote="$(git remote | head -1)"; fi
fi

# --- default branch: config → <upstream>/HEAD → main/master probe → HEAD ---
default_branch="$(cfg claudegit.defaultbranch)"
if [ -z "$default_branch" ]; then
  head_ref="$(git symbolic-ref --short "refs/remotes/$upstream_remote/HEAD" 2>/dev/null)"
  if [ -n "$head_ref" ]; then
    default_branch="${head_ref#"$upstream_remote"/}"
  elif ref_exists "$upstream_remote/main"; then
    default_branch=main
  elif ref_exists "$upstream_remote/master"; then
    default_branch=master
  else
    default_branch="$(git branch --show-current 2>/dev/null)"
    [ -z "$default_branch" ] && default_branch=main
  fi
fi

# --- fork mode: config → (upstream_remote != push_remote) ---
fork_mode="$(cfg claudegit.forkmode)"
if [ -z "$fork_mode" ]; then
  if [ -n "$push_remote" ] && [ "$upstream_remote" != "$push_remote" ]; then
    fork_mode=true
  else
    fork_mode=false
  fi
fi

printf 'default_branch=%s\n'  "$default_branch"
printf 'upstream_remote=%s\n' "$upstream_remote"
printf 'push_remote=%s\n'     "$push_remote"
printf 'fork_mode=%s\n'       "$fork_mode"
printf 'upstream_ref=%s\n'    "$upstream_remote/$default_branch"
printf 'current_branch=%s\n'  "$(git branch --show-current 2>/dev/null)"
