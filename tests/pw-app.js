// Phone-app emulation: the pages are served from another origin (like the app's bundled copy), with a fake Capacitor
// bridge, talking to the API server over CORS with a device token.
// Needs a fresh server on 8091 started with APP_ORIGINS=http://localhost:8092 and an empty DATA_DIR.
// NODE_PATH=$(npm root -g):$PWD/node_modules node tests/pw-app.js [screenshot dir]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const API = process.env.BASE || 'http://localhost:8091', WWW_PORT = 8092, WWW = 'http://localhost:' + WWW_PORT, SP = process.argv[2] || '.';
const J = { 'Content-Type': 'application/json' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const pub = path.join(__dirname, '..', 'public');
const www = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(pub, p);
  if (!f.startsWith(pub) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(WWW_PORT);
const api = async (m, u, b) => (await fetch(API + u, { method: m, headers: J, body: b ? JSON.stringify(b) : undefined })).json();

// fake Capacitor bridge: Preferences backed by sessionStorage (survives reloads, like native storage), Browser, BackgroundGeolocation
const BRIDGE = `
  (function () {
    function P(k) { return 'pref:' + k; }
    window.__opened = []; window.__bg = null;
    window.Capacitor = { platform: 'ios', isNativePlatform: function () { return true; }, Plugins: {
      Preferences: {
        get: function (o) { return Promise.resolve({ value: sessionStorage.getItem(P(o.key)) }); },
        set: function (o) { sessionStorage.setItem(P(o.key), o.value); return Promise.resolve(); },
        remove: function (o) { sessionStorage.removeItem(P(o.key)); return Promise.resolve(); }
      },
      Browser: { open: function (o) { window.__opened.push(o.url); return Promise.resolve(); } },
      App: { addListener: function () { return Promise.resolve({ remove: function () {} }); } },
      BackgroundGeolocation: {
        addWatcher: function (opt, cb) { window.__bg = cb; window.__bgOpt = opt; return Promise.resolve('w1'); },
        removeWatcher: function () { window.__bg = null; return Promise.resolve(); }
      }
    } };
  })();`;

(async () => {
  const decl = { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' };
  const crew = await api('POST', '/api/crew', { name: 'Pabs' });
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(BRIDGE);
  const errs = [], page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());

  // 1. not paired -> connect page
  await page.goto(WWW + '/');
  await page.waitForURL(/connect\.html$/);
  ok(true, 'unpaired app opens the connect page');
  const pc = await api('POST', '/api/devices/pair-code', { role: 'master' });
  await page.fill('#cCode', 'abc');
  await page.click('#cGo');
  await page.waitForSelector('#cErr .h-err');
  ok(/8 letters/.test(await page.textContent('#cErr')), 'bad code format rejected on the phone');
  await page.click('summary');
  await page.fill('#cServer', API);
  await page.fill('#cCode', pc.code.toLowerCase());
  await page.fill('#cName', 'Test iPhone');
  await page.click('#cGo');
  await page.waitForURL(WWW + '/');
  await page.waitForSelector('#heroMain', { state: 'visible' });
  ok(/Pabs/.test(await page.textContent('#heroName')), 'paired: dashboard loads over /api/v1 with the token');

  // 2. first WORK tap (declaration) online
  await page.click('#btnWork');
  await page.waitForSelector('#declModal', { state: 'visible' });
  await page.check('input[name=declRested][value=yes]'); await page.check('#declAck1'); await page.check('#declAck2');
  await page.click('#declOk');
  await page.waitForFunction(() => document.getElementById('heroState').textContent === 'WORKING');
  let au = await api('GET', '/api/entries-audit?limit=10');
  ok(au.some(a => /@Test iPhone$/.test(a.source || '')), 'audit names the phone');
  await page.goto(WWW + '/hours-of-rest.html'); await page.waitForSelector('#cardNow .h-tap.rest');   // warm the cache for this page too
  await page.goto(WWW + '/'); await page.waitForFunction(() => document.getElementById('heroState').textContent === 'WORKING');

  // 3. server unreachable, app reopened: last known data from the cache, banner shown
  await page.route(API + '/**', r => r.abort('internetdisconnected'));
  await page.reload();
  await page.waitForFunction(() => document.getElementById('heroState').textContent === 'WORKING', null, { timeout: 15000 });
  await page.waitForSelector('#cnNetBanner', { state: 'visible' });
  ok(/Offline/.test(await page.textContent('#cnNetBanner')), 'opened offline: cached status + Offline banner');
  await page.click('#btnRest');
  await page.waitForFunction(() => /saved on this phone/.test(document.getElementById('toastText').textContent));
  ok(await page.textContent('#heroState') === 'RESTING', 'offline tap queued and shown');
  await page.screenshot({ path: SP + '/app-offline.png' });

  // 4. new manual entry offline on the Hours of rest page (from the cache)
  await page.goto(WWW + '/hours-of-rest.html');
  await page.waitForSelector('#cardNow .h-tap.rest');
  ok(/Resting/.test(await page.textContent('#cardNow .h-state')), 'HoR page offline shows the queued state');
  ok((await page.evaluate(() => CNTapQ.pending().length)) === 1, 'one change waiting');

  // 5. iOS clears web storage: the outbox comes back from native storage
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.CNTapQ && CNTapQ.pending().length === 1, null, { timeout: 10000 });
  ok(true, 'outbox restored from native storage after web storage was wiped');
  ok(await page.evaluate(() => !!localStorage.getItem('cn_token')), 'token restored too');

  // 6. back online: queued tap reaches the server with its own time
  await page.unroute(API + '/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => CNTapQ.pending().length === 0, null, { timeout: 15000 });
  const es = await api('GET', `/api/crew/${crew.id}/entries`);
  ok(es.length === 2 && es[0].type === 'rest', 'queued tap applied after reconnect');
  au = await api('GET', '/api/entries-audit?limit=10');
  ok(au.some(a => a.source === 'quicklog-queued@Test iPhone'), 'audit: queued + phone');

  // 7. background positions while the voyage is open
  await page.goto(WWW + '/');
  await page.waitForFunction(() => typeof window.__bg === 'function', null, { timeout: 10000 });
  ok(true, 'background watcher started (voyage open)');
  await page.evaluate(() => window.__bg({ latitude: 55.86, longitude: -4.25, accuracy: 8, speed: 3, bearing: 90, time: Date.now() }));
  await page.waitForFunction(() => CNTapQ.pending().length === 0, null, { timeout: 10000 });
  const lp = await api('GET', '/api/positions/latest');
  ok(lp && Math.abs(lp.lat - 55.86) < 1e-6 && lp.source === 'background', 'background position recorded');

  // 8. print and downloads go to the web version in Safari
  await page.goto(WWW + '/hours-of-rest.html'); await page.waitForSelector('#cardNow .h-tap.rest');
  await page.evaluate(() => window.print());
  ok((await page.evaluate(() => window.__opened)).some(u => u === API + '/hours-of-rest.html'), 'print opens the web page in Safari');

  // 9. settings: this phone + phones list
  await page.click('[data-act=settings]');
  await page.waitForSelector('text=Test iPhone (this phone)');
  ok(true, 'Phones list shows this phone');
  await page.screenshot({ path: SP + '/app-settings.png', fullPage: false });
  await page.click('[data-act=dev-pair]');
  await page.waitForSelector('text=Enter this code');
  ok(true, 'pair code shown on the phone');

  // 10. phone removed on the web -> back to connect
  const devs = await api('GET', '/api/devices');
  await fetch(API + '/api/devices/' + devs.find(d => d.name === 'Test iPhone').id, { method: 'DELETE' });
  await page.goto(WWW + '/');
  await page.waitForURL(/connect\.html$/, { timeout: 10000 });
  ok(true, 'removed phone is sent back to the connect page');

  ok(errs.length === 0, 'no page errors ' + errs.join('; '));
  await br.close(); www.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
