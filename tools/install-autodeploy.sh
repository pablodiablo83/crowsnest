#!/usr/bin/env bash
# One-off, on the server: bash tools/install-autodeploy.sh   (adds the 5-minute cron entry; safe to run twice)
cd "$(dirname "$0")/.." || exit 1
chmod +x tools/autodeploy.sh deploy.sh
command -v python3 >/dev/null || { echo "python3 is missing: sudo apt install python3"; exit 1; }
command -v flock >/dev/null || { echo "flock is missing: sudo apt install util-linux"; exit 1; }
LINE="*/5 * * * * $PWD/tools/autodeploy.sh"
( crontab -l 2>/dev/null | grep -v "tools/autodeploy.sh"; echo "$LINE" ) | crontab -
echo "auto-deploy on: $LINE"
echo "pause: touch ~/.no-autodeploy | resume: rm ~/.no-autodeploy | log: tail ~/autodeploy.log"
