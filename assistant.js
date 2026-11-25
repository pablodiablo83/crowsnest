// Assistant engine (24 Nov 2026, Pabs): the "Ask or tell Crow's Nest" bar. Plain-language requests go through a registry of
// SKILLS (rules, no outside model, works the same on the web and in the phone app). Reads answer at once; small appends
// (a WORK/REST tap, a log line, a position) happen at once with an Undo; anything that adds many records, edits, deletes or
// ends a voyage shows a plan first and waits for "Do it".
//
// It can never do more than the person asking: every action is an ordinary call to the app's own API, made from the server
// with the caller's own cookie or device token (so crew confinement, validation, overlap checks, audit and undo all apply),
// with X-Source "assistant" so the change history says who did it.
//
// KEEPING IT UP TO DATE (the gate): tests/api-assistant.js fails when
//   - a page in public/ is neither covered by a skill (`pages`) nor listed in EXEMPT_PAGES with a reason,
//   - an API route in the server files is neither covered by a skill (`apis`) nor listed in EXEMPT_APIS with a reason,
//   - a skill lacks help text or fewer than 2 examples, or an example does not route to its own skill.
// So every new feature needs a skill (or a written reason why not) in this file before the tests pass.
const crypto = require('crypto');

// ---------------------------------------------------------------- helpers (pure)
const pad = n => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const local = (ms, tz) => new Date(ms + tz * 60000);                       // read with getUTC* = the person's wall clock
const hm = (ms, tz) => { const d = local(ms, tz); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
const dayLabel = (ms, tz) => { const d = local(ms, tz); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; };
const when = (ms, tz, now) => (Math.floor((ms + tz * 60000) / 864e5) === Math.floor((now + tz * 60000) / 864e5) ? '' : dayLabel(ms, tz) + ' ') + hm(ms, tz);
const dayStart = (ms, tz) => Math.floor((ms + tz * 60000) / 864e5) * 864e5 - tz * 60000;
const dur = min => { min = Math.max(0, Math.round(min)); return Math.floor(min / 60) + 'h ' + pad(min % 60) + 'm'; };
const PTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = d => PTS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const BF = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
const force = kn => { let i = 0; while (i < BF.length && kn >= BF[i]) i++; return i; };
const norm = t => String(t || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9:'.,/£\-+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const isQuestion = t => /^(how|what|whats|what's|when|where|who|why|which|am|are|is|did|do|does|have|has|can|could|will|should|show|tell|give|list|any)\b/.test(t) || t.endsWith('?');
const TYPE = w => (/^(work|working|worked|on watch|on duty|on deck)$/.test(w) ? 'work' : 'rest');
const TYPES = '(work(?:ing)?|rest(?:ing)?|on watch|off watch|on duty|off duty)';

// "14:00", "2pm", "2:30 pm", "at 1400" -> minutes after midnight, or null
function clock(s) {
  let m = s.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/) || s.match(/\b(\d{1,2})()\s*(am|pm)\b/) || s.match(/\bat\s+(\d{2})(\d{2})()\b/);
  if (!m) return null;
  let h = +m[1], mi = +(m[2] || 0); const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}
// minutes-after-midnight + "yesterday"/"today" words -> an instant in the past (a bare time later than now means yesterday)
function instant(mins, t, now, tz) {
  let day = dayStart(now, tz); if (/\byesterday\b/.test(t)) day -= 864e5;
  let ms = day + mins * 60000;
  if (ms > now + 60000 && !/\btoday\b/.test(t)) ms -= 864e5;
  return ms;
}
// "last 24 hours", "past 12h", "last 2 days", "today", "yesterday" -> { from, to }
function windowOf(t, now, tz) {
  let m = t.match(/\b(?:last|past|previous)\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|d|days?)\b/);
  if (m) { const n = +m[1] * (/^d/.test(m[2]) ? 24 : 1); return { from: now - n * 3600e3, to: now, label: 'the last ' + (/^d/.test(m[2]) ? m[1] + ' day' + (+m[1] === 1 ? '' : 's') : m[1] + ' h') }; }
  if (/\byesterday\b/.test(t)) { const s = dayStart(now, tz) - 864e5; return { from: s, to: s + 864e5, label: 'yesterday' }; }
  if (/\btoday\b|\bthis morning\b/.test(t)) return { from: dayStart(now, tz), to: now, label: 'today' };
  if (/\bweek\b/.test(t)) return { from: now - 7 * 864e5, to: now, label: 'the last 7 days' };
  return { from: now - 24 * 3600e3, to: now, label: 'the last 24 h' };
}
// "4 hours on 4 hours off", "4 on 4 off", "4/4" -> { on, off } in hours
function cycle(t) {
  const N = '(\\d+(?:\\.\\d+)?)\\s*(?:h|hr|hrs|hours?)?\\s*';
  let m = t.match(new RegExp(N + '(?:on|working|work)\\s*(?:,|and|then)?\\s*' + N + '(?:off|resting|rest)\\b')), on, off;
  if (m) { on = +m[1]; off = +m[2]; }
  else { m = t.match(new RegExp(N + '(?:off|resting|rest)\\s*(?:,|and|then)?\\s*' + N + '(?:on|working|work)\\b')); if (!m) return null; off = +m[1]; on = +m[2]; }
  return on > 0 && off > 0 && on <= 16 && off <= 16 ? { on, off } : null;
}
// the entries a pattern would create over [from, to]; blocks end exactly at `to` (the last one stays open if it was cut short)
function patternBlocks(on, off, from, to, firstType) {
  const out = []; let t = from, type = firstType;
  while (t < to - 59000) {
    const len = (type === 'work' ? on : off) * 3600e3, end = Math.min(t + len, to);
    out.push({ type, start: t, end: t + len > to ? null : end });
    t += len; type = type === 'work' ? 'rest' : 'work';
  }
  return out;
}
const iso = ms => new Date(Math.floor(ms / 60000) * 60000).toISOString();

// ---------------------------------------------------------------- skills
// match(c) is PURE (c.t = normalised text, c.raw, c.now, c.tz) and returns args or null. run(c, args) does the work.
// Order = priority. `apis` / `pages` feed the coverage gate.
const SKILLS = [];
const skill = s => SKILLS.push(s);

skill({ id: 'help', title: 'What I can do', help: 'Lists everything the assistant can do (always current).',
  examples: ['help', 'what can you do'], pages: [], apis: [],
  match: c => (/^(help|\?|what can you do|what can i ask|commands|what do you do)\b/.test(c.t) ? {} : null),
  run: async c => ({ ok: true, reply: 'I can:\n' + SKILLS.filter(s => s.id !== 'help').map(s => '• ' + s.title + ': ' + s.help + '  e.g. “' + s.examples[0] + '”').join('\n') }) });

skill({ id: 'pattern', title: 'Record a work pattern', help: 'Fills a window with a repeating pattern (4 on / 4 off, 6 on / 6 off …) after showing you the plan.',
  examples: ['record a work pattern of 4 hours on 4 hours off for the last 24 hours', 'log 6 on 6 off for the last 2 days starting with rest'],
  pages: ['/hours-of-rest.html'], apis: ['POST /api/crew/:id/entries', 'GET /api/crew/:id/voyages'],
  match: c => { const cy = cycle(c.t); if (!cy || !/\b(pattern|record|log|enter|fill|add|put|set|replace|overwrite)\b/.test(c.t)) return null;
    return { ...cy, win: windowOf(c.t, c.now, c.tz), first: /\bstart(?:ing)? (?:with )?(rest|off)/.test(c.t) ? 'rest' : 'work', replace: /\b(replace|overwrite|overwrite|clear)\b/.test(c.t) }; },
  run: async (c, a) => {
    const crew = await c.crew(); if (crew.reply) return crew.reply;
    const vs = await c.api('GET', `/api/crew/${crew.id}/voyages`); if (!vs.ok) return c.fail(vs);
    const from0 = a.win.from, to = Math.min(a.win.to, c.now);
    const vy = vs.data.find(v => Date.parse(v.start) <= to && (!v.end || Date.parse(v.end) >= from0));
    if (!vy) return { ok: false, reply: `${crew.name} has no voyage covering ${a.win.label}. Hours can only be recorded inside a voyage: start one first (Hours of rest › Add an earlier voyage).` };
    const from = Math.max(from0, Date.parse(vy.start)), clamped = from > from0;
    const blocks = patternBlocks(a.on, a.off, from, vy.end ? Math.min(to, Date.parse(vy.end)) : to, a.first);
    if (!blocks.length) return { ok: false, reply: 'That window is too short for the pattern.' };
    const es = await c.api('GET', `/api/crew/${crew.id}/entries`); if (!es.ok) return c.fail(es);
    const clash = es.data.filter(e => Date.parse(e.start) < (blocks[blocks.length - 1].end || to) && (!e.end || Date.parse(e.end) > blocks[0].start));
    const steps = blocks.map(b => `${b.type === 'work' ? 'WORK' : 'REST'} ${when(b.start, c.tz, c.now)} → ${b.end ? when(b.end, c.tz, c.now) : 'now (stays open)'}`);
    if (clash.length && !a.replace) return { ok: false, reply: `${crew.name} already has ${clash.length} entr${clash.length === 1 ? 'y' : 'ies'} in that window (${clash.slice(0, 3).map(e => `${e.type} ${when(Date.parse(e.start), c.tz, c.now)}`).join(', ')}${clash.length > 3 ? ' …' : ''}). Say “replace” to clear them first (they stay in the change history and can be restored), e.g. “replace with ${a.on} on ${a.off} off for ${a.win.label}”.` };
    const key = crypto.createHash('sha1').update(crew.id + a.on + a.off + from + blocks.length).digest('hex').slice(0, 10);
    const ops = [];
    for (const e of clash) ops.push({ method: 'DELETE', path: `/api/entries/${e.id}`, body: { reason: 'replaced by assistant pattern' }, label: 'remove', undo: () => ({ method: 'POST', path: `/api/entries/${e.id}/restore` }) });
    blocks.forEach((b, i) => ops.push({ method: 'POST', path: `/api/crew/${crew.id}/entries`, body: { type: b.type, start: iso(b.start), end: b.end ? iso(b.end) : null, opId: `as${key}${i}` }, label: 'add',
      undo: r => ({ method: 'DELETE', path: `/api/entries/${r.id}`, body: { reason: 'undo assistant' } }) }));
    return c.plan(`Record ${a.on} h on / ${a.off} h off for ${crew.name}, ${a.win.label}${clamped ? ` (starting at the voyage start, ${when(from, c.tz, c.now)})` : ''}:`, steps.concat(clash.length ? [`(first removing ${clash.length} existing entr${clash.length === 1 ? 'y' : 'ies'})`] : []), ops); } });

skill({ id: 'add-entry', title: 'Add hours for a time range', help: 'Adds a work or rest period you forgot to log.',
  examples: ['add rest from 14:00 to 18:00', 'enter work from 6am to 10am yesterday'],
  pages: [], apis: [],
  match: c => { const m = c.t.match(new RegExp('\\b(?:add|enter|log|record|put in)\\s+(?:a\\s+)?' + TYPES + '(?:\\s+period)?\\s+from\\s+(.+?)\\s+(?:to|until|till|-)\\s+(.+)$')); if (!m) return null;
    const a = clock(m[2]), b = clock(m[3]); if (a == null || b == null) return null; return { type: TYPE(m[1]), a, b }; },
  run: async (c, a) => {
    const crew = await c.crew(); if (crew.reply) return crew.reply;
    const s = instant(a.a, c.t, c.now, c.tz); let e = s + ((a.b - a.a + 1440) % 1440 || 1440) * 60000;
    if (e > c.now + 60000) return { ok: false, reply: 'That period would end in the future. Name an end time in the past.' };
    const key = crypto.createHash('sha1').update(crew.id + a.type + s + e).digest('hex').slice(0, 10);
    return c.plan(`Add ${a.type.toUpperCase()} for ${crew.name}:`, [`${when(s, c.tz, c.now)} → ${when(e, c.tz, c.now)} (${dur((e - s) / 60000)})`],
      [{ method: 'POST', path: `/api/crew/${crew.id}/entries`, body: { type: a.type, start: iso(s), end: iso(e), opId: 'ad' + key }, label: 'add', undo: r => ({ method: 'DELETE', path: `/api/entries/${r.id}`, body: { reason: 'undo assistant' } }) }]); } });

skill({ id: 'edit-last', title: 'Change or remove the last entry', help: 'Switch the last entry between work and rest, move its start or end, or delete it (always confirmed; deletions can be restored).',
  examples: ['change my last entry to rest', 'delete my last entry', 'set the last entry end to 16:00'],
  pages: [], apis: ['PUT /api/entries/:id', 'DELETE /api/entries/:id', 'POST /api/entries/:id/restore', 'GET /api/crew/:id/entries'],
  match: c => { if (!/\b(last|latest|previous|that)\s+(entry|period|one)\b/.test(c.t)) return null;
    if (/\b(delete|remove|scrap|get rid of)\b/.test(c.t)) return { op: 'delete' };
    let m = c.t.match(/\b(?:change|make|switch|set|turn)\b.*\bto\s+(work|working|rest|resting)\b/); if (m) return { op: 'type', type: TYPE(m[1]) };
    m = c.t.match(/\b(start|end)\b.*?\b(?:to|at)\s+(.+)$/); if (m && clock(m[2]) != null) return { op: m[1], mins: clock(m[2]) };
    m = c.t.match(/\bnote\b\s*:?\s*(.+)$/); if (m) return { op: 'note', note: m[1].slice(0, 200) };
    return null; },
  run: async (c, a) => {
    const crew = await c.crew(); if (crew.reply) return crew.reply;
    const es = await c.api('GET', `/api/crew/${crew.id}/entries`); if (!es.ok) return c.fail(es);
    const e = es.data[0]; if (!e) return { ok: false, reply: `${crew.name} has no entries to change.` };
    const s = Date.parse(e.start), en = e.end ? Date.parse(e.end) : null, desc = `${e.type.toUpperCase()} ${when(s, c.tz, c.now)} → ${en ? when(en, c.tz, c.now) : 'now'}`;
    const back = body => ({ method: 'PUT', path: `/api/entries/${e.id}`, body });
    if (a.op === 'delete') return c.plan(`Delete ${crew.name}'s last entry?`, [desc], [{ method: 'DELETE', path: `/api/entries/${e.id}`, body: { reason: 'deleted via assistant' }, label: 'delete', undo: () => ({ method: 'POST', path: `/api/entries/${e.id}/restore` }) }]);
    if (a.op === 'type') return c.plan(`Change ${crew.name}'s last entry to ${a.type.toUpperCase()}?`, [desc], [{ ...back({ type: a.type }), label: 'edit', undo: () => back({ type: e.type }) }]);
    if (a.op === 'note') return c.plan(`Add a note to ${crew.name}'s last entry?`, [desc, `note: ${a.note}`], [{ ...back({ note: a.note }), label: 'edit', undo: () => back({ note: e.note || '' }) }]);
    const t = instant(a.mins, c.t, c.now, c.tz), field = a.op;
    const moved = field === 'start' ? Math.min(t, s + (en ? en - s : 0)) : t;
    const after = field === 'start' ? iso(moved) : iso(t);
    return c.plan(`Move the ${field} of ${crew.name}'s last entry?`, [desc, `new ${field}: ${when(Date.parse(after), c.tz, c.now)}`], [{ ...back({ [field]: after }), label: 'edit', undo: () => back({ [field]: e[field] }) }]); } });

skill({ id: 'tap', title: 'Log work or rest now', help: 'Switches you to WORK or REST right now (with Undo).',
  examples: ['log me working', 'that me working', "i'm resting now"],
  pages: [], apis: ['POST /api/crew/:id/quicklog', 'POST /api/crew/:id/quicklog-undo'],
  match: c => { if (isQuestion(c.t) || /\b(from|until|till|pattern|last|hours? (?:on|off)|entry|entries)\b/.test(c.t) || /\d\s*(am|pm|:)/.test(c.t)) return null;
    let m = c.t.match(new RegExp('\\b(?:that|this)\\s+(?:me|us|him|her|them)\\s+' + TYPES + '\\b'))
      || c.t.match(new RegExp('\\b(?:log|put|mark|record|set|start|switch|tap|going|go|am|im|i\'m|we\'re|were|me|us)\\b.*?\\b' + TYPES + '\\b'))
      || c.t.match(new RegExp('^' + TYPES + '(?: now)?$'));
    return m ? { type: TYPE(m[1]) } : null; },
  run: async (c, a) => {
    const crew = await c.crew(); if (crew.reply) return crew.reply;
    const cur = await c.api('GET', `/api/crew/${crew.id}/entries`);
    const open = cur.ok && cur.data.find(e => !e.end);
    if (open && open.type === a.type) return { ok: true, reply: `${crew.name} is already ${a.type === 'work' ? 'working' : 'resting'} (since ${when(Date.parse(open.start), c.tz, c.now)}).` };
    const r = await c.api('POST', `/api/crew/${crew.id}/quicklog`, { type: a.type, tapId: 'as' + crypto.randomBytes(8).toString('hex') });
    if (!r.ok) return r.data && r.data.code === 'declaration_required' ? { ok: false, reply: 'A new voyage starts with the joining declaration. Tap WORK on the Hours of rest page once to make it.', actions: [{ kind: 'open', label: 'Open Hours of rest', url: '/hours-of-rest.html' }] } : c.fail(r);
    const d = r.data, undo = d.duplicate ? null : { method: 'POST', path: `/api/crew/${crew.id}/quicklog-undo`, body: { newId: d.id, prevId: d.closedId || undefined, voyageId: d.voyageId } };
    const same = false;
    return { ok: true, changed: !same, reply: same ? `${crew.name} is already ${a.type === 'work' ? 'working' : 'resting'} (since ${when(Date.parse(d.start), c.tz, c.now)}).` : `${crew.name}: ${a.type === 'work' ? 'WORKING' : 'RESTING'} from ${hm(Date.parse(d.start), c.tz)}.`, undo: same ? null : undo }; } });

skill({ id: 'rest-status', title: 'Rest and compliance', help: 'How much rest you have had, whether the limits are met, how long you can keep working.',
  examples: ['how much rest have i had', 'am i compliant', 'can i keep working'],
  pages: ['/hours-of-rest.html'], apis: ['GET /api/crew/:id/compliance', 'GET /api/dashboard/hor-summary', 'GET /api/crew/:id/hor-report'],
  match: c => (/\b(rest|compliant|compliance|hours of rest|breach|keep working|rest left|enough rest|legal)\b/.test(c.t) && (isQuestion(c.t) || /\b(status|summary|check)\b/.test(c.t)) ? {} : null),
  run: async c => {
    const crew = await c.crew(); if (crew.reply) return crew.reply;
    const r = await c.api('GET', `/api/crew/${crew.id}/compliance`); if (!r.ok) return c.fail(r);
    const d = r.data, th = d.thresholds || {}, tick = ok => (ok ? '✓' : '✗');
    const verdict = d.engine && d.engine.overall ? ` Engine verdict: ${d.engine.overall}.` : '';
    return { ok: true, reply: `${crew.name}: last 24 h rest ${dur(d.rest24Minutes)} (need ${dur(th.min10h)}) ${tick(d.ok24)}; 7 days ${dur(d.rest7Minutes)} (need ${dur(th.min77h)}) ${tick(d.ok7)}; longest work stretch ${dur(d.longestWorkMinutes)} (limit ${th.maxGapH} h) ${tick(d.okGap)}; rest periods in 24 h: ${d.restPeriodCount24} ${tick(d.okSplit)}.${verdict}${d.voyage ? ` Voyage day ${d.voyage.day}.` : ' No voyage open.'}`,
      actions: [{ kind: 'open', label: 'Open Hours of rest', url: '/hours-of-rest.html' }] }; } });

skill({ id: 'entries', title: 'Show recorded hours', help: 'Lists what is recorded for today, yesterday or the last N hours.',
  examples: ['show my entries for today', 'what have i logged in the last 24 hours'],
  pages: [], apis: [],
  match: c => (/\b(entries|logged|recorded|worked|my hours|what have i)\b/.test(c.t) && /\b(show|list|what|see|pull up|display|my)\b/.test(c.t) && !/\b(log|status)\b.*\b(pattern)\b/.test(c.t) ? { win: windowOf(c.t, c.now, c.tz) } : null),
  run: async (c, a) => {
    const crew = await c.crew(); if (crew.reply) return crew.reply;
    const es = await c.api('GET', `/api/crew/${crew.id}/entries`); if (!es.ok) return c.fail(es);
    const list = es.data.filter(e => Date.parse(e.start) < a.win.to && (!e.end || Date.parse(e.end) > a.win.from)).reverse();
    if (!list.length) return { ok: true, reply: `Nothing recorded for ${crew.name} in ${a.win.label}.` };
    let work = 0, rest = 0;
    const lines = list.map(e => { const s = Math.max(Date.parse(e.start), a.win.from), en = Math.min(e.end ? Date.parse(e.end) : c.now, a.win.to), m = (en - s) / 60000; if (e.type === 'work') work += m; else rest += m; return `${e.type === 'work' ? 'WORK' : 'REST'} ${when(Date.parse(e.start), c.tz, c.now)} → ${e.end ? hm(Date.parse(e.end), c.tz) : 'now'} (${dur(m)})${e.note ? ' · ' + e.note : ''}`; });
    return { ok: true, reply: `${crew.name}, ${a.win.label}: work ${dur(work)}, rest ${dur(rest)}.\n` + lines.slice(-12).join('\n') + (lines.length > 12 ? `\n… ${lines.length - 12} earlier` : '') }; } });

skill({ id: 'who', title: 'Who is working', help: 'Shows each crew member’s current status.',
  examples: ['who is working', 'who is on watch'],
  pages: [], apis: ['GET /api/crew'],
  match: c => (/\bwho\b.*\b(work|working|rest|resting|on watch|on duty|awake)\b/.test(c.t) ? {} : null),
  run: async c => {
    const cr = await c.api('GET', '/api/crew'); if (!cr.ok) return c.fail(cr);
    const out = [];
    for (const m of cr.data.slice(0, 20)) { const es = await c.api('GET', `/api/crew/${m.id}/entries`); const o = es.ok && es.data.find(e => !e.end);
      out.push(`${m.name}${m.role ? ' (' + m.role + ')' : ''}: ${o ? (o.type === 'work' ? 'WORKING' : 'RESTING') + ' since ' + when(Date.parse(o.start), c.tz, c.now) : 'no open period'}`); }
    return { ok: true, reply: out.join('\n') || 'No crew set up yet.' }; } });

skill({ id: 'voyage', title: 'Voyage and track', help: 'Voyage day, distance and fixes; ends the voyage (confirmed).',
  examples: ['how far have we gone', 'end the voyage'],
  pages: ['/track.html'], apis: ['GET /api/track/voyages', 'GET /api/track/status', 'GET /api/track/settings', 'GET /api/voyages/:id/track', 'POST /api/crew/:id/voyage/end'],
  match: c => { if (/\bend\b.*\bvoyage\b|\bvoyage\b.*\b(end|finish|over|complete)\b/.test(c.t) && !isQuestion(c.t)) return { end: true };
    return /\b(how far|distance|nautical miles|nm so far|voyage (?:so far|summary|day)|track so far|days? at sea)\b/.test(c.t) ? {} : null; },
  run: async (c, a) => {
    if (a.end) { const crew = await c.crew(); if (crew.reply) return crew.reply;
      return c.plan(`End ${crew.name}'s voyage now?`, ['The open WORK/REST period closes and the voyage ends. It can be reopened on the Hours of rest page.'], [{ method: 'POST', path: `/api/crew/${crew.id}/voyage/end`, body: {}, label: 'end', undo: null }]); }
    const r = await c.api('GET', '/api/track/voyages'); if (!r.ok) return c.fail(r);
    const v = (r.data.voyages || r.data)[0]; if (!v) return { ok: true, reply: 'No voyage recorded yet.' };
    const days = ((v.end ? Date.parse(v.end) : c.now) - Date.parse(v.start)) / 864e5;
    return { ok: true, reply: `${v.end ? 'Last voyage' : 'Current voyage'}: ${v.distanceNm != null ? v.distanceNm + ' nm' : 'distance unknown'} over ${days.toFixed(1)} days, ${v.fixes ?? 0} position fixes.`, actions: [{ kind: 'open', label: 'Open the voyage map', url: '/track.html' }] }; } });

skill({ id: 'position', title: 'Where am I / log position', help: 'Says your last position, or records a position now from the phone.',
  examples: ['where am i', 'log my position'],
  pages: [], apis: ['GET /api/positions/latest', 'POST /api/positions', 'PUT /api/positions/:id', 'DELETE /api/positions/:id', 'POST /api/positions/:id/restore', 'GET /api/place'],
  match: c => { if (/\blog\b.*\bposition\b|\brecord\b.*\bposition\b|\bposition\b.*\bnow\b/.test(c.t) && !isQuestion(c.t)) return { log: true };
    return /\bwhere (am i|are we)\b|\bmy position\b|\bour position\b|\blast (?:fix|position)\b/.test(c.t) ? {} : null; },
  run: async (c, a) => {
    const fmt = (la, lo) => { const f = (v, p, n) => { const x = Math.abs(v), d = Math.floor(x); return d + '°' + ((x - d) * 60).toFixed(1).padStart(4, '0') + '′' + (v >= 0 ? p : n); }; return f(la, 'N', 'S') + ' ' + f(lo, 'E', 'W'); };
    if (a.log) { if (c.lat == null) return { ok: false, reply: 'I need this phone’s position. Allow location in the app, or use “Log position now” on the Voyage map page.' };
      const r = await c.api('POST', '/api/positions', { lat: c.lat, lon: c.lon, ts: new Date(c.now).toISOString(), source: 'assistant', id: 'as' + crypto.randomBytes(6).toString('hex') }); if (!r.ok) return c.fail(r);
      return { ok: true, changed: true, reply: `Position logged: ${fmt(c.lat, c.lon)}.`, undo: { method: 'DELETE', path: `/api/positions/${r.data.id}` } }; }
    const p = await c.api('GET', '/api/positions/latest'); if (!p.ok) return c.fail(p);
    if (p.data.none) return c.lat != null ? { ok: true, reply: `No fix recorded yet. This phone reports ${fmt(c.lat, c.lon)}.` } : { ok: true, reply: 'No position recorded yet.' };
    const ago = Math.round((c.now - Date.parse(p.data.ts)) / 60000);
    return { ok: true, reply: `Last fix: ${fmt(p.data.lat, p.data.lon)}, ${ago < 90 ? ago + ' min' : Math.round(ago / 60) + ' h'} ago.` }; } });

skill({ id: 'weather', title: 'Weather here', help: 'Temperature, wind and gusts at your position.',
  examples: ["what's the weather for my location", 'how windy is it'],
  pages: [], apis: ['GET /api/weather'],
  match: c => (/\b(weather|temperature|how (?:windy|warm|cold)|is it (?:windy|raining|cold)|windy)\b/.test(c.t) && !/\b(forecast|tomorrow|tonight|next|later|will)\b/.test(c.t) ? {} : null),
  run: async c => { const p = await c.where(); if (p.reply) return p.reply;
    const r = await c.api('GET', `/api/weather?lat=${p.lat}&lon=${p.lon}`); if (!r.ok) return c.fail(r);
    const d = r.data, kn = Math.round(d.windSpeedKn);
    return { ok: true, reply: `${p.label}: ${Math.round(d.temperatureC)}°C, wind ${compass(d.windDirectionDeg)} ${kn} kn (Force ${force(d.windSpeedKn)}), gusts ${Math.round(d.windGustsKn)} kn. Model data (Open-Meteo), not an official forecast.` }; } });

skill({ id: 'wind', title: 'Wind forecast', help: 'The wind to expect over the next 24 hours at your position.',
  examples: ['wind forecast', 'will it get windier tonight'],
  pages: ['/wind.html'], apis: ['GET /api/wind'],
  match: c => (/\b(forecast|tomorrow|tonight|later|next (?:few )?hours|will it|get (?:windier|worse|rougher))\b/.test(c.t) && /\b(wind|windy|windier|blow|gale|gust|weather|rough|rougher)\b/.test(c.t) ? {} : (/\bwind\b/.test(c.t) && /\bforecast\b/.test(c.t) ? {} : null)),
  run: async c => { const p = await c.where(); if (p.reply) return p.reply;
    const r = await c.api('GET', `/api/wind?lat=${p.lat}&lon=${p.lon}&days=2`); if (!r.ok) return c.fail(r);
    const d = r.data, idx = d.t.map((t, i) => i).filter(i => d.t[i] >= c.now && d.t[i] <= c.now + 24 * 3600e3); if (!idx.length) return { ok: false, reply: 'The wind forecast has no hours ahead.' };
    const hi = idx.reduce((a, i) => (d.kn[i] > d.kn[a] ? i : a), idx[0]), gu = Math.max(...idx.map(i => d.gust[i] || 0)), now = idx[0];
    return { ok: true, reply: `Next 24 h at ${p.label} (${d.model.label}): now ${compass(d.dir[now])} ${Math.round(d.kn[now])} kn; strongest ${Math.round(d.kn[hi])} kn from ${compass(d.dir[hi])} around ${hm(d.t[hi], c.tz)}; gusts to ${Math.round(gu)} kn (Force ${force(gu)}).`, actions: [{ kind: 'open', label: 'Open Wind', url: '/wind.html' }] }; } });

skill({ id: 'tides', title: 'Tides', help: 'Height now and the next high and low water for the nearest port.',
  examples: ['when is high water', 'what is the tide doing'],
  pages: ['/tides.html'], apis: ['GET /api/tides', 'GET /api/tides/search', 'GET /api/tides/stations', 'GET /api/tides/predict', 'GET /api/tides/secondary', 'POST /api/tides/secondary', 'PUT /api/tides/secondary/:id', 'DELETE /api/tides/secondary/:id', 'POST /api/tides/analyse/:code', 'GET /api/tides/ukho', 'PUT /api/tides/ukho', 'DELETE /api/tides/ukho'],
  match: c => (/\b(tide|tides|tidal|high water|low water|hw|lw|springs|neaps)\b/.test(c.t) ? {} : null),
  run: async c => { const p = await c.where(true);
    const r = await c.api('GET', '/api/tides' + (p.lat != null ? `?lat=${p.lat}&lon=${p.lon}` : '')); if (!r.ok) return c.fail(r);
    const d = r.data; if (d.analysing) return { ok: true, reply: `Still working out the tides for ${d.port || 'this port'}; try again in a minute.` }; if (d.failed || !d.events) return { ok: false, reply: `Tides are not available: ${d.error || 'no data'}.` };
    const ev = d.events.slice(0, 2).map(e => `${e.type === 'high' ? 'HW' : 'LW'} ${hm(Date.parse(e.time), c.tz)} (${e.heightM.toFixed(1)} m)`).join(', ');
    return { ok: true, reply: `${d.port}: ${d.now ? d.now.h.toFixed(1) + ' m ' + (d.now.rising ? 'rising' : 'falling') + ' now; ' : ''}next ${ev}. Heights above ${d.datum}. ${d.model ? 'Modelled from sea level at your position (no gauge nearby): approximate, not for navigation near the coast.' : 'Astronomical tide only (no surge).'}`, actions: [{ kind: 'open', label: 'Open Tides', url: '/tides.html' }] }; } });

skill({ id: 'ice', title: 'Sea ice', help: 'How close the sea ice is (Greenland and the north): nearest ice edge, concentration here. Not for navigation.',
  examples: ['how close is the ice', 'sea ice near me'],
  pages: [], apis: ['GET /api/ice'],
  match: c => (/\b(sea ice|ice edge|ice floes?|floes?|pack ice|icebergs?|ice)\b/.test(c.t) ? {} : null),
  run: async c => { const p = await c.where(true);
    const r = await c.api('GET', '/api/ice' + (p.lat != null ? `?lat=${p.lat}&lon=${p.lon}` : '')); if (!r.ok) return c.fail(r);
    const d = r.data; if (d.relevant === false) return { ok: true, reply: d.reason || 'Sea ice is not a concern here.' };
    if (d.failed) return { ok: false, reply: 'The ice data is not available just now (' + (d.error || 'no answer') + '). The DMI and Canadian Ice Service charts are the authority.' };
    const e = d.near50 || d.near15, here = d.here != null ? `Ice concentration here ${d.here} %. ` : '';
    const near = e ? `Nearest ice (${e.conc} %) about ${e.distNm} nm, bearing ${String(e.bearing).padStart(3, '0')}°T.` : 'No ice of 15 % or more within about 160 nm.';
    return { ok: true, reply: `${here}${near} Data from ${d.date || 'the latest day'}. Icebergs, bergy bits and growlers are NOT shown; not for navigation.${d.stale ? ' (old copy: the service is not answering)' : ''}`, actions: [{ kind: 'open', label: 'Open dashboard', url: '/' }] }; } });

skill({ id: 'blackbox', title: 'Black box recorder', help: 'The black box recorder: what the server holds and how to download it.',
  examples: ['black box', 'open the black box recorder'],
  pages: ['/blackbox.html'], apis: ['POST /api/blackbox', 'GET /api/blackbox/status', 'GET /api/blackbox/download'],
  match: c => (/\b(black ?box|flight recorder)\b/.test(c.t) ? {} : null),
  run: async c => { const r = await c.api('GET', '/api/blackbox/status'); if (!r.ok) return c.fail(r);
    const d = r.data, l = d.last, when = l ? hm(l.t, c.tz) : null;
    return { ok: true, reply: d.totalRecords ? `The black box holds ${d.totalRecords} records over ${d.days.length} day${d.days.length === 1 ? '' : 's'}; the last one was at ${when} (${l.k}). Download it as JSON or CSV on the Black box page.` : 'The black box has nothing on the server yet. Phones upload automatically within a minute of the first position or event.', actions: [{ kind: 'open', label: 'Open Black box recorder', url: '/blackbox.html' }] }; } });

skill({ id: 'inshore', title: 'Inshore waters forecast', help: 'The Met Office inshore forecast for the nearest area.',
  examples: ['inshore forecast', 'what is the inshore waters forecast'],
  pages: ['/passage.html'], apis: ['GET /api/inshore'],
  match: c => (/\b(inshore|shipping forecast|sea state)\b/.test(c.t) ? {} : null),
  run: async c => { const p = await c.where(true);
    const r = await c.api('GET', '/api/inshore' + (p.lat != null ? `?lat=${p.lat}&lon=${p.lon}` : '')); if (!r.ok) return c.fail(r);
    const d = r.data, a = d.nearest && (d.areas || []).find(x => String(x.n) === String(d.nearest.n)); if (!a) return { ok: true, reply: 'No inshore area within 60 nm of your position. Open Passage pack to pick one.', actions: [{ kind: 'open', label: 'Open Passage pack', url: '/passage.html' }] };
    const b = (a.blocks || [])[0], txt = b ? (b.items.length ? b.items.map(i => i[0] + ': ' + i[1]).join('; ') : b.text) : '';
    return { ok: true, reply: `${a.name} (${d.nearest.distanceNm} nm): ${b ? b.title + ' – ' : ''}${txt}${d.stale ? ' (Met Office unreachable: showing the last copy)' : ''} © Crown copyright, Met Office.` }; } });

skill({ id: 'atlantic', title: 'Atlantic weather', help: 'Opens the Atlantic chart: conditions where you are and where you will be.',
  examples: ['atlantic weather', 'what will it be like along my route'],
  pages: ['/atlantic.html'], apis: ['GET /api/atlantic/wx', 'GET /api/atlantic/status', 'POST /api/atlantic/refresh'],
  match: c => (/\b(atlantic|arc|crossing|along my route|my route|ahead on)\b/.test(c.t) ? {} : null),
  run: async () => ({ ok: true, reply: 'The Atlantic page shows the weather where you are now and where you will be every 12 hours.', actions: [{ kind: 'open', label: 'Open Atlantic weather', url: '/atlantic.html' }] }) });

skill({ id: 'log', title: 'Ship’s log', help: 'Adds a line to the ship’s log, or shows the latest lines.',
  examples: ['log: engine checks done', 'show the log'],
  pages: [], apis: ['GET /api/log', 'POST /api/log', 'GET /api/log/export.txt'],
  match: c => { let m = c.raw.match(/^\s*(?:add to the log|log note|note to log|make a log entry|log entry|log)\s*[:\-]\s*(.+)$/i); if (m) return { add: m[1].trim().slice(0, 500) };
    return /\b(show|read|see|what.s in) (?:me )?(?:the |my )?(?:ship.?s )?log\b|\blog book\b/.test(c.t) ? {} : null; },
  run: async (c, a) => {
    if (a.add) { const r = await c.api('POST', '/api/log', { text: a.add }); if (!r.ok) return c.fail(r); return { ok: true, changed: true, reply: `Logged: “${a.add}”. (The log only ever grows; corrections are new lines.)` }; }
    const r = await c.api('GET', '/api/log?limit=6'); if (!r.ok) return c.fail(r);
    return { ok: true, reply: r.data.entries.length ? `${r.data.total} log entries. Latest:\n` + r.data.entries.map(e => `${when(Date.parse(e.ts), c.tz, c.now)}  ${e.text}`).join('\n') : 'The log is empty.' }; } });

skill({ id: 'status', title: 'App status', help: 'Is everything working? Shows the status summary.',
  examples: ['is everything working', 'show the app status'],
  pages: ['/status.html'], apis: ['GET /api/status'],
  match: c => (/\b(is everything|everything (?:ok|working)|app status|system status|health check|any errors|server status|status page)\b/.test(c.t) || /^status$/.test(c.t) ? {} : null),
  run: async c => { const r = await c.api('GET', '/api/status'); if (!r.ok) return c.fail(r);
    return { ok: true, reply: r.data.text, actions: [{ kind: 'open', label: 'Open Status', url: '/status.html' }] }; } });

skill({ id: 'open', title: 'Open a page', help: 'Takes you to any page: Hours of rest, Voyage map, Tides, Wind, Passage pack, Atlantic, Status.',
  examples: ['open hours of rest', 'go to the voyage map'],
  pages: ['/index.html', '/hours-of-rest.html', '/track.html', '/tides.html', '/wind.html', '/passage.html', '/atlantic.html', '/status.html'], apis: [],
  match: c => { if (!/\b(open|go to|take me to|goto)\b/.test(c.t)) return null;
    const P = [['hours of rest|hor|rest page|my hours', '/hours-of-rest.html', 'Hours of rest'], ['map|track|voyage map', '/track.html', 'Voyage map'], ['tide', '/tides.html', 'Tides'], ['wind', '/wind.html', 'Wind'], ['passage|print', '/passage.html', 'Passage pack'], ['atlantic', '/atlantic.html', 'Atlantic weather'], ['status', '/status.html', 'Status'], ['dashboard|home', '/', 'Dashboard']];
    const p = P.find(x => new RegExp('\\b(' + x[0] + ')').test(c.t)); return p ? { url: p[1], name: p[2] } : null; },
  run: async (c, a) => ({ ok: true, reply: `Opening ${a.name}.`, actions: [{ kind: 'open', label: 'Open ' + a.name, url: a.url, auto: true }] }) });

skill({ id: 'undo', title: 'Undo', help: 'Reverses the last thing I did.',
  examples: ['undo', 'undo that'],
  pages: [], apis: [],
  match: c => (/^(undo|undo that|undo last|take that back|revert)$/.test(c.t) ? {} : null),
  run: async () => ({ ok: true, undo: true, reply: '' }) });   // handled by the engine (replays the last undo)

// priority: exact/specific first. (Registration order above is by topic; matching order is here.)
const ORDER = ['help', 'undo', 'blackbox', 'open', 'pattern', 'add-entry', 'edit-last', 'log', 'tap', 'rest-status', 'entries', 'who', 'voyage', 'position', 'atlantic', 'wind', 'ice', 'weather', 'tides', 'inshore', 'status'];
SKILLS.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

// pages and routes the assistant deliberately does not cover, each with the reason (the coverage gate reads these)
const EXEMPT_PAGES = { '/login.html': 'sign-in screen', '/connect.html': 'one-time phone pairing screen', '/geo.html': 'unused page, not bundled in the apps (CLAUDE.md)', '/log.html': 'unused page, not bundled in the apps (CLAUDE.md)' };
const EXEMPT_APIS = {
  'POST /api/auth/login': 'sign-in', 'POST /api/auth/logout': 'sign-in', 'GET /api/auth/status': 'sign-in', 'GET /api/auth/me': 'sign-in', 'POST /api/auth/password': 'security: never by text',
  'POST /api/auth/pair': 'pairing a phone', 'POST /api/devices/pair-code': 'pairing a phone', 'GET /api/devices': 'phone management is deliberate, on the Customise sheet', 'DELETE /api/devices/:id': 'security: never by text',
  'GET /api/time': 'plumbing', 'GET /api/build': 'plumbing: the build label on the dashboard', 'GET /api/me': 'plumbing', 'GET /api/vessel': 'settings screen', 'PUT /api/vessel': 'settings screen',
  'POST /api/crew': 'crew management is deliberate, on Hours of rest', 'PUT /api/crew/:id': 'crew management', 'DELETE /api/crew/:id': 'crew management',
  'DELETE /api/voyages/:id': 'voyage edits are deliberate, on Hours of rest', 'POST /api/voyages/:id/restore': 'voyage edits', 'PUT /api/voyages/:id': 'voyage edits', 'PUT /api/voyages/:id/declaration': 'a declaration is the seafarer’s own statement: never by text',
  'POST /api/crew/:id/voyages': 'creating a voyage needs the joining declaration', 'POST /api/crew/:id/voyage/reopen': 'voyage edits',
  'GET /api/settings/pre-voyage': 'settings screen', 'PUT /api/settings/pre-voyage': 'settings screen',
  'GET /api/entries-audit': 'change history is read on its own page', 'GET /api/export.json': 'export from the Hours of rest page', 'GET /api/export.csv': 'export from the Hours of rest page',
  'GET /api/dashboard/settings': 'plumbing', 'PUT /api/dashboard/settings': 'settings screen', 'PUT /api/track/settings': 'settings screen',
  'GET /api/voyages/:id/track.gpx': 'file export', 'GET /api/voyages/:id/track.csv': 'file export',
  'POST /api/agent': 'this assistant itself',
};
// every route in the server files is matched against these by the gate; a route listed in a skill's `apis` is covered
const covered = () => new Set(SKILLS.flatMap(s => s.apis || []));
const coveredPages = () => new Set(SKILLS.flatMap(s => s.pages || []));

// ---------------------------------------------------------------- engine
function route(text, opts) {
  const o = Object.assign({ now: Date.now(), tz: 0 }, opts || {}), c = { raw: String(text || '').trim().slice(0, 400), now: o.now, tz: o.tz };
  c.t = norm(c.raw);
  if (!c.t) return null;
  for (const s of SKILLS) { const a = s.match(c); if (a) return { skill: s, args: a, c }; }
  return null;
}

function mount(app, { port, curDevice }) {
  const portOf = typeof port === 'function' ? port : () => port;
  const pending = new Map();   // token -> { owner, title, ops, at }
  const lastUndo = new Map();  // owner -> { op, at }
  const ownerOf = req => crypto.createHash('sha1').update(String(req.get('authorization') || req.get('cookie') || req.ip)).digest('hex').slice(0, 16);

  function makeCtx(req, base) {
    const hdr = { 'Content-Type': 'application/json', 'X-Source': 'assistant' };
    if (req.get('authorization')) hdr.Authorization = req.get('authorization'); else if (req.get('cookie')) hdr.Cookie = req.get('cookie');
    const prefix = req.get('authorization') ? '/api/v1' : '/api';
    const api = async (method, path, body) => {
      try {
        const r = await fetch(`http://127.0.0.1:${portOf()}${prefix}${path.replace(/^\/api/, '')}`, { method, headers: hdr, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
        const data = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, data };
      } catch (e) { return { ok: false, status: 0, data: { error: 'could not reach the app: ' + (e.message || e) } }; }
    };
    const ctx = Object.assign({}, base, { api });
    ctx.fail = r => ({ ok: false, reply: r.status === 403 ? 'That is not allowed for this sign-in.' : `That did not work: ${(r.data && (r.data.error || r.data.detail)) || 'error ' + r.status}.` });
    let crewMemo = null;
    ctx.crew = async () => {   // who the request is about: a name in the text, else the dashboard's crew member, else the only one
      if (crewMemo) return crewMemo;
      const cr = await api('GET', '/api/crew'); if (!cr.ok) return (crewMemo = { reply: ctx.fail(cr) });
      const list = cr.data; if (!list.length) return (crewMemo = { reply: { ok: false, reply: 'No crew members are set up yet (Hours of rest › Customise).' } });
      const named = list.filter(m => m.name && ctx.t.includes(norm(m.name).split(' ').slice(-1)[0]) || (m.name && ctx.t.includes(norm(m.name).split(' ')[0]) && norm(m.name).split(' ')[0].length > 2));
      let pick = named.length === 1 ? named[0] : null;
      if (!pick && list.length === 1) pick = list[0];
      if (!pick && base.crewId) pick = list.find(m => m.id === base.crewId) || null;
      if (!pick) { const ds = await api('GET', '/api/dashboard/settings'); pick = ds.ok && list.find(m => m.id === ds.data.primaryCrewId) || null; }
      if (!pick) return (crewMemo = { reply: { ok: false, reply: 'Which crew member? Include a name, e.g. “… for ' + list[0].name.split(' ').slice(-1)[0] + '”.' } });
      return (crewMemo = pick);
    };
    ctx.where = async (optional) => {   // the phone's position, else the last recorded fix
      if (base.lat != null) return { lat: +base.lat.toFixed(3), lon: +base.lon.toFixed(3), label: 'Here' };
      const p = await api('GET', '/api/positions/latest');
      if (p.ok && p.data && !p.data.none) return { lat: +(+p.data.lat).toFixed(3), lon: +(+p.data.lon).toFixed(3), label: 'At your last fix' };
      return optional ? {} : { reply: { ok: false, reply: 'I do not know where you are yet: allow location on this phone, or log a position first.' } };
    };
    ctx.plan = (title, steps, ops) => {
      for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60000) pending.delete(k);
      const mine = [...pending.values()].filter(v => v.owner === base.owner); if (mine.length > 20) return { ok: false, reply: 'Too many unconfirmed plans: confirm or cancel one first.' };
      const token = crypto.randomBytes(12).toString('hex'); pending.set(token, { owner: base.owner, title, ops, at: Date.now() });
      return { ok: true, plan: { title, steps }, reply: title + '\n' + steps.map(s => '• ' + s).join('\n'), actions: [{ kind: 'confirm', label: 'Do it', token }, { kind: 'cancel', label: 'Cancel', token }] };
    };
    return ctx;
  }

  async function execute(req, p, base) {
    const ctx = makeCtx(req, base), done = [], undos = [];
    for (const op of p.ops) {
      const r = await ctx.api(op.method, op.path, op.body);
      if (!r.ok) { const why = ctx.fail(r).reply; return { ok: false, reply: `${done.length ? 'Stopped after ' + done.length + ' of ' + p.ops.length + ' steps. ' : ''}${why}${done.length ? ' What was done stays; say “undo” to reverse it.' : ''}`, changed: !!done.length, undo: undos.length ? undos : null }; }
      done.push(op); if (op.undo) { const u = op.undo(r.data || {}); if (u) undos.unshift(u); }
    }
    return { ok: true, changed: true, reply: `Done: ${done.length} change${done.length === 1 ? '' : 's'} made. Everything stays in the change history.`, undo: undos.length ? undos : null };
  }

  async function confirmNow(req, base, token) {
    const p = pending.get(token);
    if (!p || p.owner !== base.owner || Date.now() - p.at > 10 * 60000) return { ok: false, reply: 'That plan has expired. Ask again.' };
    pending.delete(token); return execute(req, p, base);
  }
  async function undoNow(req, base) {
    const u = lastUndo.get(base.owner); if (!u) return { ok: false, reply: 'Nothing to undo.' };
    lastUndo.delete(base.owner);
    const r = await execute(req, { ops: u.ops }, base);
    return r.ok ? { ok: true, changed: true, reply: 'Undone.' } : r;
  }
  app.post('/api/agent', async (req, res) => {
    const b = req.body || {}, owner = ownerOf(req), now = Date.now();
    const tz = Number.isFinite(+b.tz) && Math.abs(+b.tz) <= 14 * 60 ? Math.round(+b.tz) : 0;
    const ctxIn = b.context && typeof b.context === 'object' ? b.context : {};
    const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null);
    const base = { owner, now, tz, lat: num(ctxIn.lat, 90), lon: num(ctxIn.lon, 180), crewId: typeof ctxIn.crewId === 'string' ? ctxIn.crewId.slice(0, 64) : null, raw: '', t: '' };
    if (base.lat == null || base.lon == null) { base.lat = null; base.lon = null; }
    let out;
    try {
      if (b.cancel) { pending.delete(String(b.cancel)); out = { ok: true, reply: 'Cancelled. Nothing was changed.' }; }
      else if (b.confirm || b.undo) {
        out = await (b.undo ? undoNow(req, base) : confirmNow(req, base, String(b.confirm)));
      } else {
        const text = String(b.text || '').trim().slice(0, 400);
        if (!text) return res.status(400).json({ error: 'text required' });
        const hit = route(text, { now, tz });
        if (!hit) out = { ok: false, skill: null, reply: 'I did not understand that. Try: “log me working”, “what’s the weather here”, “record 4 hours on 4 hours off for the last 24 hours”, or say “help”.' };
        else if (hit.skill.id === 'undo') out = await undoNow(req, base);
        else { Object.assign(base, { raw: hit.c.raw, t: hit.c.t }); out = await hit.skill.run(makeCtx(req, base), hit.args); out.skill = hit.skill.id; }
      }
    } catch (e) { console.error('assistant:', e && e.stack || e); out = { ok: false, reply: 'Something went wrong in the assistant. It has been logged.' }; }
    if (out.undo) { const ops = Array.isArray(out.undo) ? out.undo : [out.undo]; lastUndo.set(owner, { ops, op: ops[0], at: now }); out.actions = (out.actions || []).concat([{ kind: 'undo', label: 'Undo' }]); }
    delete out.undo; out.changed = !!out.changed;
    res.set('Cache-Control', 'no-store').json(out);
  });
  return { SKILLS };
}
module.exports = mount;
Object.assign(module.exports, { SKILLS, EXEMPT_PAGES, EXEMPT_APIS, covered, coveredPages, route, patternBlocks, cycle, clock, windowOf, instant, norm });
