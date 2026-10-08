// Tides end to end against a FAKE gauge service (the IOC network is unreachable from the sandbox; CI checks the real one):
// the fake serves a year of Millport-like readings made from known constants, so every prediction can be checked
// against the truth. Starts the fake on 8094. Needs a fresh server on 8091 with IOC_BASE=http://127.0.0.1:8094 GEOCODE_BASE=http://127.0.0.1:8094 NO_TIDE_WARMUP=1.
// The same fake answers place searches (Open-Meteo geocoding shape): Fowey, plus a Fowey abroad that must be dropped.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs');
const T = require('../engine/tide.js');
const B = process.env.BASE || 'http://localhost:8091', SP = process.argv[2] || '.';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// Millport's constants as analysed from the real gauge on 7 Oct 2026 (largest terms)
const TRUTH = [['M2', 1.130, 342.2], ['S2', 0.305, 34.0], ['N2', 0.213, 315.6], ['K1', 0.106, 192.1], ['O1', 0.100, 45.9], ['M4', 0.092, 92.4],
  ['K2', 0.089, 34.2], ['MS4', 0.086, 119.9], ['nu2', 0.055, 316.8], ['L2', 0.054, 354.9], ['2N2', 0.052, 279.9], ['M3', 0.050, 112.8]].map(([name, H, G]) => ({ name, H, G }));
const Z0 = 2.192;
let hits = 0, wickHits = 0, geoHits = 0, ukhoHits = 0, seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
const fake = http.createServer((q, r) => {
  hits++;
  if (q.url.startsWith('/ukho/')) {   // fake ADMIRALTY UK Tidal API (Discovery shape)
    if (q.headers['ocp-apim-subscription-key'] !== 'GOODKEY1234567890ABCDEF') { r.writeHead(401); return r.end('{"statusCode":401}'); }
    ukhoHits++;
    if (/\/Stations$/.test(q.url)) {
      r.writeHead(200, { 'Content-Type': 'application/json' });
      return r.end(JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-4.6333, 50.3333] }, properties: { Id: '0021', Name: 'Fowey', Country: 'England', ContinuousHeightsAvailable: false } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-4.185, 50.368] }, properties: { Id: '0014', Name: 'Plymouth (Devonport)', Country: 'England', ContinuousHeightsAvailable: true } }] }));
    }
    const m = q.url.match(/Stations\/(\w+)\/TidalEvents\?duration=(\d+)/), ev = [];
    const d0 = Math.floor(Date.now() / 86400000) * 86400000;
    for (let t = d0 + 3 * 3600000, i = 0; t < d0 + (+m[2]) * 86400000; t += 22350000, i++)
      ev.push({ EventType: i % 2 ? 'LowWater' : 'HighWater', DateTime: new Date(t).toISOString().slice(0, 19), IsApproximateTime: false, Height: i % 2 ? 1.0 : 5.0, IsApproximateHeight: false, Filtered: false });
    r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify(ev));
  }
  if (q.url.startsWith('/v1/search')) {
    geoHits++;
    const name = new URL(q.url, 'http://x').searchParams.get('name') || '';
    const results = /^fow/i.test(name) ? [{ name: 'Fowey', latitude: 50.3356, longitude: -4.6367, country_code: 'GB', admin1: 'England', admin2: 'Cornwall' },
      { name: 'Fowey', latitude: -37.8, longitude: 145.0, country_code: 'AU', admin1: 'Victoria' }] : [];
    r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ results }));
  }
  if (/code=wick/.test(q.url)) { wickHits++; r.writeHead(503); return r.end('down'); }   // a gauge whose service fails
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
  const near = await (await fetch(B + '/api/tides?lat=55.85&lon=-4.95')).json();
  ok(near.portId === 'mill', 'dashboard card follows the phone position (?lat&lon)');
  // --- a gauge that fails: reported, not restarted on every poll, retried on request
  await fetch(B + '/api/tides/predict?port=wick');
  let w = null; for (let i = 0; i < 20 && !(w && w.status === 'failed'); i++) { await sleep(500); w = await (await fetch(B + '/api/tides/predict?port=wick')).json(); }
  ok(w.status === 'failed' && /503/.test(w.error), 'failed analysis reported (' + w.error + ')');
  const wh = wickHits; await fetch(B + '/api/tides/predict?port=wick'); await fetch(B + '/api/tides?port=wick'); await sleep(300);
  ok(wickHits === wh, 'failed gauge not re-fetched on every poll');
  const wc = await (await fetch(B + '/api/tides?port=wick')).json();
  ok(wc.failed && !wc.analysing && wc.error, 'dashboard card reports the failure');
  await fetch(B + '/api/tides/analyse/wick', { method: 'POST' }); await sleep(500);
  ok(wickHits > wh, 'Try again re-fetches');
  // --- diagnostics tool reads the same database
  if (process.env.DATA_DIR_FOR_TOOL) {
    const out = require('child_process').execFileSync('node', [__dirname + '/../tools/tide-check.js'], { env: Object.assign({}, process.env, { DATA_DIR: process.env.DATA_DIR_FOR_TOOL }) }).toString();
    ok(/mill: \d+ readings.*-> (HW|LW) /.test(out), 'tools/tide-check.js predicts from stored constants');
  }
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
  // --- search: a place without a gauge gets the nearest gauge's tides (Fowey -> Plymouth, ~17 nm)
  const sr = await (await fetch(B + '/api/tides/search?q=Fowey')).json();
  ok(sr.places.length === 1 && sr.places[0].nearest.id === 'plym' && Math.abs(sr.places[0].nearest.distanceNm - 17) < 2, 'search Fowey: one UK place, nearest gauge Plymouth (' + (sr.places[0] && sr.places[0].nearest.distanceNm) + ' nm), the one abroad dropped');
  const sg = await (await fetch(B + '/api/tides/search?q=mill')).json();
  ok(sg.gauges.some(g => g.id === 'mill'), 'search matches gauges by name');
  const g0 = geoHits; await fetch(B + '/api/tides/search?q=fowey');
  ok(geoHits === g0, 'place searches cached');
  // --- page
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'cn_sid', value: SID, url: B }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('cn_fix', JSON.stringify({ lat: 55.85, lon: -4.95, ts: Date.now(), source: 'gps' })); if (!sessionStorage.getItem('t0')) { sessionStorage.setItem('t0', '1'); localStorage.removeItem('cn_tidePort'); } } catch (e) {} });
  const errs = [], page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(B + '/tides.html');
  await page.waitForSelector('.t-big');
  ok(await page.inputValue('#q') === 'Rothesay Bay', 'nearest secondary port (within 5 nm) chosen first');
  const pick = async (text, option) => {
    await page.click('#q'); await page.fill('#q', text);
    await page.locator('#qList [role=option]', { hasText: option }).first().click();
  };
  await pick('mill', 'Millport'); await page.waitForFunction(() => /Millport predictions come from/.test(document.getElementById('about').textContent));
  ok(await page.inputValue('#q') === 'Millport' && /Tide gauge at Millport/.test(await page.textContent('#from')), 'search a gauge by name');
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
  await page.waitForFunction(() => document.getElementById('q').value === 'Largs');
  await page.waitForFunction(() => /by the Admiralty method/.test(document.getElementById('about').textContent));
  ok(/Millport \d\d:\d\d/.test(await page.textContent('#table')), 'secondary table shows the standard-port working');
  const largs = (await (await fetch(B + '/api/tides/secondary')).json()).find(p => p.name === 'Largs');
  ok(largs && largs.hwTimes[1][1] === -5 && largs.diffs.MLWS === -0.1, 'almanac notation parsed (+0005, -0:05, −0.1)');
  // search a place: Fowey -> Plymouth's tides, with the distance, a caution and an offer to add it as a secondary port
  await pick('Fowey', 'Fowey');
  await page.waitForFunction(() => /Plymouth \(Devonport\) predictions come from/.test(document.getElementById('about').textContent), null, { timeout: 60000 });
  const from = await page.textContent('#from');
  ok(await page.inputValue('#q') === 'Fowey' && /Fowey/.test(await page.textContent('#place')) && /Plymouth \(Devonport\)<?.*tide gauge, 1\d nm away/.test(from) && /can differ/.test(from), 'Fowey: Plymouth tides, distance and caution shown (' + from.slice(0, 90) + ')');
  ok((await page.$$eval('#table tbody tr', t => t.length)) > 25, 'Fowey: table of high and low waters');
  await page.click('#addPlace');
  ok(await page.inputValue('#sName') === 'Fowey' && await page.inputValue('#sStd') === 'plym' && /^50\.33/.test(await page.inputValue('#sLat')), 'add Fowey as a secondary port: form prefilled (name, Plymouth, position)');
  await page.click('#sCancel');
  await page.reload(); await page.waitForSelector('.t-big');
  ok(await page.inputValue('#q') === 'Fowey', 'chosen place remembered');
  await page.click('#q');
  ok(await page.locator('#qList [role=option]', { hasText: 'Fowey' }).count() >= 1, 'recent places offered on focus');
  await page.fill('#q', 'Fow'); await page.locator('#qList [role=option]').first().waitFor();
  await page.screenshot({ path: SP + '/tides-results.png' });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: SP + '/tides-search.png', fullPage: true });
  // dashboard card
  await page.goto(B + '/');
  await page.waitForFunction(() => /Fowey|Largs|Millport/.test(document.getElementById('tidesSub').textContent), null, { timeout: 15000 });
  ok(/Fowey/.test(await page.textContent('#tidesSub')) && /Plymouth/.test(await page.textContent('#tidesSub')), 'dashboard card: Fowey (Plymouth)');
  ok(/High|Low/.test(await page.textContent('#tidesSub')) && (await page.$('#tideSvg line')), 'dashboard tide card: next waters and live curve');
  // --- UKHO (ADMIRALTY UK Tidal API): connect with the user's key; free tier never stored, paid tier cached
  const UK = (m, body) => fetch(B + '/api/tides/ukho', { method: m, headers: J, body: body ? JSON.stringify(body) : undefined });
  ok((await (await UK('GET')).json()).connected === false, 'UKHO not connected at first');
  let ur = await UK('PUT', { key: 'BADKEY1234567890ABCDEF', tier: 'discovery' });
  ok(ur.status === 400 && /refused/.test((await ur.json()).error), 'wrong UKHO key refused, not saved');
  ur = await UK('PUT', { key: 'GOODKEY1234567890ABCDEF', tier: 'discovery' });
  ok(ur.status === 200 && (await ur.json()).stations === 2, 'UKHO key checked against the station list and saved');
  const st2 = await (await UK('GET')).json();
  ok(st2.connected && st2.tier === 'discovery' && !JSON.stringify(st2).includes('GOODKEY'), 'status never returns the key');
  const su = await (await fetch(B + '/api/tides/search?q=Fowey')).json();
  ok(su.ukho.some(u => u.id === '0021') && su.places[0].ukho && su.places[0].ukho.id === '0021', 'search: UKHO station Fowey, and the place Fowey maps to it');
  let h0 = ukhoHits, pr = await fetch(B + '/api/tides/predict?port=ukho:0021&days=3&from=' + Date.now()), pd = await pr.json();
  ok(pr.status === 200 && pd.port.kind === 'ukho' && pd.extremes.length >= 8 && pd.extremes.every(e => e.h === 5 || e.h === 1) && pd.curve.length > 200 && /Crown copyright/.test(pd.attribution), 'UKHO prediction: UKHO high/low waters, curve between them, Crown copyright credit');
  ok(/no-store/.test(pr.headers.get('cache-control') || ''), 'free tier: sent with no-store (the phone keeps no copy)');
  await fetch(B + '/api/tides/predict?port=ukho:0021&days=3');
  ok(ukhoHits - h0 >= 2, 'free tier: fetched each time, not cached on the server');
  await UK('PUT', { key: 'GOODKEY1234567890ABCDEF', tier: 'foundation' });
  h0 = ukhoHits; pr = await fetch(B + '/api/tides/predict?port=ukho:0021&days=3'); await fetch(B + '/api/tides/predict?port=ukho:0021&days=3');
  ok(ukhoHits - h0 === 1 && !/no-store/.test(pr.headers.get('cache-control') || ''), 'paid tier: cached (one UKHO call for two requests) and storable offline');
  const cardU = await (await fetch(B + '/api/tides?port=ukho:0021')).json();
  ok(cardU.port === 'Fowey' && cardU.events.length === 4, 'dashboard card works with a UKHO station');
  await page.goto(B + '/tides.html'); await page.waitForSelector('.t-big');
  ok(/Connected/.test(await page.textContent('#ukhoBox')), 'Tides page shows UKHO connected');
  await pick('Fowey', 'UKHO station Fowey');
  await page.waitForFunction(() => /UK Hydrographic Office/.test(document.getElementById('about').textContent), null, { timeout: 20000 });
  ok(/UKHO station/.test(await page.textContent('#from')) && /Next (high|low) water/.test(await page.textContent('#nowBox')) && !(await page.$('.t-sn')), 'page: Fowey from UKHO (no springs bar: UKHO gives no levels)');
  ok(await page.$eval('#chart .curve', p => p.getAttribute('d').length > 200), 'page: curve drawn through UKHO waters');
  await page.screenshot({ path: SP + '/tides-ukho.png', fullPage: true });
  await UK('DELETE');
  ok((await (await UK('GET')).json()).connected === false, 'UKHO disconnected');
  ok(errs.length === 0, 'no page errors ' + errs.join('; '));
  await br.close(); fake.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e.stack); process.exit(1); });
