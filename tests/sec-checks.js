// Security checks (run by tests/run-all.sh on a fresh server; needs DATA_DIR_FOR_TOOL to create a crew account):
// security headers, crew accounts confined to their own crew member (web gate + track routes), sign-in lockout that a
// stranger cannot use against the master, per-address pairing brake, no crash when a phone tries a password change,
// script injection through stored names (escaping checked with the CSP switched off), and the sign-in redirect.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const B = process.env.BASE || 'http://localhost:8091', SP = process.argv[2] || '.';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const J = { 'Content-Type': 'application/json' };
const login = async (username, password, ip) => {
  const r = await fetch.unsigned(B + '/api/auth/login', { method: 'POST', headers: Object.assign({ 'CF-Connecting-IP': ip || '198.51.100.1' }, J), body: JSON.stringify({ username, password }) });
  const m = (r.headers.get('set-cookie') || '').match(/cn_sid=([^;]+)/);
  return { status: r.status, sid: m && m[1] };
};
const as = sid => (u, o = {}) => fetch.unsigned(B + u, Object.assign({}, o, { headers: Object.assign({ Cookie: 'cn_sid=' + sid }, J, o.headers || {}) }));

(async () => {
  const SID = await require('./lib/session')(B);
  const api = async (m, u, b) => (await fetch(B + u, { method: m, headers: J, body: b ? JSON.stringify(b) : undefined })).json();

  // --- headers
  const h = (await fetch.unsigned(B + '/login.html')).headers, h2 = (await fetch.unsigned(B + '/api/crew')).headers;
  ok(/frame-ancestors 'none'/.test(h.get('content-security-policy') || '') && /script-src 'self'(;|$)/.test(h.get('content-security-policy')) && h.get('x-frame-options') === 'DENY' &&
    h.get('x-content-type-options') === 'nosniff' && !h.get('x-powered-by'), 'security headers on pages (CSP without inline scripts, no framing, nosniff, no X-Powered-By)');
  ok(h2.get('x-frame-options') === 'DENY' && !h2.get('x-powered-by'), 'security headers on API errors too');
  ok((await fetch.unsigned(B + '/login.js')).status === 200 && [302, 401].includes((await fetch.unsigned(B + '/connect.js', { redirect: 'manual' })).status), 'login.js open (sign-in page needs it), everything else still gated');

  // --- crew isolation: Alice (primary) and Bob; a crew web account for Bob
  const XSS = '<img src=x onerror=window.__x=1>';
  const alice = await api('POST', '/api/crew', { name: 'Alice' }), bob = await api('POST', '/api/crew', { name: XSS });
  await api('PUT', '/api/dashboard/settings', { primaryCrewId: alice.id });
  const decl = { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' };
  const qa = await api('POST', `/api/crew/${alice.id}/quicklog`, { type: 'work', declaration: decl });
  await api('POST', `/api/crew/${bob.id}/quicklog`, { type: 'work', declaration: decl });
  await api('PUT', '/api/vessel', { vessel: XSS, flag: XSS });
  execFileSync('node', ['tools/user.js', 'add', 'bobby', 'crew', bob.id, '--password-stdin'], { input: 'bob-password-1234\n', env: Object.assign({}, process.env, { DATA_DIR: process.env.DATA_DIR_FOR_TOOL }) });
  const bl = await login('bobby', 'bob-password-1234', '198.51.100.7');
  ok(bl.status === 200 && bl.sid, 'crew account signs in');
  const bobGet = as(bl.sid);
  const crewList = await (await bobGet('/api/crew')).json();
  ok(crewList.length === 1 && crewList[0].id === bob.id, 'crew account sees only its own crew member (GET /api/crew)');
  const sum = await (await bobGet('/api/dashboard/hor-summary')).json();
  ok(sum.crewName === XSS, 'crew dashboard shows its own hours, not the primary crew member\'s');
  const tv = await (await bobGet('/api/track/voyages?crew=' + alice.id)).json();
  ok(JSON.stringify(tv).indexOf(qa.voyageId) < 0, 'crew cannot list another crew member\'s voyages through ?crew=');
  ok((await bobGet('/api/voyages/' + qa.voyageId + '/track')).status === 404, 'crew cannot open another crew member\'s voyage track');
  ok((await bobGet('/api/export.json')).status === 403 && (await bobGet('/api/crew/' + alice.id + '/entries')).status === 403, 'crew cannot export or read others\' entries');

  // --- sign-in lockout: a stranger's 10 bad tries do not lock the master out
  for (let i = 0; i < 10; i++) await login('tester', 'wrong-password-' + i, '203.0.113.' + (i % 3 + 1));
  let l = await login('tester', 'test-password-1234', '198.51.100.9');
  ok(l.status === 200, 'master can still sign in after a stranger\'s 10 wrong passwords');
  for (let i = 0; i < 10; i++) await login('tester', 'wrong-password-' + i, '203.0.113.50');
  l = await login('tester', 'test-password-1234', '203.0.113.50');
  ok(l.status === 429, 'but the guessing address itself is locked after 10');

  // --- pairing brake per address; a phone cannot change a password (clean 400, no crash)
  for (let i = 0; i < 20; i++) await fetch.unsigned(B + '/api/v1/auth/pair', { method: 'POST', headers: Object.assign({ 'CF-Connecting-IP': '203.0.113.60' }, J), body: JSON.stringify({ code: 'AAAABBBB' }) });
  const p1 = await fetch.unsigned(B + '/api/v1/auth/pair', { method: 'POST', headers: Object.assign({ 'CF-Connecting-IP': '203.0.113.60' }, J), body: JSON.stringify({ code: 'AAAABBBB' }) });
  const p2 = await fetch.unsigned(B + '/api/v1/auth/pair', { method: 'POST', headers: Object.assign({ 'CF-Connecting-IP': '198.51.100.20' }, J), body: JSON.stringify({ code: 'AAAABBBB' }) });
  ok(p1.status === 429 && p2.status === 400, 'pairing brake is per address (others can still pair)');
  const pc = await api('POST', '/api/devices/pair-code', { role: 'master' });
  const tok = (await (await fetch.unsigned(B + '/api/v1/auth/pair', { method: 'POST', headers: J, body: JSON.stringify({ code: pc.code, name: 'sec test' }) })).json()).token;
  const pw = await fetch.unsigned(B + '/api/v1/auth/password', { method: 'POST', headers: Object.assign({ Authorization: 'Bearer ' + tok }, J), body: JSON.stringify({ current: 'x', next: 'y' }) });
  ok([400, 403, 404].includes(pw.status) && (await fetch.unsigned(B + '/healthz')).status === 200, 'password change from a phone: refused cleanly (' + pw.status + ')');

  // --- robustness: requests that used to crash or stall the server
  let t0 = Date.now(), r = await fetch(B + '/api/tides/predict?port=mill&days=1&from=1e22');
  ok((await fetch.unsigned(B + '/healthz')).status === 200 && Date.now() - t0 < 5000, 'absurd tide "from" (1e22): server stays up (' + r.status + ', ' + (Date.now() - t0) + ' ms)');
  t0 = Date.now(); r = await fetch.unsigned(B + '/api/auth/login', { method: 'POST', headers: J, body: JSON.stringify({ username: 'x'.repeat(90000), password: 'y' }) });
  ok(r.status === 401 && Date.now() - t0 < 3000, 'giant username: refused quickly (' + r.status + ')');
  r = await fetch(B + `/api/crew/${alice.id}/voyages`, { method: 'POST', headers: J, body: JSON.stringify({ start: '-271821-04-20T00:00:00Z', end: '2000-01-02T00:00:00Z' }) });
  ok(r.status === 400, 'date before 2000 refused (' + r.status + ')');
  const carol = await api('POST', '/api/crew', { name: 'Carol' });
  r = await fetch(B + `/api/crew/${carol.id}/voyages`, { method: 'POST', headers: J, body: JSON.stringify({ start: '2000-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' }) });
  await api('PUT', '/api/dashboard/settings', { primaryCrewId: carol.id });
  t0 = Date.now(); r = await fetch(B + '/api/dashboard/hor-summary');
  ok(r.status === 200 && Date.now() - t0 < 4000, '26-year voyage: dashboard still answers fast (' + (Date.now() - t0) + ' ms)');
  await api('PUT', '/api/dashboard/settings', { primaryCrewId: alice.id });
  r = await fetch(B + `/api/crew/${alice.id}/entries`, { method: 'POST', headers: J, body: JSON.stringify({ type: 'rest', start: new Date(Date.now() - 7200000).toISOString(), end: new Date(Date.now() - 3600000).toISOString(), note: { evil: 1 } }) });
  ok(r.status === 400, 'note as an object refused (' + r.status + ')');
  // 130,000 positions in Alice's voyage window: the track still loads (bounds used to overflow the call stack)
  const Database = require('better-sqlite3'), db = new Database(require('path').join(process.env.DATA_DIR_FOR_TOOL, 'crowsnest.db'));
  const ins = db.prepare('INSERT INTO positions (id, ts, lat, lon, acc, sog, cog, source, crew_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const vst = Date.parse(qa.start) + 1000, step = (Date.now() - 2000 - vst) / 130000;   // inside the voyage, not in the future
  db.transaction(() => { for (let i = 0; i < 130000; i++) ins.run('bulk' + i, new Date(vst + i * step).toISOString(), 55.7 + i * 1e-6, -4.9, 5, null, null, 'auto', null, new Date().toISOString()); })();
  db.close();
  t0 = Date.now(); r = await fetch(B + '/api/voyages/' + qa.voyageId + '/track');
  const tj = r.status === 200 ? await r.json() : {};
  ok(r.status === 200 && Array.isArray(tj.stats && tj.stats.bbox) && tj.points && tj.points.length > 100000, 'track with 130,000 positions loads (' + r.status + ', ' + (tj.points ? tj.points.length : 0) + ' points, bbox ' + JSON.stringify(tj.bbox) + ', ' + (Date.now() - t0) + ' ms)');
  // CSV export: formulas neutralised, numbers kept
  await api('PUT', '/api/crew/' + alice.id, { name: '=HYPERLINK("http://evil","x")', role: '@SUM(1+1)' });
  const csv = await (await fetch(B + '/api/export.csv')).text();
  ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`) && csv.includes(`"'@SUM(1+1)"`) && !/(^|,)"=/m.test(csv), 'CSV export: formulas shown as text, not run');
  const tcsv = await (await fetch(B + '/api/voyages/' + qa.voyageId + '/track.csv')).text();
  ok(/,"-4\.9",/.test(tcsv), 'CSV export: negative numbers stay numbers');

  // --- stored names cannot run script (escaping checked with the CSP switched off), and the CSP blocks it anyway
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  for (const bypassCSP of [true, false]) {
    const ctx = await br.newContext({ bypassCSP, viewport: { width: 390, height: 844 } });
    await ctx.addCookies([{ name: 'cn_sid', value: bypassCSP ? SID : bl.sid, url: B }]);
    const page = await ctx.newPage();
    for (const path of ['/', '/hours-of-rest.html', '/track.html', '/tides.html']) {
      await page.goto(B + path); await page.waitForTimeout(1500);
      ok(!(await page.evaluate(() => window.__x)), (bypassCSP ? 'escaping' : 'CSP') + ': stored <img onerror> does not run on ' + path);
    }
    await ctx.close();
  }
  // --- sign-in redirect stays on this site
  const ctx = await br.newContext();
  const page = await ctx.newPage();
  for (const next of ['/%5Cevil.example/x', '//evil.example', '/%09/evil.example', 'https://evil.example']) {
    await page.goto(B + '/login.html?next=' + next);
    await page.fill('#u', 'tester'); await page.fill('#p', 'test-password-1234');
    await Promise.all([page.waitForURL(u => !/login\.html/.test(String(u)), { timeout: 15000 }).catch(() => {}), page.click('button[type=submit]')]);
    ok(new URL(page.url()).origin === new URL(B).origin, 'sign-in redirect stays on this site (next=' + decodeURIComponent(next) + ' -> ' + page.url() + ')');
    await ctx.clearCookies();
  }
  await br.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e.stack); process.exit(1); });
