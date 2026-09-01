#!/usr/bin/env bash
# Behavior test for scripts/gitctx.sh — the per-repo context resolver shared by
# every git:* skill. Verifies git-config overrides win, and auto-detection is
# correct for direct-branch, master-named, and fork layouts.
#
# Run:  bash tests/test_gitctx.sh   (from the plugin root)
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
GITCTX="$HERE/scripts/gitctx.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0 fail=0
# assert KEY appears with exactly VALUE in the resolver output stored in $OUT
assert_line() {
  local key="$1" want="$2"
  local got
  got="$(printf '%s\n' "$OUT" | sed -n "s/^${key}=//p")"
  if [ "$got" = "$want" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "  FAIL [$CASE] $key: want '$want' got '$got'"
  fi
}

# Create a bare repo seeded with one commit on $branch, echo its path.
make_remote() {
  local name="$1" branch="$2" bare="$WORK/$1.git" seed="$WORK/$1-seed"
  git init -q --bare --initial-branch="$branch" "$bare"
  git init -q --initial-branch="$branch" "$seed"
  git -C "$seed" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  git -C "$seed" push -q "$bare" "$branch"
  echo "$bare"
}

run_ctx() { OUT="$(cd "$1" && bash "$GITCTX" 2>/dev/null)"; }

# ---- Case 1: direct repo, default branch 'main' -------------------------
CASE=direct-main
origin="$(make_remote origin-a main)"
git clone -q "$origin" "$WORK/c1"
run_ctx "$WORK/c1"
assert_line default_branch main
assert_line upstream_remote origin
assert_line push_remote origin
assert_line fork_mode false
assert_line upstream_ref origin/main

# ---- Case 2: direct repo, default branch 'master' -----------------------
CASE=direct-master
originm="$(make_remote origin-b master)"
git clone -q "$originm" "$WORK/c2"
run_ctx "$WORK/c2"
assert_line default_branch master
assert_line upstream_ref origin/master

# ---- Case 3: fork model — origin=fork, upstream=canonical ---------------
CASE=fork
canonical="$(make_remote canonical main)"
fork="$(make_remote fork main)"
git clone -q "$fork" "$WORK/c3"
git -C "$WORK/c3" remote add upstream "$canonical"
git -C "$WORK/c3" fetch -q upstream
git -C "$WORK/c3" remote set-head upstream -a >/dev/null 2>&1
run_ctx "$WORK/c3"
assert_line default_branch main
assert_line upstream_remote upstream
assert_line push_remote origin
assert_line fork_mode true
assert_line upstream_ref upstream/main

# ---- Case 4: git-config overrides beat detection ------------------------
CASE=override
git clone -q "$origin" "$WORK/c4"
git -C "$WORK/c4" config claudegit.defaultbranch develop
git -C "$WORK/c4" config claudegit.forkmode true
run_ctx "$WORK/c4"
assert_line default_branch develop      # override beats origin/HEAD=main
assert_line fork_mode true               # forced on despite single remote
assert_line upstream_ref origin/develop

echo "----"
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
