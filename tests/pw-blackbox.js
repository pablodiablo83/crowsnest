// Black box recorder: server files (POST/status/download), the recorder in the browser (queues, uploads by itself, offline keeps,
// errors recorded) and the page + dashboard button. Fresh server on 8091 (NO_TIDE_WARMUP=1). Usage: node tests/pw-blackbox.js [screenshot dir]
const { chromium } = require('playwright'), fs = require('fs');
const B = process.env.BASE || 'http://localhost:8091', OUT = process.argv[2] || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  ok((await fetch(B + '/api/blackbox', { method: 'POST' })).status === 401, 'upload needs a sign-in');
  const sid = await require('./lib/session')(B);
  const J = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
  const now = Date.now(), rec = (i, k, d, t) => ({ id: 'tst' + i + '-' + now.toString(36), t: t || now - i * 1000, k, d: d || {} });
  let r = await J('POST', '/api/blackbox', { device: 'tdev1', records: [rec(1, 'pos', { lat: 55.6, lon: -5.9, sog: 6.9, cog: 271 }), rec(2, 'err', { msg: '=cmd|calc' }), rec(3, 'state', { online: true })] });
  let d = await r.json(); ok(r.status === 200 && d.stored === 3 && d.dup === 0, 'three records stored');
  d = await (await J('POST', '/api/blackbox', { device: 'tdev1', records: [rec(1, 'pos', {}), rec(4, 'note', { msg: 'hello' })] })).json();
  ok(d.stored === 1 && d.dup === 1, 'a repeated id is a duplicate (idempotent)');
  d = await (await J('POST', '/api/blackbox', { records: [{ id: 'x', t: 5, k: 'BAD KIND' }, { id: 'abcdef1', t: now + 3 * 864e5, k: 'pos' }, 7, { id: 'abcdef2', t: now, k: 'pos', d: { big: 'x'.repeat(5000) } }] })).json();
  ok(d.rejected === 3 && d.stored === 1, 'bad shape, far-future time and non-objects are refused; oversize detail is truncated');
  ok((await J('POST', '/api/blackbox', { records: [] })).status === 400 && (await J('POST', '/api/blackbox', { records: new Array(301).fill(rec(9, 'pos')) })).status === 400, 'empty and oversize batches refused');
  const st = await (await J('GET', '/api/blackbox/status')).json();
  ok(st.totalRecords >= 5 && st.days.length >= 1 && st.devices.some(x => x.device === 'tdev1'), 'status lists days and devices');
  const day = new Date(now).toISOString().slice(0, 10);
  let dl = await fetch(B + '/api/blackbox/download?day=' + day + '&format=jsonl'); let txt = await dl.text();
  ok(dl.status === 200 && /attachment; filename="crows-nest-black-box-/.test(dl.headers.get('content-disposition')) && txt.trim().split('\n').length >= 6 && /"k":"export"/.test(txt.trim().split('\n').pop()), 'JSON Lines download, one record a line, notice last');
  txt.trim().split('\n').forEach(l => JSON.parse(l));
  dl = await fetch(B + '/api/blackbox/download?day=all&format=csv'); txt = await dl.text();
  ok(/^"time_utc","device"/.test(txt) && /"'=cmd\|calc/.test(txt.replace(/\\"/g, '"')) || /'=cmd/.test(txt), 'CSV download, formula-safe');
  ok((await fetch(B + '/api/blackbox/download?day=../x')).status === 400 && (await fetch(B + '/api/blackbox/download?day=1999-01-01')).status === 404, 'bad day refused, missing day 404');
  const file = require('path').join(process.env.DATA_DIR_FOR_TOOL || '', 'blackbox', 'bb-' + day + '.jsonl');
  if (process.env.DATA_DIR_FOR_TOOL) ok(fs.existsSync(file), 'a plain daily file exists on disk');

  // the browser: recorder + page
  const br = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addCookies([{ name: 'cn_sid', value: sid, url: B }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('cn_fix', JSON.stringify({ lat: 61.1, lon: -46.2, ts: Date.now(), source: 'gps', sog: 4.2, cog: 190 })); } catch (e) {} });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(B + '/'); await pg.waitForTimeout(500);
  ok(await pg.locator('#bbBtn').count() === 1 && (await pg.locator('#bbBtn').getAttribute('aria-label')).startsWith('Black box recorder') && await pg.locator('#moreSheet a[href="/blackbox.html"]').count() === 1, 'dashboard has the Black box recorder button and More entry');
  const q0 = await pg.evaluate(() => JSON.parse(localStorage.getItem('cn_bb_q') || '[]').map(x => x.k));
  ok(q0.includes('start'), 'the page start is recorded in the local queue');
  await pg.evaluate(() => { setTimeout(() => { throw new Error('boom from test'); }, 0); }); await pg.waitForTimeout(300);
  ok((await pg.evaluate(() => JSON.parse(localStorage.getItem('cn_bb_q') || '[]').map(x => x.k))).includes('err'), 'a script error is recorded');
  await pg.evaluate(() => CNBlackBox.flush()); await pg.waitForTimeout(800);
  ok(await pg.evaluate(() => CNBlackBox.status().queued) === 0, 'queue uploaded and emptied');
  await ctx.setOffline(true); await pg.evaluate(() => CNBlackBox.note('offline note')); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => CNBlackBox.status().queued) >= 1, 'offline: records wait in the queue');
  await ctx.setOffline(false); await pg.waitForTimeout(3500);   // the 'online' event flushes after 1.5 s, no call from the test
  ok(await pg.evaluate(() => CNBlackBox.status().queued) === 0, 'back online: they upload by themselves');
  await pg.goto(B + '/blackbox.html'); await pg.waitForSelector('#bDays .b-day');
  ok(/Recording/.test(await pg.locator('#bState').innerText()) && await pg.locator('#bDays a[href*="format=csv"]').count() >= 2, 'page shows Recording and download links');
  ok(/boom from test|offline note/.test(await (await fetch(B + '/api/blackbox/download?day=' + day)).text()), 'the browser records reached the server file');
  await pg.fill('#bNote', 'engine alarm'); await pg.click('#bNoteForm button'); await pg.waitForTimeout(800);
  ok(/engine alarm/.test(await (await fetch(B + '/api/blackbox/download?day=' + day)).text()), 'a typed note is uploaded');
  await pg.click('#bToggle'); ok(/Paused/.test(await pg.locator('#bState').innerText()), 'can be paused');
  await pg.click('#bToggle');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page fits a phone');
  await pg.screenshot({ path: OUT + '/blackbox.png', fullPage: true });
  ok(errs.filter(e => !/boom from test/.test(e)).length === 0, 'no page errors ' + errs.join('|'));
  await br.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
