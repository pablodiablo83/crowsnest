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
- Offline queueing for Work/Rest taps; boat-device (NMEA/Signal K) feed to POST /api/positions; tides setup; AI bar stub; versioned API.
- Vessel name still "Bluejay" (should be Alba Explorer); confirm voyage start 28 Sep 2026 00:00 BST.
- Unused: public/app.js, public/styles.css, public/geo.html, public/log.html (check before deleting).
