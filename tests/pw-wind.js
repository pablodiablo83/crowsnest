// Wind page + /api/wind, against a FAKE Open-Meteo (the sandbox cannot reach the real one; CI checks the real one separately).
// Also the Met Office inshore waters card, against tests/fixtures/inshore.html (real markup) served by the same fake.
// Starts the fake on 8093 itself. Needs a fresh server on 8091 started with
//   OPEN_METEO_BASE=http://127.0.0.1:8093 INSHORE_URL=http://127.0.0.1:8093/inshore INSHORE_MIN_AREAS=3
// NODE_PATH=$(npm root -g):$PWD/node_modules node tests/pw-wind.js [screenshot dir]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs');
const B = process.env.BASE || 'http://localhost:8091', SP = process.argv[2] || '.';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const MODELS = ['ukmo_seamless', 'ecmwf_ifs025', 'icon_seamless', 'dmi_seamless', 'meteofrance_seamless', 'gfs_seamless', 'best_match'];
let hits = 0, inHits = 0, inFail = false;
const FIXTURE = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'inshore.html'), 'utf8');
// fake Open-Meteo: speed = 10 + 2*modelIndex (+ hour wobble), direction 225 (from SW); meteofrance has no data here
const fake = http.createServer((q, r) => {
  if (q.url.startsWith('/inshore')) {
    inHits++;
    if (inFail) { r.writeHead(503); return r.end('down'); }
    r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(FIXTURE);
  }
  hits++;
  const u = new URL(q.url, 'http://x'), m = u.searchParams.get('models'), days = +u.searchParams.get('forecast_days') || 7;
  const mi = MODELS.indexOf(m);
  if (m === 'meteofrance_seamless') { r.writeHead(400, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ error: true, reason: 'No data is available for this location' })); }
  const t0 = Math.floor(Date.now() / 3600000) * 3600 - 3600 * 2, n = days * 24, t = [], kn = [], dir = [], gust = [];
  // icon_seamless veers 15 degrees an hour through north, to test that the dial turns the short way round
  for (let i = 0; i < n; i++) { t.push(t0 + i * 3600); kn.push(10 + 2 * mi + (i % 6)); dir.push(m === 'icon_seamless' ? (300 + i * 15) % 360 : 225); gust.push(16 + 2 * mi + (i % 6)); }
  r.writeHead(200, { 'Content-Type': 'application/json' });
  r.end(JSON.stringify({ latitude: 55.95, longitude: -4.9, hourly: { time: t, wind_speed_10m: kn, wind_direction_10m: dir, wind_gusts_10m: gust },
    current: { time: t0 + 7200, wind_speed_10m: kn[2], wind_direction_10m: 225, wind_gusts_10m: gust[2] } }));
}).listen(8093);

(async () => {
  // --- inshore: Met Office unreachable and nothing cached yet -> 502, names only, never a fake "no warning"
  inFail = true;
  let ri = await fetch(B + '/api/inshore?lat=55.85&lon=-4.95');
  let di = await ri.json();
  ok(ri.status === 502 && di.nearest.n === 14 && di.areas.length === 19 && di.areas.every(a => !a.blocks.length), 'inshore unreachable: 502, area names and nearest area still given');
  inFail = false;
  ri = await fetch(B + '/api/inshore?lat=55.85&lon=-4.95'); di = await ri.json();
  ok(ri.status === 200 && di.nearest && di.nearest.n === 14, 'off Cumbrae -> area 14 (Firth of Clyde)');
  ok(/^06:00 \(UTC\) on Wed 7 Oct 2026$/.test(di.issued) && /low pressure/.test(di.situation) && /to 06:00 \(UTC\) on Thu 8 Oct/.test(di.period), 'issue time, period and general situation parsed');
  const a14 = di.areas.find(a => a.key === '14');
  ok(a14 && a14.warning && a14.blocks.length === 2 && a14.blocks[0].items[0][0] === 'Wind' && /Westerly or northwesterly 4 to 6/.test(a14.blocks[0].items[0][1]), 'area 14: warning, forecast + outlook, Wind/Sea state/Weather/Visibility');
  ok(a14.blocks[1].title === 'Outlook for the following 24 hours' && a14.blocks[0].items.length === 4, 'block titles and 4 items');
  const sh = di.areas.find(a => a.key === '18'), sh60 = di.areas.find(a => a.key === '18b');
  ok(sh && !sh.warning && sh.blocks.length === 1, 'Shetland Isles: no warning, forecast only');
  ok(sh60 && /shallow area of low pressure/.test(sh60.situation) && sh60.notes.some(t => /^Valid /.test(t)), 'Shetland 60 nm: own general situation and validity');
  ok(di.copyright === '© Crown copyright, Met Office', 'Crown copyright attribution given');
  const ih = inHits; await fetch(B + '/api/inshore'); ok(inHits === ih, 'inshore cached (Met Office not hit again)');
  ok((await (await fetch(B + '/api/inshore?lat=49.45&lon=-2.50')).json()).nearest.n === 19, 'Guernsey -> Channel Islands');
  ok((await (await fetch(B + '/api/inshore?lat=50&lon=-20')).json()).nearest === null, 'mid-Atlantic -> no inshore area');
  ok((await (await fetch(B + '/api/inshore?lat=56.62&lon=-6.06')).json()).nearest.n === 15, 'Tobermory -> Mull of Kintyre to Ardnamurchan');
  ok((await (await fetch(B + '/api/inshore?lat=57.9&lon=-5.16')).json()).nearest.n === 16, 'Ullapool -> The Minch');

  // --- API
  let r = await (await fetch(B + '/api/wind?lat=55.95&lon=-4.9')).json();
  ok(r.model.id === 'ukmo_seamless' && r.t.length === 168 && r.kn[0] === 10, 'default model UK Met Office, 7 days hourly');
  ok(r.models.length === 7 && r.source === 'Open-Meteo', 'model list and source returned');
  const h0 = hits;
  await fetch(B + '/api/wind?lat=55.95&lon=-4.9');
  ok(hits === h0, 'second request served from the 10-minute cache');
  let res = await fetch(B + '/api/wind?lat=55.95&lon=-4.9&model=nonsense');
  ok(res.status === 400, 'unknown model refused');
  res = await fetch(B + '/api/wind?lat=55.95');
  ok(res.status === 400, 'missing lon refused');
  res = await fetch(B + '/api/wind?lat=55.95&lon=-4.9&model=meteofrance_seamless');
  const mf = await res.json();
  ok(res.status === 502 && /No data/.test(mf.detail) && mf.models.length === 7, 'model without data: 502 with reason, model list still given');
  r = await (await fetch(B + '/api/wind?lat=55.95&lon=-4.9&compare=1')).json();
  ok(r.compare.length === 6 && r.compare.filter(c => c.error).length === 1, 'compare: 6 other models, the one without data marked');

  // --- page
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 55.95, longitude: -4.9 }, permissions: ['geolocation'] });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('cn_fix')) localStorage.setItem('cn_fix', JSON.stringify({ lat: 55.95, lon: -4.9, ts: Date.now(), source: 'gps' })); } catch (e) {} });
  const errs = [], page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(B + '/wind.html');
  await page.waitForFunction(() => document.querySelectorAll('.w-row').length > 40);
  const rows = await page.$$eval('.w-row', b => b.length);
  ok(rows >= 48 + 30 && rows < 100, 'hourly for 2 days then 3-hourly (' + rows + ' rows)');
  ok(await page.textContent('#fDir') === 'SW', 'dial: from SW');
  const tr = await page.$eval('#dArrow', e => e.style.transform);
  ok(/rotate\(45deg\)/.test(tr), 'arrow points downwind (from 225 -> towards 045): ' + tr);
  ok(/Force \d/.test(await page.textContent('#fBft')), 'Beaufort force shown');
  ok(/UK Met Office/.test(await page.textContent('#srcNote')), 'source names the model');
  await page.screenshot({ path: SP + '/wind-mobile.png', fullPage: false });
  const before = await page.textContent('#whenText');
  await page.click('.w-row[data-k="10"]');
  ok(await page.textContent('#whenText') !== before && await page.getAttribute('.w-row[data-k="10"]', 'aria-pressed') === 'true', 'tapping a row moves the dial to that time');
  await page.evaluate(() => window.scrollTo(0, 0));
  const y0 = await page.evaluate(() => window.scrollY);
  for (const v of ['5', '20', '40']) { await page.fill('#slider', v); await page.dispatchEvent('#slider', 'input'); }
  ok(await page.getAttribute('.w-row[data-k="40"]', 'aria-pressed') === 'true', 'slider selects a time');
  ok(await page.evaluate(() => window.scrollY) === y0, 'sliding the time does not scroll the page');
  await page.click('#nextH'); await page.click('#prevH');
  ok(await page.evaluate(() => window.scrollY) === y0, '- / + do not scroll the page');
  await page.click('#nowBtn');
  ok(/now|in 1 h|1 h ago/.test(await page.textContent('#whenRel')), 'Now returns to the current hour');
  // model switch persists
  const k1 = await page.textContent('#fKn');
  await page.selectOption('#modelSel', 'gfs_seamless');
  await page.waitForFunction(() => /NOAA GFS/.test(document.getElementById('srcNote').textContent));
  ok(await page.textContent('#fKn') !== k1, 'switching model changes the forecast');
  await page.reload();
  await page.waitForFunction(() => /NOAA GFS/.test(document.getElementById('srcNote').textContent));
  ok(await page.$eval('#modelSel', s => s.value) === 'gfs_seamless', 'model choice remembered');
  // short way round: ICON veers 15 deg/hour through north; each 1-hour step must turn +15, never -345
  await page.selectOption('#modelSel', 'icon_seamless');
  await page.waitForFunction(() => /DWD ICON/.test(document.getElementById('srcNote').textContent));
  const rots = [];
  for (let v = 0; v <= 12; v++) { await page.fill('#slider', String(v)); await page.dispatchEvent('#slider', 'input'); rots.push(await page.$eval('#dArrow', e => parseFloat(e.style.transform.slice(7)))); }
  const steps = rots.slice(1).map((x, i) => x - rots[i]);
  ok(steps.every(d => d === 15), 'arrow turns the short way through north (steps ' + [...new Set(steps)].join(',') + ')');
  await page.selectOption('#modelSel', 'gfs_seamless');
  await page.waitForFunction(() => /NOAA GFS/.test(document.getElementById('srcNote').textContent));
  // compare
  await page.click('#cmpBtn');
  await page.waitForSelector('.w-cmp');
  const cmpRows = await page.$$eval('.w-cmp tbody tr', t => t.length);
  ok(cmpRows === 7 && /range \d+–\d+ kn/.test(await page.textContent('#cmpOut')), 'compare table: 7 models and the spread');
  ok(/not available here/.test(await page.textContent('#cmpOut')), 'model without data shown as not available');
  await page.screenshot({ path: SP + '/wind-compare.png', fullPage: true });
  // Met Office inshore card
  await page.waitForFunction(() => /Strong wind warning/.test(document.getElementById('inBody').textContent));
  ok(/nearest is 14\./.test(await page.$eval('#areaSel', s => s.options[s.selectedIndex].text)), 'inshore area defaults to the nearest (14)');
  ok(/Westerly or northwesterly 4 to 6/.test(await page.textContent('#inBody')) && /Outlook for the following 24 hours/.test(await page.textContent('#inBody')), 'inshore forecast and outlook shown');
  ok(/Issued .*07:00/.test(await page.textContent('#inIssued')) || /Issued/.test(await page.textContent('#inIssued')), 'issue time shown');
  await page.screenshot({ path: SP + '/inshore.png', fullPage: false, clip: await page.$eval('#inshoreCard', e => { const r = e.getBoundingClientRect(); return { x: 0, y: r.top + window.scrollY, width: 390, height: Math.min(r.height, 1400) }; }) }).catch(() => {});
  await page.selectOption('#areaSel', '18');
  ok(/No strong wind warning/.test(await page.textContent('#inBody')), 'other area: Shetland, no warning');
  await page.reload();
  await page.waitForFunction(() => /No strong wind warning/.test(document.getElementById('inBody').textContent));
  ok(await page.$eval('#areaSel', s => s.value) === '18', 'chosen sea area remembered');
  await page.selectOption('#areaSel', 'auto');
  // model without data: message, page still usable
  await page.selectOption('#modelSel', 'meteofrance_seamless');
  await page.waitForSelector('#msg:not([hidden])');
  ok(/unavailable/.test(await page.textContent('#msg')) && (await page.$$eval('.w-row', b => b.length)) > 40, 'model without data: message, last forecast kept');
  await page.selectOption('#modelSel', 'ukmo_seamless');
  // desktop layout
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(300);
  await page.screenshot({ path: SP + '/wind-desktop.png' });
  // dashboard card
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(B + '/');
  await page.waitForFunction(() => /UK Met Office/.test(document.getElementById('windSub').textContent), null, { timeout: 15000 });
  ok(await page.getAttribute('#windCard', 'href') === '/wind.html', 'dashboard wind card opens the wind page');
  const dash = await page.$eval('#windArrow span', e => e.style.transform);
  ok(/rotate\(45deg\)/.test(dash), 'dashboard arrow also points downwind: ' + dash);
  ok(errs.length === 0, 'no page errors ' + errs.join('; '));
  await br.close(); fake.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
