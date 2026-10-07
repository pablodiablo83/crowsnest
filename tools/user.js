#!/usr/bin/env node
// Manage web sign-in accounts (run inside the container: docker exec -it crowsnest-hor node tools/user.js ...)
//   node tools/user.js add <username> [master|crew <crewId>]   create an account (asks for the password twice)
//   node tools/user.js password <username>                      set a new password (signs that user out everywhere)
//   node tools/user.js list                                     list accounts
//   node tools/user.js disable <username> | enable <username>   stop / allow an account (disable signs it out)
// --password-stdin reads the password from standard input instead of asking (tests, scripts).
'use strict';
const path = require('path'), fs = require('fs'), crypto = require('crypto'), readline = require('readline');
const Database = require('better-sqlite3');
const auth = require('../auth.js');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'crowsnest.db'));
db.pragma('journal_mode = WAL');
auth.init(db);
const [cmd, name, role = 'master', crewId = null] = process.argv.slice(2).filter(a => a !== '--password-stdin');
const fromStdin = process.argv.includes('--password-stdin');
const die = m => { console.error(m); process.exit(1); };
const audit = (action, id, before, after) => {
  try { db.prepare('INSERT INTO entry_audit (at, entry_id, crew_id, action, before_json, after_json, source) VALUES (?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), 'user:' + id, null, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, 'tools/user.js'); } catch (e) { /* audit table not created yet */ }
};

function ask(q) {   // hidden input
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, a => { rl.output.write('\n'); rl.close(); resolve(a); });
  });
}
async function newPassword() {
  if (fromStdin) return (fs.readFileSync(0, 'utf8').split(/\r?\n/)[0] || '');
  const a = await ask('New password: '), b = await ask('Again: ');
  if (a !== b) die('The two passwords differ - nothing changed.');
  return a;
}
const find = n => db.prepare('SELECT * FROM users WHERE username = ?').get(String(n || ''));

(async () => {
  if (cmd === 'list') {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at').all();
    if (!rows.length) return console.log('No accounts yet. Add one: node tools/user.js add skipper');
    for (const u of rows) console.log(`${u.username.padEnd(16)} ${u.role.padEnd(7)} ${u.crew_id || ''} ${u.disabled_at ? 'DISABLED' : 'active'}`);
    return;
  }
  if (!name || !/^[A-Za-z0-9._-]{2,32}$/.test(name)) die('Username: 2-32 letters, digits, dot, dash or underscore.');
  if (cmd === 'add') {
    if (find(name)) die('That username already exists. To change its password: node tools/user.js password ' + name);
    if (!['master', 'crew'].includes(role)) die('Role must be master or crew.');
    if (role === 'crew' && !crewId) die('A crew account needs the crew member id: node tools/user.js add <name> crew <crewId>');
    const pw = await newPassword(), bad = auth.passwordProblem(pw); if (bad) die('Not saved: ' + bad + '.');
    const u = { id: crypto.randomBytes(8).toString('hex'), username: name, pass_hash: auth.hashPassword(pw), role, crew_id: role === 'crew' ? crewId : null, created_at: new Date().toISOString() };
    db.prepare('INSERT INTO users (id, username, pass_hash, role, crew_id, created_at) VALUES (@id,@username,@pass_hash,@role,@crew_id,@created_at)').run(u);
    audit('user-add', u.id, null, auth.userView(u));
    return console.log(`Account ${name} (${role}) created. Sign in at the Crow's Nest web address.`);
  }
  const u = find(name); if (!u) die('No account called ' + name + '. See: node tools/user.js list');
  if (cmd === 'password') {
    const pw = await newPassword(), bad = auth.passwordProblem(pw); if (bad) die('Not saved: ' + bad + '.');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(pw), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit('user-password', u.id, null, { username: u.username });
    return console.log('Password changed for ' + name + '. Signed out on all devices.');
  }
  if (cmd === 'disable' || cmd === 'enable') {
    db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(cmd === 'disable' ? new Date().toISOString() : null, u.id);
    if (cmd === 'disable') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit('user-' + cmd, u.id, null, { username: u.username });
    return console.log(name + (cmd === 'disable' ? ' disabled and signed out.' : ' enabled.'));
  }
  die('Commands: add, password, list, disable, enable');
})();
