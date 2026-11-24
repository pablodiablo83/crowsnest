// Assistant engine (assistant.js). Two halves:
//  1. THE GATE (no server needed): every page and every API route must be covered by a skill or exempted with a reason; every
//     skill needs help text and examples that route to it. Add a feature without teaching the assistant and this fails.
//  2. Behaviour against a fresh server on 8091 with fakes on 8097 (Open-Meteo). Usage: node tests/api-assistant.js
const fs = require('fs'), path = require('path'), http = require('http');
const A = require('../assistant.js');
const ROOT = path.join(__dirname, '..');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// ------------------------------------------------------------ 1. the gate
{
  const S = A.SKILLS;
  ok(S.length >= 15 && new Set(S.map(s => s.id)).size === S.length, S.length + ' skills, ids unique');
  for (const s of S) {
    ok(s.title && s.help && Array.isArray(s.examples) && s.examples.length >= 2, `skill ${s.id}: title, help, 2+ examples`);
    for (const ex of s.examples) { const hit = A.route(ex); ok(hit && hit.skill.id === s.id, `skill ${s.id}: “${ex}” routes to it${hit && hit.skill.id !== s.id ? ' (went to ' + hit.skill.id + ')' : ''}`); }
  }
  ok(A.route('blah blah nothing') === null && A.route('') === null, 'nonsense routes nowhere');
  // pages
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.html')).map(f => '/' + f);
  const cp = A.coveredPages(), ex = A.EXEMPT_PAGES;
  const missingP = pages.filter(p => !cp.has(p) && !ex[p]);
  ok(!missingP.length, 'every page is covered or exempt' + (missingP.length ? ' — ADD A SKILL (or an exemption with a reason) for: ' + missingP.join(', ') : ''));
  const staleP = [...cp, ...Object.keys(ex)].filter(p => p !== '/index.html' && !pages.includes(p));
  ok(!staleP.length, 'no skill or exemption names a page that does not exist' + (staleP.length ? ': ' + staleP.join(', ') : ''));
  // routes
  const routes = new Set();
  for (const f of ['server.js', 'extra.js', 'tides.js', 'atlantic-wx.js', 'assistant.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); let m; const re = /app\.(get|post|put|delete)\(\s*'([^']+)'/g;
    while ((m = re.exec(src))) if (m[2].startsWith('/api/')) routes.add(m[1].toUpperCase() + ' ' + m[2]);
  }
  const cv = A.covered(), xa = A.EXEMPT_APIS;
  const missingR = [...routes].filter(r => !cv.has(r) && !xa[r]);
  ok(!missingR.length, routes.size + ' API routes all covered or exempt' + (missingR.length ? ' — ADD A SKILL (apis) or an EXEMPT_APIS reason for: ' + missingR.join(' | ') : ''));
  const staleR = [...cv, ...Object.keys(xa)].filter(r => !routes.has(r));
  ok(!staleR.length, 'no skill or exemption names a route that does not exist' + (staleR.length ? ': ' + staleR.join(' | ') : ''));
  ok(Object.values(xa).every(v => v && v.length > 3), 'every exemption has a reason');
}

// ------------------------------------------------------------ 2. behaviour
const B = process.env.BASE || 'http://localhost:8091';
const fake = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'), now = Math.floor(Date.now() / 3600e3) * 3600;
  const t = Array.from({ length: 49 }, (_, i) => now + i * 3600), kn = t.map((_, i) => 10 + (i === 5 ? 12 : 0)), dir = t.map(() => 225), gust = kn.map(k => k * 1.4);
  r.writeHead(200, { 'Content-Type': 'application/json' });
  r.end(JSON.stringify({ latitude: 55.7, longitude: -4.9, hourly: { time: t, wind_speed_10m: kn, wind_direction_10m: dir, wind_gusts_10m: gust },
    current: { time: now, temperature_2m: 9.4, weather_code: 3, wind_speed_10m: 14, wind_direction_10m: 225, wind_gusts_10m: 21 } }));
}).listen(8097);

(async () => {
  const unsigned = global.fetch;
  ok((await unsigned(B + '/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"help"}' })).status === 401, 'assistant needs a sign-in');
  await require('./lib/session')(B);
  const J = (m, p, b, h) => fetch(B + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, h || {}), body: b && JSON.stringify(b) }).then(async r => ({ status: r.status, ok: r.ok, d: await r.json().catch(() => ({})) }));
  const ask = async (text, extra, h) => (await J('POST', '/api/agent', Object.assign({ text, tz: 60, context: { lat: 55.7, lon: -4.9 } }, extra || {}), h)).d;
  const act = (r, k) => (r.actions || []).find(a => a.kind === k);
  const crewId = (await J('POST', '/api/crew', { name: 'Alex Morgan', role: 'Master' })).d.id;
  const decl = { rested: 'yes', ackRecords: true, ackEmergency: true, under18: false, declaredBy: 'seafarer' };
  const now = Date.now(), iso = ms => new Date(ms).toISOString();

  let r = await ask('help'); ok(r.skill === 'help' && A.SKILLS.filter(s => s.id !== 'help').every(s => r.reply.includes(s.title)), 'help lists every skill');
  r = await ask('hello there'); ok(r.ok === false && /did not understand/.test(r.reply), 'unknown request: says so and suggests');
  r = await ask('open the tides page'); ok(r.skill === 'open' && act(r, 'open').url === '/tides.html', 'open: gives the page link');

  // no voyage yet: a WORK tap needs the joining declaration (never invented)
  r = await ask('that me working'); ok(r.skill === 'tap' && r.ok === false && /joining declaration/.test(r.reply), 'first tap of a voyage: sends you to the declaration');
  r = await ask('record 4 hours on 4 hours off for the last 24 hours'); ok(r.ok === false && /no voyage/i.test(r.reply), 'pattern with no voyage: refuses plainly');

  // a voyage that began 30 h ago
  const vy = await J('POST', `/api/crew/${crewId}/voyages`, { start: iso(now - 30 * 3600e3), declaration: decl }); ok(vy.ok, 'voyage created for the test');

  // "that me working": immediate, undoable
  r = await ask('that me working');
  ok(r.skill === 'tap' && r.ok && /WORKING from \d\d:\d\d/.test(r.reply) && act(r, 'undo'), 'tap: “that me working” logs WORK now with Undo (' + r.reply + ')');
  let es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es.length === 1 && es[0].type === 'work' && !es[0].end, 'one open WORK entry');
  r = await ask('i am resting now'); ok(r.ok && /RESTING/.test(r.reply), 'tap: REST closes the work period');
  r = await ask('undo'); ok(r.ok && /Undone/.test(r.reply), 'undo by text');
  es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es.length === 1 && es[0].type === 'work' && !es[0].end, 'undo put the open WORK period back');
  r = await ask('that me working'); ok(r.ok && /already working/.test(r.reply) && !act(r, 'undo'), 'tap in the same state: says so, nothing changed');
  // clear the test entry so the pattern has a clean window
  await J('DELETE', `/api/entries/${es[0].id}`);

  // the pattern: 4 on / 4 off for the last 24 h
  r = await ask('record a work pattern of 4 hours on 4 hours off for the last 24 hours');
  ok(r.skill === 'pattern' && r.ok && r.plan && r.plan.steps.length === 6 && act(r, 'confirm') && act(r, 'cancel'), 'pattern: shows a plan of 6 blocks first (' + (r.plan ? r.plan.steps.length : r.reply) + ')');
  ok(/WORK/.test(r.plan.steps[0]) && /REST/.test(r.plan.steps[1]) && /\+?/.test(r.reply), 'plan alternates WORK, REST');
  es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es.length === 0, 'nothing is recorded before you say Do it');
  let c = await ask('', { text: undefined, confirm: act(r, 'confirm').token }); ok(c.ok && /6 changes/.test(c.reply) && act(c, 'undo'), 'confirm: 6 entries recorded, Undo offered (' + c.reply + ')');
  es = (await J('GET', `/api/crew/${crewId}/entries`)).d.slice().reverse();
  ok(es.length === 6 && es.every((e, i) => e.type === (i % 2 ? 'rest' : 'work')), '6 entries, alternating work and rest');
  ok(es.every((e, i) => !i || es[i - 1].end === e.start) && Math.abs(Date.parse(es[0].start) - (now - 24 * 3600e3)) < 120e3 && Math.abs(Date.parse(es[5].end) - now) < 120e3, 'contiguous, from 24 h ago to now');
  c = await ask('', { text: undefined, confirm: 'nonsense' }); ok(c.ok === false && /expired/.test(c.reply), 'a made-up confirm token is refused');
  const t2 = act(await ask('record 4 hours on 4 hours off for the last 24 hours'), 'confirm'); ok(!t2, 'repeat: refuses to double up');
  r = await ask('record 4 hours on 4 hours off for the last 24 hours'); ok(/already has 6 entries/.test(r.reply) && /replace/.test(r.reply), 'repeat: explains and offers “replace”');
  r = await ask('replace with 6 on 6 off for the last 24 hours'); ok(r.plan && r.plan.steps.length === 5 && /removing 6/.test(r.plan.steps[4]), 'replace: plan removes the old entries first');
  c = await ask('', { text: undefined, confirm: act(r, 'confirm').token }); ok(c.ok, 'replace confirmed');
  es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es.length === 4, '4 entries (6 on / 6 off) after replace');
  c = await ask('', { text: undefined, undo: true }); ok(c.ok && /Undone/.test(c.reply), 'undo reverses the whole replace');
  es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es.length === 6, 'original 6 entries are back (' + es.length + ')');

  // edit and delete
  r = await ask('change my last entry to work'); ok(r.plan && /REST|WORK/.test(r.plan.steps[0]) && act(r, 'confirm'), 'edit: plan first');
  await ask('', { text: undefined, confirm: act(r, 'confirm').token });
  es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es[0].type === 'work', 'last entry is now WORK');
  c = await ask('', { text: undefined, undo: true }); es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es[0].type === 'rest', 'undo changed it back to REST');
  r = await ask('set the last entry end to ' + new Date(Date.parse(es[0].end) - 3600e3 + 3600e3).toISOString().slice(11, 16)); ok(r.skill === 'edit-last' || /did not understand/.test(r.reply), 'edit-end phrase understood or politely refused');
  r = await ask('delete my last entry'); ok(r.plan && /Delete/.test(r.reply), 'delete: asks first');
  await ask('', { text: undefined, confirm: act(r, 'confirm').token });
  es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es.length === 5, 'entry deleted (kept in history)');
  c = await ask('', { text: undefined, undo: true }); es = (await J('GET', `/api/crew/${crewId}/entries`)).d; ok(es.length === 6, 'delete undone: entry restored');
  const au = (await J('GET', '/api/entries-audit')).d; ok(JSON.stringify(au).includes('assistant'), 'change history says “assistant”');
  // add a range (a forgotten hour inside the voyage, before the pattern window)
  r = await ask('add rest from 02:00 to 03:00 ' + (new Date(now - 28 * 3600e3).getUTCDate() === new Date(now - 24 * 3600e3).getUTCDate() ? 'today' : 'yesterday')); ok(r.skill === 'add-entry', 'add-entry understood');

  // reads
  r = await ask('how much rest have i had'); ok(r.skill === 'rest-status' && /24 h rest (11h 5\dm|12h 0\dm)/.test(r.reply) && /✓/.test(r.reply), 'rest status: 12h in 24 h (' + r.reply.slice(0, 90) + ')');
  r = await ask('show my entries for the last 24 hours'); ok(r.skill === 'entries' && /work (11h 5\dm|12h 0\dm), rest (11h 5\dm|12h 0\dm)/.test(r.reply), 'entries: totals (' + r.reply.split('\n')[0] + ')');
  r = await ask('who is working'); ok(r.skill === 'who' && /Alex Morgan/.test(r.reply), 'who: lists crew status');
  r = await ask("what's the weather for my location"); ok(r.skill === 'weather' && r.ok && /9°C/.test(r.reply) && /SW 14 kn \(Force 4\)/.test(r.reply), 'weather: ' + r.reply.slice(0, 90));
  r = await ask('wind forecast'); ok(r.skill === 'wind' && r.ok && /strongest 22 kn/.test(r.reply), 'wind: ' + r.reply.slice(0, 100));
  r = await ask('where am i'); ok(r.skill === 'position', 'position (no fix yet): ' + r.reply);
  r = await ask('log my position'); ok(r.ok && /Position logged: 55°42/.test(r.reply) && act(r, 'undo'), 'position logged from the phone with Undo');
  r = await ask('where am i'); ok(/Last fix: 55°42/.test(r.reply), 'position read back');
  r = await ask('log: engine checks done'); ok(r.skill === 'log' && r.ok, 'ship’s log line added');
  r = await ask('show the log'); ok(/engine checks done/.test(r.reply), 'ship’s log read back');
  r = await ask('how far have we gone'); ok(r.skill === 'voyage' && r.ok, 'voyage: ' + r.reply.slice(0, 80));
  r = await ask('is everything working'); ok(r.skill === 'status' && /CROW'S NEST STATUS/.test(r.reply), 'status summary');
  r = await ask('when is high water'); ok(r.skill === 'tides' && r.reply.length > 10, 'tides answers or says why not');
  r = await ask('inshore forecast'); ok(r.skill === 'inshore' && r.reply.length > 10, 'inshore answers or says why not');
  r = await ask('atlantic weather'); ok(r.skill === 'atlantic' && act(r, 'open').url === '/atlantic.html', 'atlantic: link');
  r = await ask('end the voyage'); ok(r.plan && act(r, 'confirm'), 'end voyage: asks first');
  await J('POST', '/api/agent', { cancel: act(r, 'cancel').token }); es = (await J('GET', `/api/crew/${crewId}/voyages`)).d; ok(!es[0].end, 'cancel: voyage still open');

  // a crew phone gets only what it may do
  const code = (await J('POST', '/api/devices/pair-code', { role: 'crew', crewId })).d.code;
  const tok = (await (await unsigned(B + '/api/v1/auth/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'crew phone' }) })).json()).token;
  const H = { Authorization: 'Bearer ' + tok };
  r = await ask('show the log', {}, H); ok(r.ok === false && /not allowed/.test(r.reply), 'crew phone: the ship’s log is refused (its own limits apply)');
  r = await J('POST', '/api/v1/agent', { text: 'how much rest have i had', tz: 0, context: {} }, H); ok(r.d.skill === 'rest-status' && /Alex Morgan/.test(r.d.reply), 'crew phone: can ask about its own hours');
  r = await J('POST', '/api/v1/agent', { text: 'who is working', tz: 0 }, H); ok(/Alex Morgan/.test(r.d.reply) && !/\n/.test(r.d.reply.trim()), 'crew phone: sees only itself');
  const plan = await ask('delete my last entry'); const ex = await J('POST', '/api/v1/agent', { confirm: act(plan, 'confirm').token }, H);
  ok(ex.d.ok === false && /expired/.test(ex.d.reply), 'a plan cannot be confirmed from a different sign-in');
  r = await J('POST', '/api/v1/agent', { text: 'record 4 hours on 4 hours off for the last 24 hours' }, H); ok(r.d.skill === 'pattern', 'crew phone: pattern allowed for its own hours (then checked by the same rules)');

  fake.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
