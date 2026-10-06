// Crow's Nest - offline queue for Work/Rest taps (shared by the dashboard and the Hours of Rest page)
// Every tap is saved on this device first, then sent. If the server cannot be reached the tap waits here and is sent,
// in order, with the time it was made, when the connection returns. The server applies each tap once (tapId).
// A queued tap that the server refuses (e.g. a later period was logged from another device) is kept as "not applied".
(function () {
  'use strict';
  var KEY = 'cn_tapq', FAILED = 'cn_tapq_failed', FRESH_MS = 30000, TIMEOUT_MS = 15000;
  var skew = 0, flushing = null, subs = [];

  function get(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function changed() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }
  function newId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  // pages call this with any server response so queued tap times use the server's clock
  function noteDate(r) { var d = r && r.headers && r.headers.get('Date'); if (d) { var t = Date.parse(d); if (!isNaN(t)) skew = t - Date.now(); } }

  function add(crewId, type, declaration) {
    var item = { tapId: newId(), crewId: crewId, type: type, at: new Date(Date.now() + skew).toISOString(), made: Date.now(), tries: 0 };
    if (declaration) item.declaration = declaration;
    var q = get(KEY); q.push(item); put(KEY, q); changed();
    return item;
  }
  function pending(crewId) { return get(KEY).filter(function (i) { return !crewId || i.crewId === crewId; }); }
  function last(crewId) { var p = pending(crewId); return p.length ? p[p.length - 1] : null; }
  // withdraw a tap that has not been sent yet (Undo). False if it already went.
  function remove(tapId) {
    var q = get(KEY), n = q.filter(function (i) { return i.tapId !== tapId; });
    if (n.length === q.length) return false;
    put(KEY, n); changed(); return true;
  }
  function failed() { return get(FAILED); }
  function clearFailed() { put(FAILED, []); changed(); }

  // Send queued taps in order. Resolves { sent: [{item, row}], failed: [{item, error}], left: n }.
  // Stops at the first tap that cannot reach the server (it stays queued); a refused tap is moved to "not applied".
  function flush() {
    if (flushing) return flushing;
    flushing = (async function () {
      var out = { sent: [], failed: [] };
      for (;;) {
        var q = get(KEY); if (!q.length) break;
        var item = q[0], body = { type: item.type, tapId: item.tapId };
        if (item.declaration) body.declaration = item.declaration;
        if (item.tries > 0 || Date.now() - item.made > FRESH_MS) body.at = item.at;   // a fresh first try uses the server's time
        var r = null, d = null, ac = window.AbortController ? new AbortController() : null, timer = ac && setTimeout(function () { ac.abort(); }, TIMEOUT_MS);
        try {
          r = await fetch('/api/crew/' + encodeURIComponent(item.crewId) + '/quicklog', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac ? ac.signal : undefined });
          noteDate(r);
          try { d = await r.json(); } catch (e) {}
        } catch (e) { r = null; }   // offline, or timed out (if it did arrive, the replay is recognised by tapId)
        clearTimeout(timer);
        q = get(KEY);
        var still = q.some(function (i) { return i.tapId === item.tapId; });
        // no reply, a gateway/tunnel error, a login prompt or rate limit: keep it and try later
        if (!r || r.status >= 500 || r.status === 401 || r.status === 408 || r.status === 429) {
          if (still) put(KEY, q.map(function (i) { if (i.tapId === item.tapId) i.tries++; return i; }));
          break;
        }
        put(KEY, q.filter(function (i) { return i.tapId !== item.tapId; }));
        if (r.ok) out.sent.push({ item: item, row: d || {} });
        else {
          var f = get(FAILED); f.push({ item: item, status: r.status, error: (d && d.error) || ('HTTP ' + r.status), code: d && d.code, at: new Date().toISOString() });
          put(FAILED, f.slice(-50)); out.failed.push({ item: item, error: (d && d.error) || ('HTTP ' + r.status) });
        }
      }
      out.left = get(KEY).length;
      flushing = null;
      if (out.sent.length || out.failed.length) changed();
      return out;
    })();
    return flushing;
  }

  window.addEventListener('online', function () { flush(); });
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === FAILED) changed(); });   // the other page queued or sent
  setInterval(function () { if (get(KEY).length) flush(); }, 30000);

  window.CNTapQ = {
    add: add, pending: pending, last: last, remove: remove, flush: flush, failed: failed, clearFailed: clearFailed,
    noteDate: noteDate, onChange: function (f) { subs.push(f); }
  };
})();
