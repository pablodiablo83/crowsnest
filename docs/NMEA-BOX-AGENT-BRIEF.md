# Prompt for an AI agent: design and build the Crow's Nest boat-data box (SeaTalk / NMEA gateway)

Copy everything below the line into the agent. It is written to be self-contained. Sections 3 to 6 are the technical specification of the app as it exists on 25 Nov 2026; section 7 lists what does NOT exist yet and must be built on the app side. Nothing here has been tested with real boat hardware.

---

## 1. Your role

You are a senior marine-electronics and embedded-systems engineer with experience of NMEA 0183, NMEA 2000, Raymarine SeaTalk (1 and NG), Signal K, ESP32 and Raspberry Pi hardware, 12 V marine power design and EMC. You also write firmware and server code.

Your job: design, then build, a small plug-in box that reads a yacht's instrument data and delivers it to the Crow's Nest app, over the boat's Wi-Fi and (when there is internet) to the Crow's Nest server. Work in phases (section 9). Ask me the questions in section 8 first. Do not guess hardware facts: where you rely on a protocol detail (a PGN number, a SeaTalk datagram, a pin-out, a baud rate) say how sure you are (High / Moderate / Low) and tell me which datasheet or specification to check. Never invent part numbers or prices; if you cannot verify one, say so.

## 2. What I need

A box that:
1. Plugs into the boat's instrument network (SeaTalk 1, SeaTalk NG / NMEA 2000, and NMEA 0183 inputs) and reads it **read-only** by default.
2. Normalises everything into one clean data stream (position, speed, course, heading, depth, wind, water temperature, battery and engine data, and more).
3. Serves that stream on the boat's own Wi-Fi so the Crow's Nest app works with **no internet** (offshore).
4. Uploads the data to the Crow's Nest server when internet exists (Starlink, 4G, marina Wi-Fi), buffering while offline and never losing or duplicating records.
5. Is safe, small, low power, simple to install and robust at sea.

The owner is a lawyer and professional mariner who works from an iPhone, often at sea, and wants plain, dependable behaviour over clever features.

## 3. What Crow's Nest is (feature summary)

Crow's Nest is a self-hosted maritime dashboard for the master of a vessel. It runs as a web app and as iOS and Android apps (Capacitor wrappers around the same web pages). Everything below exists today unless marked "not built".

**Hours of rest (core, regulatory).** MCA / STCW compliance: minimum 10 h rest in any 24 h and 77 h in any 7 days. Per-crew voyages, one-tap WORK / REST logging with an 8-second Undo, offline queue, gap filling, joining declarations, audit trail, CSV / JSON / printed record exports.

**Dashboard.** One screen with large pictures: status and rest bars, Position map (real coastline, boat, trail; in open water it zooms out to the nearest land ahead and behind), Wind compass (speed in the centre, Force word), Tides curve, Speed over ground dial, Course over ground compass, Weather, Voyage sketch, Atlantic thumbnail, Log, Sea ice, and a placeholder "Boat data / Connect NMEA" row where your box will plug in. Layout by window width: iPhone, iPhone Duo (two panes), iPad, desktop. Night mode (red on black) on every page.

**Position and voyage track.** Positions are recorded on taps, at voyage end, on a timer while the app is open, by the iOS background tracker while a voyage is open, and by any device that POSTs them. Voyage map in the same look, offline coastline, draw-on animation.

**Wind.** Hourly wind and gusts from Open-Meteo, chosen model (default UK Met Office), arrows point downwind, text says "from".

**Tides.** Own harmonic engine. UK tide gauges (IOC) analysed from a year of data; secondary ports from the user's almanac differences; optional UKHO API; a **world model** (Open-Meteo modelled sea level fitted by the same engine) used automatically when no gauge is within 25 nm. Astronomical only, not for pilotage.

**Atlantic weather.** Server engine fetches a 2-degree grid every 6 h (wind, gusts, pressure, rain, waves, swell, 10 days); a chart page and a "Now and ahead" list at the boat and every 12 h along the route at a set speed.

**Other pages.** Inshore waters forecast (Met Office), Passage pack (printable tides, wind and inshore), Sea ice concentration near the vessel (north only), Status page (health checks and recent errors), Black box recorder (below).

**Black box recorder.** Every page records the device's state (position, SOG, COG, connectivity, battery, queue sizes, errors) into a local queue and uploads it automatically; the server keeps plain daily JSON-lines files, downloadable as JSON or CSV by the master.

**Assistant.** A text/voice bar that understands commands ("start a 4 on 4 off pattern", "what is the wind", "how close is the ice"). Every new feature must teach it.

**Platform.** Offline-first: pages and last data are cached on the phone; only append-style records (taps, positions) queue offline and are idempotent. Auto-deploy from GitHub after tests pass. Privacy first: the vessel's data stays on the owner's own server.

## 4. Architecture and stack

- **Server:** Node 20 / Express, SQLite (better-sqlite3), single file server `server.js` plus modules, vanilla JavaScript front end (no build step), Docker, host is a Dell laptop on the boat or ashore; app on 127.0.0.1:8090 behind Caddy and a Cloudflare tunnel at `https://app.crows-nest.co.uk`.
- **Apps:** Capacitor 8 wrapper (`capacitor://localhost` origin on iOS), same pages as the web. In the app, `fetch('/api/...')` is rewritten to `<server>/api/v1/...` with an `Authorization: Bearer <device token>` header (public/net.js).
- **Auth:** the web has its own sign-in (session cookie). Phones and devices use device tokens: the master makes a one-time 8-character pairing code (valid 10 minutes) on the web app; the device exchanges it at `POST /api/auth/pair` (or `/api/v1/auth/pair`) for a long-lived token. Roles today: `master` (everything) and `crew` (one crew member's own hours, plus it may `POST /api/positions`). Token hashes are stored, never the token.
- **Compatibility rule:** `/api/v1` must stay backwards compatible; additive changes only.
- **Security baseline:** CSP `script-src 'self'`, no inline scripts, dates accepted 2000-2100 only, text fields capped, sign-in and pairing rate limits, every route behind the gate.
- **Tests:** about 25 suites (`tests/run-all.sh`), Playwright for the pages, fakes for outside services.

## 5. The interface that exists today (use this first)

**Pair the box (once).** `POST /api/auth/pair` with `{ "code": "ABCD-EFGH", "name": "Boat box" }` returns a device token. Store it on the box (never in a repository, never in logs).

**Send a position.** `POST /api/v1/positions` with header `Authorization: Bearer <token>` and JSON:

```
{ "id": "bx-<boot>-<counter>",   // 1-64 chars [A-Za-z0-9_-]; makes a retry idempotent
  "ts": "2026-11-25T05:29:10Z",  // ISO 8601, UTC; not in the future, not older than 400 days
  "lat": 25.693, "lon": -22.525, // decimal degrees; 0,0 is refused
  "acc": 5,                      // metres, optional
  "sog": 8.5,                    // knots 0-200, optional
  "cog": 258,                    // degrees true 0-360, optional
  "source": "device" }           // "device" is the value for a boat box
```

Response `201` (stored) or `200` with `"duplicate": true`. Errors are `400` with a plain message. There is no batch endpoint and no per-request rate limit today; default JSON body limit 100 kB.

**Read.** `GET /api/v1/positions/latest`, `GET /api/v1/time` (server clock; the response `Date` header lets a device correct its clock offset), `GET /api/v1/dashboard/settings`.

**Browser / app side.** The app already keeps the last fix in `localStorage.cn_fix` as `{lat, lon, ts, source, sog, cog}` and the dashboard shows SOG and COG tiles from `fix.sog` and `fix.cog` (COG is hidden below 0.5 kn). The Position tile, voyage track and black box all read that fix.

**Today's limits you must design around:** positions only. There is no endpoint for depth, wind, heading, speed through water, battery or engine data yet (section 7).

## 6. Data the dashboard can use, and what it needs from the box

| Dashboard item | Needed from the box | Notes |
|---|---|---|
| Position, voyage track | lat, lon, time, accuracy/HDOP | already supported |
| Speed over ground | SOG (kn) | already supported |
| Course over ground | COG (deg true) | already supported |
| Heading / compass | magnetic and true heading | not built |
| Wind compass | apparent wind angle and speed; true wind (derived using STW or SOG, heading) | not built; today wind comes from a weather model |
| Depth | depth below transducer (and offset) | not built |
| Speed through water | STW | not built |
| Water temperature | deg C | not built |
| Boat data tile | connection state, last-heard age, which sources are live | not built |
| Power and engines | house/start battery volts, engine RPM, temperature, oil pressure, fuel | not built; desirable |
| Environment | air temperature, barometric pressure | not built; feeds the weather picture |
| AIS | nearby targets, own-ship CPA/TCPA | stretch goal, not built |

Typical sources (Moderate confidence; verify against the standards and the instrument manuals):
- **NMEA 0183** (4800 or 38400 baud, RS-422/RS-232): RMC, GGA, GLL, VTG, HDT, HDG, HDM, DBT, DPT, MWV, MWD, VHW, MTW, MDA, XDR, RPM, VDM/VDO (AIS).
- **NMEA 2000** (CAN, 250 kbit/s): PGNs such as 129025 (position, rapid), 129026 (COG/SOG), 129029 (GNSS data), 127250 (heading), 128267 (depth), 128259 (speed through water), 130306 (wind), 130310 / 130311 / 130312 (environment, temperature), 127488 / 127489 (engine), 127508 (battery), 127505 (fluid level), 127245 (rudder).
- **SeaTalk 1** (single wire, 4800 baud, 9 data bits with a command flag, 12 V level): datagrams for depth, apparent wind angle and speed, speed through water, water temperature, latitude/longitude, SOG, COG, heading and pilot data. The decoding details differ between instrument generations; take them from a reliable reverse-engineered reference and test with a real bus.
- **SeaTalk NG** is NMEA 2000 electrically (DeviceNet-style connectors), so it is covered by the NMEA 2000 input.
- **Signal K** is the target normalised data model (paths such as `navigation.position`, `navigation.speedOverGround`, `environment.depth.belowTransducer`, `environment.wind.speedApparent`). Use it internally so any later app can consume the box.

## 7. What does NOT exist yet (app-side work to scope with the box)

Propose these, and say which side builds each:
1. **Instrument ingest endpoint:** `POST /api/v1/instruments`, a batch of records `{ id, t, v: { sog, cog, hdg, stw, dbt, awa, aws, wtemp, vbat, rpm ... } }`, idempotent by `id`, ranges validated, same dates rule (2000-2100), capped batch size (for example 300) and detail size.
2. **A least-privilege `instrument` device role:** today a box would have to pair as `master` or `crew`. A box must be able to post positions and instruments and read nothing else. Pairing by the existing one-time code flow.
3. **Latest-values endpoint and dashboard tiles:** `GET /api/instruments/latest` with the age of each value; the dashboard shows live values, dims and says "N s old" when a source stops, and falls back to the weather-model value when the box is silent. Every new route needs an assistant skill and a test (the repo has a gate test).
4. **Local (offline) link:** the app talks to the box on the boat's Wi-Fi when there is no internet. Constraints on iOS: the app origin is `capacitor://localhost`; plain `http://` and `ws://` to a local address need App Transport Security "local networking" and the Local Network privacy permission; mixed content rules apply on the web version served over https. Decide: WebSocket from the page to the box, or the box pushes to the server and the server is on the boat's LAN.
5. **Black box integration:** the box's own faults and connection state should appear in the black box log and status page.
6. **Dashboard "Boat data" row** becomes a live status row (connected / last heard / sources).

## 8. Questions to ask me before you design anything

1. Which boat and which instruments (make, model, year)? Raymarine ST60 / ST70 / i70, Garmin, B&G, Simrad? SeaTalk 1, SeaTalk NG, NMEA 0183, or a mix? Is there an NMEA 2000 backbone, and where are its free taps and power?
2. Is there a chartplotter or multiplexer already (which can output NMEA 0183 or N2K)? Could I simply use a commercial gateway for the instrument side?
3. 12 V or 24 V boat? Where will the box live and how much power may it draw continuously (a good target is under 1 W average)?
4. Internet at sea: Starlink, 4G, none? Is there a router or Wi-Fi access point on board?
5. Read-only, or also writing (autopilot commands)? (Default and recommendation: read-only; control is out of scope for safety and liability.)
6. One-off for my boat, or a product others may buy later? (This changes certification, documentation and bill-of-materials choices.)
7. Budget, quantity, preferred form (DIN-rail, IP65 box, Pi HAT, ESP32 board).
8. Which data matters most first? (My guess: position, SOG, COG, heading, depth, wind, water temperature, battery.)

## 9. Phases and deliverables

**Phase 0, requirements.** Ask section 8, confirm assumptions, produce a one-page requirements list.

**Phase 1, architecture options with trade-offs.** At least: (A) commercial gateway(s) for NMEA 2000 / 0183 / SeaTalk 1 plus a small Linux computer running Signal K and a bridge to Crow's Nest; (B) a custom ESP32-based multi-input gateway (CAN transceiver, RS-422 receivers, a SeaTalk 1 interface, Wi-Fi) with a small bridge; (C) hybrid. For each: cost, power, size, risk, development effort, maintainability, certification. Give a clear recommendation. Expect that a first prototype should use proven parts and that custom hardware comes second.

**Phase 2, interface contract.** A written, versioned schema for the data the box sends to the server and to the local app, mapped to Signal K paths, with units, ranges, update rates, staleness rules, and the exact JSON for section 7. Include a replayable test log format.

**Phase 3, electronics design (if custom).** Power input 9-32 V with reverse-polarity, surge and load-dump protection; galvanic isolation on every instrument connection (NMEA 0183 opto-isolated inputs, isolated CAN, SeaTalk 1 level shifting); fuse; connectors; ESD protection; thermal and condensation considerations; KiCad schematic and PCB plan; bill of materials with at least two sources per critical part. NMEA 2000: do not power the box from the bus unless its load equivalence number is respected; take power separately and say so.

**Phase 4, firmware and bridge.** Language and frameworks you choose and why. Requirements: non-blocking reads of all inputs; checksums and range checks on every sentence; per-source timestamps and age; de-duplication; clock handling (GNSS time, then server `Date` header correction); a persistent ring buffer on flash or SD for offline periods; uploads with retries, backoff and idempotent ids; over-the-air update that cannot brick the box; watchdog; configuration over a captive-portal web page; no secrets in firmware images; the device token stored in protected storage.

**Phase 5, app-side changes.** The section 7 items, with tests, following the repository rules (every route behind the gate, assistant skill, `?v=` bumps on changed scripts, `/api/v1` additive only).

**Phase 6, verification.** Bench simulator (replay NMEA 0183 text, SeaTalk 1 and N2K logs), soak test of at least 7 days, power-cycle and wire-pull tests, corrupted-data tests, clock-jump tests, flat-battery behaviour, and an on-board trial plan with acceptance criteria below. List the standards to check (NMEA 0183 / 2000 interface requirements, EMC, CE / UKCA, radio rules for the Wi-Fi module) and what the owner must do to stay legal.

**Acceptance criteria.**
- Position, SOG and COG appear in the app within 2 s of the instrument output on the boat's Wi-Fi with no internet, and within 15 s on the server when online.
- 24 hours offline then reconnect: no records lost, none duplicated.
- Any single input failing leaves the others working and is shown as "silent for N s", never as a stale value presented as current.
- Never transmits on the instrument bus unless a hardware jumper AND a setting are both enabled.
- Average draw under the agreed figure; survives 9-32 V swings and reverse connection without damage.
- All instrument readings carry units, source and age; nothing is smoothed in a way that hides a fault.

## 10. Rules for how you work

- Tell me the confidence (High / Moderate / Low) of every protocol, electrical or regulatory claim, and what to verify.
- Short, dense answers; British English; challenge my assumptions rather than agreeing.
- Safety first: the box must never make navigation data look better than it is. The app is an aid, not an authority.
- No secrets in any file you produce. Tokens, Wi-Fi keys and pairing codes are entered at install time.
- Give each deliverable as a file I can keep (Markdown, KiCad, code), not just chat text.
- Do not start any build, order or purchase without my yes.
