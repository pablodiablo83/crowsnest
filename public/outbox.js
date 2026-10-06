// Crow's Nest - offline outbox (dashboard, Hours of rest page, and the phone app)
// Things that record what happened - Work/Rest taps, End voyage, a new entry, a position - are saved on this device first,
// then sent in order. Without a connection they wait here and go, with the time they were made, when it returns.
// The server applies each one once (its opId) and refuses one that no longer fits the record (e.g. a later period was
// logged from another phone); refused items are kept as "not applied" for the person to see.
// Edits and deletes are NOT queued: they depend on the record as it was, so they need a connection.
(function () {
  'use strict';
  var KEY = 'cn_tapq', FAILED = 'cn_tapq_failed', FRESH_MS = 30000, TIMEOUT_MS = 15000;
  var skew = 0, flushing = null, subs = [];

  function get(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function changed() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }
  function newId() { return 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function idOf(i) { return i.opId || i.tapId; }
  function kindOf(i) { return i.kind || 'tap'; }
  // pages call this with any server response so queued times use the server's clock
  // (the Date header is whole seconds: the server's clock is somewhere in that second, so take its middle)
  function noteDate(r) { var d = r && r.headers && r.headers.get('Date'); if (d) { var t = Date.parse(d); if (!isNaN(t)) skew = t + 500 - Date.now(); } }
  function nowIso() { return new Date(Date.now() + skew).toISOString(); }

  function push(item) {
    item.opId = item.opId || newId(); item.made = Date.now(); item.tries = 0;
    var q = get(KEY); q.push(item); put(KEY, q); changed();
    return item;
  }
  function add(crewId, type, declaration) {
    var it = { kind: 'tap', crewId: crewId, type: type, at: nowIso() };
    if (declaration) it.declaration = declaration;
    it = push(it); it.tapId = it.opId; return it;
  }
  function addEnd(crewId) { return push({ kind: 'end', crewId: crewId, at: nowIso() }); }
  function addEntry(crewId, entry) { return push({ kind: 'entry', crewId: crewId, at: entry.start, entry: entry }); }
  function addPosition(body) { return push({ kind: 'position', opId: body.id, at: body.ts, body: body }); }

  function pending(crewId) { return get(KEY).filter(function (i) { return !crewId || i.crewId === crewId; }); }
  // the latest tap or End voyage for this crew member: decides what the page shows as "now"
  function last(crewId) { var p = pending(crewId).filter(function (i) { return kindOf(i) === 'tap' || kindOf(i) === 'end'; }); return p.length ? p[p.length - 1] : null; }
  function state(crewId) {
    var l = crewId && last(crewId);
    if (!l) return null;
    return kindOf(l) === 'end' ? { mode: null, since: null, ended: true, item: l } : { mode: l.type, since: l.at, ended: false, item: l };
  }
  // withdraw an item that has not been sent yet (Undo). False if it already went.
  function remove(opId) {
    var q = get(KEY), n = q.filter(function (i) { return idOf(i) !== opId; });
    if (n.length === q.length) return false;
    put(KEY, n); changed(); return true;
  }
  function failed() { return get(FAILED); }
  function clearFailed() { put(FAILED, []); changed(); }
  function describe(i) {
    var t = new Date(i.at), hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    var k = kindOf(i);
    if (k === 'tap') return i.type.toUpperCase() + ' ' + hm;
    if (k === 'end') return 'End voyage ' + hm;
    if (k === 'entry') return (i.entry.type === 'rest' ? 'Rest' : 'Work') + ' entry from ' + hm;
    return 'Position ' + hm;
  }

  function request(item) {
    var late = item.tries > 0 || Date.now() - item.made > FRESH_MS, k = kindOf(item), c = encodeURIComponent(item.crewId || '');
    if (k === 'tap') {
      var b = { type: item.type, tapId: idOf(item) };
      if (item.declaration) b.declaration = item.declaration;
      if (late) b.at = item.at;   // a fresh first try uses the server's time
      return ['/api/crew/' + c + '/quicklog', b];
    }
    if (k === 'end') { var e = { opId: idOf(item) }; if (late) e.at = item.at; return ['/api/crew/' + c + '/voyage/end', e]; }
    if (k === 'entry') return ['/api/crew/' + c + '/entries', Object.assign({}, item.entry, { opId: idOf(item) })];
    return ['/api/positions', item.body];
  }

  // Send queued items in order. Resolves { sent: [{item, row}], failed: [{item, error}], left: n }.
  // Stops at the first item that cannot reach the server (it stays queued); a refused item moves to "not applied".
  function flush() {
    if (flushing) return flushing;
    flushing = (async function () {
      var out = { sent: [], failed: [] };
      for (;;) {
        var q = get(KEY); if (!q.length) break;
        var item = q[0], rq = request(item);
        var r = null, d = null, ac = window.AbortController ? new AbortController() : null, timer = ac && setTimeout(function () { ac.abort(); }, TIMEOUT_MS);
        try {
          r = await fetch(rq[0], { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rq[1]), signal: ac ? ac.signal : undefined });
          noteDate(r);
          try { d = await r.json(); } catch (e) {}
        } catch (e) { r = null; }   // offline, or timed out (if it did arrive, the replay is recognised by its opId)
        clearTimeout(timer);
        q = get(KEY);
        var id = idOf(item), still = q.some(function (i) { return idOf(i) === id; });
        // no reply, a gateway/tunnel error, a login prompt or rate limit: keep it and try later
        if (!r || r.status >= 500 || r.status === 401 || r.status === 408 || r.status === 429) {
          if (still) put(KEY, q.map(function (i) { if (idOf(i) === id) i.tries++; return i; }));
          break;
        }
        put(KEY, q.filter(function (i) { return idOf(i) !== id; }));
        if (r.ok) out.sent.push({ item: item, row: d || {} });
        else {
          var err = (d && d.error) || ('HTTP ' + r.status), f = get(FAILED);
          f.push({ item: item, status: r.status, error: err, code: d && d.code, at: new Date().toISOString() });
          put(FAILED, f.slice(-50)); out.failed.push({ item: item, error: err });
        }
      }
      out.left = get(KEY).length;
      flushing = null;
      if (out.sent.length || out.failed.length) changed();
      return out;
    })();
    return flushing;
  }
  // flush, then report what happened to one item: { sent: row } | { failed: error } | { queued: true }
  async function send(item) {
    var res = await flush(), id = idOf(item);
    var s = res.sent.find(function (x) { return idOf(x.item) === id; }); if (s) return { sent: s.row };
    var f = res.failed.find(function (x) { return idOf(x.item) === id; }); if (f) return { failed: f.error };
    return { queued: true };
  }

  window.addEventListener('online', function () { flush(); });
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === FAILED) changed(); });   // another page queued or sent
  document.addEventListener('visibilitychange', function () { if (!document.hidden && get(KEY).length) flush(); });
  setInterval(function () { if (get(KEY).length) flush(); }, 30000);

  window.CNTapQ = {
    add: add, addEnd: addEnd, addEntry: addEntry, addPosition: addPosition, pending: pending, last: last, state: state,
    remove: remove, flush: flush, send: send, failed: failed, clearFailed: clearFailed, describe: describe,
    noteDate: noteDate, onChange: function (f) { subs.push(f); }
  };
})();
