#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
PORT=${PORT:-8090}
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "local edits on server - stop"; git status -s; exit 1; }
OLD=$(git rev-parse HEAD)
git fetch -q origin main || { echo "fetch failed - nothing changed"; exit 1; }
[ "$(git rev-parse origin/main)" = "$OLD" ] && { echo "already up to date ($(git rev-parse --short HEAD))"; exit 0; }
cp -a data "bak-data-$(date +%Y%m%d-%H%M)" || { echo "data backup failed - nothing changed"; exit 1; }
git merge -q --ff-only origin/main || { echo "cannot fast-forward - stop"; exit 1; }
docker compose up -d --build 2>&1 | tail -2
ok=0
for i in $(seq 20); do sleep 2
  curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && curl -sf "http://127.0.0.1:$PORT/api/v1/time" >/dev/null && { ok=1; break; }
done
if [ $ok = 1 ]; then echo "DEPLOYED $(git rev-parse --short HEAD)"
else echo "HEALTH CHECK FAILED - rolling back"; git reset -q --hard "$OLD"; docker compose up -d --build 2>&1 | tail -2; echo "rolled back to $(git rev-parse --short HEAD)"; fi
