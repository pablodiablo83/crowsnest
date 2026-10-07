// Web sign-in: every page and API route is closed without a session; sign-in, lockout, cookie flags, cross-site guard,
// password change, sign-out, crew accounts and the account tool (tools/user.js).
// Needs a fresh server on 8091 and the test account (tests/run-all.sh makes both).
const fs = require('fs'), path = require('path'), http = require('http'), { execFileSync } = require('child_process');
const B = process.env.BASE || 'http://localhost:8091', J = { 'Content-Type': 'application/json' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const raw = (method, p, headers, body) => new Promise(res => {
  const U = new URL(B), q = http.request({ agent: false, host: U.hostname, port: U.port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => res({ s: x.statusCode, h: x.headers, d }));
  });
  if (body) q.write(JSON.stringify(body)); q.end();
});
const login = (u, p, extra) => raw('POST', '/api/auth/login', extra, { username: u, password: p });
const sidOf = r => ((r.h['set-cookie'] || []).join(';').match(/cn_sid=([^;]+)/) || [])[1];
const userTool = (args, pw) => execFileSync('node', [path.join(__dirname, '..', 'tools', 'user.js')].concat(args, ['--password-stdin']),
  { input: pw + '\n', env: Object.assign({}, process.env, { DATA_DIR: process.env.DATA_DIR_FOR_TOOL || '' }), encoding: 'utf8' });

(async () => {
  // --- every route in server.js is closed without a sign-in (except the deliberate few)
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routes = [...src.matchAll(/app\.(get|post|put|delete)\('([^']+)'/g)].map(m => [m[1].toUpperCase(), m[2].replace(/:[a-z]+/gi, 'x')]);
  const OPEN = new Set(['POST /api/auth/login', 'GET /api/auth/status', 'GET /healthz']);
  let leaks = [];
  for (const [m, p] of routes) {
    if (OPEN.has(m + ' ' + p)) continue;
    const r = await raw(m, p, {}, m === 'GET' ? null : {});
    if (!(r.s === 401 || (r.s === 302 && /login\.html/.test(r.h.location || '')))) leaks.push(m + ' ' + p + ' -> ' + r.s);
  }
  ok(routes.length >= 55 && !leaks.length, 'all ' + routes.length + ' server routes closed without sign-in' + (leaks.length ? ': ' + leaks.join(', ') : ''));
  for (const p of ['/', '/index.html', '/hours-of-rest.html', '/wind.html', '/track.html', '/hor.js', '/net.js', '/outbox.js', '/connect.html']) {
    const r = await raw('GET', p);
    if (!(r.s === 302 && /^\/login\.html\?next=/.test(r.h.location))) leaks.push(p + ' -> ' + r.s);
  }
  ok(!leaks.length, 'pages and scripts redirect to the login page' + (leaks.length ? ': ' + leaks.join(', ') : ''));
  ok((await raw('GET', '/API/CREW')).s === 401, 'upper-case path does not slip past the gate');
  for (const p of ['/login.html', '/wave.css', '/assets/icon.png', '/manifest.json', '/healthz']) ok((await raw('GET', p)).s === 200, p + ' open (login page needs it)');
  ok(JSON.parse((await raw('GET', '/api/auth/status')).d).accounts === true, 'status says accounts exist (and nothing more)');
  ok((await raw('GET', '/api/v1/vessel')).s === 401, '/api/v1 still needs a device token');

  // --- sign in
  let r = await login('tester', 'wrong-password-1');
  ok(r.s === 401 && JSON.parse(r.d).code === 'bad_login', 'wrong password refused');
  r = await login('nobody', 'whatever-password');
  ok(r.s === 401 && JSON.parse(r.d).error === 'wrong username or password', 'unknown user: same message (does not reveal usernames)');
  for (let i = 0; i < 10; i++) await login('ghost', 'nope-nope-nope');
  r = await login('ghost', 'nope-nope-nope');
  ok(r.s === 429, 'locked after 10 wrong passwords for a username');
  r = await login('tester', 'test-password-1234');
  const sid = sidOf(r), cookie = (r.h['set-cookie'] || []).join(';');
  ok(r.s === 200 && sid && /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie) && /Max-Age=2592000/.test(cookie) && !/Secure/.test(cookie), 'signed in: HttpOnly, SameSite=Lax, 30 days (no Secure on plain localhost)');
  r = await raw('POST', '/api/auth/login', { Host: 'app.crows-nest.co.uk' }, { username: 'tester', password: 'test-password-1234' });
  ok(/Secure/.test((r.h['set-cookie'] || []).join(';')), 'Secure cookie on the real host name');
  r = await raw('POST', '/api/auth/login', {}, { username: 'tester', password: 'test-password-1234', remember: false });
  ok(!/Max-Age/.test((r.h['set-cookie'] || []).join(';')), 'not "stay signed in": cookie ends with the browser session');
  const C = { Cookie: 'cn_sid=' + sid };
  r = await raw('GET', '/api/auth/me', C);
  ok(r.s === 200 && JSON.parse(r.d).user.username === 'tester', 'session works');
  ok((await raw('GET', '/', C)).s === 200, 'dashboard opens when signed in');
  ok((await raw('GET', '/api/auth/me', { Cookie: 'cn_sid=' + sid.slice(0, -2) + 'xx' })).s === 401, 'tampered cookie refused');

  // --- cross-site guard
  const crew = JSON.parse((await raw('POST', '/api/crew', Object.assign({ Origin: 'https://evil.example' }, C), { name: 'X' })).d);
  ok(crew.code === 'cross_site', 'change from another site refused');
  r = await raw('POST', '/api/crew', Object.assign({ Origin: B }, C), { name: 'Deckhand' });
  ok(r.s === 200, 'change from this site accepted');
  const deck = JSON.parse(r.d);
  await raw('PUT', '/api/vessel', Object.assign({ Origin: B }, C), { flag: 'Red Ensign' });   // an audited change
  const au = JSON.parse((await raw('GET', '/api/entries-audit?limit=50', C)).d);
  ok(au.some(a => a.action === 'sign-in') && au.some(a => /@tester$/.test(a.source || '')), 'audit: sign-in recorded, changes name the account');

  // --- crew account (made with the account tool), limited to its own hours
  userTool(['add', 'deck', 'crew', deck.id], 'deckhand-password-1');
  r = await login('deck', 'deckhand-password-1'); const DC = { Cookie: 'cn_sid=' + sidOf(r) };
  const list = JSON.parse((await raw('GET', '/api/crew', DC)).d);
  ok(list.length === 1 && list[0].id === deck.id, 'crew account sees only its crew member');
  ok((await raw('PUT', '/api/vessel', DC, { vessel: 'X' })).s === 403, 'crew account cannot change the vessel');
  ok((await raw('GET', '/api/devices', DC)).s === 403, 'crew account cannot see paired phones');
  userTool(['disable', 'deck'], 'x');
  ok((await raw('GET', '/api/auth/me', DC)).s === 401, 'disabled account is signed out at once');

  // --- password change: other sessions end, this one stays
  const other = sidOf(await login('tester', 'test-password-1234'));
  r = await raw('POST', '/api/auth/password', C, { current: 'wrong', next: 'new-password-5678' });
  ok(r.s === 400 && JSON.parse(r.d).code === 'bad_current', 'password change needs the current password');
  r = await raw('POST', '/api/auth/password', C, { current: 'test-password-1234', next: 'short' });
  ok(r.s === 400 && JSON.parse(r.d).code === 'weak', 'short password refused');
  r = await raw('POST', '/api/auth/password', C, { current: 'test-password-1234', next: 'new-password-5678' });
  ok(r.s === 200 && (await raw('GET', '/api/auth/me', C)).s === 200 && (await raw('GET', '/api/auth/me', { Cookie: 'cn_sid=' + other })).s === 401, 'password changed: this device stays in, others signed out');
  ok((await login('tester', 'test-password-1234')).s === 401 && (await login('tester', 'new-password-5678')).s === 200, 'old password no longer works, new one does');

  // --- sign out
  await raw('POST', '/api/auth/logout', C);
  ok((await raw('GET', '/api/auth/me', C)).s === 401, 'signed out: the cookie no longer works');
  userTool(['password', 'tester'], 'test-password-1234');   // leave the account as the other suites expect
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
