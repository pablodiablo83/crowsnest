# Crow's Nest (crowsnest-hor)

Self-hosted maritime dashboard for the master of a vessel. Owner: Pabs (lawyer, skipper of Alba Explorer; works from an iPhone).
Stack: Node/Express + SQLite (better-sqlite3), vanilla JS front end (no build step), Docker. One file server: `server.js`.

## Deploy (do this, not paste scripts)
1. Push to `main`.
2. Pabs runs `deploy` on the server (alias for `~/crowsnest-hor/deploy.sh | tail -15`): backs up `data/`, fast-forwards, rebuilds, health-checks `/healthz` + `/api/vessel`, auto-rolls back.
Server is Dell "Blairquhosh"; app on 127.0.0.1:8090 behind Caddy basic-auth and a Cloudflare tunnel (https://app.crows-nest.co.uk). The app has no auth of its own. `caddy/`, `cloudflared/`, `data/`, `.env` are NOT in git.

## Rules
- Never commit secrets, `data/`, or Caddy/cloudflared config.
- Keep replies and server output short: ask Pabs for the last 15 lines only (`2>&1 | tail -15`).
- Hours of Rest is MCA/STCW: min 10 h rest/24 h, 77 h/7 d. Engine in `engine/` (spec: `engine/SPEC.md`). Voyages are per crew member; the voyage track is vessel-level (positions found by time window).
- Maritime answers: tag confidence High / Moderate / Low; verify or hedge, never assert without evidence.
- Test before pushing: API tests and Playwright (chromium at /opt/pw-browsers). Check the dashboard, /hours-of-rest.html and /track.html.

## Open items
- Rotate exposed Nextcloud credential and sudo password; give `skipper` its own password; per-user accounts.
- Boat-device (NMEA/Signal K) feed to POST /api/positions; tides setup; AI bar stub; versioned API.
- Vessel name "Bluejay" -> Alba Explorer and voyage 1 start (28 Sep 2026 00:00 BST = 2026-09-27T23:00:00Z): curl fix handed to Pabs 6 Oct 2026; confirm done.
- No service worker: the app cannot be opened from cold while offline (queued taps only work with the page already loaded).
- Unused: public/app.js, public/styles.css, public/geo.html, public/log.html (check before deleting).

## Lessons learned (problems met and fixes that work)
Pabs works from an iPhone terminal (SSH to the server) - long pastes get garbled and logs cost tokens.
- Large pasted scripts/base64 payloads garbled in the terminal. Fix: use git + `deploy`; never ask him to paste more than ~30 lines. If a paste is unavoidable, split into small parts and verify an md5 before acting.
- Server output: always `2>&1 | tail -15`. Ask for the last 10-15 lines, not whole logs or attachments.
- Prefer command-line saves (heredocs) over nano. Use `bash <<'RUN' ... RUN` for multi-line blocks.
- Safari double login on app.crows-nest.co.uk: Safari fetches favicon/apple-touch-icon/manifest without credentials, giving a second 401 prompt. Fix (applied in Caddy): exempt those paths from basicauth. Confirm with Pabs that it is gone.
- Server has no node on the host: do data fixes with `curl` against the local API (127.0.0.1:8090), not node scripts.
- Deploy safety: `deploy.sh` backs up `data/` to `bak-data-*`, fast-forwards only, rebuilds, health-checks, rolls back on failure. A rollback leaves origin ahead; fix forward and push again.
- Hours of rest page: gap-fill must round start up / end down to the minute (else 409 overlap); editing only a note must keep the original ISO start/end (else 409 overlap).
- Maps: Leaflet/CDNs are unreachable in the sandbox, so the app has its own slippy-map engine (public/track.js). Tile error handling: keep failed tiles marked bad and retry on `online`, never remove-and-re-add (that hung the page offline). z-index order: grid 0, tiles 1, track 2.
- iPhone cannot track in the background; recording only happens with the app open, on taps, voyage end, "Log position now", or a device POSTing to /api/positions. Do not promise continuous tracking.
- Test stack in the sandbox: Playwright with `/opt/pw-browsers/chromium` (`NODE_PATH=$(npm root -g):$PWD/node_modules`); kill test servers with `fuser -k PORT/tcp`; font/icon 404s in the sandbox are expected. Earlier suites (apitest*.js, shot*.js) were in a scratch folder and are not in the repo - rebuild what you need.
- Offline taps (public/tapq.js, both pages): saved to localStorage `cn_tapq` first, then POST quicklog with `tapId` (idempotent, survives undo) and, on a late replay, `at` (device time, skew-corrected from the server Date header). Server refuses a late tap that falls before the open period or outside a voyage (409, kept in `cn_tapq_failed`, shown on the Hours of rest page). Audit source `quicklog-queued` marks device-timed entries.
- Mock geolocation gives constant timestamps in tests, so check counts of a source rather than "last".
- Do not put secrets in the repo. Exposed earlier and still to rotate: a Nextcloud credential and the sudo password.
