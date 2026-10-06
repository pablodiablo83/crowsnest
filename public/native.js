// Crow's Nest - phone app only: record the vessel's position in the background while a voyage is open.
// Uses the background-geolocation plugin (iOS shows the blue location indicator while it runs). Positions go through the
// outbox, so they survive no connection. Off when this phone's setting says so (Hours of rest > Customise > This phone).
// Limits (iOS): it runs while the app is open or in the background; if the app is swiped away, it stops until reopened.
(function () {
  'use strict';
  var N = window.CNNet; if (!N || !N.isApp) return;
  var BG = N.plug('BackgroundGeolocation'); if (!BG) return;
  var watcher = null, last = null, cfg = { intervalMin: 15, voyageOpen: false };
  var KN = 1.943844;

  function enabled() { try { return localStorage.getItem('cn_bg') !== 'off'; } catch (e) { return true; } }
  function nm(a, b) {
    var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function onFix(loc, err) {
    if (err || !loc) return;
    var f = { lat: loc.latitude, lon: loc.longitude, ts: loc.time || Date.now() };
    if (last) {
      var age = f.ts - last.ts, moved = nm(last, f);
      // the timer interval, or sooner when making way (1 nm after 2 min); lying still, one an hour
      if (!(age >= cfg.intervalMin * 60000 || (age >= 120000 && moved >= 1)) || (moved < 0.1 && age < 3600000)) return;
    }
    last = f;
    var body = { id: 'b' + f.ts.toString(36) + Math.random().toString(36).slice(2, 6), ts: new Date(f.ts).toISOString(), lat: f.lat, lon: f.lon, source: 'background' };
    if (loc.accuracy != null) body.acc = Math.round(loc.accuracy);
    if (loc.speed != null && loc.speed >= 0) body.sog = Math.round(loc.speed * KN * 10) / 10;
    if (loc.bearing != null && loc.bearing >= 0) body.cog = Math.round(loc.bearing);
    window.CNTapQ.addPosition(body);
    window.CNTapQ.flush();
  }
  async function start() {
    if (watcher) return;
    watcher = 'starting';
    try {
      watcher = await BG.addWatcher({
        backgroundTitle: 'Crow’s Nest', backgroundMessage: 'Recording the voyage track',
        requestPermissions: true, stale: false, distanceFilter: 50
      }, onFix);
    } catch (e) { watcher = null; }
  }
  async function stop() {
    var w = watcher; watcher = null;
    if (w && w !== 'starting') { try { await BG.removeWatcher({ id: w }); } catch (e) {} }
  }
  async function check() {
    try {
      var r = await fetch('/api/track/status', { cache: 'no-store' });
      if (r.ok && !r.headers.get('X-CN-Cached')) { var d = await r.json(); cfg.intervalMin = d.intervalMin || 15; cfg.voyageOpen = !!d.voyageOpen; }
    } catch (e) { /* offline: keep the last known state */ }
    if (enabled() && cfg.voyageOpen) start(); else stop();
  }
  window.CNNative = { check: check, running: function () { return !!watcher; } };
  document.addEventListener('cn:tap', function () { setTimeout(check, 3000); });
  document.addEventListener('cn:voyage-end', function () { setTimeout(check, 3000); });
  setInterval(check, 5 * 60000);
  N.ready.then(check);
})();
