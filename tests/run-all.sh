#!/usr/bin/env bash
# Run every suite, each against its own fresh server (empty data) on port 8091. Usage: tests/run-all.sh [--no-browser]
# Needs: npm install (repo root); for the browser suites, Playwright + chromium (sandbox: /opt/pw-browsers, CI: npx playwright install).
set -u
cd "$(dirname "$0")/.." || exit 1
TMP=$(mktemp -d); trap 'fuser -k 8091/tcp >/dev/null 2>&1; rm -rf "$TMP"' EXIT
export NODE_PATH="$(npm root -g):$PWD/node_modules${NODE_PATH:+:$NODE_PATH}"
fail=0
fresh() {   # fresh [ENV=VAL...]
  fuser -k 8091/tcp >/dev/null 2>&1; sleep 0.3; rm -rf "$TMP/data"; mkdir -p "$TMP/data"
  (env DATA_DIR="$TMP/data" PORT=8091 "$@" node server.js > "$TMP/server.log" 2>&1 &)
  for i in $(seq 50); do curl -sf localhost:8091/healthz >/dev/null && return 0; sleep 0.2; done
  echo "server did not start"; tail -5 "$TMP/server.log"; return 1
}
run() {   # run NAME CMD...
  local out; out=$("${@:2}" 2>&1); local rc=$?
  if [ $rc -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; echo "$out" | grep -v '^PASS' | tail -15; fail=1; fi
}
run engine node engine/hor-engine.test.js
fresh && run api-tapqueue node tests/api-tapqueue.js
fresh && run api-v1 node tests/api-v1.js
if [ "${1:-}" != "--no-browser" ]; then
  fresh && run pw-tapqueue node tests/pw-tapqueue.js "$TMP"
  fresh APP_ORIGINS=http://localhost:8092 && run pw-app node tests/pw-app.js "$TMP"
  fresh OPEN_METEO_BASE=http://127.0.0.1:8093 INSHORE_URL=http://127.0.0.1:8093/inshore INSHORE_MIN_AREAS=3 && run pw-wind node tests/pw-wind.js "$TMP"
fi
exit $fail
