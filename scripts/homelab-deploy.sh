#!/usr/bin/env bash
#
# Stage a built God's Eye View release on the homelab host (a Mac mini M4, in
# our case) and, if a LaunchAgent is installed, restart the server onto it.
#
# WHY A RELEASE DIRECTORY AND NOT `rsync` OVER THE LIVE ONE. A running preview
# server holds the served directory open. Writing files into it one at a time
# means there is a window in which the page is half of one build and half of
# another — and on this app that window looks like a working map with a stale
# bundle, which is exactly the kind of quiet wrongness the dead-reckon problem
# set is about. So a release is written to its own directory and swapped in with
# a single atomic symlink move.
#
# Environment:
#   GEV_DEPLOY_ROOT     Where releases live. Default: ~/gev-deploy
#   GEV_LAUNCHD_LABEL   User LaunchAgent to kickstart. Default: com.gev.preview
#                       (skipped, with a note, when it is not loaded)
#   GEV_KEEP_RELEASES   How many old releases to keep. Default: 5
#
# Usage:
#   ./scripts/homelab-deploy.sh            stage and restart
#   ./scripts/homelab-deploy.sh --dry-run  print what it would do
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ROOT="${GEV_DEPLOY_ROOT:-$HOME/gev-deploy}"
LAUNCHD_LABEL="${GEV_LAUNCHD_LABEL:-com.gev.preview}"
KEEP="${GEV_KEEP_RELEASES:-5}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
RELEASE_DIR="$DEPLOY_ROOT/releases/$STAMP"
CURRENT_LINK="$DEPLOY_ROOT/current"

if [ ! -d "$REPO_ROOT/dist" ]; then
  echo "error: $REPO_ROOT/dist does not exist — run 'npm run build' first." >&2
  exit 1
fi

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "would run: $*"
  else
    "$@"
  fi
}

echo "release      $STAMP"
echo "deploy root  $DEPLOY_ROOT"

run mkdir -p "$DEPLOY_ROOT/releases"
# Two deploys of the same commit inside the same second collide on the stamp.
# `cp -R src existing-dir` would nest the build as <release>/dist and serve a
# directory listing instead of the app, so a colliding release is replaced.
run rm -rf "$RELEASE_DIR"
run cp -R "$REPO_ROOT/dist" "$RELEASE_DIR"

# Symlink to a temp name, then rename over `current`, so the served path is
# never absent. The rename must NOT follow the existing symlink: a plain `mv`
# would drop the new link INSIDE the old release directory and leave `current`
# pointing at the previous build with no error. BSD/macOS spells that -h, GNU
# spells it -T; the runner is a Mac mini but this also has to work when someone
# runs it on Linux to check it.
if mv --version >/dev/null 2>&1; then MV_NO_DEREF=(mv -Tf); else MV_NO_DEREF=(mv -fh); fi
run rm -f "$CURRENT_LINK.tmp"
run ln -s "$RELEASE_DIR" "$CURRENT_LINK.tmp"
run "${MV_NO_DEREF[@]}" "$CURRENT_LINK.tmp" "$CURRENT_LINK"
echo "current   -> $RELEASE_DIR"

# Prune old releases, newest first, never touching the one just published.
if [ "$DRY_RUN" = "0" ] && [ -d "$DEPLOY_ROOT/releases" ]; then
  # shellcheck disable=SC2012 # names are timestamp-prefixed, so ls order is fine
  ls -1 "$DEPLOY_ROOT/releases" | sort -r | tail -n "+$((KEEP + 1))" | while read -r old; do
    [ "$old" = "$STAMP" ] && continue
    echo "pruning      $old"
    rm -rf "${DEPLOY_ROOT:?}/releases/${old:?}"
  done
fi

# Restarting is OPTIONAL. A homelab that serves this by some other means (a
# reverse proxy pointed at `current`, a container, nothing at all yet) is a
# perfectly good setup, and a missing LaunchAgent must not fail a good build.
if launchctl list "$LAUNCHD_LABEL" >/dev/null 2>&1; then
  echo "restarting   $LAUNCHD_LABEL"
  run launchctl kickstart -k "gui/$(id -u)/$LAUNCHD_LABEL"
else
  echo "note: LaunchAgent '$LAUNCHD_LABEL' is not loaded — nothing restarted."
  echo "      The release is staged at $CURRENT_LINK; see docs/HAWAII-DEAD-RECKON.md"
  echo "      for the LaunchAgent template, or serve that path however you prefer."
fi

echo "done."
