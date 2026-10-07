// Crow's Nest — Hours of Rest
// Minimal self-hosted backend: Express + SQLite (file-based, no external DB).

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const horEngine = require('./engine/hor-engine.js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'crowsnest.db'));
let reqDevice = null;   // the paired device making the current request (handlers are synchronous; set and cleared around them)

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS crew (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    crew_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('rest','work')),
    start TEXT NOT NULL,
    end TEXT,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY(crew_id) REFERENCES crew(id)
  );
`);

// ---- migrations (idempotent): soft delete + audit trail for hours-of-rest entries ----
for (const sql of [
  'ALTER TABLE entries ADD COLUMN deleted_at TEXT',
  'ALTER TABLE entries ADD COLUMN deleted_reason TEXT',
  'ALTER TABLE crew ADD COLUMN deleted_at TEXT',
  'ALTER TABLE entries ADD COLUMN voyage_id TEXT',
  'ALTER TABLE crew ADD COLUMN role TEXT',
  'ALTER TABLE entries ADD COLUMN tap_id TEXT'
]) {
  try { db.exec(sql); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_entries_tap ON entries(crew_id, tap_id)');
db.exec(`
  CREATE TABLE IF NOT EXISTS entry_audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    crew_id TEXT,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    source TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_entry_audit_entry ON entry_audit(entry_id);
  CREATE TABLE IF NOT EXISTS voyages (
    id TEXT PRIMARY KEY,
    crew_id TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY(crew_id) REFERENCES crew(id)
  );
`);
for (const sql of ['ALTER TABLE voyages ADD COLUMN declaration TEXT', 'ALTER TABLE voyages ADD COLUMN end_op_id TEXT']) {   // after the table exists
  try { db.exec(sql); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
}
const entryView = r => r ? { id: r.id, crew_id: r.crew_id, type: r.type, start: r.start, end: r.end, note: r.note } : null;
function auditRaw(action, id, crewId, before, after, source) {
  if (reqDevice) source = (source || 'api') + '@' + reqDevice.name;   // which paired phone did it
  db.prepare('INSERT INTO entry_audit (at, entry_id, crew_id, action, before_json, after_json, source) VALUES (?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), id, crewId || null, action,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, source || null);
}
function audit(action, entryId, crewId, before, after, source) {
  auditRaw(action, entryId, crewId, entryView(before), entryView(after), source);
}
const parseDecl = v => { if (!v || !v.declaration) return null; try { return JSON.parse(v.declaration); } catch (e) { return null; } };
const voyageView = v => v ? { id: v.id, crew_id: v.crew_id, start: v.start, end: v.end, note: v.note, declaration: parseDecl(v) } : null;
function auditV(action, v, before, after, source) {
  auditRaw(action, 'voyage:' + v.id, v.crew_id, voyageView(before), voyageView(after), source);
}
// ---- voyages: records (and the compliance rules) exist only while a voyage is open ----
const activeVoyage = crewId => db.prepare(`SELECT * FROM voyages WHERE crew_id = ? AND end IS NULL AND ${ACTIVE} ORDER BY start DESC LIMIT 1`).get(crewId);
const lastEndedVoyage = crewId => db.prepare(`SELECT * FROM voyages WHERE crew_id = ? AND end IS NOT NULL AND ${ACTIVE} ORDER BY end DESC LIMIT 1`).get(crewId);
function voyageAt(crewId, iso) {
  const t = Date.parse(iso);
  return db.prepare(`SELECT * FROM voyages WHERE crew_id = ? AND ${ACTIVE} ORDER BY start ASC`).all(crewId)
    .find(v => Date.parse(v.start) <= t && (!v.end || t < Date.parse(v.end))) || null;
}
// Joining declaration, taken once - at the first WORK tap of a voyage (wording: see the dashboard; version-stamped).
// Terms follow the Merchant Shipping (MLC) (Hours of Work) Regulations 2018 and MSN 1877: hours of work / hours of rest,
// 'properly rested when they begin duty' (MSN 1877 para 3.2), records endorsed and copied (reg 12), call-outs and
// emergency work with compensatory rest (regs 5 and 11).
const DECL_VERSION = 'joining-v1';
function normDeclaration(d) {
  if (!d || typeof d !== 'object') return null;
  if (!['yes', 'no'].includes(d.rested)) return { error: "rested must be 'yes' or 'no'" };
  if (d.ackRecords !== true || d.ackEmergency !== true) return { error: 'both acknowledgements must be confirmed' };
  if (typeof d.under18 !== 'boolean') return { error: 'under18 must be answered' };
  if (!['seafarer', 'master'].includes(d.declaredBy)) return { error: "declaredBy must be 'seafarer' or 'master'" };
  return {
    version: DECL_VERSION, at: new Date().toISOString(),
    rested: d.rested, note: String(d.note || '').slice(0, 400),
    ackRecords: true, ackEmergency: true, under18: d.under18, declaredBy: d.declaredBy
  };
}
function startVoyage(crewId, startIso, source, declaration) {
  const v = { id: uid(), crew_id: crewId, start: startIso, end: null, note: '', created_at: new Date().toISOString(), declaration: declaration ? JSON.stringify(declaration) : null };
  db.prepare('INSERT INTO voyages (id, crew_id, start, end, note, created_at, declaration) VALUES (@id,@crew_id,@start,@end,@note,@created_at,@declaration)').run(v);
  auditV('voyage-start', v, null, v, source);
  return v;
}
function voyagesOverlap(crewId, start, end, excludeId) {   // end null = open
  const s = Date.parse(start), e = end ? Date.parse(end) : Infinity;
  return db.prepare(`SELECT * FROM voyages WHERE crew_id = ? AND ${ACTIVE} AND id != ?`).all(crewId, excludeId || '')
    .find(o => Date.parse(o.start) < e && (o.end ? Date.parse(o.end) : Infinity) > s) || null;
}
const dayOfVoyage = v => Math.floor((Date.now() - Date.parse(v.start)) / 86400000) + 1;
const ACTIVE = 'deleted_at IS NULL';

// Times must carry a time zone; stored as UTC ISO strings. Returns null for empty.
function normTime(v) {
  if (v === null || v === undefined || v === '') return null;
  const str = String(v);
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(str)) throw new Error('time must include a time zone (e.g. 2026-10-06T11:33:00Z)');
  const t = Date.parse(str);
  if (isNaN(t)) throw new Error('invalid time');
  return new Date(t).toISOString();
}
const FUTURE_TOL_MS = 5 * 60 * 1000;
// Returns an error object {status, error, conflict?} or null. excludeId = the entry being edited.
function checkEntry(crewId, e, excludeId, vy) {
  const now = Date.now();
  const s = Date.parse(e.start), en = e.end ? Date.parse(e.end) : null;
  if (s > now + FUTURE_TOL_MS) return { status: 400, error: 'start is in the future' };
  if (en !== null && en > now + FUTURE_TOL_MS) return { status: 400, error: 'end is in the future' };
  if (en !== null && en <= s) return { status: 400, error: 'end must be after start' };
  if (vy) {
    if (s < Date.parse(vy.start)) return { status: 409, error: 'starts before the voyage began', voyage: voyageView(vy) };
    if (vy.end && (en === null || en > Date.parse(vy.end))) return { status: 409, error: 'extends past the end of the voyage', voyage: voyageView(vy) };
  }
  const others = db.prepare(`SELECT * FROM entries WHERE crew_id = ? AND ${ACTIVE} AND id != ?`).all(crewId, excludeId || '');
  if (en === null && others.some(o => !o.end)) return { status: 409, error: 'another period is still open - close it first', conflict: entryView(others.find(o => !o.end)) };
  const hit = others.find(o => {
    const os = Date.parse(o.start), oe = o.end ? Date.parse(o.end) : Infinity;
    return os < (en === null ? Infinity : en) && oe > s;
  });
  if (hit) return { status: 409, error: 'overlaps an existing period', conflict: entryView(hit) };
  return null;
}

const MIN_10H = 600, MIN_77H = 4620, MAX_GAP_H = 14, MIN_LONG_REST_H = 6;

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function overlapMinutes(startIso, endIso, winStart, winEnd) {
  const s = Math.max(new Date(startIso), winStart);
  const e = Math.min(new Date(endIso), winEnd);
  return e > s ? (e - s) / 60000 : 0;
}

function computeCompliance(crewId) {
  const now = new Date();
  const rows = db.prepare(`SELECT * FROM entries WHERE crew_id = ? AND ${ACTIVE} ORDER BY start ASC`).all(crewId);
  const entries = rows.map(e => ({ ...e, end: e.end || now.toISOString() }));

  const win24Start = new Date(now - 24 * 3600 * 1000);
  const win7Start = new Date(now - 7 * 24 * 3600 * 1000);
  const lookStart = new Date(now - 48 * 3600 * 1000);

  let rest24 = 0, rest7 = 0;
  entries.forEach(e => {
    if (e.type === 'rest') {
      rest24 += overlapMinutes(e.start, e.end, win24Start, now);
      rest7 += overlapMinutes(e.start, e.end, win7Start, now);
    }
  });

  let longestWork = 0, curWork = 0;
  entries.forEach(e => {
    const dur = overlapMinutes(e.start, e.end, lookStart, now);
    if (dur <= 0) return;
    if (e.type === 'work') { curWork += dur; longestWork = Math.max(longestWork, curWork); }
    else { curWork = 0; }
  });

  const restPeriodsIn24 = entries
    .filter(e => e.type === 'rest' && overlapMinutes(e.start, e.end, win24Start, now) > 0)
    .map(e => overlapMinutes(e.start, e.end, win24Start, now));
  const restPeriodCount = restPeriodsIn24.length;
  const hasLongEnoughRest = restPeriodsIn24.some(m => m >= MIN_LONG_REST_H * 60);

  return {
    rest24Minutes: rest24,
    rest7Minutes: rest7,
    longestWorkMinutes: longestWork,
    restPeriodCount24: restPeriodCount,
    ok24: rest24 >= MIN_10H,
    ok7: rest7 >= MIN_77H,
    okGap: longestWork <= MAX_GAP_H * 60,
    okSplit: restPeriodCount <= 2 ? (restPeriodCount === 0 || hasLongEnoughRest) : false,
    thresholds: { min10h: MIN_10H, min77h: MIN_77H, maxGapH: MAX_GAP_H, minLongRestH: MIN_LONG_REST_H }
  };
}

// Evaluate one voyage (the open one by default). For an ended voyage the report is as at its end.
function engineReport(crewId, extra, voyage) {
  const voy = voyage || activeVoyage(crewId);
  if (!voy) return null;
  const rows = db.prepare(`SELECT id, type, start, end FROM entries WHERE voyage_id = ? AND ${ACTIVE} ORDER BY start ASC`).all(voy.id);
  const opts = Object.assign({
    asOf: voy.end || new Date().toISOString(),
    recordStart: voy.start,
    // PRE_DUTY: time before the voyage counts as available rest - unless the seafarer declared they were not properly rested at joining
    rules: { preRecordRest: getSetting('preVoyagePolicy', 'rest') === 'rest' && !(parseDecl(voy) && parseDecl(voy).rested === 'no') }
  }, extra || {});
  return horEngine.evaluate(rows, opts);
}
function voyageSummary(v) {
  const days = Math.max(1, Math.ceil((Date.parse(v.end) - Date.parse(v.start)) / 86400000) + 1);
  const r = engineReport(v.crew_id, { history: true, historyDays: days }, v);
  const eps = r.history ? [...r.history.rest24, ...r.history.rest7d, ...r.history.interval] : [];
  return {
    id: v.id, start: v.start, end: v.end,
    overall: r.overall,
    breaches: eps.filter(x => x.verdict === 'breach').length,
    notConfirmed: eps.filter(x => x.verdict === 'indeterminate').length,
    entryProblems: r.dataQuality.errors
  };
}
// One-off, idempotent: records from before voyages existed become a voyage per crew member.
db.transaction(() => {
  const crews = db.prepare(`SELECT DISTINCT crew_id FROM entries WHERE voyage_id IS NULL AND ${ACTIVE}`).all();
  for (const { crew_id } of crews) {
    const rows = db.prepare(`SELECT * FROM entries WHERE crew_id = ? AND voyage_id IS NULL AND ${ACTIVE} ORDER BY start ASC`).all(crew_id);
    const hasOpen = rows.some(r => !r.end);
    const lastEnd = Math.max(...rows.map(r => Date.parse(r.end || r.start)));
    const keepOpen = hasOpen || (Date.now() - lastEnd) < 24 * 3600 * 1000;
    const v = startVoyage(crew_id, rows[0].start, 'migration');
    if (!keepOpen) {
      const ended = { ...v, end: new Date(lastEnd).toISOString() };
      db.prepare('UPDATE voyages SET end = ? WHERE id = ?').run(ended.end, v.id);
      auditV('voyage-end', v, v, ended, 'migration');
    }
    db.prepare(`UPDATE entries SET voyage_id = ? WHERE crew_id = ? AND voyage_id IS NULL AND ${ACTIVE}`).run(v.id, crew_id);
  }
})();

const app = express();
app.use(express.json());

// ---- web sign-in (auth.js): ONE gate in front of every page and API route ----
// Open without signing in: the login page and its images/styles, the health check, POST /api/auth/login,
// GET /api/auth/status, and /api/v1/* (the phone app; checked by its own device-token gate below).
// Everything else needs a session cookie. Caddy no longer asks for a password (removed 7 Oct 2026): this gate is the lock.
const auth = require('./auth.js');
auth.init(db);
const PUBLIC_GET = [/^\/login\.html$/, /^\/wave\.css$/, /^\/assets\/[\w.-]+$/, /^\/favicon\.ico$/, /^\/apple-touch-icon[\w-]*\.png$/, /^\/manifest\.json$/, /^\/healthz$/];
app.use((req, res, next) => {
  const p = req.path;
  if (/^\/api\/v1(\/|$)/i.test(p)) return next();
  if ((req.method === 'POST' && p === '/api/auth/login') || (req.method === 'GET' && p === '/api/auth/status')) return next();
  if ((req.method === 'GET' || req.method === 'HEAD') && PUBLIC_GET.some(r => r.test(p))) return next();
  const s = auth.readSession(db, auth.cookieOf(req));
  if (!s) {
    if (/^\/api\//i.test(p)) return res.status(401).json({ code: 'login_required', error: 'sign in first' });
    if (req.method === 'GET') return res.redirect(302, '/login.html?next=' + encodeURIComponent(req.originalUrl));
    return res.status(401).send('sign in first');
  }
  // a change must come from this site (SameSite=Lax already stops most cross-site requests; this closes the rest)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const o = req.get('Origin');
    if (o && o.replace(/^https?:\/\//i, '') !== req.get('host')) return res.status(403).json({ code: 'cross_site', error: 'request from another site refused' });
  }
  if (s.user.role === 'crew' && /^\/api\//i.test(p) && !/^\/api\/auth\//.test(p) && !crewAllowed({ crew_id: s.user.crew_id }, req.method, p))
    return res.status(403).json({ code: 'forbidden', error: 'this account is for one crew member only' });
  req.user = s.user; req.sid = auth.cookieOf(req);
  reqDevice = { id: null, name: s.user.username, role: s.user.role, crew_id: s.user.crew_id, web: true };   // audit + crew limits
  try { next(); } finally { reqDevice = null; }
});
app.use(express.static(path.join(__dirname, 'public')));

const signFails = new Map();   // key -> timestamps of failed sign-ins in the last 15 minutes (per username and per address)
function tooMany(keys) {
  const now = Date.now();
  return keys.some(([k, limit]) => { const a = (signFails.get(k) || []).filter(t => t > now - 15 * 60000); signFails.set(k, a); return a.length >= limit; });
}
const clientIp = req => String(req.get('CF-Connecting-IP') || String(req.get('X-Forwarded-For') || '').split(',')[0] || req.ip || '').trim();
app.post('/api/auth/login', (req, res) => {
  const b = req.body || {}, username = String(b.username || '').trim(), password = String(b.password || '');
  const keys = [['u:' + username.toLowerCase(), 10], ['ip:' + clientIp(req), 30]];
  if (tooMany(keys)) return res.status(429).json({ code: 'too_many_attempts', error: 'too many wrong passwords - wait 15 minutes' });
  const u = username ? db.prepare('SELECT * FROM users WHERE username = ? AND disabled_at IS NULL').get(username) : null;
  const ok = auth.verifyPassword(password, u ? u.pass_hash : auth.DUMMY) && !!u;
  if (!ok) {
    keys.forEach(([k]) => signFails.set(k, (signFails.get(k) || []).concat(Date.now())));
    return res.status(401).json({ code: 'bad_login', error: 'wrong username or password' });
  }
  keys.forEach(([k]) => signFails.delete(k));
  const s = auth.createSession(db, u.id, b.remember !== false, req.get('User-Agent'));
  auth.setCookie(req, res, s.sid, s.maxAge);
  auditRaw('sign-in', 'user:' + u.id, u.crew_id, null, { username: u.username }, 'web ' + clientIp(req));
  res.json({ ok: true, user: auth.userView(u) });
});
app.post('/api/auth/logout', (req, res) => {
  auth.endSession(db, auth.cookieOf(req)); auth.clearCookie(req, res);
  res.json({ ok: true });
});
// for the login page: are there any accounts yet? (says nothing else)
app.get('/api/auth/status', (req, res) => res.json({ accounts: db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NULL').get().n > 0 }));
app.get('/api/auth/me', (req, res) => res.json({ user: auth.userView(req.user) }));
app.post('/api/auth/password', (req, res) => {
  const b = req.body || {}, u = req.user;
  if (!auth.verifyPassword(String(b.current || ''), u.pass_hash)) return res.status(400).json({ code: 'bad_current', error: 'the current password is wrong' });
  const bad = auth.passwordProblem(b.next); if (bad) return res.status(400).json({ code: 'weak', error: bad });
  db.transaction(() => {
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(b.next), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(u.id, auth.sha256(req.sid));   // sign out everywhere else
    auditRaw('user-password', 'user:' + u.id, u.crew_id, null, { username: u.username }, 'web');
  })();
  res.json({ ok: true });
});

// ---- phones (the iOS app): device tokens, pairing, /api/v1 ----
// The web app sits behind Caddy basic auth and has no login of its own. The app talks to /api/v1/*, which Caddy lets
// through without basic auth; every /api/v1 request must carry a device token (Authorization: Bearer ...), except pairing.
// A device is paired with a one-time code made on the web app (Customise > Phones). Role 'master' = everything;
// role 'crew' = that crew member's own hours only. /api/v1/x is the same handler as /api/x.
const crypto = require('crypto');
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('master','crew')),
    crew_id TEXT, created_at TEXT NOT NULL, last_seen TEXT, revoked_at TEXT
  );
  CREATE TABLE IF NOT EXISTS pair_codes (
    code_hash TEXT PRIMARY KEY, role TEXT NOT NULL, crew_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
  );
`);
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', PAIR_TTL_MS = 10 * 60000;
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const deviceView = d => d ? { id: d.id, name: d.name, role: d.role, crewId: d.crew_id, createdAt: d.created_at, lastSeen: d.last_seen, revokedAt: d.revoked_at } : null;
const APP_ORIGINS = ['capacitor://localhost', 'ionic://localhost', 'http://localhost', 'https://localhost']
  .concat(String(process.env.APP_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
const pairFails = [];   // timestamps of failed pairing attempts (all devices): brute-force brake
const PAIR_FAIL_LIMIT = 20;

// What a crew-role device may do: read shared things, and read/write its own crew member's hours.
function crewAllowed(dev, method, p) {
  const own = dev.crew_id, m = p.match(/^\/api\/crew\/([^/]+)(\/.*)?$/);
  if (m) {
    if (m[1] !== own) return false;
    if (method === 'GET') return true;
    return /^\/(quicklog|quicklog-undo|entries|voyages|voyage\/end|voyage\/reopen)$/.test(m[2] || '');
  }
  const e = p.match(/^\/api\/entries\/([^/]+)(\/restore)?$/);
  if (e) { const r = db.prepare('SELECT crew_id FROM entries WHERE id = ?').get(e[1]); return !!r && r.crew_id === own; }
  const v = p.match(/^\/api\/voyages\/([^/]+)(\/(declaration|restore|track|track\.gpx|track\.csv))?$/);
  if (v) {
    if (method === 'GET' && /^\/track/.test(v[2] || '')) return true;   // the track is vessel-level
    const r = db.prepare('SELECT crew_id FROM voyages WHERE id = ?').get(v[1]); return !!r && r.crew_id === own;
  }
  if (method === 'POST' && p === '/api/positions') return true;
  if (method !== 'GET') return false;
  return ['/api/vessel', '/api/crew', '/api/me', '/api/time', '/api/dashboard/settings', '/api/dashboard/hor-summary', '/api/settings/pre-voyage',
    '/api/positions/latest', '/api/weather', '/api/wind', '/api/inshore', '/api/tides', '/api/settings/tide-provider'].includes(p) || /^\/api\/track\//.test(p);
}

app.use((req, res, next) => {
  if (!/^\/api\/v1(\/|$)/i.test(req.path)) return next();   // case-insensitive, like Express routing
  const origin = req.get('Origin');
  if (origin && APP_ORIGINS.includes(origin)) {
    res.set({ 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Expose-Headers': 'Date',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Source', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  req.url = req.url.replace(/^\/api\/v1/i, '/api');
  if (req.path === '/api/auth/pair' || req.path === '/api/time') return next();
  const m = String(req.get('Authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{20,100})$/);
  const dev = m && db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(m[1]));
  if (!dev) return res.status(401).json({ code: 'unauthorised', error: 'this phone is not paired (or was removed) - pair it again' });
  if (dev.role === 'crew' && !crewAllowed(dev, req.method, req.path)) return res.status(403).json({ code: 'forbidden', error: 'this phone is paired for ' + 'one crew member only' });
  const nowIso = new Date().toISOString();
  if (!dev.last_seen || Date.now() - Date.parse(dev.last_seen) > 60000) db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(nowIso, dev.id);
  reqDevice = dev;
  try { next(); } finally { reqDevice = null; }
});

// Server clock (the app corrects tap times with it)
app.get('/api/time', (req, res) => res.json({ now: new Date().toISOString() }));
// Who is this? (the app shows it; null on the web)
app.get('/api/me', (req, res) => res.json({ device: deviceView(reqDevice) }));
// Make a one-time pairing code (web app, master only)
app.post('/api/devices/pair-code', (req, res) => {
  if (reqDevice && reqDevice.role !== 'master') return res.status(403).json({ error: 'only the master can pair phones' });
  const role = (req.body || {}).role === 'crew' ? 'crew' : 'master';
  const crewId = role === 'crew' ? String((req.body || {}).crewId || '') : null;
  if (role === 'crew' && !db.prepare(`SELECT 1 FROM crew WHERE id = ? AND ${ACTIVE}`).get(crewId)) return res.status(400).json({ error: 'choose the crew member this phone is for' });
  let code = ''; const b = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) code += PAIR_ALPHABET[b[i] % PAIR_ALPHABET.length];
  const now = Date.now();
  db.prepare('DELETE FROM pair_codes WHERE expires_at < ?').run(new Date(now - 86400000).toISOString());
  db.prepare('INSERT INTO pair_codes (code_hash, role, crew_id, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(sha256(code), role, crewId, new Date(now).toISOString(), new Date(now + PAIR_TTL_MS).toISOString());
  res.json({ code: code.slice(0, 4) + '-' + code.slice(4), role, crewId, expiresAt: new Date(now + PAIR_TTL_MS).toISOString() });
});
// Exchange a pairing code for a device token (the app; no login needed - the code is the proof)
app.post('/api/auth/pair', (req, res) => {
  const now = Date.now();
  while (pairFails.length && pairFails[0] < now - 3600000) pairFails.shift();
  if (pairFails.length >= PAIR_FAIL_LIMIT) return res.status(429).json({ code: 'too_many_attempts', error: 'too many wrong codes - wait an hour, or make a new code' });
  const code = normCode((req.body || {}).code);
  const name = String((req.body || {}).name || '').trim().slice(0, 60) || 'Phone';
  const pc = code.length === 8 && db.prepare('SELECT * FROM pair_codes WHERE code_hash = ?').get(sha256(code));
  if (!pc || pc.used_at || Date.parse(pc.expires_at) < now) { pairFails.push(now); return res.status(400).json({ code: 'bad_code', error: 'that code is wrong, used or expired - make a new one' }); }
  const token = crypto.randomBytes(32).toString('base64url');
  const dev = { id: uid(), name, token_hash: sha256(token), role: pc.role, crew_id: pc.crew_id, created_at: new Date(now).toISOString() };
  db.transaction(() => {
    db.prepare('UPDATE pair_codes SET used_at = ? WHERE code_hash = ?').run(dev.created_at, pc.code_hash);
    db.prepare('INSERT INTO devices (id, name, token_hash, role, crew_id, created_at) VALUES (@id,@name,@token_hash,@role,@crew_id,@created_at)').run(dev);
    auditRaw('device-pair', 'device:' + dev.id, dev.crew_id, null, deviceView(dev), 'pairing');
  })();
  res.json({ token, device: deviceView(dev) });
});
app.get('/api/devices', (req, res) => {
  if (reqDevice && reqDevice.role !== 'master') return res.status(403).json({ error: 'master only' });
  res.json(db.prepare('SELECT * FROM devices ORDER BY created_at DESC').all().map(deviceView));
});
app.delete('/api/devices/:id', (req, res) => {
  if (reqDevice && reqDevice.role !== 'master') return res.status(403).json({ error: 'master only' });
  const d = db.prepare('SELECT * FROM devices WHERE id = ? AND revoked_at IS NULL').get(req.params.id);
  if (!d) return res.json({ ok: true });
  db.transaction(() => {
    db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), d.id);
    auditRaw('device-remove', 'device:' + d.id, d.crew_id, deviceView(d), null, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true });
});

// ---- settings (vessel name) ----
// Vessel details (they head the printed record: MSN 1877 Annex B asks for vessel name, flag and official number)
const VESSEL_KEYS = { vessel: 'vessel', officialNumber: 'vesselOfficialNo', flag: 'vesselFlag' };
const vesselView = () => ({ vessel: getSetting('vessel', ''), officialNumber: getSetting('vesselOfficialNo', ''), flag: getSetting('vesselFlag', '') });
app.get('/api/vessel', (req, res) => res.json(vesselView()));
app.put('/api/vessel', (req, res) => {
  const before = vesselView(), body = req.body || {};
  db.transaction(() => {
    for (const [k, key] of Object.entries(VESSEL_KEYS)) if (body[k] !== undefined) setSetting(key, String(body[k]).trim().slice(0, 80));
    auditRaw('vessel-edit', 'vessel', null, before, vesselView(), req.get('X-Source') || 'api');
  })();
  res.json({ ok: true, ...vesselView() });
});

// ---- crew ----
app.get('/api/crew', (req, res) => {
  const all = db.prepare('SELECT * FROM crew WHERE deleted_at IS NULL ORDER BY created_at ASC').all();
  res.json(reqDevice && reqDevice.role === 'crew' ? all.filter(c => c.id === reqDevice.crew_id) : all);
});
app.post('/api/crew', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'name required' });
  const row = { id: uid(), name, role: String(req.body.role || '').trim().slice(0, 40), created_at: new Date().toISOString() };
  db.prepare('INSERT INTO crew (id, name, role, created_at) VALUES (@id, @name, @role, @created_at)').run(row);
  if (!getSetting('primaryCrewId', '')) setSetting('primaryCrewId', row.id); // first crew becomes the dashboard default
  res.json(row);
});
// Rename a crew member / change their rank (audited)
app.put('/api/crew/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM crew WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const name = b.name === undefined ? c.name : String(b.name).trim().slice(0, 60);
  const role = b.role === undefined ? (c.role || '') : String(b.role).trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'name required' });
  db.transaction(() => {
    db.prepare('UPDATE crew SET name = ?, role = ? WHERE id = ?').run(name, role, c.id);
    auditRaw('crew-edit', 'crew:' + c.id, c.id, { name: c.name, role: c.role || '' }, { name, role }, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true, id: c.id, name, role });
});
app.delete('/api/crew/:id', (req, res) => {
  // nothing is erased: the crew member is marked deleted and their entries soft-deleted (audited)
  db.transaction(() => {
    const now = new Date().toISOString();
    for (const e of db.prepare(`SELECT * FROM entries WHERE crew_id = ? AND ${ACTIVE}`).all(req.params.id)) {
      db.prepare('UPDATE entries SET deleted_at = ?, deleted_reason = ? WHERE id = ?').run(now, 'crew member deleted', e.id);
      audit('delete', e.id, e.crew_id, e, null, 'crew-delete');
    }
    db.prepare('UPDATE crew SET deleted_at = ? WHERE id = ?').run(now, req.params.id);   // row kept: entries reference it
    if (getSetting('primaryCrewId', '') === req.params.id) setSetting('primaryCrewId', '');
  })();
  res.json({ ok: true });
});

// ---- entries ----
app.get('/api/crew/:id/entries', (req, res) => {
  res.json(db.prepare(`SELECT * FROM entries WHERE crew_id = ? AND ${ACTIVE} ORDER BY start DESC`).all(req.params.id));
});
app.post('/api/crew/:id/entries', (req, res) => {
  const { type, note } = req.body;
  // opId: an entry added offline and sent later is applied once (stored in tap_id, the client operation id)
  const opId = req.body.opId === undefined ? null : String(req.body.opId);
  if (opId !== null && !OP_ID.test(opId)) return res.status(400).json({ error: 'opId must be 1-64 letters, digits, _ or -' });
  if (opId) { const seen = db.prepare('SELECT * FROM entries WHERE crew_id = ? AND tap_id = ?').get(req.params.id, opId); if (seen) return res.json({ ...seen, duplicate: true }); }
  if (!['rest', 'work'].includes(type) || !req.body.start) {
    return res.status(400).json({ error: 'type (rest|work) and start are required' });
  }
  let start, end;
  try { start = normTime(req.body.start); end = normTime(req.body.end); } catch (e) { return res.status(400).json({ error: e.message }); }
  const vy = voyageAt(req.params.id, start);
  if (!vy) return res.status(409).json({ status: 409, error: 'this time is not inside a voyage. Start one with the first WORK tap, or add an earlier voyage first (POST /api/crew/:id/voyages).' });
  const bad = checkEntry(req.params.id, { start, end }, null, vy);
  if (bad) return res.status(bad.status).json(bad);
  const row = {
    id: uid(), crew_id: req.params.id, voyage_id: vy.id, type, start,
    end, note: note || '', created_at: new Date().toISOString(), tap_id: opId
  };
  db.transaction(() => {
    db.prepare(`INSERT INTO entries (id, crew_id, voyage_id, type, start, end, note, created_at, tap_id)
      VALUES (@id, @crew_id, @voyage_id, @type, @start, @end, @note, @created_at, @tap_id)`).run(row);
    audit('create', row.id, row.crew_id, null, row, opId ? 'manual-queued' : 'manual');
  })();
  res.json(row);
});
// quick-log: close any open entry for this crew member, open a new one of `type` at now.
// Offline queue (public/tapq.js): `tapId` makes a replay idempotent; `at` (ISO with zone) is the time the tap was made on the
// device, sent only when a queued tap is replayed late. A late tap must fall after the open period began and inside a voyage.
const MAX_TAP_AGE_MS = 30 * 86400000, CLOCK_TOL_MS = 2000;
const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
// A time sent by the phone for something done earlier offline: zone required, not in the future, not more than 30 days old.
function lateTime(v) {
  const at = normTime(v);   // throws on a bad time
  if (at && Date.parse(at) > Date.now() + FUTURE_TOL_MS) throw new Error('time is in the future');
  if (at && Date.parse(at) < Date.now() - MAX_TAP_AGE_MS) throw new Error('time is more than 30 days old');
  return at;
}
app.post('/api/crew/:id/quicklog', (req, res) => {
  const { type } = req.body;
  if (!['rest', 'work'].includes(type)) return res.status(400).json({ error: 'type required' });
  const tapId = req.body.tapId === undefined ? null : String(req.body.tapId);
  if (tapId !== null && !OP_ID.test(tapId)) return res.status(400).json({ error: 'tapId must be 1-64 letters, digits, _ or -' });
  if (tapId) {   // already applied (the reply was lost) - or applied and since undone: never apply it twice
    const seen = db.prepare('SELECT * FROM entries WHERE crew_id = ? AND tap_id = ?').get(req.params.id, tapId);
    if (seen) return res.json({ ...seen, voyageId: seen.voyage_id, duplicate: true });
  }
  let at = null;
  try { at = lateTime(req.body.at); } catch (e) { return res.status(400).json({ error: 'tap ' + e.message }); }
  const open = db.prepare(`SELECT * FROM entries WHERE crew_id = ? AND end IS NULL AND ${ACTIVE}`).get(req.params.id);
  if (open && open.type === type) return res.json({ ...open, voyageId: open.voyage_id }); // already in this state
  // the phone's clock is only corrected to about a second: a tap up to 2 s "before" the open period is the next tap, placed just after it
  if (at && open && Date.parse(at) <= Date.parse(open.start) && Date.parse(open.start) - Date.parse(at) < CLOCK_TOL_MS) at = new Date(Date.parse(open.start) + 1000).toISOString();
  if (at && open && Date.parse(at) <= Date.parse(open.start))
    return res.status(409).json({ code: 'tap_out_of_order', error: 'a later period was logged before this tap reached the server', conflict: entryView(open) });
  let vy = activeVoyage(req.params.id);
  let decl = null;
  if (!vy) {   // a voyage starts with the first WORK tap, which carries the joining declaration
    if (type !== 'work') return res.status(409).json({ code: 'voyage_not_started', error: 'a voyage starts with the first WORK tap' });
    decl = normDeclaration(req.body.declaration);
    if (!decl) return res.status(400).json({ code: 'declaration_required', error: 'joining declaration required to start a voyage', declarationVersion: DECL_VERSION });
    if (decl.error) return res.status(400).json({ code: 'declaration_invalid', error: decl.error });
  }
  // never close an entry at or before its own start (clock skew): nudge forward one second
  const nowMs = at ? Date.parse(at) : open ? Math.max(Date.now(), Date.parse(open.start) + 1000) : Date.now();
  const now = new Date(nowMs).toISOString();
  if (at) {   // a late tap must not overlap what was logged since, nor start before the voyage (or overlap an earlier one)
    const bad = vy ? checkEntry(req.params.id, { start: now, end: null }, open ? open.id : null, vy) : null;
    if (bad) return res.status(bad.status).json({ code: 'tap_conflict', ...bad });
    const hit = !vy && voyagesOverlap(req.params.id, now, null);
    if (hit) return res.status(409).json({ code: 'tap_conflict', error: 'overlaps another voyage', conflict: voyageView(hit) });
  }
  const source = at ? 'quicklog-queued' : 'quicklog';
  let startedVoyage = false;
  const row = { id: uid(), crew_id: req.params.id, voyage_id: null, type, start: now, end: null, note: '', created_at: new Date().toISOString(), tap_id: tapId };
  db.transaction(() => {
    if (!vy) { vy = startVoyage(req.params.id, now, source, decl); startedVoyage = true; }   // the first tap starts the voyage
    row.voyage_id = vy.id;
    if (open) {
      db.prepare('UPDATE entries SET end = ? WHERE id = ?').run(now, open.id);
      audit('close', open.id, open.crew_id, open, { ...open, end: now }, source);
    }
    db.prepare(`INSERT INTO entries (id, crew_id, voyage_id, type, start, end, note, created_at, tap_id)
      VALUES (@id, @crew_id, @voyage_id, @type, @start, @end, @note, @created_at, @tap_id)`).run(row);
    audit('create', row.id, row.crew_id, null, row, source);
  })();
  res.json({ ...row, voyageId: vy.id, startedVoyage, closedId: open ? open.id : null });
});
// ---- voyages ----
app.get('/api/crew/:id/voyages', (req, res) => {
  res.json(db.prepare(`SELECT * FROM voyages WHERE crew_id = ? AND ${ACTIVE} ORDER BY start DESC`).all(req.params.id)
    .map(v => ({ ...v, declaration: parseDecl(v), entryCount: db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE voyage_id = ? AND ${ACTIVE}`).get(v.id).n })));
});
// Backfill a voyage (e.g. one that was not logged live). Voyages never overlap.
app.post('/api/crew/:id/voyages', (req, res) => {
  let start, end;
  try { start = normTime(req.body && req.body.start); end = normTime(req.body && req.body.end); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!start) return res.status(400).json({ error: 'start is required' });
  if (Date.parse(start) > Date.now() + FUTURE_TOL_MS) return res.status(400).json({ error: 'start is in the future' });
  if (end && (Date.parse(end) <= Date.parse(start) || Date.parse(end) > Date.now() + FUTURE_TOL_MS)) return res.status(400).json({ error: 'end must be after start and not in the future' });
  const hit = voyagesOverlap(req.params.id, start, end);
  if (hit) return res.status(409).json({ error: 'overlaps another voyage', conflict: voyageView(hit) });
  let bdecl = null;
  if (req.body.declaration) { bdecl = normDeclaration(req.body.declaration); if (!bdecl || bdecl.error) return res.status(400).json({ code: 'declaration_invalid', error: (bdecl && bdecl.error) || 'declaration invalid' }); }
  const v = db.transaction(() => {
    const nv = startVoyage(req.params.id, start, req.get('X-Source') || 'api', bdecl);
    if (end) { db.prepare('UPDATE voyages SET end = ? WHERE id = ?').run(end, nv.id); auditV('voyage-end', nv, nv, { ...nv, end }, 'api'); }
    return { ...nv, end: end || null };
  })();
  res.json(v);
});
// Delete a voyage that holds no entries (audited; nothing is erased)
app.delete('/api/voyages/:id', (req, res) => {
  const v = db.prepare(`SELECT * FROM voyages WHERE id = ? AND ${ACTIVE}`).get(req.params.id);
  if (!v) return res.json({ ok: true });
  const n = db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE voyage_id = ? AND ${ACTIVE}`).get(v.id).n;
  if (n > 0) return res.status(409).json({ error: 'this voyage still holds ' + n + ' entr' + (n === 1 ? 'y' : 'ies') + ' - delete or move them first', entries: n });
  db.transaction(() => {
    db.prepare('UPDATE voyages SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), v.id);
    auditV('voyage-delete', v, v, null, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true });
});
app.post('/api/voyages/:id/restore', (req, res) => {
  const v = db.prepare('SELECT * FROM voyages WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'nothing to restore' });
  const hit = voyagesOverlap(v.crew_id, v.start, v.end, v.id);
  if (hit) return res.status(409).json({ error: 'overlaps another voyage', conflict: voyageView(hit) });
  db.transaction(() => {
    db.prepare('UPDATE voyages SET deleted_at = NULL WHERE id = ?').run(v.id);
    auditV('voyage-restore', v, null, v, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true });
});
// Take or replace the joining declaration of a voyage (audited; the earlier one stays in the audit trail).
app.put('/api/voyages/:id/declaration', (req, res) => {
  const v = db.prepare(`SELECT * FROM voyages WHERE id = ? AND ${ACTIVE}`).get(req.params.id);
  if (!v) return res.status(404).json({ error: 'not found' });
  const d = normDeclaration(req.body);
  if (!d) return res.status(400).json({ code: 'declaration_required', error: 'declaration required' });
  if (d.error) return res.status(400).json({ code: 'declaration_invalid', error: d.error });
  db.transaction(() => {
    db.prepare('UPDATE voyages SET declaration = ? WHERE id = ?').run(JSON.stringify(d), v.id);
    auditV('voyage-declaration', v, v, { ...v, declaration: JSON.stringify(d) }, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true, declaration: d });
});
// Adjust a voyage's start/end (audited). It can never cut off entries it contains or overlap another voyage.
app.put('/api/voyages/:id', (req, res) => {
  const v = db.prepare(`SELECT * FROM voyages WHERE id = ? AND ${ACTIVE}`).get(req.params.id);
  if (!v) return res.status(404).json({ error: 'not found' });
  let start, end;
  try {
    start = req.body.start === undefined ? v.start : normTime(req.body.start);
    end = req.body.end === undefined ? v.end : normTime(req.body.end);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  if (end && Date.parse(end) <= Date.parse(start)) return res.status(400).json({ error: 'end must be after start' });
  if (Date.parse(start) > Date.now() + FUTURE_TOL_MS || (end && Date.parse(end) > Date.now() + FUTURE_TOL_MS)) return res.status(400).json({ error: 'time is in the future' });
  const ents = db.prepare(`SELECT * FROM entries WHERE voyage_id = ? AND ${ACTIVE}`).all(v.id);
  if (ents.some(e => Date.parse(e.start) < Date.parse(start))) return res.status(409).json({ error: 'an entry starts before that voyage start' });
  if (end && ents.some(e => !e.end || Date.parse(e.end) > Date.parse(end))) return res.status(409).json({ error: 'an entry runs past that voyage end' });
  const hit = voyagesOverlap(v.crew_id, start, end, v.id);
  if (hit) return res.status(409).json({ error: 'overlaps another voyage', conflict: voyageView(hit) });
  const note = req.body.note === undefined ? v.note : String(req.body.note);
  db.transaction(() => {
    db.prepare('UPDATE voyages SET start = ?, end = ?, note = ? WHERE id = ?').run(start, end, note, v.id);
    auditV('voyage-edit', v, v, { ...v, start, end, note }, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true });
});
// End the voyage: close any open period at the same instant, then the voyage itself.
// Offline (the app): opId applies it once; at = when End voyage was pressed, if sent later. A late end must come after
// everything logged in the voyage, else it is refused (409) and the phone shows it as not applied.
app.post('/api/crew/:id/voyage/end', (req, res) => {
  const b = req.body || {};
  const opId = b.opId === undefined ? null : String(b.opId);
  if (opId !== null && !OP_ID.test(opId)) return res.status(400).json({ error: 'opId must be 1-64 letters, digits, _ or -' });
  if (opId) {
    const seen = db.prepare(`SELECT * FROM voyages WHERE crew_id = ? AND end_op_id = ?`).get(req.params.id, opId);
    if (seen) return res.json({ ok: true, voyageId: seen.id, end: seen.end, closedEntryId: null, duplicate: true });
  }
  let at = null;
  try { at = lateTime(b.at); } catch (e) { return res.status(400).json({ error: e.message }); }
  const vy = activeVoyage(req.params.id);
  if (!vy) return res.status(409).json({ code: 'no_open_voyage', error: 'no voyage is open' });
  const open = db.prepare(`SELECT * FROM entries WHERE voyage_id = ? AND end IS NULL AND ${ACTIVE}`).get(vy.id);
  const lastEnd = db.prepare(`SELECT MAX(end) AS m FROM entries WHERE voyage_id = ? AND ${ACTIVE}`).get(vy.id).m;
  const floor = Math.max(Date.parse(vy.start), open ? Date.parse(open.start) : 0, lastEnd ? Date.parse(lastEnd) : 0) + 1000;
  if (at && Date.parse(at) < floor) return res.status(409).json({ code: 'end_out_of_order', error: 'something was logged in this voyage after the End voyage tap' });
  const now = new Date(at ? Date.parse(at) : Math.max(Date.now(), floor)).toISOString();
  const src = at ? '-queued' : '';
  db.transaction(() => {
    if (open) {
      db.prepare('UPDATE entries SET end = ? WHERE id = ?').run(now, open.id);
      audit('close', open.id, open.crew_id, open, { ...open, end: now }, 'voyage-end' + src);
    }
    db.prepare('UPDATE voyages SET end = ?, end_op_id = ? WHERE id = ?').run(now, opId, vy.id);
    auditV('voyage-end', vy, vy, { ...vy, end: now }, 'end-voyage' + src);
  })();
  res.json({ ok: true, voyageId: vy.id, end: now, closedEntryId: open ? open.id : null });
});
// Undo ending a voyage (only the most recent one, and only while no newer voyage has been started).
app.post('/api/crew/:id/voyage/reopen', (req, res) => {
  const { voyageId, entryId } = req.body || {};
  const vy = db.prepare(`SELECT * FROM voyages WHERE id = ? AND crew_id = ? AND end IS NOT NULL AND ${ACTIVE}`).get(String(voyageId || ''), req.params.id);
  if (!vy) return res.status(404).json({ error: 'no ended voyage to reopen' });
  if (activeVoyage(req.params.id)) return res.status(409).json({ error: 'a newer voyage is already open' });
  let ent = null;
  if (entryId) {
    ent = db.prepare(`SELECT * FROM entries WHERE id = ? AND voyage_id = ? AND ${ACTIVE}`).get(String(entryId), vy.id);
    if (!ent || ent.end !== vy.end) return res.status(409).json({ error: 'the last period was changed since' });
  }
  db.transaction(() => {
    db.prepare('UPDATE voyages SET end = NULL WHERE id = ?').run(vy.id);
    auditV('voyage-reopen', vy, vy, { ...vy, end: null }, 'undo');
    if (ent) { db.prepare('UPDATE entries SET end = NULL WHERE id = ?').run(ent.id); audit('reopen', ent.id, ent.crew_id, ent, { ...ent, end: null }, 'undo'); }
  })();
  res.json({ ok: true });
});
// How time before a voyage's start is treated by the 10h / 77h rules: 'rest' = PRE_DUTY (default; assumed rest, reported separately) or 'unknown'
app.get('/api/settings/pre-voyage', (req, res) => res.json({ policy: getSetting('preVoyagePolicy', 'rest') }));
app.put('/api/settings/pre-voyage', (req, res) => {
  const policy = String((req.body || {}).policy || '');
  if (!['unknown', 'rest'].includes(policy)) return res.status(400).json({ error: "policy must be 'unknown' or 'rest'" });
  setSetting('preVoyagePolicy', policy);
  res.json({ ok: true, policy });
});

// Atomic undo of a quick-log: the entry it created is soft-deleted and, if it had closed an earlier
// period, that period is re-opened - all in one transaction, both steps audited.
app.post('/api/crew/:id/quicklog-undo', (req, res) => {
  const { newId, prevId, voyageId } = req.body || {};
  const created = db.prepare(`SELECT * FROM entries WHERE id = ? AND crew_id = ? AND ${ACTIVE}`).get(String(newId || ''), req.params.id);
  if (!created) return res.status(404).json({ error: 'nothing to undo' });
  if (created.end) return res.status(409).json({ error: 'that period has already ended' });
  let prev = null;
  if (prevId) {
    prev = db.prepare(`SELECT * FROM entries WHERE id = ? AND crew_id = ? AND ${ACTIVE}`).get(String(prevId), req.params.id);
    if (!prev || prev.end !== created.start) return res.status(409).json({ error: 'the earlier period was changed since' });
  }
  db.transaction(() => {
    db.prepare('UPDATE entries SET deleted_at = ?, deleted_reason = ? WHERE id = ?').run(new Date().toISOString(), 'undo', created.id);
    audit('delete', created.id, created.crew_id, created, null, 'undo');
    if (prev) {
      db.prepare('UPDATE entries SET end = NULL WHERE id = ?').run(prev.id);
      audit('reopen', prev.id, prev.crew_id, prev, { ...prev, end: null }, 'undo');
    }
    if (voyageId) {   // the tap that was undone had started the voyage: withdraw it too, if nothing else is in it
      const vy = db.prepare(`SELECT * FROM voyages WHERE id = ? AND crew_id = ? AND ${ACTIVE}`).get(String(voyageId), req.params.id);
      const left = vy ? db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE voyage_id = ? AND ${ACTIVE}`).get(vy.id).n : 1;
      if (vy && left === 0) {
        db.prepare('UPDATE voyages SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), vy.id);
        auditV('voyage-delete', vy, vy, null, 'undo');
      }
    }
  })();
  res.json({ ok: true });
});
app.put('/api/entries/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM entries WHERE id = ? AND ${ACTIVE}`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { type, note } = req.body;
  if (type !== undefined && !['rest', 'work'].includes(type)) return res.status(400).json({ error: 'type must be rest or work' });
  let start, end;
  try {
    start = req.body.start === undefined ? existing.start : normTime(req.body.start);
    end = req.body.end === undefined ? existing.end : normTime(req.body.end);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  if (!start) return res.status(400).json({ error: 'start is required' });
  const merged = { type: type ?? existing.type, start, end, note: note ?? existing.note };
  const vy = existing.voyage_id ? db.prepare('SELECT * FROM voyages WHERE id = ?').get(existing.voyage_id) : null;
  const bad = checkEntry(existing.crew_id, merged, existing.id, vy);
  if (bad) return res.status(bad.status).json(bad);
  db.transaction(() => {
    db.prepare('UPDATE entries SET type=@type, start=@start, end=@end, note=@note WHERE id=@id')
      .run({ ...merged, id: req.params.id });
    audit('edit', existing.id, existing.crew_id, existing, { ...existing, ...merged }, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true });
});
// Delete never erases: the entry is marked deleted and the change is audited.
app.delete('/api/entries/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM entries WHERE id = ? AND ${ACTIVE}`).get(req.params.id);
  if (!existing) return res.json({ ok: true });
  db.transaction(() => {
    db.prepare('UPDATE entries SET deleted_at = ?, deleted_reason = ? WHERE id = ?')
      .run(new Date().toISOString(), String((req.body && req.body.reason) || req.query.reason || ''), existing.id);
    audit('delete', existing.id, existing.crew_id, existing, null, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true });
});

// Undo a delete: the entry comes back if it still fits (inside a voyage, not overlapping anything else)
app.post('/api/entries/:id/restore', (req, res) => {
  const e = db.prepare('SELECT * FROM entries WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'nothing to restore' });
  if (!db.prepare('SELECT 1 FROM crew WHERE id = ? AND deleted_at IS NULL').get(e.crew_id)) return res.status(409).json({ error: 'this crew member has been deleted' });
  const vy = voyageAt(e.crew_id, e.start);
  if (!vy) return res.status(409).json({ error: 'this time is no longer inside a voyage' });
  const bad = checkEntry(e.crew_id, { start: e.start, end: e.end }, e.id, vy);
  if (bad) return res.status(bad.status).json(bad);
  db.transaction(() => {
    db.prepare('UPDATE entries SET deleted_at = NULL, deleted_reason = NULL, voyage_id = ? WHERE id = ?').run(vy.id, e.id);
    audit('restore', e.id, e.crew_id, null, { ...e, voyage_id: vy.id }, req.get('X-Source') || 'api');
  })();
  res.json({ ok: true });
});

// ---- compliance ----
app.get('/api/crew/:id/compliance', (req, res) => {
  const legacy = computeCompliance(req.params.id);
  const vy = activeVoyage(req.params.id);
  legacy.voyage = vy ? { ...voyageView(vy), day: dayOfVoyage(vy) } : null;
  try { legacy.engine = engineReport(req.params.id); } catch (e) { legacy.engineError = String(e.message || e); }
  res.json(legacy);
});
// Full engine report; ?history=1&days=30 adds every past breach/indeterminate episode (audit / inspection use)
app.get('/api/crew/:id/hor-report', (req, res) => {
  try {
    const extra = {};
    if (req.query.history) { extra.history = true; extra.historyDays = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365); }
    const v = req.query.voyage ? db.prepare(`SELECT * FROM voyages WHERE id = ? AND crew_id = ? AND ${ACTIVE}`).get(String(req.query.voyage), req.params.id) : null;
    if (req.query.voyage && !v) return res.status(404).json({ error: 'voyage not found' });
    const r = engineReport(req.params.id, extra, v);
    if (!r) return res.status(409).json({ error: 'no voyage is open (pass ?voyage=<id> for a past one)' });
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
// Audit trail of every create / close / edit / delete
app.get('/api/entries-audit', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 5000);
  const rows = req.query.entry
    ? db.prepare('SELECT * FROM entry_audit WHERE entry_id = ? ORDER BY seq DESC LIMIT ?').all(String(req.query.entry), limit)
    : db.prepare('SELECT * FROM entry_audit ORDER BY seq DESC LIMIT ?').all(limit);
  res.json(rows);
});

// ---- export (everything) ----
app.get('/api/export.json', (req, res) => {
  const vessel = getSetting('vessel', '');
  const crew = db.prepare('SELECT * FROM crew').all();
  const entries = db.prepare('SELECT * FROM entries').all();   // includes deleted_at / deleted_reason
  const auditTrail = db.prepare('SELECT * FROM entry_audit ORDER BY seq ASC').all();
  res.setHeader('Content-Disposition', 'attachment; filename="crowsnest-hours-of-rest.json"');
  const voyages = db.prepare('SELECT * FROM voyages ORDER BY start ASC').all().map(v => ({ ...v, declaration: parseDecl(v) }));
  res.json({ exportedAt: new Date().toISOString(), vessel, crew, voyages, entries, auditTrail });
});
app.get('/api/export.csv', (req, res) => {
  const vessel = getSetting('vessel', '');
  const vv = vesselView();
  const crewRows = db.prepare('SELECT * FROM crew').all();
  const crewById = Object.fromEntries(crewRows.map(c => [c.id, c.name]));
  const roleById = Object.fromEntries(crewRows.map(c => [c.id, c.role || '']));
  const entries = db.prepare(`SELECT * FROM entries WHERE ${ACTIVE} ORDER BY start ASC`).all();
  const header = ['vessel', 'official_number', 'flag', 'crew_member', 'rank', 'type', 'start', 'end', 'duration_minutes', 'note'];
  const rows = entries.map(e => {
    const dur = e.end ? Math.round((new Date(e.end) - new Date(e.start)) / 60000) : '';
    return [vessel, vv.officialNumber, vv.flag, crewById[e.crew_id] || e.crew_id, roleById[e.crew_id] || '', e.type, e.start, e.end || '', dur, (e.note || '').replace(/[\r\n,]+/g, ' ')];
  });
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="crowsnest-hours-of-rest.csv"');
  res.send(csv);
});

// ---- dashboard: primary crew member (whose rest status shows on the main dashboard) ----
// a crew member's phone always shows that crew member on its dashboard
const dashCrewId = () => reqDevice && reqDevice.role === 'crew' ? reqDevice.crew_id : getSetting('primaryCrewId', '');
app.get('/api/dashboard/settings', (req, res) => {
  res.json({ primaryCrewId: dashCrewId() });
});
app.put('/api/dashboard/settings', (req, res) => {
  setSetting('primaryCrewId', String(req.body.primaryCrewId || ''));
  res.json({ ok: true });
});
app.get('/api/dashboard/hor-summary', (req, res) => {
  const primaryCrewId = dashCrewId();
  const crew = db.prepare('SELECT * FROM crew WHERE id = ? AND deleted_at IS NULL').get(primaryCrewId);
  if (!crew) return res.json({ configured: false });
  const open = db.prepare(`SELECT * FROM entries WHERE crew_id = ? AND end IS NULL AND ${ACTIVE}`).get(primaryCrewId);
  const out = {
    configured: true,
    crewName: crew.name,
    status: open ? open.type : null,
    statusSince: open ? open.start : null,
    compliance: computeCompliance(primaryCrewId)   // legacy figures, kept for older clients
  };
  const vy = activeVoyage(primaryCrewId);
  out.voyage = vy ? { ...voyageView(vy), day: dayOfVoyage(vy), declarationDue: !vy.declaration } : null;
  try {
    if (vy) out.engine = engineReport(primaryCrewId);
    else { const last = lastEndedVoyage(primaryCrewId); if (last) out.lastVoyage = voyageSummary(last); }
  } catch (e) { out.engineError = String(e.message || e); }
  res.json(out);
});

// ---- positions and voyage track ----
// A fix is a point in time and space. The track of a voyage is simply the fixes that fall inside its dates (plus a short margin),
// so editing a voyage's dates re-draws its track. Fixes are recorded by the phone while the app is open (see dashboard.js);
// anything that can POST to /api/positions (an NMEA/Signal K gateway, say) can add to the same track with source 'device'.
db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    acc REAL,
    sog REAL,
    cog REAL,
    source TEXT,
    crew_id TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_positions_ts ON positions(ts);
`);
const POS_SOURCES = ['auto', 'tap', 'end', 'manual', 'typed', 'device', 'background'];   // background = the phone app while closed
const TRACK_INTERVALS = [0, 5, 10, 15, 30, 60];
const TRACK_MARGIN_MS = 10 * 60 * 1000;   // a fix taken a moment before the voyage was opened, or after it was closed, still belongs to it
const TRACK_MAX_ACC_M = 1000;             // fixes less accurate than this are kept but not drawn or counted
const TRACK_MAX_KN = 45;                  // a jump faster than this between two fixes is treated as a bad fix
const TRACK_GAP_H = 3;                    // legs longer than this are drawn dashed: the path in between is not known
const NM_M = 1852;
const posView = r => r ? { id: r.id, ts: r.ts, lat: r.lat, lon: r.lon, acc: r.acc, sog: r.sog, cog: r.cog, source: r.source } : null;
function haversineNm(a, b) {
  const R = 6371008.8 / NM_M, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const round1 = x => Math.round(x * 10) / 10;
// Rows (any order) -> points flagged used/ignored, legs between used points, and summary figures.
function analyseTrack(rows) {
  const pts = rows.slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)).map(r => ({ ...posView(r), used: true, why: null }));
  let last = null, jumps = 0;
  for (const p of pts) {
    if (p.acc != null && p.acc > TRACK_MAX_ACC_M) { p.used = false; p.why = 'inaccurate'; continue; }
    if (last) {
      const hrs = (Date.parse(p.ts) - Date.parse(last.ts)) / 3600000, nm = haversineNm(last, p);
      const bad = hrs <= 0 ? nm > 0.05 : nm / hrs > TRACK_MAX_KN;
      if (bad && jumps < 2) { jumps++; p.used = false; p.why = 'jump'; continue; }   // after three in a row, believe the new position
    }
    jumps = 0; last = p;
  }
  const used = pts.filter(p => p.used), legs = [];
  let dist = 0, maxKn = 0, gaps = 0, runNm = 0, runH = 0;   // run* = distance and time on legs that were really under way
  for (let i = 1; i < used.length; i++) {
    const a = used[i - 1], b = used[i], nm = haversineNm(a, b), hrs = (Date.parse(b.ts) - Date.parse(a.ts)) / 3600000;
    const gap = hrs > TRACK_GAP_H && nm >= 0.5, kn = hrs > 0 ? nm / hrs : 0;   // a long wait at the same spot is not a gap in the path
    dist += nm; if (gap) gaps++;
    if (!gap && hrs > 0 && nm / hrs >= 0.8) { runNm += nm; runH += hrs; }
    if (hrs >= 5 / 60 && kn > maxKn) maxKn = kn;
    legs.push({ from: a.id, to: b.id, nm: Math.round(nm * 100) / 100, hours: Math.round(hrs * 1000) / 1000, kn: round1(kn), gap });
  }
  const stats = {
    fixes: pts.length, used: used.length, ignored: pts.length - used.length,
    distanceNm: round1(dist), avgKn: runH >= 0.1 ? round1(runNm / runH) : null, maxLegKn: maxKn ? round1(maxKn) : null,
    gaps, firstTs: used.length ? used[0].ts : null, lastTs: used.length ? used[used.length - 1].ts : null,
    bbox: used.length ? [Math.min(...used.map(p => p.lat)), Math.min(...used.map(p => p.lon)), Math.max(...used.map(p => p.lat)), Math.max(...used.map(p => p.lon))] : null
  };
  return { points: pts, legs, stats };
}
function trackRows(v) {
  const from = new Date(Date.parse(v.start) - TRACK_MARGIN_MS).toISOString();
  const to = new Date((v.end ? Date.parse(v.end) : Date.now()) + TRACK_MARGIN_MS).toISOString();
  return db.prepare(`SELECT * FROM positions WHERE ts >= ? AND ts <= ? AND ${ACTIVE} ORDER BY ts ASC`).all(from, to);
}
const trackOf = v => analyseTrack(trackRows(v));
function trackCrewId(req) {
  const q = req && req.query && req.query.crew;
  if (q && db.prepare(`SELECT 1 FROM crew WHERE id = ? AND ${ACTIVE}`).get(String(q))) return String(q);
  const p = getSetting('primaryCrewId', '');
  if (p && db.prepare(`SELECT 1 FROM crew WHERE id = ? AND ${ACTIVE}`).get(p)) return p;
  const f = db.prepare(`SELECT id FROM crew WHERE ${ACTIVE} ORDER BY created_at ASC LIMIT 1`).get();
  return f ? f.id : null;
}
function numIn(v, lo, hi) { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN; }

app.post('/api/positions', (req, res) => {
  const b = req.body || {};
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'lat must be -90 to 90 and lon -180 to 180' });
  if (lat === 0 && lon === 0) return res.status(400).json({ error: 'position 0,0 is not accepted (it is what a failed fix looks like)' });
  const acc = numIn(b.acc, 0, 1e6), sog = numIn(b.sog, 0, 200), cog = numIn(b.cog, 0, 360);
  if ([acc, sog, cog].some(Number.isNaN)) return res.status(400).json({ error: 'acc (metres), sog (knots) and cog (degrees) must be numbers in range' });
  let ts;
  try { ts = b.ts ? normTime(b.ts) : new Date().toISOString(); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (Date.parse(ts) > Date.now() + FUTURE_TOL_MS) return res.status(400).json({ error: 'time is in the future' });
  if (b.id !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(String(b.id))) return res.status(400).json({ error: 'id must be 1-64 letters, digits, _ or -' });
  const id = b.id ? String(b.id) : uid();
  const source = POS_SOURCES.includes(b.source) ? b.source : 'auto';
  const crew = b.crewId && db.prepare(`SELECT 1 FROM crew WHERE id = ? AND ${ACTIVE}`).get(String(b.crewId)) ? String(b.crewId) : null;
  const r = db.prepare('INSERT OR IGNORE INTO positions (id, ts, lat, lon, acc, sog, cog, source, crew_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, ts, lat, lon, acc, sog, cog, source, crew, new Date().toISOString());
  const row = db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
  res.status(r.changes ? 201 : 200).json({ ...posView(row), duplicate: !r.changes });
});
app.get('/api/positions/latest', (req, res) => {
  const r = db.prepare(`SELECT * FROM positions WHERE ${ACTIVE} ORDER BY ts DESC LIMIT 1`).get();
  res.json(r ? posView(r) : { none: true });
});
app.delete('/api/positions/:id', (req, res) => {
  const r = db.prepare(`UPDATE positions SET deleted_at = ? WHERE id = ? AND ${ACTIVE}`).run(new Date().toISOString(), req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});
app.post('/api/positions/:id/restore', (req, res) => {
  const r = db.prepare('UPDATE positions SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});
app.get('/api/track/settings', (req, res) => {
  const n = parseInt(getSetting('trackIntervalMin', '15'), 10);
  res.json({ intervalMin: TRACK_INTERVALS.includes(n) ? n : 15, intervals: TRACK_INTERVALS });
});
app.put('/api/track/settings', (req, res) => {
  const n = Number((req.body || {}).intervalMin);
  if (!TRACK_INTERVALS.includes(n)) return res.status(400).json({ error: 'intervalMin must be one of ' + TRACK_INTERVALS.join(', ') });
  setSetting('trackIntervalMin', String(n));
  res.json({ ok: true, intervalMin: n });
});
// Dashboard tile: is a voyage open, how much track is there, where was the last fix.
app.get('/api/track/status', (req, res) => {
  const cid = trackCrewId(req), n = parseInt(getSetting('trackIntervalMin', '15'), 10);
  const out = { intervalMin: TRACK_INTERVALS.includes(n) ? n : 15, configured: !!cid, voyageOpen: false };
  const lat = db.prepare(`SELECT * FROM positions WHERE ${ACTIVE} ORDER BY ts DESC LIMIT 1`).get();
  out.lastFix = lat ? posView(lat) : null;
  if (!cid) return res.json(out);
  const open = activeVoyage(cid), shown = open || lastEndedVoyage(cid);
  out.voyageOpen = !!open;
  if (shown) {
    const t = trackOf(shown), u = t.points.filter(p => p.used), step = Math.max(1, Math.ceil(u.length / 40));
    out.voyage = { id: shown.id, start: shown.start, end: shown.end, fixes: t.stats.used, distanceNm: t.stats.distanceNm };
    out.path = u.filter((p, i) => i % step === 0 || i === u.length - 1).map(p => [Math.round(p.lat * 1e4) / 1e4, Math.round(p.lon * 1e4) / 1e4]);
  }
  res.json(out);
});
app.get('/api/track/voyages', (req, res) => {
  const cid = trackCrewId(req);
  if (!cid) return res.json([]);
  res.json(db.prepare(`SELECT * FROM voyages WHERE crew_id = ? AND ${ACTIVE} ORDER BY start DESC`).all(cid).map(v => {
    const s = trackOf(v).stats;
    return { id: v.id, start: v.start, end: v.end, note: v.note, fixes: s.used, distanceNm: s.distanceNm };
  }));
});
function voyageForTrack(req, res) {
  const v = db.prepare(`SELECT * FROM voyages WHERE id = ? AND ${ACTIVE}`).get(req.params.id);
  if (!v) { res.status(404).json({ error: 'voyage not found' }); return null; }
  return v;
}
app.get('/api/voyages/:id/track', (req, res) => {
  const v = voyageForTrack(req, res); if (!v) return;
  const crew = db.prepare('SELECT name, role FROM crew WHERE id = ?').get(v.crew_id) || {};
  res.json({
    voyage: { ...voyageView(v), crewName: crew.name || '', crewRole: crew.role || '' },
    vessel: vesselView(), now: new Date().toISOString(),
    margin: { minutes: TRACK_MARGIN_MS / 60000, maxAccuracyM: TRACK_MAX_ACC_M, gapHours: TRACK_GAP_H },
    ...trackOf(v)
  });
});
const xmlEsc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
app.get('/api/voyages/:id/track.gpx', (req, res) => {
  const v = voyageForTrack(req, res); if (!v) return;
  const t = trackOf(v), u = t.points.filter(p => p.used), ves = vesselView();
  const name = (ves.vessel ? ves.vessel + ' ' : '') + 'voyage ' + v.start.slice(0, 10) + (v.end ? ' to ' + v.end.slice(0, 10) : '');
  const wpt = (p, n) => `  <wpt lat="${p.lat}" lon="${p.lon}"><time>${p.ts}</time><name>${xmlEsc(n)}</name></wpt>\n`;
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Crow\'s Nest" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `  <metadata><name>${xmlEsc(name)}</name><time>${new Date().toISOString()}</time></metadata>\n`;
  if (u.length) { x += wpt(u[0], 'Start'); if (u.length > 1) x += wpt(u[u.length - 1], v.end ? 'End' : 'Latest'); }
  x += `  <trk><name>${xmlEsc(name)}</name>\n`;
  let open = false, prev = null;
  u.forEach(p => {
    if (!open || (prev && (Date.parse(p.ts) - Date.parse(prev.ts)) / 3600000 > TRACK_GAP_H)) { if (open) x += '    </trkseg>\n'; x += '    <trkseg>\n'; open = true; }
    x += `      <trkpt lat="${p.lat}" lon="${p.lon}"><time>${p.ts}</time></trkpt>\n`;
    prev = p;
  });
  if (open) x += '    </trkseg>\n';
  x += '  </trk>\n</gpx>\n';
  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="crowsnest-track-${v.start.slice(0, 10)}.gpx"`);
  res.send(x);
});
app.get('/api/voyages/:id/track.csv', (req, res) => {
  const v = voyageForTrack(req, res); if (!v) return;
  const rows = trackOf(v).points.map(p => [p.ts, p.lat, p.lon, p.acc == null ? '' : Math.round(p.acc), p.sog == null ? '' : p.sog, p.cog == null ? '' : p.cog, p.source, p.used ? 'yes' : 'no ' + p.why]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="crowsnest-track-${v.start.slice(0, 10)}.csv"`);
  res.send([['time_utc', 'lat', 'lon', 'accuracy_m', 'sog_kn', 'cog_deg', 'source', 'used'], ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'));
});

// ---- weather & wind (Open-Meteo — free, no API key, forecast model not an official marine forecast) ----
app.get('/api/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon query params required' });
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&wind_speed_unit=kn&timezone=auto`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const d = await r.json();
    const c = d.current || {};
    res.json({
      source: 'Open-Meteo forecast model — not an official marine/shipping forecast',
      fetchedAt: new Date().toISOString(),
      temperatureC: c.temperature_2m,
      weatherCode: c.weather_code,
      windSpeedKn: c.wind_speed_10m,
      windDirectionDeg: c.wind_direction_10m,
      windGustsKn: c.wind_gusts_10m
    });
  } catch (e) {
    res.status(502).json({ error: 'weather fetch failed', detail: String(e.message || e) });
  }
});

// ---- wind: hourly forecast from a chosen model (Open-Meteo). Forecast model output, not an official marine forecast. ----
// Model ids are Open-Meteo's; 'seamless' ones blend a high-resolution regional run with its global parent.
// Verified against the live API by .github/workflows/wind-models.yml (this sandbox cannot reach Open-Meteo).
const WIND_MODELS = [
  { id: 'ukmo_seamless', label: 'UK Met Office', detail: 'UKV 2 km over the UK and Ireland, global 10 km beyond' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', detail: 'European Centre global model, 25 km' },
  { id: 'icon_seamless', label: 'DWD ICON', detail: 'German Weather Service: ICON-D2 2 km / ICON-EU 7 km / global' },
  { id: 'dmi_seamless', label: 'DMI HARMONIE', detail: 'Danish Met Institute, 2 km over NW Europe' },
  { id: 'meteofrance_seamless', label: 'Météo-France', detail: 'AROME 1.3-2.5 km / ARPEGE' },
  { id: 'gfs_seamless', label: 'NOAA GFS', detail: 'US global model, 13-25 km' },
  { id: 'best_match', label: 'Open-Meteo best match', detail: 'Open-Meteo picks the best model for the spot' }
];
const WIND_DEFAULT = 'ukmo_seamless';
const OPEN_METEO = process.env.OPEN_METEO_BASE || 'https://api.open-meteo.com';   // tests point this at a fake
const windCache = new Map();   // key -> { at, data }; Open-Meteo updates hourly at most, so 10 minutes is plenty
async function windFor(model, lat, lon, days) {
  const key = [model, lat.toFixed(2), lon.toFixed(2), days].join('|');
  const hit = windCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.data;
  const url = `${OPEN_METEO}/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&models=${model}&wind_speed_unit=kn&timeformat=unixtime&timezone=GMT&forecast_days=${days}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.reason || `upstream ${r.status}`);
  const h = d.hourly || {}, c = d.current || {};
  const round = a => (a || []).map(v => v == null ? null : Math.round(v * 10) / 10);
  const data = {
    gridLat: d.latitude, gridLon: d.longitude,
    current: c.time ? { t: c.time * 1000, kn: c.wind_speed_10m, dir: c.wind_direction_10m, gust: c.wind_gusts_10m } : null,
    t: (h.time || []).map(x => x * 1000), kn: round(h.wind_speed_10m), dir: (h.wind_direction_10m || []).map(v => v == null ? null : Math.round(v)), gust: round(h.wind_gusts_10m)
  };
  if (!data.t.length || data.kn.every(v => v == null)) throw new Error('this model has no wind data for this position');
  windCache.set(key, { at: Date.now(), data });
  if (windCache.size > 200) windCache.delete(windCache.keys().next().value);
  return data;
}
app.get('/api/wind', async (req, res) => {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'lat and lon query params required' });
  const days = Math.min(10, Math.max(1, parseInt(req.query.days, 10) || 7));
  const want = String(req.query.model || WIND_DEFAULT);
  const m = WIND_MODELS.find(x => x.id === want);
  if (!m) return res.status(400).json({ error: 'unknown model', models: WIND_MODELS });
  const base = { source: 'Open-Meteo', note: 'Forecast model output - not an official marine forecast', models: WIND_MODELS, model: m, lat, lon, fetchedAt: new Date().toISOString() };
  try {
    const out = Object.assign(base, await windFor(m.id, lat, lon, days));
    if (req.query.compare) {   // the same hours from every other model, side by side (for the "Models" view)
      out.compare = await Promise.all(WIND_MODELS.filter(x => x.id !== m.id).map(x =>
        windFor(x.id, lat, lon, days).then(d => ({ model: x, t: d.t, kn: d.kn, dir: d.dir, gust: d.gust }), e => ({ model: x, error: String(e.message || e) }))));
    }
    res.json(out);
  } catch (e) {
    res.status(502).json(Object.assign(base, { error: 'wind forecast unavailable', detail: String(e.message || e) }));
  }
});

// ---- Met Office inshore waters forecast (official text forecast to 12 nm, issued 4 times a day) ----
// No data feed exists (checked 7 Oct 2026: the old CoreProductCache XML is gone), so the public page is read and parsed:
// each area is <section class="marine-card [warning]"> with <h2 class="card-name">Name (n)</h2>, a forecast-block and an
// outlook-block, each <h3>title</h3> + <dl><dt>Wind|Sea state|Weather|Visibility</dt><dd>...</dd></dl>.
// Fetched at most every 15 minutes; the last good copy is kept (also across restarts) and served, marked stale, if the
// Met Office cannot be reached. © Crown copyright, Met Office.
const INSHORE_URL = process.env.INSHORE_URL || 'https://weather.metoffice.gov.uk/specialist-forecasts/coast-and-sea/inshore-waters-forecast';
const INSHORE_PAGE = 'https://weather.metoffice.gov.uk/specialist-forecasts/coast-and-sea/inshore-waters-forecast';
const INSHORE_AREAS = require('./inshore-areas.js');
const htmlText = h => String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();
function parseInshore(html) {
  const one = (re, src) => { const m = (src || html).match(re); return m ? htmlText(m[1]) : ''; };
  const out = {
    issued: one(/Issued at:\s*<time>([\s\S]*?)<\/time>/i),
    period: one(/<div id="sea-forecast-time"[^>]*>[\s\S]*?<p>[\s\S]*?<\/p>\s*<p>([\s\S]*?)<\/p>/i),
    situation: one(/<p class="synopsis-text">([\s\S]*?)<\/p>/i),
    areas: []
  };
  const secs = html.split(/<section aria-labelledby="area/i).slice(1);
  for (const raw of secs) {
    const sec = raw.split(/<\/section>/i)[0];
    const head = one(/<h2[^>]*class="card-name"[^>]*>([\s\S]*?)<\/h2>/i, sec);
    const m = head.match(/^(.*?)\s*\((\d+)\)\s*$/);
    if (!m) continue;
    const name = m[1], n = +m[2];
    const blocks = [];
    for (const cls of ['forecast-block', 'outlook-block']) {
      const b = sec.match(new RegExp('<div class="' + cls + '">([\\s\\S]*?)(?=<div class="(?:forecast|outlook)-block">|$)', 'i'));
      if (!b) continue;
      const items = [];
      const re = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi; let d;
      while ((d = re.exec(b[1]))) items.push([htmlText(d[1]), htmlText(d[2])]);
      blocks.push({ title: one(/<h3>([\s\S]*?)<\/h3>/i, b[1]).replace(/:$/, ''), items, text: items.length ? '' : htmlText(b[1].replace(/<h3>[\s\S]*?<\/h3>/i, '')) });
    }
    const card = (sec.match(/class="marine-card([^"]*)"/i) || [, ''])[1];
    const pre = sec.split(/<div class="(?:forecast-block|general-situation)">/i)[0];
    out.areas.push({
      key: /^For Coastal areas up to 60/i.test(name) ? n + 'b' : String(n), n, name,
      warning: /\bwarning\b/.test(card),
      notes: (pre.match(/<p>([\s\S]*?)<\/p>/gi) || []).map(htmlText).filter(Boolean),   // e.g. 'Strong winds are forecast', 'Valid ... UTC'
      situation: one(/<div class="general-situation">[\s\S]*?<p>([\s\S]*?)<\/p>/i, sec) || null,
      blocks
    });
  }
  return out;
}
const nmBetween = (a, b) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
};
// the inshore area whose coast is nearest the position (null if further than 60 nm from any)
function nearestInshore(lat, lon) {
  let best = null;
  for (const a of INSHORE_AREAS) for (const p of a.pts) {
    const d = nmBetween([lat, lon], p);
    if (!best || d < best.nm) best = { n: a.n, name: a.name, nm: d };
  }
  return best && best.nm <= 60 ? { n: best.n, key: String(best.n), name: best.name, distanceNm: Math.round(best.nm * 10) / 10 } : null;
}
let inshoreMem = null;   // { at, data }
async function inshoreForecast() {
  if (inshoreMem && Date.now() - inshoreMem.at < 15 * 60000) return { data: inshoreMem.data, stale: false };
  try {
    const r = await fetch(INSHORE_URL, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'CrowsNest/1.0 (private marine dashboard; 15-min cache)' } });
    if (!r.ok) throw new Error('Met Office answered ' + r.status);
    const data = parseInshore(await r.text());
    if (data.areas.length < (+process.env.INSHORE_MIN_AREAS || 10)) throw new Error('page layout changed: only ' + data.areas.length + ' areas found');
    data.fetchedAt = new Date().toISOString();
    inshoreMem = { at: Date.now(), data };
    setSetting('inshoreLast', JSON.stringify(data));
    return { data, stale: false };
  } catch (e) {
    const last = inshoreMem ? inshoreMem.data : (() => { try { return JSON.parse(getSetting('inshoreLast', '') || 'null'); } catch (x) { return null; } })();
    if (last) return { data: last, stale: true, error: String(e.message || e) };
    throw e;
  }
}
app.get('/api/inshore', async (req, res) => {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  const nearest = Number.isFinite(lat) && Number.isFinite(lon) ? nearestInshore(lat, lon) : null;
  try {
    const f = await inshoreForecast();
    res.json(Object.assign({ source: 'Met Office', copyright: '© Crown copyright, Met Office', url: INSHORE_PAGE, nearest, stale: f.stale, staleReason: f.error || null }, f.data));
  } catch (e) {
    res.status(502).json({ error: 'inshore waters forecast unavailable', detail: String(e.message || e), url: INSHORE_PAGE, nearest,
      areas: INSHORE_AREAS.map(a => ({ key: String(a.n), n: a.n, name: a.name, blocks: [] })) });
  }
});

// ---- tides: Admiralty UK Tidal API - Discovery tier (free, UK/Ireland only) ----
// NOTE: endpoint path and response field names below are built from the
// published community Python client's documented usage, not a direct read
// of Admiralty's own docs (which sit behind portal login). Verify against
// a real response once an API key is in place — see README.
app.put('/api/settings/tide-provider', (req, res) => {
  const { apiKey, stationId } = req.body;
  if (apiKey !== undefined) setSetting('ukhoApiKey', String(apiKey));
  if (stationId !== undefined) setSetting('ukhoStationId', String(stationId));
  res.json({ ok: true });
});
app.get('/api/settings/tide-provider', (req, res) => {
  res.json({
    hasApiKey: !!getSetting('ukhoApiKey', ''),
    stationId: getSetting('ukhoStationId', '')
  });
});
app.get('/api/tides', async (req, res) => {
  const apiKey = getSetting('ukhoApiKey', '');
  const stationId = getSetting('ukhoStationId', '');
  if (!apiKey || !stationId) {
    return res.json({
      configured: false,
      message: 'Tide data provider not yet set up — see README for Admiralty UK Tidal API (Discovery) setup.'
    });
  }
  try {
    const url = `https://admiraltyapi.azure-api.net/uktidalapi/api/V1/Stations/${encodeURIComponent(stationId)}/TidalEvents?duration=6`;
    const r = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const raw = await r.json();
    const events = (Array.isArray(raw) ? raw : []).map(e => ({
      type: e.EventType === 'HighWater' ? 'high' : e.EventType === 'LowWater' ? 'low' : String(e.EventType || '').toLowerCase(),
      time: e.DateTime,
      heightM: e.Height
    }));
    res.json({
      configured: true,
      source: 'Admiralty UK Tidal API (Discovery) — UK/Ireland stations only',
      stationId,
      events
    });
  } catch (e) {
    res.status(502).json({ configured: true, error: 'tide fetch failed', detail: String(e.message || e) });
  }
});

require('./extra')(app, db);

app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Crow's Nest — Hours of Rest listening on :${PORT}`));
