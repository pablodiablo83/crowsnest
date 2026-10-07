// Passage pack (print / PDF of tides, wind and the inshore forecast) against FAKE services on 8095: tide gauge (IOC),
// Open-Meteo and the Met Office inshore page (tests/fixtures/inshore.html). Needs a fresh server on 8091 started with
//   IOC_BASE=http://127.0.0.1:8095 OPEN_METEO_BASE=http://127.0.0.1:8095 INSHORE_URL=http://127.0.0.1:8095/inshore INSHORE_MIN_AREAS=3 NO_TIDE_WARMUP=1
// NODE_PATH=$(npm root -g):$PWD/node_modules node tests/pw-passage.js [output dir]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const T = require('../engine/tide.js');
const B = process.env.BASE || 'http://localhost:8091', SP = process.argv[2] || '.';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'inshore.html'), 'utf8');
const TRUTH = [['M2', 1.130, 342.2], ['S2', 0.305, 34.0], ['N2', 0.213, 315.6], ['K1', 0.106, 192.1], ['O1', 0.100, 45.9], ['M4', 0.092, 92.4]].map(([name, H, G]) => ({ name, H, G }));
const fake = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/inshore') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(FIXTURE); }
  if (u.pathname === '/service.php') {   // a year of Millport-like readings for any gauge
    const a = Date.parse(u.searchParams.get('timestart') + 'T00:00:00Z'), b = Date.parse(u.searchParams.get('timestop') + 'T00:00:00Z');
    const ts = []; for (let t = a; t <= b; t += 15 * 60000) ts.push(t);
    const h = T.predict(TRUTH, 2.19, ts);
    r.writeHead(200, { 'Content-Type': 'application/json' });
    return r.end(JSON.stringify(ts.map((t, i) => ({ slevel: +h[i].toFixed(3), stime: new Date(t).toISOString().slice(0, 19).replace('T', ' ') }))));
  }
  const days = +u.searchParams.get('forecast_days') || 7, t0 = Math.floor(Date.now() / 86400000) * 86400 - 86400, t = [], kn = [], dir = [], gust = [];
  for (let i = 0; i < (days + 1) * 24; i++) { t.push(t0 + i * 3600); kn.push(8 + (i % 20)); dir.push(225); gust.push(14 + (i % 20)); }
  r.writeHead(200, { 'Content-Type': 'application/json' });
  r.end(JSON.stringify({ latitude: 55.75, longitude: -4.9, hourly: { time: t, wind_speed_10m: kn, wind_direction_10m: dir, wind_gusts_10m: gust }, current: { time: t0, wind_speed_10m: 10, wind_direction_10m: 225, wind_gusts_10m: 15 } }));
}).listen(8095);

(async () => {
  const SID = await require('./lib/session')(B);
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'cn_sid', value: SID, url: B }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('cn_fix', JSON.stringify({ lat: 55.85, lon: -4.95, ts: Date.now(), source: 'gps' })); } catch (e) {} window.__printed = 0; window.print = () => { window.__printed++; }; });
  const errs = [], page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  // entry point from the tides page
  await page.goto(B + '/tides.html');
  ok(await page.$('#printLink[href^="/passage.html"]'), 'tides page links to the passage pack');
  await page.goto(B + '/passage.html');
  await page.waitForFunction(() => /Ready/.test(document.getElementById('status').textContent), null, { timeout: 90000 });
  const doc = await page.textContent('#doc');
  ok(/Tides: Millport/.test(doc), 'nearest port (Millport) by default');
  ok(await page.$$eval('#doc .sec:first-of-type .day', d => d.length) === 3, '3 days of tides by default');
  ok(await page.$$eval('#doc svg.tc path', p => p.filter(x => x.getAttribute('d').length > 500).length) >= 4, 'tidal curves and wind chart drawn');
  ok(/HW \d\d:\d\d/.test(doc) && /LW \d\d:\d\d/.test(doc), 'high and low waters listed');
  ok(await page.$$eval('#doc .day table.hrs td', t => t.length) >= 24, 'hourly heights table');
  ok(/Wind: your position/.test(doc) && /Force/.test(doc) && /SW225°/.test(doc), 'wind tables (from SW 225°)');
  ok(/inshore waters forecast/i.test(doc) && /14\. /.test(doc), 'inshore forecast for the nearest area (14)');
  // layout at iPhone width: form fields side by side don't overlap, nothing in the pack is wider than the page
  const fits = () => page.evaluate(() => {
    const doc = document.getElementById('doc'), r = doc.getBoundingClientRect(), bad = [];
    doc.querySelectorAll('table, svg, .day, .dayh').forEach(el => { const b = el.getBoundingClientRect(); if (b.right > r.right + 1 || b.left < r.left - 1) bad.push(el.tagName + '.' + el.className.baseVal + el.className + ' ' + Math.round(b.width) + '>' + Math.round(r.width)); });
    const d = document.getElementById('oStart').getBoundingClientRect(), n = document.getElementById('oDays').getBoundingClientRect();
    return { bad: bad.slice(0, 3), overlap: d.right > n.left + 0.5, pageScroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  let f = await fits();
  ok(!f.overlap, 'date and days boxes do not overlap at phone width');
  ok(!f.bad.length && !f.pageScroll, 'pack fits the phone width (' + (f.bad.join('; ') || 'all tables and charts inside') + ')');
  await page.selectOption('#oStep', '1');
  await page.waitForFunction(() => /Ready/.test(document.getElementById('status').textContent) && document.querySelectorAll('#doc table.wnd').length > 6, null, { timeout: 30000 });
  f = await fits();
  ok(!f.bad.length && !f.pageScroll, 'hourly wind tables fit the phone width (' + (f.bad.join('; ') || 'ok') + ')');
  ok(await page.$eval('#doc table.hrs', t => t.rows.length === 4 && t.rows[0].cells.length === 13), 'hourly heights in two rows of 12');
  await page.selectOption('#oStep', '3');
  // a second port, wind at it, 2 days, hourly wind: URL carries the settings
  await page.click('#addPort');
  await page.selectOption('#ports .p-port:nth-child(2) select', 'porp');
  await page.selectOption('#oDays', '2');
  await page.selectOption('#oWat', 'porp');
  await page.waitForFunction(() => /Ready/.test(document.getElementById('status').textContent) && /Tides: Portpatrick/.test(document.getElementById('doc').textContent), null, { timeout: 90000 });
  ok(/p=mill%2Cporp/.test(page.url()) && /days=2/.test(page.url()) && /wat=porp/.test(page.url()), 'settings kept in the URL (' + page.url().split('?')[1] + ')');
  ok(/Wind: Portpatrick/.test(await page.textContent('#doc')), 'wind at the chosen port');
  await page.click('#go'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__printed) === 1, 'Print button opens printing');
  // print layout: controls hidden, A4 PDF made
  await page.emulateMedia({ media: 'print' });
  ok(await page.$eval('.no-print', e => getComputedStyle(e).display === 'none'), 'settings hidden on paper');
  await page.setViewportSize({ width: 718, height: 1000 });   // A4 printable width at 11 mm margins
  f = await fits();
  ok(!f.bad.length, 'pack fits A4 width (' + (f.bad.join('; ') || 'ok') + ')');
  await page.setViewportSize({ width: 390, height: 844 });
  const pdf = await page.pdf({ format: 'A4', path: SP + '/passage.pdf' });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok(pages >= 3, 'A4 PDF made (' + pages + ' pages, ' + Math.round(pdf.length / 1024) + ' KB)');
  await page.emulateMedia({ media: 'screen' });
  await page.screenshot({ path: SP + '/passage.png', fullPage: false });
  // a link with settings opens the same pack (how the app hands printing to Safari)
  await page.goto(B + '/passage.html?p=porp&inc=t&days=1');
  await page.waitForFunction(() => /Ready/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  const h2 = (await page.$$eval('#doc .sec h2', h => h.map(x => x.textContent))).join(' | ');
  ok(h2 === 'Tides: Portpatrick' && await page.$$eval('#doc .day', d => d.length) === 1, 'URL settings restored (Portpatrick, tides only, 1 day): ' + h2);
  // branding: letterhead, a brand line atop each later section, the copyright notice, the PDF's name
  ok(await page.$('#doc .cn-letterhead svg') && /Crow’s Nest/.test(await page.textContent('#doc .cn-letterhead')), 'passage pack: Crow’s Nest letterhead with the mark');
  const yr = new Date().getFullYear();
  ok((await page.textContent('#doc .cn-notice')).includes('© ' + yr + ' Crow’s Nest. All rights reserved.') && /Crown copyright, Met Office/.test(await page.textContent('#doc .cn-notice')), 'passage pack: copyright notice + third-party credits');
  ok(/^Crow’s Nest – Passage pack/.test(await page.title()), 'PDF named after Crow’s Nest (' + await page.title() + ')');
  await page.goto(B + '/passage.html?p=mill,porp&inc=tw&days=1');
  await page.waitForFunction(() => /Ready/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  ok(await page.$$eval('#doc .sec .cn-run', r => r.length) === 2, 'brand line atop each section after the first');
  // downloads: CSV ends with the notice, JSON and GPX carry it
  const J = { 'Content-Type': 'application/json' };
  const c = await (await fetch(B + '/api/crew', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Brand Test' }) })).json();
  const q = await (await fetch(B + '/api/crew/' + c.id + '/quicklog', { method: 'POST', headers: J, body: JSON.stringify({ type: 'work', tapId: 'b1', declaration: { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' } }) })).json();
  await fetch(B + '/api/positions', { method: 'POST', headers: J, body: JSON.stringify({ lat: 55.75, lon: -4.9, source: 'test' }) });
  const csv = await (await fetch(B + '/api/export.csv')).text(), last = csv.trim().split(/\r\n/).pop();
  ok(/^"vessel",/.test(csv) && last.includes('© ' + yr + ' Crow’s Nest. All rights reserved.'), 'hours of rest CSV: header first, notice last');
  const js = await (await fetch(B + '/api/export.json')).json();
  ok(js.generator === 'Crow’s Nest' && js.copyright.startsWith('© ' + yr + ' Crow’s Nest'), 'JSON export carries the notice');
  const gpx = await (await fetch(B + '/api/voyages/' + q.voyageId + '/track.gpx')).text();
  ok(/<copyright author="Crow’s Nest"><year>\d{4}<\/year><\/copyright>/.test(gpx) && /<desc>© \d{4} Crow’s Nest/.test(gpx), 'GPX metadata copyright');
  const tcsv = await (await fetch(B + '/api/voyages/' + q.voyageId + '/track.csv')).text();
  ok(/^"time_utc"/.test(tcsv) && /All rights reserved/.test(tcsv.trim().split(/\r\n/).pop()), 'track CSV: notice last');
  // printed hours of rest record and voyage map
  await page.goto(B + '/hours-of-rest.html');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,[data-act]')].find(x => (x.dataset && x.dataset.act === 'print') || /^print/i.test(x.textContent.trim())); if (b) b.click(); });
  await page.waitForFunction(() => window.__printed > 1, null, { timeout: 10000 }).catch(() => {});
  ok(await page.$('#printRecord .cn-letterhead') && /All rights reserved/.test(await page.textContent('#printRecord')), 'hours of rest record: letterhead and notice');
  ok(errs.length === 0, 'no page errors ' + errs.join('; '));
  await br.close(); fake.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e.stack); process.exit(1); });
