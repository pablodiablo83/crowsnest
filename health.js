// Status page support (24 Nov 2026): what each outside service last did (note), the last server errors (every
// console.error is also kept in a small ring buffer, newest 40, text only, cut to 300 characters) and the running commit.
// Required at the top of server.js so errors from start-up are caught too. Nothing here is written to disk.
const fs = require('fs'), path = require('path');
const started = Date.now();
const marks = new Map();   // name -> { ok, at, lastOk, lastFail, error }
const errors = [];         // { at, text }

function note(name, ok, err) {
  const m = marks.get(name) || { lastOk: null, lastFail: null, error: null };
  m.ok = !!ok; m.at = Date.now();
  if (ok) m.lastOk = m.at; else { m.lastFail = m.at; m.error = String((err && err.message) || err || 'failed').slice(0, 200); }
  marks.set(name, m);
}

const origError = console.error.bind(console);
console.error = (...args) => {
  try {
    const text = args.map(a => (a && a.stack) ? String(a.stack).split('\n').slice(0, 2).join(' | ') : typeof a === 'string' ? a : JSON.stringify(a))
      .join(' ').replace(/\b\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, '').replace(/\s+/g, ' ').slice(0, 300);
    errors.push({ at: Date.now(), text }); if (errors.length > 40) errors.shift();
  } catch (e) { /* never let logging break the server */ }
  origError(...args);
};

// the commit being served: read from the git checkout (docker-compose mounts ./.git read-only); null if unknown
function commit(dir) {
  try {
    const g = path.join(dir, '.git'), head = fs.readFileSync(path.join(g, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head.slice(0, 7);
    const ref = head.slice(5);
    try { return fs.readFileSync(path.join(g, ref), 'utf8').trim().slice(0, 7); } catch (e) { /* packed */ }
    const line = fs.readFileSync(path.join(g, 'packed-refs'), 'utf8').split('\n').find(l => l.endsWith(' ' + ref));
    return line ? line.slice(0, 7) : null;
  } catch (e) { return null; }
}

module.exports = { started, marks, errors, note, commit };
