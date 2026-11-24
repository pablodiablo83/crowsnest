// Status page (/status.html + GET /api/status): master sees every check and a plain-text summary that copies; crew phones
// are refused; errors are kept. Fresh server on 8091. Usage: node tests/pw-status.js [screenshot dir]
const { chromium } = require('playwright');
const B = process.env.BASE || 'http://localhost:8091', OUT = process.argv[2] || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  // the error ring buffer (health.js) keeps console.error lines, short and in order
  const h = require('../health.js'); const n0 = h.errors.length;
  const orig = process.stderr.write; process.stderr.write = () => true;
  console.error(new Error('test boom'), { x: 1 }); process.stderr.write = orig;
  ok(h.errors.length === n0 + 1 && /test boom/.test(h.errors[h.errors.length - 1].text), 'errors are kept for the status page');
  ok((await fetch(B + '/api/status')).status === 401, 'status needs a sign-in');
  const sid = await require('./lib/session')(B);
  const J = (m, p, b, hd) => fetch(B + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, hd || {}), body: b && JSON.stringify(b) });
  let r = await J('GET', '/api/status'); const s = await r.json();
  const ids = s.checks.map(c => c.id);
  ok(r.status === 200 && ['server', 'db', 'disk', 'hor', 'auth', 'phones', 'position', 'atlantic', 'tides', 'ukho', 'wind', 'weather', 'inshore', 'errors'].every(i => ids.includes(i)), '14 checks: ' + ids.join(','));
  ok(s.checks.every(c => ['ok', 'warn', 'bad', 'idle'].includes(c.state) && c.summary && !/undefined|NaN|\?/.test(c.summary)), 'every check has a state and a clean summary');
  ok(s.checks.find(c => c.id === 'tides').state !== 'idle' || !/failed/.test(s.checks.find(c => c.id === 'tides').detail || ''), 'a failed tide analysis is never shown as not in use');
  ok(s.checks.find(c => c.id === 'db').state === 'ok' && /integrity ok/.test(s.checks.find(c => c.id === 'db').summary), 'database integrity checked');
  ok(/^CROW'S NEST STATUS/.test(s.text) && /ERRORS \(last 24 h\)/.test(s.text) && /^OK +Server: up /m.test(s.text), 'plain-text summary');
  ok(r.headers.get('cache-control') === 'no-store', 'never cached on a phone');
  ok(!/ukhoKey|token|password|pass_hash/i.test(JSON.stringify(s)), 'no secrets in the report');
  // a crew phone is refused
  const crew = await (await J('POST', '/api/crew', { name: 'Status crew' })).json();
  const code = (await (await J('POST', '/api/devices/pair-code', { role: 'crew', crewId: crew.id })).json()).code;
  const tok = (await (await fetch.unsigned(B + '/api/v1/auth/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'crew phone' }) })).json()).token;
  ok((await fetch.unsigned(B + '/api/v1/status', { headers: { Authorization: 'Bearer ' + tok } })).status === 403, 'crew phone: 403');
  // the page
  const br = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
  await ctx.addCookies([{ name: 'cn_sid', value: sid, url: B }]);
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(B + '/'); ok(await pg.locator('.dfooter a[href="/status.html"]').count() === 1, 'dashboard footer links to Status');
  await pg.goto(B + '/status.html'); await pg.waitForSelector('#sList li[data-id]');
  ok(await pg.locator('#sList li[data-id]').count() === s.checks.length, 'one row per check');
  ok(/healthy|to check|failing/i.test(await pg.locator('#sOverall').innerText()), 'overall line: ' + await pg.locator('#sOverall').innerText());
  ok(/CROW'S NEST STATUS/.test(await pg.locator('#sText').innerText()), 'text summary on the page');
  await pg.click('#sCopy'); await pg.waitForTimeout(200);
  const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(/^CROW'S NEST STATUS/.test(clip) && /Copied/.test(await pg.locator('#sCopy').innerText()), 'Copy puts the summary on the clipboard');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'fits a phone');
  await pg.screenshot({ path: OUT + '/status.png', fullPage: true });
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  await br.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
