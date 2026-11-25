// Crow's Nest black box recorder (client, 25 Nov 2026). Loaded on every page. Records the device's own state into a queue in
// localStorage (cn_bb_q) and uploads it to the server automatically (POST /api/blackbox), so a copy exists off the phone if something
// goes wrong. Records: start (page opened), pos (every minute the position changes: lat, lon, sog, cog, accuracy), state (every 5 min:
// online, battery, queue sizes, page), net (online/offline), vis (app to background / foreground), err (script errors, failed API calls),
// note (typed on the Black box page). Nothing leaves the user's own server. Never throws into the page. window.CNBlackBox = { note, flush, status }.
(function () {
  'use strict';
  if (window.CNBlackBox) return;
  var BGK = 'cn_bb_bg', QK = 'cn_bb_q', DK = 'cn_bb_dev', OFF = 'cn_bb_off', LASTUP = 'cn_bb_up', LASTPOS = 'cn_bb_pos', DROPS = 'cn_bb_drop', LASTERR = 'cn_bb_err';
  var MAXQ = 3000, BATCH = 150, inflight = false, seq = 0, lastKey = '';
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function dev() { var d = ls(DK); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 8) + (Date.now() % 1679616).toString(36); ls(DK, d); } return d; }
  function queue() { try { var q = JSON.parse(ls(QK) || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
  function save(q) {
    if (q.length > MAXQ) { ls(DROPS, String((+ls(DROPS) || 0) + q.length - MAXQ)); q = q.slice(q.length - MAXQ); }
    try { localStorage.setItem(QK, JSON.stringify(q)); } catch (e) { try { localStorage.setItem(QK, JSON.stringify(q.slice(-300))); } catch (e2) {} }
  }
  function on() { return ls(OFF) !== '1'; }
  function page() { return (location.pathname || '/').replace(/^\//, '') || 'dashboard'; }
  function rec(k, d) {
    try {
      if (!on()) return;
      var t = Date.now(), q = queue();
      q.push({ id: dev() + '-' + t.toString(36) + '-' + (seq++).toString(36) + Math.random().toString(36).slice(2, 4), t: t, k: k, d: d || {} });
      save(q);
      if (q.length >= BATCH || k === 'err' || k === 'note') setTimeout(flush, k === 'err' ? 2000 : 200);
    } catch (e) {}
  }
  function fix() { try { var f = JSON.parse(ls('cn_fix') || 'null'); return f && isFinite(f.lat) && isFinite(f.lon) ? f : null; } catch (e) { return null; } }
  function round(v, n) { return v == null || !isFinite(v) ? undefined : Math.round(v * Math.pow(10, n)) / Math.pow(10, n); }

  // a fix handed over by the phone app's background tracker (native.js): recorded at most once a minute, uploaded at once
  function pos(f) {
    if (!f || !isFinite(f.lat) || !isFinite(f.lon)) return;
    if (Date.now() - (+ls(LASTPOS) || 0) < 55000) return;
    ls(LASTPOS, String(Date.now())); lastKey = f.lat + ',' + f.lon + ',' + (f.ts || '');
    rec('pos', { lat: round(f.lat, 5), lon: round(f.lon, 5), sog: round(f.sog, 1), cog: round(f.cog, 0), acc: round(f.acc, 0), src: f.source || 'background' });
    flush();
  }
  // phone app only: keep the location tracker running in the background even with no voyage open, so the black box keeps recording (default on)
  function bgWanted() { return on() && ls(BGK) !== '0'; }

  // ---- position: whenever the app's fix is newer than the last one recorded (at most once a minute across tabs)
  function samplePos() {
    var f = fix(); if (!f) return;
    var key = f.lat + ',' + f.lon + ',' + (f.ts || '');
    if (key === lastKey) return;
    if (Date.now() - (+ls(LASTPOS) || 0) < 55000) return;
    lastKey = key; ls(LASTPOS, String(Date.now()));
    rec('pos', { lat: round(f.lat, 5), lon: round(f.lon, 5), sog: round(f.sog, 1), cog: round(f.cog, 0), acc: round(f.acc != null ? f.acc : f.accuracy, 0), src: f.source || undefined, fixAgeS: f.ts ? Math.round((Date.now() - f.ts) / 1000) : undefined });
  }
  function sampleState() {
    var d = { online: navigator.onLine !== false, page: page(), queued: queue().length };
    try { d.tapq = JSON.parse(ls('cn_tapq') || '[]').length; d.tapFailed = JSON.parse(ls('cn_tapq_failed') || '[]').length; d.posq = JSON.parse(ls('cn_posq') || '[]').length; } catch (e) {}
    var up = +ls(LASTUP) || 0; if (up) d.lastUploadAgoS = Math.round((Date.now() - up) / 1000);
    var dr = +ls(DROPS) || 0; if (dr) d.dropped = dr;
    if (navigator.getBattery) { navigator.getBattery().then(function (b) { d.battery = Math.round(b.level * 100); d.charging = b.charging; rec('state', d); }, function () { rec('state', d); }); } else rec('state', d);
  }

  // ---- upload: oldest 150 first; a stored (or duplicate) answer removes them; offline or a failure keeps them for next time
  function flush() {
    if (inflight || !on() || navigator.onLine === false) return Promise.resolve(false);
    var q = queue(); if (!q.length) return Promise.resolve(true);
    var batch = q.slice(0, BATCH); inflight = true;
    return fetch('/api/blackbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: dev(), records: batch }), keepalive: JSON.stringify(batch).length < 60000, credentials: 'same-origin' })
      .then(function (r) {
        // 400 = the server refused these records for good (shape); 401/403/5xx/429 = try again later
        if (r.ok || r.status === 400) { var gone = {}; batch.forEach(function (b) { gone[b.id] = 1; }); save(queue().filter(function (x) { return !gone[x.id]; })); if (r.ok) ls(LASTUP, String(Date.now())); return r.ok; }
        return false;
      }).catch(function () { return false; }).then(function (ok) { inflight = false; if (ok && queue().length >= BATCH) return flush(); return ok; });
  }

  function status() { return { on: on(), device: dev(), queued: queue().length, lastUpload: +ls(LASTUP) || 0, dropped: +ls(DROPS) || 0, online: navigator.onLine !== false }; }
  window.CNBlackBox = { pos: pos, bgWanted: bgWanted, setBg: function (v) { ls(BGK, v ? null : '0'); if (window.CNNative) window.CNNative.check(); }, bg: function () { return ls(BGK) !== '0'; }, note: function (text) { rec('note', { msg: String(text || '').slice(0, 500) }); return flush(); }, flush: flush, status: status, on: on, set: function (v) { ls(OFF, v ? null : '1'); rec(v ? 'rec-on' : 'rec-off', {}); if (v) flush(); } };

  // ---- events
  window.addEventListener('error', function (e) { rec('err', { msg: String(e.message || 'error').slice(0, 200), src: String(e.filename || '').replace(/^.*\//, '').slice(0, 60), line: e.lineno, page: page() }); });
  window.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; if (r && /Transition was (aborted|skipped)|AbortError/.test(String(r.message || r))) return; rec('err', { msg: String((r && r.message) || r || 'rejected promise').slice(0, 200), kind: 'promise', page: page() }); });
  window.addEventListener('online', function () { rec('net', { online: true }); setTimeout(flush, 1500); });
  window.addEventListener('offline', function () { rec('net', { online: false }); });
  document.addEventListener('visibilitychange', function () { rec('vis', { visible: !document.hidden, page: page() }); if (document.hidden) flush(); });
  window.addEventListener('pagehide', function () { flush(); });
  // failed API calls (not the recorder's own, at most one record per path every 30 s)
  var ofetch = window.fetch, recent = {};
  if (typeof ofetch === 'function') window.fetch = function (input, init) {
    var url = ''; try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
    var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    var track = /^\/api\//.test(path) && path.indexOf('/api/blackbox') !== 0;
    var p = ofetch.apply(this, arguments);
    if (!track) return p;
    return p.then(function (r) { if (r && r.status >= 500) note(path, r.status); return r; }, function (e) { note(path, 'network'); throw e; });
  };
  function note(path, why) { var n = Date.now(); if (recent[path] && n - recent[path] < 30000) return; recent[path] = n; rec('err', { msg: 'api ' + path + ' ' + why, kind: 'api', page: page() }); }

  // ---- start
  rec('start', { page: page(), online: navigator.onLine !== false, ua: String(navigator.userAgent || '').slice(0, 140), native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) });
  setTimeout(samplePos, 3000); setInterval(samplePos, 20000);
  setTimeout(sampleState, 8000); setInterval(sampleState, 5 * 60000);
  setTimeout(flush, 5000); setInterval(flush, 15000);
})();
