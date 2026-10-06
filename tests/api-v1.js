// API tests for the phone app: pairing, device tokens, /api/v1, CORS, crew-role limits, queued End voyage and entries.
// Run against a fresh server with an empty DATA_DIR and APP_ORIGINS unset: node tests/api-v1.js
const B = process.env.BASE || 'http://localhost:8091', J = { 'Content-Type': 'application/json' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const iso = ms => new Date(ms).toISOString();
async function req(m, u, b, h) {
  const r = await fetch(B + u, { method: m, headers: Object.assign({}, J, h || {}), body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => null), h: r.headers };
}
const bearer = t => ({ Authorization: 'Bearer ' + t });
(async () => {
  const decl = { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' };
  const pabs = (await req('POST', '/api/crew', { name: 'Pabs' })).d, deck = (await req('POST', '/api/crew', { name: 'Deckhand' })).d;

  // --- v1 needs a token
  let r = await req('GET', '/api/v1/vessel');
  ok(r.s === 401 && r.d.code === 'unauthorised', 'v1 without token -> 401');
  r = await req('GET', '/api/v1/vessel', null, bearer('x'.repeat(43)));
  ok(r.s === 401, 'v1 with unknown token -> 401');
  r = await req('GET', '/api/v1/time');
  ok(r.s === 200 && Math.abs(Date.parse(r.d.now) - Date.now()) < 5000, 'v1 time is open');

  // --- CORS preflight
  let pf = await fetch(B + '/api/v1/vessel', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  ok(pf.status === 204 && pf.headers.get('access-control-allow-origin') === 'capacitor://localhost' && /Authorization/.test(pf.headers.get('access-control-allow-headers')), 'preflight from capacitor://localhost allowed');
  ok(/Date/.test(pf.headers.get('access-control-expose-headers') || ''), 'Date header exposed (clock correction)');
  pf = await fetch(B + '/api/v1/vessel', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  ok(!pf.headers.get('access-control-allow-origin'), 'other origins get no CORS grant');

  // --- pairing
  r = await req('POST', '/api/devices/pair-code', { role: 'master' });
  ok(r.s === 200 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.d.code), 'master pair code made (web)');
  const code = r.d.code;
  r = await req('POST', '/api/v1/auth/pair', { code: code.toLowerCase().replace('-', ' '), name: 'Pabs iPhone' });
  ok(r.s === 200 && r.d.token && r.d.device.role === 'master', 'pairing with code (any case/spacing) gives a token');
  const mt = r.d.token, mdev = r.d.device;
  r = await req('POST', '/api/v1/auth/pair', { code, name: 'again' });
  ok(r.s === 400 && r.d.code === 'bad_code', 'a code works once');
  r = await req('GET', '/api/v1/me', null, bearer(mt));
  ok(r.s === 200 && r.d.device.name === 'Pabs iPhone', 'v1 /me with token');
  r = await req('GET', '/api/v1/vessel', null, Object.assign({ Origin: 'capacitor://localhost' }, bearer(mt)));
  ok(r.s === 200 && r.h.get('access-control-allow-origin') === 'capacitor://localhost', 'v1 GET with token + CORS header');
  ok((await req('GET', '/api/devices')).d.length === 1, 'device listed on web');

  // --- master phone does everything; audit names the phone
  r = await req('POST', `/api/v1/crew/${pabs.id}/quicklog`, { type: 'work', declaration: decl, tapId: 'm1', at: iso(Date.now() - 600000) }, bearer(mt));
  ok(r.s === 200 && r.d.startedVoyage, 'master phone starts a voyage');
  r = await req('PUT', '/api/v1/vessel', { vessel: 'Alba Explorer' }, bearer(mt));
  ok(r.s === 200 && r.d.vessel === 'Alba Explorer', 'master phone renames the vessel');
  let au = (await req('GET', '/api/entries-audit?limit=20')).d;
  ok(au.some(a => /@Pabs iPhone$/.test(a.source || '')), 'audit source names the phone');

  // --- crew phone: own hours only
  r = await req('POST', '/api/devices/pair-code', { role: 'crew' });
  ok(r.s === 400, 'crew code needs a crew member');
  r = await req('POST', '/api/devices/pair-code', { role: 'crew', crewId: deck.id });
  const ct = (await req('POST', '/api/v1/auth/pair', { code: r.d.code, name: 'Deck phone' })).d.token;
  ok(!!ct, 'crew phone paired');
  r = await req('GET', '/api/v1/crew', null, bearer(ct));
  ok(r.s === 200 && r.d.length === 1 && r.d[0].id === deck.id, 'crew phone sees only its crew member');
  r = await req('GET', '/api/v1/dashboard/settings', null, bearer(ct));
  ok(r.d.primaryCrewId === deck.id, 'crew phone dashboard shows its crew member');
  r = await req('GET', `/api/v1/crew/${pabs.id}/entries`, null, bearer(ct));
  ok(r.s === 403, 'crew phone cannot read another crew member');
  r = await req('POST', `/api/v1/crew/${pabs.id}/quicklog`, { type: 'rest' }, bearer(ct));
  ok(r.s === 403, 'crew phone cannot tap for another crew member');
  r = await req('PUT', '/api/v1/vessel', { vessel: 'X' }, bearer(ct));
  ok(r.s === 403, 'crew phone cannot change the vessel');
  r = await req('POST', '/api/v1/devices/pair-code', { role: 'master' }, bearer(ct));
  ok(r.s === 403, 'crew phone cannot make pairing codes');
  r = await req('GET', '/api/v1/export.json', null, bearer(ct));
  ok(r.s === 403, 'crew phone cannot export everything');
  r = await req('POST', `/api/v1/crew/${deck.id}/quicklog`, { type: 'work', declaration: decl, tapId: 'c1' }, bearer(ct));
  ok(r.s === 200, 'crew phone taps for itself');
  const deckEntry = r.d.id;
  r = await req('PUT', `/api/v1/entries/${deckEntry}`, { note: 'x' }, bearer(ct));
  ok(r.s !== 403, 'crew phone edits its own entry');
  const pabsEntry = (await req('GET', `/api/crew/${pabs.id}/entries`)).d[0].id;
  r = await req('DELETE', `/api/v1/entries/${pabsEntry}`, null, bearer(ct));
  ok(r.s === 403, "crew phone cannot delete another's entry");
  r = await req('GET', '/api/v1/dashboard/hor-summary', null, bearer(ct));
  ok(r.s === 200 && r.d.crewName === 'Deckhand', 'crew phone hor-summary is its own');

  // --- queued End voyage
  r = await req('POST', `/api/v1/crew/${pabs.id}/quicklog`, { type: 'rest', tapId: 'm2', at: iso(Date.now() - 300000) }, bearer(mt));
  ok(r.s === 200, 'queued rest');
  r = await req('POST', `/api/v1/crew/${pabs.id}/voyage/end`, { opId: 'e0', at: iso(Date.now() - 360000) }, bearer(mt));
  ok(r.s === 409 && r.d.code === 'end_out_of_order', 'late End voyage before the last tap -> 409');
  const endAt = iso(Date.now() - 120000);
  r = await req('POST', `/api/v1/crew/${pabs.id}/voyage/end`, { opId: 'e1', at: endAt }, bearer(mt));
  ok(r.s === 200 && r.d.end === endAt, 'queued End voyage at its own time');
  r = await req('POST', `/api/v1/crew/${pabs.id}/voyage/end`, { opId: 'e1', at: endAt }, bearer(mt));
  ok(r.s === 200 && r.d.duplicate, 'End voyage replay is a duplicate');
  r = await req('POST', `/api/v1/crew/${pabs.id}/voyage/end`, { opId: 'e2' }, bearer(mt));
  ok(r.s === 409 && r.d.code === 'no_open_voyage', 'End with no open voyage -> 409');
  const es = (await req('GET', `/api/crew/${pabs.id}/entries`)).d;
  ok(es[0].end === endAt, 'open period closed at the End voyage time');

  // --- queued manual entry
  const vstart = Date.now() - 3 * 3600000;
  await req('POST', `/api/crew/${pabs.id}/voyages`, { start: iso(vstart - 3600000), end: iso(vstart + 3600000) });
  const ent = { type: 'rest', start: iso(vstart), end: iso(vstart + 1800000), note: 'offline', opId: 'n1' };
  r = await req('POST', `/api/v1/crew/${pabs.id}/entries`, ent, bearer(mt));
  ok(r.s === 200 && !r.d.duplicate, 'manual entry with opId');
  r = await req('POST', `/api/v1/crew/${pabs.id}/entries`, ent, bearer(mt));
  ok(r.s === 200 && r.d.duplicate, 'manual entry replay is a duplicate');

  // --- unversioned web API unchanged; revocation
  ok((await req('GET', '/api/vessel')).s === 200, 'web /api still works without a token (Caddy guards it)');
  await req('DELETE', '/api/devices/' + mdev.id);
  r = await req('GET', '/api/v1/vessel', null, bearer(mt));
  ok(r.s === 401, 'removed phone is refused');

  // --- brute-force brake
  let last;
  for (let i = 0; i < 22; i++) last = await req('POST', '/api/v1/auth/pair', { code: 'AAAA-AAAA' });
  ok(last.s === 429, 'pairing locks after 20 wrong codes in an hour');
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
