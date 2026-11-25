#!/usr/bin/env bash
# Auto-deploy (25 Nov 2026): run by cron every 5 minutes ON THE SERVER. Deploys origin/main with the normal deploy.sh (backup, fast-forward,
# rebuild, health check, automatic rollback) once GitHub's "Tests" job has PASSED for that exact commit. Pull-based: nothing reaches into
# the server and no secret is stored. A commit that fails CI, fails to deploy or is rolled back is not retried (until a newer commit).
# Pause: touch ~/.no-autodeploy   Resume: rm ~/.no-autodeploy   Log: ~/autodeploy.log
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
[ -e "$HOME/.no-autodeploy" ] && exit 0
exec 9>/tmp/crowsnest-autodeploy.lock; flock -n 9 || exit 0
REPO=pablodiablo83/crowsnest; MARK="$HOME/.autodeploy-failed"; LOG="$HOME/autodeploy.log"
[ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 300000 ] && tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
say() { echo "$(date '+%F %T') $*" >> "$LOG"; }
git fetch -q origin main 2>/dev/null || exit 0
NEW=$(git rev-parse origin/main); CUR=$(git rev-parse HEAD)
[ "$NEW" = "$CUR" ] && exit 0
[ "$NEW" = "$(cat "$MARK" 2>/dev/null)" ] && exit 0
# decide from GitHub's check runs for that commit (public repo, no token): wait | go | stop
verdict() { python3 -c '
import json,sys
try: runs=json.load(sys.stdin).get("check_runs",[])
except Exception: print("wait"); sys.exit()
t=[r for r in runs if r.get("name")=="test"]
if not t: print("wait")
elif any(r.get("status")!="completed" for r in t): print("wait")
elif all(r.get("conclusion")=="success" for r in t): print("go")
else: print("stop")'; }
V=$(curl -sf -m 20 "https://api.github.com/repos/$REPO/commits/$NEW/check-runs?per_page=100" | verdict) || exit 0
case "$V" in
  wait) exit 0 ;;
  stop) say "skip ${NEW:0:7}: tests failed on GitHub"; echo "$NEW" > "$MARK"; exit 0 ;;
esac
say "deploying ${NEW:0:7} (tests passed)"
OUT=$(./deploy.sh 2>&1 | tail -4); say "$(echo "$OUT" | tr '\n' ' ')"
echo "$OUT" | grep -q "^DEPLOYED" || echo "$NEW" > "$MARK"
