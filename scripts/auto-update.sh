#!/usr/bin/env bash
# Runs on the server every hour (systemd timer). If GitHub has new commits on
# the branch, pull, rebuild and restart. Otherwise do nothing.
set -euo pipefail
DIR="/opt/assistant"
cd "$DIR"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi
echo "[auto-update] $(date -Is) updating $LOCAL -> $REMOTE"
git reset -q --hard "origin/$BRANCH"
docker compose up -d --build 2>&1 | tail -3
docker image prune -f >/dev/null 2>&1 || true
echo "[auto-update] $(date -Is) done"
