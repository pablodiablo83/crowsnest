// Wind page + /api/wind, against a FAKE Open-Meteo (the sandbox cannot reach the real one; CI checks the real one separately).
// Starts the fake on 8093 itself. Needs a fresh server on 8091 started with OPEN_METEO_BASE=http://127.0.0.1:8093
// NODE_PATH=$(npm root -g):$PWD/node_modules node tests/pw-wind.js [screenshot dir]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs');
const B = process.env.BASE || 'http://localhost:8091', SP = process.argv[2] || '.';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const MODELS = ['ukmo_seamless', 'ecmwf_ifs025', 'icon_seamless', 'dmi_seamless', 'meteofrance_seamless', 'gfs_seamless', 'best_match'];
let hits = 0;
// fake Open-Meteo: speed = 10 + 2*modelIndex (+ hour wobble), direction 225 (from SW); meteofrance has no data here
const fake = http.createServer((q, r) => {
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
