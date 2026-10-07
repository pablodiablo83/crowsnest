# Crow's Nest (crowsnest-hor)

Self-hosted maritime dashboard for the master of a vessel. Owner: Pabs (lawyer, skipper of Alba Explorer; works from an iPhone).
Stack: Node/Express + SQLite (better-sqlite3), vanilla JS front end (no build step), Docker. One file server: `server.js`.
iOS app: `app/` = Capacitor 8 shell (Swift Package Manager) bundling `public/`; guide and status in `docs/IOS-APP.md`. Moving from Safari to the app is the current priority (offline use at sea).

## Deploy (do this, not paste scripts)
1. Push to `main`.
2. Pabs runs `deploy` on the server (alias for `~/crowsnest-hor/deploy.sh | tail -15`): backs up `data/`, fast-forwards, rebuilds, health-checks `/healthz` + `/api/vessel`, auto-rolls back.
Server is Dell "Blairquhosh"; app on 127.0.0.1:8090 behind Caddy basic-auth and a Cloudflare tunnel (https://app.crows-nest.co.uk). The web has no auth of its own (Caddy basic auth); `/api/v1/*` is for the phone app and requires a device token (server.js checks it; Caddy must let `/api/v1/*` through). `caddy/`, `cloudflared/`, `data/`, `.env` are NOT in git.

## Rules
- Never commit secrets, `data/`, or Caddy/cloudflared config.
- Keep replies and server output short: ask Pabs for the last 15 lines only (`2>&1 | tail -15`).
- Hours of Rest is MCA/STCW: min 10 h rest/24 h, 77 h/7 d. Engine in `engine/` (spec: `engine/SPEC.md`). Voyages are per crew member; the voyage track is vessel-level (positions found by time window).
- Maritime answers: tag confidence High / Moderate / Low; verify or hedge, never assert without evidence.
- Test before pushing: `tests/run-all.sh` (engine, API, Playwright incl. app emulation; chromium at /opt/pw-browsers). GitHub Actions runs it on every push. Check the dashboard, /hours-of-rest.html and /track.html.
- `/api/v1` must stay backwards compatible: installed app builds keep running old page code. Additive changes only, or version up.
- After changing `public/`, the app needs a rebuild (`cd app && npm run sync`, then Xcode or the TestFlight workflow); the web only needs `deploy`.
- Offline: only append-style records queue (taps, End voyage, new entries, positions - `public/outbox.js`, idempotent by opId/tapId). Edits/deletes need a connection. Server refuses late items that no longer fit (409) and the phone lists them as not applied.

## Open items
- Rotate exposed Nextcloud credential and sudo password; give `skipper` its own password. (Per-phone accounts now exist: pairing + device tokens; the web is still one shared basic-auth login.)
- iOS app: Apple Developer enrolment; first real-device run on Pabs's Mac (back ~13 Oct 2026); TestFlight secrets. Checklist in docs/IOS-APP.md.
- Boat-device (NMEA/Signal K) feed to POST /api/positions (could use a crew-role-free device token later); tides setup; AI bar stub; push notifications (rest-budget warning); Android.
- Confirm voyage 1 starts 28 Sep 2026 00:00 BST (= 2026-09-27T23:00:00Z); curl check handed to Pabs 6 Oct 2026. (Vessel rename dropped by Pabs, 7 Oct 2026: leave the vessel name as it is.)
- Safari/web: no service worker, so the web version cannot open from cold offline. Not planned: the iOS app replaces it.
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
- Test stack in the sandbox: Playwright with `/opt/pw-browsers/chromium` (`NODE_PATH=$(npm root -g):$PWD/node_modules`); kill test servers with `fuser -k PORT/tcp`; font/icon 404s in the sandbox are expected. Suites live in `tests/` (each needs a fresh server with an empty DATA_DIR, default http://localhost:8091, override with BASE): `node tests/api-tapqueue.js`; `NODE_PATH=$(npm root -g):$PWD/node_modules node tests/pw-tapqueue.js <screenshot dir>`. Keep new suites there, not in scratch.
- Offline taps (public/tapq.js, both pages): saved to localStorage `cn_tapq` first, then POST quicklog with `tapId` (idempotent, survives undo) and, on a late replay, `at` (device time, skew-corrected from the server Date header). Server refuses a late tap that falls before the open period or outside a voyage (409, kept in `cn_tapq_failed`, shown on the Hours of rest page). Audit source `quicklog-queued` marks device-timed entries.
- Mock geolocation gives constant timestamps in tests, so check counts of a source rather than "last".
- Do not put secrets in the repo. Exposed earlier and still to rotate: a Nextcloud credential and the sudo password.
- App emulation in Playwright (tests/pw-app.js): serve public/ on another origin (8092), inject a fake `window.Capacitor` (Preferences backed by sessionStorage, Browser, BackgroundGeolocation), start the server with `APP_ORIGINS=http://localhost:8092`, block the API with `page.route(...abort)` to simulate no signal (setOffline also blocks the page server).
- CORS: `Date` is not a safelisted response header; the server exposes it for /api/v1 (outbox clock correction needs it).
- `reqDevice` (current phone) is set around synchronous handlers only; do not read it after an `await`.
- public/assets/icon.svg has a broken outline cropped by its viewBox; the app icon uses app/assets/icon.svg (redrawn). Regenerate icons with `cd app && npm run icons`.
- Caddy: the LIVE config is `/etc/caddy/Caddyfile` (systemd `caddy`). `~/crowsnest-hor/caddy/crowsnest.Caddyfile` is a stale template (REPLACE_WITH_HASH) - never edit it as if live. The app.crows-nest.co.uk block (line ~27) has `@auth not path <icons> /manifest.json /api/v1/*` + `basicauth @auth`; `/api/v1/*` exemption added 7 Oct 2026 (verified: /api/v1/time 200, /api/v1/vessel 401 from the app, /api/vessel 401 from Caddy). Edit pattern: backup, sed one line, `caddy validate`, then `systemctl reload caddy`.

