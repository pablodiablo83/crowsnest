// Crow's Nest - web sign-in: user accounts, password hashing and sessions (shared by server.js and tools/user.js).
// Passwords: scrypt (Node built-in) with a per-user salt, stored as "scrypt$N$r$p$salt$hash". Sessions: a random 32-byte
// id in an HttpOnly cookie; only its SHA-256 is stored, so a copy of the database cannot be used to sign in.
'use strict';
const crypto = require('crypto');

const COOKIE = 'cn_sid';
const LONG_MS = 30 * 86400000, SHORT_MS = 12 * 3600000;   // "stay signed in" / not
const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('master','crew')), crew_id TEXT, created_at TEXT NOT NULL, disabled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL,
      expires_at TEXT NOT NULL, long INTEGER NOT NULL DEFAULT 1, agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);
}
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}
function verifyPassword(pw, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 6 || p[0] !== 'scrypt') return false;
  const want = Buffer.from(p[5], 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(p[4], 'base64'), want.length, { N: +p[1], r: +p[2], p: +p[3], maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
// a fixed dummy hash, verified when the username does not exist, so timing does not reveal which usernames exist
const DUMMY = hashPassword(crypto.randomBytes(12).toString('hex'));

function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 10) return 'the password must be at least 10 characters';
  if (pw.length > 200) return 'the password is too long';
  return null;
}

function createSession(db, userId, long, agent) {
  const sid = crypto.randomBytes(32).toString('base64url'), now = Date.now();
  db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, last_seen, expires_at, long, agent) VALUES (?,?,?,?,?,?,?)')
    .run(sha256(sid), userId, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + (long ? LONG_MS : SHORT_MS)).toISOString(), long ? 1 : 0, String(agent || '').slice(0, 160));
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date(now).toISOString());
  return { sid, maxAge: long ? LONG_MS : null };
}
// returns { user, session } or null; slides the expiry forward (at most once a minute)
function readSession(db, sid) {
  if (!sid || !/^[A-Za-z0-9_-]{30,60}$/.test(sid)) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(sid));
  if (!s || Date.parse(s.expires_at) < Date.now()) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND disabled_at IS NULL').get(s.user_id);
  if (!u) return null;
  if (Date.now() - Date.parse(s.last_seen) > 60000) {
    db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id_hash = ?')
      .run(new Date().toISOString(), new Date(Date.now() + (s.long ? LONG_MS : SHORT_MS)).toISOString(), s.id_hash);
  }
  return { user: u, session: s };
}
function endSession(db, sid) { if (sid) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(sid)); }
function cookieOf(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
// Secure everywhere except plain-http localhost (tests); the public site is only reached over https.
function setCookie(req, res, sid, maxAge) {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.get('host') || ''));
  const parts = [COOKIE + '=' + sid, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (!local) parts.push('Secure');
  if (maxAge) parts.push('Max-Age=' + Math.floor(maxAge / 1000));
  res.append('Set-Cookie', parts.join('; '));
}
function clearCookie(req, res) {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.get('host') || ''));
  res.append('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (local ? '' : '; Secure'));
}
const userView = u => u ? { id: u.id, username: u.username, role: u.role, crewId: u.crew_id } : null;

module.exports = { init, hashPassword, verifyPassword, DUMMY, passwordProblem, createSession, readSession, endSession, cookieOf, setCookie, clearCookie, userView, sha256, COOKIE };
