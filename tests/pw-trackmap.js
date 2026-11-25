// Voyage map (public/track.html, track.js, coast.js): the Position look (sea navy, real coastline, amber dotted trail, boat at the head), the draw-on
// animation, Chart/Detail switch, night mode, print colours. Fresh server on 8091. Usage: node tests/pw-trackmap.js [screenshot dir]
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8091', OUT = process.argv[2] || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const sid = await require('./lib/session')(B);
  const J = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }).then(r => r.json());
  const crew = await J('POST', '/api/crew', { name: 'Map Crew' }), now = Date.now(), H = 3600e3;
  await J('POST', `/api/crew/${crew.id}/voyages`, { start: new Date(now - 15 * H).toISOString(), declaration: { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' } });
  // 14 fixes every 30 min down the Clyde (13 h ago to 6.5 h ago), a 3.5 h gap (a faint straight line), then 6 more (3 h ago to 30 min ago)
  const pts = []; for (let i = 0; i < 14; i++) pts.push([now - 13 * H + i * 0.5 * H, 55.82 - i * 0.012, -4.88 - i * 0.02]);
  for (let i = 0; i < 6; i++) pts.push([now - 3 * H + i * 0.5 * H, 55.82 - 13 * 0.012 - 0.01 - i * 0.012, -4.88 - 13 * 0.02 - 0.02 - i * 0.02]);
  for (let i = 0; i < pts.length; i++) { const r = await J('POST', '/api/positions', { id: 'tm' + i, ts: new Date(pts[i][0]).toISOString(), lat: +pts[i][1].toFixed(5), lon: +pts[i][2].toFixed(5), acc: 15, sog: 5, cog: 215, source: 'auto' }); if (r.error) console.log('seed', i, r.error); }
  const br = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const mk = async (opts, w, h, night, route) => {
    const ctx = await br.newContext(Object.assign({ viewport: { width: w || 1180, height: h || 820 }, hasTouch: true }, opts || {})); await ctx.addCookies([{ name: 'cn_sid', value: sid, url: B }]);
    if (night) await ctx.addInitScript(() => { try { localStorage.setItem('cn_theme', 'night'); } catch (e) {} });
    const page = await ctx.newPage(); page.errs = []; page.tiles = 0; page.on('pageerror', e => page.errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/font|fonts\.g|ERR_|Failed to load|tile\./i.test(m.text())) page.errs.push(m.text()); });
    page.on('request', r => { if (/tile\.openstreetmap|tiles\.openseamap/.test(r.url())) page.tiles++; });
    await page.route(/tile\.openstreetmap\.org|tiles\.openseamap\.org/, route || (r => r.fulfill({ contentType: 'image/png', body: PNG })));
    await page.goto(B + '/track.html'); await page.waitForFunction(() => window.__cnMap && window.__cnMap.data && window.__cnMap.data.points.length > 5, null, { timeout: 15000 });
    return { ctx, page };
  };
  // ---- the look, and the draw-on
  {
    const { ctx, page } = await mk();
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('map')).backgroundColor) === 'rgb(15, 58, 122)', 'chart: sea navy, the dashboard colour');
    await page.waitForFunction(() => document.querySelector('.tm-land path'), null, { timeout: 10000 });
    ok(await page.evaluate(() => document.querySelector('.tm-land path').getAttribute('fill') === 'var(--land)' && document.querySelectorAll('.tm-tiles img').length === 0), 'chart: real coastline drawn in slate, no tiles');
    ok(page.tiles === 0, 'chart: no tile is requested at all (works offline)');
    ok(await page.evaluate(() => !!document.querySelector('g[stroke-dasharray="1 11"]') && !!document.querySelector('g[stroke-dasharray="1 17"] line')), 'amber dotted trail, with the over-3-hour gap as a fainter straight line');
    ok(await page.evaluate(() => /Natural Earth/.test(document.querySelector('.tm-attr').textContent)), 'chart: coastline credit shown');
    // draw-on: the line grows and the boat rides its head
    await page.evaluate(() => { __cnMap.stopAnim(); __cnMap.setTrack(__cnMap.data, true); });
    await page.waitForFunction(() => __cnMap.reveal > 0.08 && __cnMap.reveal < 0.95, null, { timeout: 8000 });
    const mid = await page.evaluate(() => { const mp = document.getElementById('trMaskPath'), h = document.getElementById('trHead'), r = __cnMap.route[__cnMap.route.length - 1]; return { off: +mp.style.strokeDashoffset, hasMask: !!document.querySelector('g[mask]'), head: h.getAttribute('transform'), last: r, lbl: document.getElementById('trHeadLbl').style.opacity }; });
    ok(mid.hasMask && mid.off > 0 && mid.off < 1000, 'draw-on: the line is part-drawn (dash offset ' + Math.round(mid.off) + ' of 1000)');
    ok(mid.lbl === '0' && !new RegExp('translate\\(' + mid.last[0].toFixed(1)).test(mid.head), 'draw-on: the boat is part-way, its label waits');
    await page.screenshot({ path: OUT + '/trackmap-mid.png' });
    await page.waitForFunction(() => !__cnMap.anim && __cnMap.reveal === 1, null, { timeout: 8000 });
    await page.waitForTimeout(700);   // the label fades in
    const end = await page.evaluate(() => { const h = document.getElementById('trHead'), r = __cnMap.route[__cnMap.route.length - 1], m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(h.getAttribute('transform')); return { dx: Math.abs(+m[1] - r[0]), dy: Math.abs(+m[2] - r[1]), mask: !!document.querySelector('g[mask]'), lbl: getComputedStyle(document.getElementById('trHeadLbl')).opacity, pulse: !!document.querySelector('#trPulse.pulse') }; });
    ok(end.dx < 1 && end.dy < 1 && !end.mask && +end.lbl > 0.8, 'draw-on: ends with the boat on the latest fix, mask removed, label shown ' + JSON.stringify(end));
    ok(end.pulse, 'draw-on: a single pulse rings the boat when it arrives');
    // a refresh while drawing keeps the animation going; a pan keeps drawing
    await page.evaluate(() => { __cnMap.setTrack(__cnMap.data, true); });
    await page.waitForFunction(() => __cnMap.reveal > 0.1 && __cnMap.anim, null, { timeout: 8000 });
    await page.evaluate(() => { __cnMap.setTrack(__cnMap.data); __cnMap.panBy(20, 10); });
    ok(await page.evaluate(() => !!__cnMap.anim && !!document.getElementById('trMaskPath')), 'a refresh and a pan do not cancel the draw-on');
    // touching the map skips it
    const box = await page.locator('#map').boundingBox(); await page.mouse.move(box.x + 300, box.y + 200); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => !__cnMap.anim && __cnMap.reveal === 1 && !document.querySelector('g[mask]')), 'a touch skips the animation and shows the whole track');
    ok(page.errs.length === 0, 'no page errors ' + page.errs.join('|'));
    await ctx.close();
  }
  // ---- reduced motion: no animation, no mask
  {
    const { ctx, page } = await mk({ reducedMotion: 'reduce' });
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => __cnMap.reveal === 1 && !__cnMap.anim && !document.getElementById('trMaskPath') && !document.querySelector('.tm-pop')), 'reduced motion: the whole track at once, nothing animates');
    await ctx.close();
  }
  // ---- picking a fix, zoom hint, Detail switch
  {
    const { ctx, page } = await mk();
    await page.waitForFunction(() => !__cnMap.anim, null, { timeout: 8000 });
    const h = await page.evaluate(() => { const x = __cnMap.hits[5]; return { x: x.x, y: x.y }; }), box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + h.x, box.y + h.y); await page.waitForTimeout(200);
    ok(/°.*′/.test(await page.textContent('#picked')) && /SOG 5\.0 kn/.test(await page.textContent('#picked')), 'tapping a fix shows its time, position and speed: ' + (await page.textContent('#picked')).slice(0, 70));
    await page.evaluate(() => __cnMap.setView(55.7, -4.95, 6)); await page.evaluate(() => __cnMap.setView(55.7, -4.95, 12)); await page.waitForTimeout(150);
    ok(await page.locator('.tm-hint').isVisible(), 'zoomed in on the chart: it says the coastline is approximate and points to Detail');
    await page.evaluate(() => __cnMap.fit(__cnMap.data.stats.bbox));
    ok(await page.locator('[data-m=sea]').isHidden(), 'chart: the sea-marks button is hidden');
    await page.click('[data-m=detail]'); await page.waitForFunction(() => document.querySelectorAll('.tm-tiles img').length > 0, null, { timeout: 8000 });
    ok(await page.evaluate(() => localStorage.getItem('cn_mapmode') === 'detail' && !document.querySelector('.tm-land path') && /OpenStreetMap/.test(document.querySelector('.tm-attr').textContent)), 'Detail: tiles load, chart land hides, OpenStreetMap credit, choice remembered');
    ok(await page.locator('[data-m=sea]').isVisible() && !(await page.locator('.tm-hint').isVisible()), 'Detail: sea-marks button appears');
    await page.reload(); await page.waitForFunction(() => window.__cnMap && __cnMap.data); await page.waitForFunction(() => document.querySelectorAll('.tm-tiles img').length > 0, null, { timeout: 8000 });
    ok(await page.evaluate(() => __cnMap.mode === 'detail'), 'Detail survives a reload');
    await page.click('[data-m=detail]'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => __cnMap.mode === 'chart' && document.querySelectorAll('.tm-tiles img').length === 0 && !!document.querySelector('.tm-land path')), 'back to Chart: tiles gone, coastline back');
    await ctx.close();
  }
  // ---- Detail with no connection says so, and the chart is one tap away
  {
    const { ctx, page } = await mk({}, 1180, 820, false, r => r.abort());
    await page.evaluate(() => { localStorage.setItem('cn_mapmode', 'detail'); }); await page.reload(); await page.waitForFunction(() => window.__cnMap && __cnMap.data);
    await page.waitForFunction(() => !document.querySelector('.tm-msg').hidden, null, { timeout: 8000 });
    ok(/Detail needs a connection/.test(await page.textContent('.tm-msg')), 'Detail offline: a plain message, the track still drawn');
    await page.evaluate(() => localStorage.removeItem('cn_mapmode'));
    await ctx.close();
  }
  // ---- night, print, phone
  {
    const { ctx, page } = await mk({}, 390, 844, true);
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('map')).backgroundColor) === 'rgb(22, 4, 4)', 'night: the map goes red on black like the dashboard');
    await page.waitForFunction(() => !__cnMap.anim, null, { timeout: 8000 });
    await page.locator('#map').screenshot({ path: OUT + '/trackmap-night.png' });
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: no sideways scroll');
    await page.emulateMedia({ media: 'print' });
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('map')).backgroundColor) === 'rgb(223, 233, 242)', 'print: light colours for paper');
    ok(page.errs.length === 0, 'night/phone: no page errors ' + page.errs.join('|'));
    await ctx.close();
  }
  { const { ctx, page } = await mk({}, 390, 844); await page.waitForFunction(() => !__cnMap.anim, null, { timeout: 8000 }); await page.locator('#map').screenshot({ path: OUT + '/trackmap-phone.png' }); await ctx.close(); }
  await br.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
