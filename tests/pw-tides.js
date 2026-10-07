// Tides end to end against a FAKE gauge service (the IOC network is unreachable from the sandbox; CI checks the real one):
// the fake serves a year of Millport-like readings made from known constants, so every prediction can be checked
// against the truth. Starts the fake on 8094. Needs a fresh server on 8091 with IOC_BASE=http://127.0.0.1:8094 NO_TIDE_WARMUP=1.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs');
const T = require('../engine/tide.js');
const B = process.env.BASE || 'http://localhost:8091', SP = process.argv[2] || '.';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// Millport's constants as analysed from the real gauge on 7 Oct 2026 (largest terms)
const TRUTH = [['M2', 1.130, 342.2], ['S2', 0.305, 34.0], ['N2', 0.213, 315.6], ['K1', 0.106, 192.1], ['O1', 0.100, 45.9], ['M4', 0.092, 92.4],
  ['K2', 0.089, 34.2], ['MS4', 0.086, 119.9], ['nu2', 0.055, 316.8], ['L2', 0.054, 354.9], ['2N2', 0.052, 279.9], ['M3', 0.050, 112.8]].map(([name, H, G]) => ({ name, H, G }));
const Z0 = 2.192;
let hits = 0, seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
const fake = http.createServer((q, r) => {
  hits++;
  const u = new URL(q.url, 'http://x'), a = Date.parse(u.searchParams.get('timestart') + 'T00:00:00Z'), b = Date.parse(u.searchParams.get('timestop') + 'T00:00:00Z');
  const ts = []; for (let t = a; t <= b; t += 15 * 60000) ts.push(t);
  const h = T.predict(TRUTH, Z0, ts);
  r.writeHead(200, { 'Content-Type': 'application/json' });
  r.end(JSON.stringify(ts.map((t, i) => ({ slevel: +(h[i] + 0.04 * rnd()).toFixed(3), stime: new Date(t).toISOString().slice(0, 19).replace('T', ' '), sensor: 'bub' }))));
}).listen(8094);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const SID = await require('./lib/session')(B);
  const J = { 'Content-Type': 'application/json' };
  // --- nearest ports
  const st = await (await fetch(B + '/api/tides/stations?lat=55.85&lon=-4.95')).json();
  ok(st.standard[0].id === 'mill' && st.standard[1].id === 'porp' || st.standard[0].id === 'mill', 'nearest gauge to Cumbrae is Millport (' + st.standard.slice(0, 3).map(s => s.name).join(', ') + ')');
  // --- first use: analysis runs, then predictions
  let r = await fetch(B + '/api/tides/predict?port=mill&days=3');
  ok(r.status === 202 && (await r.json()).status === 'analysing', 'first request: 202 analysing');
  let d = null;
  for (let i = 0; i < 60; i++) { await sleep(1000); r = await fetch(B + '/api/tides/predict?port=mill&days=3&from=' + Date.now()); if (r.status === 200) { d = await r.json(); break; } }
  ok(!!d, 'analysis finished (' + hits + ' gauge requests)');
  ok(d.datum.code === 'CD' && /Chart Datum/.test(d.datum.label), 'gauge on Chart Datum detected (LAT ' + d.levels.LAT + ')');
  ok(d.quality.days >= 360 && d.quality.rmsM < 0.05, 'year analysed, fit ' + d.quality.rmsM + ' m');
  const truth = T.extremes(TRUTH, Z0, Date.now(), Date.now() + 3 * 86400000, 6);
  let worstT = 0, worstH = 0;
  for (const e of d.extremes) {
    const m = truth.filter(x => x.type === e.type).sort((a, b) => Math.abs(a.t - e.t) - Math.abs(b.t - e.t))[0];
    worstT = Math.max(worstT, Math.abs(m.t - e.t) / 60000); worstH = Math.max(worstH, Math.abs(m.h - e.h));
  }
  ok(d.extremes.length >= 10 && worstT < 4 && worstH < 0.03, `predicted HW/LW match the truth: worst ${worstT.toFixed(1)} min, ${(worstH * 100).toFixed(1)} cm`);
  ok(Math.abs(d.levels.MHWS - (Z0 + 1.130 + 0.305)) < 0.03, 'MHWS ' + d.levels.MHWS);
  // --- dashboard card
  const card = await (await fetch(B + '/api/tides')).json();
  ok(card.configured && card.port === 'Millport' && card.events.length === 4 && card.curve.length > 30 && card.now, 'dashboard card: port, next 4 events, curve, now');
  // --- secondary port (Admiralty method)
  r = await fetch(B + '/api/tides/secondary', { method: 'POST', headers: J, body: JSON.stringify({ name: 'X', std: 'mill', hwTimes: [['0000', 10], ['0000', 5]], lwTimes: [['0000', 0], ['0600', 0]], stdLevels: { MHWS: 3.4, MHWN: 2.8, MLWN: 1.0, MLWS: 0.3 }, diffs: { MHWS: 0, MHWN: 0, MLWN: 0, MLWS: 0 } }) });
  ok(r.status === 400, 'secondary port with the same two times refused');
  const SEC = { name: 'Rothesay Bay', std: 'mill', lat: 55.84, lon: -5.05, hwTimes: [['0000', -5], ['0600', 10]], lwTimes: [['0000', 0], ['0600', 15]], stdLevels: { MHWS: 3.6, MHWN: 3.0, MLWN: 1.4, MLWS: 0.8 }, diffs: { MHWS: 0.2, MHWN: 0.1, MLWN: 0.0, MLWS: -0.1 }, notes: 'test figures' };
  const sp = await (await fetch(B + '/api/tides/secondary', { method: 'POST', headers: J, body: JSON.stringify(SEC) })).json();
  ok(sp.id && sp.hwTimes[1][1] === 10, 'secondary port saved');
  const ds = await (await fetch(B + '/api/tides/predict?port=sec:' + sp.id + '&days=2&from=' + Date.now())).json();
  const e0 = ds.extremes[0], exp = T.secondaryExtremes([{ t: e0.std.t, h: e0.std.h, type: e0.type }], { hwTimes: SEC.hwTimes, lwTimes: SEC.lwTimes, std: SEC.stdLevels, diff: SEC.diffs })[0];
  ok(ds.port.kind === 'sec' && Math.abs(e0.t - exp.t) < 1000 && Math.abs(e0.h - exp.h) < 0.011, 'secondary HW/LW by the Admiralty method (' + e0.type + ' ' + e0.dt + ' min, ' + e0.dh + ' m)');
  ok(Math.abs(ds.levels.MHWS - 3.8) < 1e-9, 'secondary levels = standard + differences');
  // --- page
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'cn_sid', value: SID, url: B }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('cn_fix', JSON.stringify({ lat: 55.85, lon: -4.95, ts: Date.now(), source: 'gps' })); localStorage.removeItem('cn_tidePort'); } catch (e) {} });
  const errs = [], page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(B + '/tides.html');
  await page.waitForSelector('.t-big');
  ok(/Rothesay Bay/.test(await page.$eval('#portSel', s => s.options[s.selectedIndex].text)), 'nearest secondary port (within 5 nm) chosen first');
  await page.selectOption('#portSel', 'mill'); await page.waitForFunction(() => /Millport predictions come from/.test(document.getElementById('about').textContent));
  ok(/m/.test(await page.textContent('.t-big')) && /Next (high|low) water/.test(await page.textContent('#nowBox')), 'now card: height and next high/low water');
  ok((await page.$$eval('#table tbody tr', t => t.length)) > 25, 'table: 7 days of high and low waters');
  ok(await page.$eval('#chart .curve', p => p.getAttribute('d').length > 200), 'tidal curve drawn');
  await page.fill('#tslider', '84'); await page.dispatchEvent('#tslider', 'input');
  ok(/^14:00/.test(await page.textContent('#readT')) && /m$/.test(await page.textContent('#readH')), 'slider: height at 14:00');
  await page.screenshot({ path: SP + '/tides.png', fullPage: true });
  // add a secondary port from almanac-style figures
  await page.click('#secAdd');
  await page.fill('#sName', 'Largs');
  await page.fill('#hw1d', '+0005'); await page.fill('#hw2d', '-0:05'); await page.fill('#lw1d', '0'); await page.fill('#lw2d', '+0010');
  await page.waitForFunction(() => document.getElementById('slMHWS').value !== '');
  for (const [k, v] of [['MHWS', '+0.1'], ['MHWN', '0.0'], ['MLWN', '-0.1'], ['MLWS', '−0.1']]) await page.fill('#sd' + k, v);
  await page.click('#secForm button[type=submit]');
  await page.waitForFunction(() => /Largs/.test(document.getElementById('portSel').options[document.getElementById('portSel').selectedIndex].text));
  await page.waitForFunction(() => /by the Admiralty method/.test(document.getElementById('about').textContent));
  ok(/Millport \d\d:\d\d/.test(await page.textContent('#table')), 'secondary table shows the standard-port working');
  const largs = (await (await fetch(B + '/api/tides/secondary')).json()).find(p => p.name === 'Largs');
  ok(largs && largs.hwTimes[1][1] === -5 && largs.diffs.MLWS === -0.1, 'almanac notation parsed (+0005, -0:05, −0.1)');
  // dashboard card
  await page.goto(B + '/');
  await page.waitForFunction(() => /Largs|Millport/.test(document.getElementById('tidesSub').textContent), null, { timeout: 15000 });
  ok(/High|Low/.test(await page.textContent('#tidesSub')) && (await page.$('#tideSvg line')), 'dashboard tide card: next waters and live curve');
  ok(errs.length === 0, 'no page errors ' + errs.join('; '));
  await br.close(); fake.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e.stack); process.exit(1); });
