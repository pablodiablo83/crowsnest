# Crow's Nest overview PDF (24 Nov 2026)

`Crows-Nest-overview.pdf`: 8-page A4 feature overview and app description with real screens (fictional vessel "Sea Lark", crew and passage; test weather/tide data).

Rebuild (sandbox or any machine with Playwright + chromium; working dir = a scratch folder holding these files, `icon.svg` from public/assets and a `shots/` folder):
1. `node fake.js &` (fake IOC / Open-Meteo / inshore on 8095)
2. Start the server on 8091 with `DATA_DIR=<empty> IOC_BASE=http://127.0.0.1:8095 OPEN_METEO_BASE=http://127.0.0.1:8095 INSHORE_URL=http://127.0.0.1:8095/inshore INSHORE_MIN_AREAS=3`, add the `tester` account (tools/user.js), then `node seed.js`
3. `node shoot.js shots` and `node shoot2.js shots` (paths inside point at /home/user/crowsnest)
4. `node render.js <folder> out.pdf [preview dir]`

Update the "Where things stand" table on page 8 before reuse.
