// Dashboard "Split Deck" layout (public/index.html, dash.css, dashpics.js, dashui.js): real browser at phone, Duo-upright, iPad portrait and
// landscape sizes. Fresh server on 8091. Usage: node tests/pw-dashboard.js [screenshot dir]
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8091', OUT = process.argv[2] || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const sid = await require('./lib/session')(B);
  const J = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }).then(r => r.json());
  const crew = await J('POST', '/api/crew', { name: 'Dash Crew' });
  await J('POST', `/api/crew/${crew.id}/voyages`, { start: new Date(Date.now() - 30 * 3600e3).toISOString(), declaration: { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' } });
  await J('POST', `/api/crew/${crew.id}/quicklog`, { type: 'work' });
  const br = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const mk = async (w, h, night) => {
    const ctx = await br.newContext({ viewport: { width: w, height: h }, hasTouch: true }); await ctx.addCookies([{ name: 'cn_sid', value: sid, url: B }]);
    await ctx.addInitScript(n => { try { localStorage.setItem('cn_fix', JSON.stringify({ lat: 55.62, lon: -5.88, ts: Date.now(), source: 'gps' })); if (n) localStorage.setItem('cn_theme', 'night'); } catch (e) {} }, !!night);
    await ctx.route('**/api/weather**', r => r.fulfill({ json: { temperatureC: 9.4, weatherCode: 3, windSpeedKn: 14, windDirectionDeg: 225, windGustsKn: 21 } }));
    const page = await ctx.newPage(); page.errs = []; page.on('pageerror', e => page.errs.push(String(e)));
    await page.goto(B + '/'); await page.waitForSelector('#heroMain', { state: 'visible' }); await page.waitForFunction(() => document.getElementById('heroState').textContent === 'WORKING');
    await page.waitForFunction(() => document.querySelector('#posPic path[fill-rule]'), null, { timeout: 15000 }).catch(() => {});
    return { ctx, page };
  };
  const SIZES = [['phone 390', 390, 844], ['small phone 375', 375, 667], ['Duo upright 660', 660, 860], ['iPad portrait 820', 820, 1180], ['iPad landscape 1180', 1180, 820], ['desktop 1440', 1440, 900]];
  for (const [name, w, h] of SIZES) {
    const { ctx, page } = await mk(w, h);
    const m = await page.evaluate(() => {
      const r = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top + scrollY, r: b.right, b: b.bottom + scrollY, w: b.width, h: b.height }; };
      const tiles = [...document.querySelectorAll('.tile')].map(e => ({ id: e.className.split(' ')[1], ...r(e), clip: e.scrollHeight - e.clientHeight, vis: getComputedStyle(e).display !== 'none' }));
      let overlap = 0; for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) { const a = tiles[i], b = tiles[j]; if (a.l < b.r - 2 && b.l < a.r - 2 && a.t < b.b - 2 && b.t < a.b - 2) overlap++; }
      const hero = r(document.getElementById('hero')), dock = r(document.getElementById('ddock')), btn = [...document.querySelectorAll('.hbtn')].filter(e => getComputedStyle(e).display !== 'none').map(r);
      const small = [...document.querySelectorAll('.ddock a, .ddock button, .hbtn, .dpill')].filter(e => getComputedStyle(e).display !== 'none').map(e => ({ n: e.textContent.trim().slice(0, 12), ...r(e) })).filter(x => x.h < 44 || x.w < 44);
      const bl = document.getElementById('dBuild'), mic = document.getElementById('micBtn'); const bld = { txt: bl.textContent, ...r(bl), micTop: mic.getBoundingClientRect().top + scrollY, micL: mic.getBoundingClientRect().left };
      return { bld, tiles, overlap, hero, dock, btn, small, sw: document.documentElement.scrollWidth, iw: innerWidth, rail: getComputedStyle(document.getElementById('dmain')).display };
    });
    ok(m.tiles.length === 11 && m.tiles.every(t => t.vis), name + ': 11 tiles shown (' + m.tiles.length + ')');
    ok(/^build ([0-9a-f]{7,}|\?)$/.test(m.bld.txt) && m.bld.r <= m.iw && m.bld.l > m.iw / 2 - 40, name + ': build label bottom right (' + m.bld.txt + ')');
    ok(m.sw <= m.iw + 1, name + ': no sideways scroll (' + m.sw + ' ≤ ' + m.iw + ')');
    ok(m.overlap === 0, name + ': tiles do not overlap');
    ok(m.small.length === 0, name + ': every control is at least 44 pt (' + JSON.stringify(m.small) + ')');
    ok(m.btn.length === 1 && m.btn[0].h >= 100, name + ': one big rest/work toggle (' + Math.round(m.btn[0] && m.btn[0].h) + ' pt tall)');
    ok(await page.evaluate(() => { const d = document.getElementById('ddock').getBoundingClientRect(); return Math.abs(d.bottom - innerHeight) < 2; }), name + ': dock sits on the bottom edge');
    if (w >= 1000) {
      const clipped = m.tiles.filter(t => t.clip > 3).map(t => t.id + ':' + t.clip);
      ok(!clipped.length, name + ': nothing clipped inside the tiles' + (clipped.length ? ' ' + clipped.join(',') : ''));
      ok(m.hero.r < m.tiles[0].l && m.hero.t < 200, name + ': control rail on the left, always visible');
      ok(await page.locator('.ddock a.d-wide').first().isVisible() && !(await page.locator('#moreBtn').isVisible()), name + ': dock shows every page');
    } else {
      ok(await page.locator('#moreBtn').isVisible() && !(await page.locator('.ddock a.d-wide').first().isVisible()), name + ': dock shows Home, Hours, Map, Atlantic and More');
    }
    ok(await page.evaluate(() => /^M/.test(document.querySelector('#posPic path[fill-rule]') ? document.querySelector('#posPic path[fill-rule]').getAttribute('d') : '')), name + ': Position chart draws the real coastline');
    ok(await page.evaluate(() => ['windPic', 'tidePic', 'wxPic', 'trackPic', 'atlPic', 'logPic'].every(id => document.getElementById(id).querySelector('svg'))), name + ': every tile has its own picture');
    ok(page.errs.length === 0, name + ': no page errors ' + page.errs.join('|'));
    if (w === 390 || w === 1180 || w === 660) await page.screenshot({ path: OUT + '/dash-' + w + '.png' });
    await ctx.close();
  }
  // phone behaviour
  {
    const { ctx, page } = await mk(390, 844);
    ok(await page.evaluate(() => document.getElementById('hero').getBoundingClientRect().top < 120), 'phone: strip right under the header');
    await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(250);
    ok(await page.evaluate(() => document.getElementById('hero').getBoundingClientRect().bottom < 0 && getComputedStyle(document.getElementById('hero')).position !== 'sticky' && getComputedStyle(document.getElementById('hero')).position !== 'fixed'), 'phone: the control strip scrolls away with the page (not fixed)');
    ok(await page.evaluate(() => [...document.querySelectorAll('.dapp *')].filter(e => getComputedStyle(e).position === 'fixed' && !e.closest('.ddock') && e.id !== 'dBuild' && !e.closest('.dsheet') && !e.closest('.dasst') && !e.closest('.dlocation-box') && !e.closest('.htoast')).length === 0), 'phone: the only fixed things are the dock, sheets and toasts');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#moreBtn'); ok(await page.locator('#moreSheet a[href="/passage.html"]').isVisible(), 'phone: More opens the other pages'); await page.keyboard.press('Escape'); ok(!(await page.locator('#moreSheet').isVisible()), 'phone: Escape closes More');
    await ctx.close();
  }
  // night mode: remembered, red, and the pictures follow
  {
    const { ctx, page } = await mk(1180, 820);
    await page.click('#themeBtn'); ok(await page.evaluate(() => document.documentElement.classList.contains('night') && localStorage.getItem('cn_theme') === 'night'), 'night mode on and remembered');
    await page.waitForTimeout(450);   // the Night cross-fade (260 ms) must have finished
    const bg = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.getElementById('btnRest')).backgroundColor]);
    ok(bg[0] === 'rgb(0, 0, 0)' && /255, 106, 77/.test(bg[1]), 'night: black background, red toggle (' + bg.join(' / ') + ')');
    await page.reload(); await page.waitForSelector('#heroMain', { state: 'visible' }); ok(await page.evaluate(() => document.documentElement.classList.contains('night')), 'night mode survives a reload');
    await page.screenshot({ path: OUT + '/dash-night.png' }); await page.click('#themeBtn');
    ok(await page.evaluate(() => !document.documentElement.classList.contains('night')), 'and back to day');
    // rest bars and state glyph
    ok(await page.evaluate(() => /h \d\dm/.test(document.getElementById('rb24V').textContent) && document.getElementById('rBars').style.display !== 'none'), 'rest bars show the 24 h and 7 day totals (' + await page.textContent('#rb24V') + ')');
    ok(await page.evaluate(() => document.getElementById('heroGlyph').className.includes('work')), 'state glyph shows WORK');
    // set position by hand
    await page.click('#locSet'); ok(await page.locator('#locationBox').isVisible(), 'Set position opens the manual entry');
    await page.fill('#manualLat', '55.70'); await page.fill('#manualLon', '-5.80'); await page.click('#manualLocBtn'); await page.waitForTimeout(400);
    ok(/55°42\.0′N 005°48\.0′W/.test((await page.textContent('#locDdm')).replace(/\s+/g, ' ')) && !(await page.locator('#locationBox').isVisible()), 'manual position shown and the box closes (' + (await page.textContent('#locDdm')) + ')');
    // tap toggles state through the existing tap queue
    await page.click('#btnRest'); await page.waitForFunction(() => document.getElementById('heroState').textContent === 'RESTING'); ok(await page.evaluate(() => document.getElementById('heroGlyph').className.includes('rest') && getComputedStyle(document.getElementById('btnRest')).display === 'none' && getComputedStyle(document.getElementById('btnWork')).display !== 'none'), 'tap: RESTING, the toggle now offers WORK');
    await ctx.close();
  }
  ok(true, 'done'); await br.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
