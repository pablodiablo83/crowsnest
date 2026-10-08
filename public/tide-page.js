// Crow's Nest - tides page: port choice (nearest first), now, curve with a time slider, HW/LW table, secondary ports.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var MIN = 60000, HOUR = 3600000, DAY = 86400000, PORT_KEY = 'cn_tidePort', PLACE_KEY = 'cn_tidePlace', RECENT_KEY = 'cn_tideRecent';
  var S = { lat: null, lon: null, ports: null, port: null, place: null, data: null, day: 0, sel: null, secs: [], editing: null, poll: null };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function hm(ms) { var t = new Date(ms); return p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function dayLabel(ms) { return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function midnight(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function m2(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function dur(ms) { var m = Math.max(0, Math.round(ms / MIN)), h = Math.floor(m / 60); return (h ? h + ' h ' : '') + p2(m % 60) + ' min'; }
  function toast(t, ms) { $('toastText').textContent = t; $('toast').classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { $('toast').classList.remove('show'); }, ms || 4000); }
  async function api(path, opt) {
    opt = opt || {};
    var r = await fetch(path, { method: opt.method || 'GET', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined });
    var d = null; try { d = await r.json(); } catch (e) {}
    if (!r.ok && r.status !== 202) throw Object.assign(new Error((d && d.error) || ('failed (' + r.status + ')')), { status: r.status });
    return { status: r.status, d: d };
  }

  /* ---------------------------------------------------------------- position and ports */
  function lastFix() { try { var f = JSON.parse(lsGet('cn_fix') || 'null'); if (f && isFinite(f.lat)) return f; } catch (e) {} return null; }
  async function findPosition() {
    var f = lastFix(); if (f) return f;
    try { var r = await api('/api/positions/latest'); if (r.d && isFinite(r.d.lat)) return r.d; } catch (e) {}
    return null;
  }
  function jget(k) { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } }
  function allPorts() { return S.ports.secondary.map(function (p) { return Object.assign({ key: 'sec:' + p.id }, p); }).concat(S.ports.standard.map(function (p) { return Object.assign({ key: p.id }, p); })); }
  function portByKey(k) { return allPorts().find(function (p) { return p.key === k; }) || null; }
  async function loadPorts() {
    var q = S.lat != null ? '?lat=' + S.lat.toFixed(3) + '&lon=' + S.lon.toFixed(3) : '';
    S.ports = (await api('/api/tides/stations' + q)).d;
    var std = S.ports.standard, sec = S.ports.secondary;
    $('sStd').innerHTML = std.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
    // choice: remembered, else the nearest secondary port within 5 nm, else the nearest standard port
    var saved = lsGet(PORT_KEY), near = sec.filter(function (p) { return p.distanceNm != null && p.distanceNm <= 5; })[0];
    S.port = saved && portByKey(saved) ? saved : near ? 'sec:' + near.id : (std[0] ? std[0].id : 'mill');
    var pl = jget(PLACE_KEY); S.place = pl && pl.port === S.port ? pl : null;
    showChoice();
    S.secs = (await api('/api/tides/secondary')).d;
    renderSecList();
  }

  /* ---------------------------------------------------------------- search: places, gauges, your ports */
  var NM = function (a, b) { var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r, h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.pow(Math.sin(dLon / 2), 2); return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h))); };
  var ICON = {
    std: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M2 14c2.5-3 5-3 7.5 0s5 3 7.5 0 4-3 5-2"/><path d="M2 19c2.5-3 5-3 7.5 0s5 3 7.5 0 4-3 5-2"/><path d="M12 3v7"/></svg>',
    sec: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V21M5 13a7 7 0 0 0 14 0M8 11h8"/></svg>',
    place: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>'
  };
  var Q = { items: [], active: -1, timer: null, seq: 0 };
  function choiceName() { var p = portByKey(S.port); return S.place ? S.place.name : p ? p.name : ''; }
  function showChoice() {
    var p = portByKey(S.port); if (!p) return;
    if (document.activeElement !== $('q')) $('q').value = choiceName();
    var here = S.lat != null ? { lat: S.lat, lon: S.lon } : null, html;
    if (S.place) {
      var d = NM(S.place, p.lat != null ? p : (S.ports.standard.find(function (x) { return x.id === p.std; }) || p));
      html = p.kind === 'sec' ? 'From your secondary port <b>' + esc(p.name) + '</b> (' + Math.round(d * 10) / 10 + ' nm away), predicted from ' + esc(p.stdName || '') + '.'
        : 'From the <b>' + esc(p.name) + '</b> tide gauge, ' + Math.round(d) + ' nm away.';
      if (p.kind === 'std' && d > 5) html += '<span class="warn">Times and heights at ' + esc(S.place.name) + ' can differ from ' + esc(p.name) + '. For almanac accuracy, <button type="button" id="addPlace">add ' + esc(S.place.name) + ' as a secondary port</button>.</span>';
      $('place').textContent = S.place.name + (S.place.area ? ', ' + S.place.area : '');
    } else if (p.kind === 'sec') {
      html = 'Your secondary port, predicted from <b>' + esc(p.stdName || p.std) + '</b> by the Admiralty method' + (here && p.lat != null ? ' · ' + Math.round(NM(here, p)) + ' nm from you' : '') + '.';
      $('place').textContent = p.name;
    } else {
      html = 'Tide gauge at <b>' + esc(p.name) + '</b>' + (here ? ' · ' + Math.round(NM(here, p)) + ' nm from you' : '') + '.';
      $('place').textContent = p.name;
    }
    $('from').innerHTML = html;
    var add = $('addPlace'); if (add) add.addEventListener('click', function () { openForm(null, { name: S.place.name, std: p.id, lat: S.place.lat, lon: S.place.lon }); $('secForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  function choose(it) {
    if (it.kind === 'place') {
      S.place = { name: it.name, area: it.area, lat: it.lat, lon: it.lon };
      S.port = it.secondary ? 'sec:' + it.secondary.id : it.nearest.id;
      S.place.port = S.port; lsSet(PLACE_KEY, JSON.stringify(S.place));
      var rec = (jget(RECENT_KEY) || []).filter(function (r) { return !(r.name === it.name && Math.abs(r.lat - it.lat) < 0.01); });
      rec.unshift(it); lsSet(RECENT_KEY, JSON.stringify(rec.slice(0, 6)));
    } else { S.place = null; S.port = it.key; lsSet(PLACE_KEY, ''); }
    lsSet(PORT_KEY, S.port);
    closeList(); $('q').value = choiceName(); $('q').blur(); showChoice(); S.day = 0; load();
  }
  function useHere() {
    S.place = null; lsSet(PLACE_KEY, ''); lsSet(PORT_KEY, '');
    var go = function () { loadPorts().then(function () { var near = S.ports.secondary.filter(function (p) { return p.distanceNm != null && p.distanceNm <= 5; })[0]; S.port = near ? 'sec:' + near.id : S.ports.standard[0].id; showChoice(); load(); }); };
    if (!navigator.geolocation) return go();
    $('from').textContent = 'Finding your position…';
    navigator.geolocation.getCurrentPosition(function (p) { S.lat = p.coords.latitude; S.lon = p.coords.longitude; lsSet('cn_fix', JSON.stringify({ lat: S.lat, lon: S.lon, ts: Date.now(), source: 'gps' })); go(); }, go, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }
  function closeList() { $('qList').hidden = true; $('q').setAttribute('aria-expanded', 'false'); Q.active = -1; }
  function renderList(groups) {
    Q.items = []; var html = '';
    groups.forEach(function (g) {
      if (!g.items.length && !g.msg) return;
      html += '<li class="hd" role="presentation">' + esc(g.title) + '</li>';
      if (g.msg) html += '<li class="msg" role="presentation">' + esc(g.msg) + '</li>';
      g.items.forEach(function (it) {
        var i = Q.items.push(it) - 1;
        html += '<li role="option" id="qo' + i + '" data-i="' + i + '" aria-selected="false"><span class="ic ' + it.kind + '">' + ICON[it.kind] + '</span><div><b>' + esc(it.name) + '</b><span>' + esc(it.sub) + '</span></div></li>';
      });
    });
    $('qList').innerHTML = html || '<li class="msg" role="presentation">No matches.</li>';
    $('qList').hidden = false; $('q').setAttribute('aria-expanded', 'true'); Q.active = -1;
  }
  function portItem(p) {
    var here = S.lat != null ? { lat: S.lat, lon: S.lon } : null;
    return { kind: p.kind, key: p.kind === 'sec' ? 'sec:' + p.id : p.id, name: p.name,
      sub: (p.kind === 'sec' ? 'Your port · on ' + (p.stdName || p.std) : 'Tide gauge') + (here && p.lat != null ? ' · ' + Math.round(NM(here, p)) + ' nm' : '') };
  }
  function placeItem(pl) {
    return { kind: 'place', name: pl.name, area: pl.area, lat: pl.lat, lon: pl.lon, nearest: pl.nearest, secondary: pl.secondary,
      sub: (pl.area ? pl.area + ' · ' : '') + (pl.secondary ? 'your port ' + pl.secondary.name : 'tides from ' + pl.nearest.name + ', ' + Math.round(pl.nearest.distanceNm) + ' nm') };
  }
  function suggest() {   // empty or unchanged field: near you and recent places
    var near = allPorts().filter(function (p) { return p.distanceNm != null; }).sort(function (a, b) { return a.distanceNm - b.distanceNm; }).slice(0, 5);
    renderList([{ title: 'Recent places', items: (jget(RECENT_KEY) || []).map(placeItem) }, { title: S.lat != null ? 'Nearest to you' : 'Tide gauges', items: (near.length ? near : allPorts().slice(0, 6)).map(portItem) }]);
  }
  function search() {
    var raw = $('q').value.trim(), k = raw.toLowerCase();
    if (!k || raw === choiceName()) return suggest();
    var mine = allPorts().filter(function (p) { return p.name.toLowerCase().indexOf(k) >= 0; });
    var recent = (jget(RECENT_KEY) || []).filter(function (r) { return r.name.toLowerCase().indexOf(k) >= 0; });
    var local = [{ title: 'Your ports', items: mine.filter(function (p) { return p.kind === 'sec'; }).map(portItem) },
      { title: 'Tide gauges', items: mine.filter(function (p) { return p.kind === 'std'; }).slice(0, 5).map(portItem) }];
    var seq = ++Q.seq;
    renderList([{ title: 'Places', items: recent.map(placeItem), msg: k.length >= 3 ? 'Searching places…' : '' }].concat(local));
    clearTimeout(Q.timer);
    if (k.length < 3) return;
    Q.timer = setTimeout(async function () {
      var places = [], msg = '';
      try { var r = await api('/api/tides/search?q=' + encodeURIComponent(raw)); places = r.d.places || []; if (r.d.placesError) msg = 'Place search unavailable just now: gauges and your ports still work.'; }
      catch (e) { msg = 'Place search needs a connection: gauges and your ports still work offline.'; }
      if (seq !== Q.seq) return;
      var seen = {}, items = places.map(placeItem).concat(recent.map(placeItem)).filter(function (it) { var key = it.name + it.lat.toFixed(2); if (seen[key]) return false; seen[key] = 1; return true; });
      renderList([{ title: 'Places', items: items, msg: msg || (items.length ? '' : 'No coastal place called “' + raw + '” found.') }].concat(local));
    }, 280);
  }
  function move(dir) {
    if (!Q.items.length) return;
    Q.active = (Q.active + dir + Q.items.length) % Q.items.length;
    [].forEach.call($('qList').querySelectorAll('[role=option]'), function (li) { li.setAttribute('aria-selected', String(+li.getAttribute('data-i') === Q.active)); });
    var el = $('qo' + Q.active); if (el) { el.scrollIntoView({ block: 'nearest' }); $('q').setAttribute('aria-activedescendant', el.id); }
  }
  $('q').addEventListener('focus', function () { var q = this; setTimeout(function () { q.select(); }, 0); suggest(); });
  $('q').addEventListener('input', search);
  $('q').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if ($('qList').hidden) search(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); var it = Q.items[Q.active >= 0 ? Q.active : 0]; if (it) choose(it); }
    else if (e.key === 'Escape') { e.preventDefault(); closeList(); this.value = choiceName(); this.blur(); }
  });
  $('q').addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== $('q')) { closeList(); $('q').value = choiceName(); } }, 180); });
  $('qList').addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep focus while tapping a result
  $('qList').addEventListener('click', function (e) { var li = e.target.closest('[data-i]'); if (li) choose(Q.items[+li.getAttribute('data-i')]); });
  $('qHere').addEventListener('click', useHere);

  /* ---------------------------------------------------------------- predictions */
  async function load() {
    clearTimeout(S.poll);
    var from = midnight(Date.now()) - 6 * HOUR;
    var r;
    try { r = await api('/api/tides/predict?port=' + encodeURIComponent(S.port) + '&from=' + from + '&days=8'); }
    catch (e) { $('nowBox').innerHTML = '<p class="t-msg">Tide predictions unavailable (' + esc(e.message) + ').</p>'; return; }
    if (r.status === 202) {   // first use of this gauge: a year of readings is being fetched and analysed
      var d = r.d, pr = d.progress;
      $('nowBox').innerHTML = d.status === 'failed' ? '<p class="t-msg">Could not read the ' + esc(d.station.name) + ' gauge data: ' + esc(d.error || 'unknown error') + '.</p><div class="h-actions"><button type="button" class="h-btn ghost" id="tRetry">Try again</button></div>' :
        '<div class="t-wait"><div class="cn-wave lg" role="status" aria-label="Analysing"></div><p class="h-sub">First use of ' + esc(d.station.name) + ': reading a year of tide-gauge data and working out its tidal constants' +
        (pr ? ' (' + Math.min(pr.done, pr.total) + ' of ' + pr.total + ' months)' : '') + '. This takes about a minute, once.</p></div>';
      if (d.status !== 'failed') S.poll = setTimeout(load, 4000);
      else $('tRetry').addEventListener('click', async function () { try { await api('/api/tides/analyse/' + encodeURIComponent(d.station.code), { method: 'POST' }); } catch (e) {} load(); });
      return;
    }
    S.data = r.d;
    buildDays(); renderNow(); renderTable(); renderAbout();
    if (S.sel == null || S.day === 0) { var now = Date.now(); S.sel = Math.round((now - midnight(now)) / (10 * MIN)); }
    renderChart();
  }
  function heightAt(t) {   // linear between the 10-minute curve points
    var c = S.data.curve;
    for (var i = 1; i < c.length; i++) if (c[i][0] >= t) { var a = c[i - 1], b = c[i], f = (t - a[0]) / (b[0] - a[0]); return { h: a[1] + f * (b[1] - a[1]), rising: b[1] > a[1] }; }
    return null;
  }
  function renderNow() {
    var d = S.data, now = Date.now(), cur = heightAt(now), next = d.extremes.filter(function (e) { return e.t > now; });
    var nhw = next.filter(function (e) { return e.type === 'HW'; })[0], nlw = next.filter(function (e) { return e.type === 'LW'; })[0];
    var L = d.levels, spring = L.MHWS - L.MLWS, today = d.extremes.filter(function (e) { return e.t >= now - 13 * HOUR && e.t <= now + 13 * HOUR; });
    var hi = Math.max.apply(null, today.filter(function (e) { return e.type === 'HW'; }).map(function (e) { return e.h; }).concat([-99]));
    var lo = Math.min.apply(null, today.filter(function (e) { return e.type === 'LW'; }).map(function (e) { return e.h; }).concat([99]));
    var range = hi > -99 && lo < 99 ? hi - lo : null, pct = range ? Math.round(range / spring * 100) : null;
    var neap = L.MHWN - L.MLWN, phase = range == null ? '' : range >= spring * 0.92 ? 'Springs' : range <= neap * 1.08 ? 'Neaps' : (isRisingRange() ? 'Building to springs' : 'Easing to neaps');
    $('nowBox').innerHTML = (cur ? '<div class="t-now" style="margin-top:12px"><div class="t-big">' + cur.h.toFixed(1) + '<small>m</small></div><div><div class="t-dir">' + (cur.rising ? '↑ Rising' : '↓ Falling') + '</div><div class="h-sub">' + esc(d.datum.label) + ' now, ' + hm(now) + '</div></div></div>' : '') +
      '<div class="t-next">' + [nhw, nlw].filter(Boolean).sort(function (a, b) { return a.t - b.t; }).map(function (e) {
        return '<div class="t-ev' + (e.type === 'HW' ? ' hw' : '') + '"><div class="k">Next ' + (e.type === 'HW' ? 'high' : 'low') + ' water</div><div class="v">' + hm(e.t) + ' · ' + m2(e.h) + ' m</div><div class="s">in ' + dur(e.t - now) + '</div></div>';
      }).join('') + '</div>' +
      (pct != null ? '<div class="t-sn"><div class="bar"><i style="width:' + Math.min(100, pct) + '%"></i></div><div class="lab"><span><b>' + phase + '</b> · range ' + m2(range) + ' m</span><span>' + pct + '% of spring range</span></div></div>' : '');
  }
  function isRisingRange() {   // is the daily range growing (towards springs)?
    var e = S.data.extremes, now = Date.now(), r = function (a, b) { var x = e.filter(function (q) { return q.t >= a && q.t < b; }); var h = x.filter(function (q) { return q.type === 'HW'; }).map(function (q) { return q.h; }), l = x.filter(function (q) { return q.type === 'LW'; }).map(function (q) { return q.h; }); return h.length && l.length ? Math.max.apply(null, h) - Math.min.apply(null, l) : null; };
    var a = r(now - 13 * HOUR, now + 13 * HOUR), b = r(now + 35 * HOUR, now + 61 * HOUR);
    return a != null && b != null && b > a;
  }
  function buildDays() {
    var html = '', t0 = midnight(Date.now());
    for (var i = 0; i < 7; i++) {
      var t = t0 + i * DAY + 2 * HOUR;   // (DST-safe label)
      html += '<button type="button" data-d="' + i + '" aria-pressed="' + (i === S.day) + '">' + (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })) + '</button>';
    }
    $('days').innerHTML = html;
  }

  /* ---------------------------------------------------------------- chart */
  function dayStart() { var d = new Date(midnight(Date.now())); d.setDate(d.getDate() + S.day); return d.getTime(); }
  function renderChart() {
    var svg = $('chart'), W = svg.clientWidth || 360, H = 230, padL = 30, padR = 8, padT = 22, padB = 22;
    var t0 = dayStart(), t1 = t0 + DAY, d = S.data, L = d.levels;
    var pts = d.curve.filter(function (p) { return p[0] >= t0 - 30 * MIN && p[0] <= t1 + 30 * MIN; });
    if (!pts.length) { svg.innerHTML = ''; return; }
    var top = Math.max(L.HAT || 0, Math.max.apply(null, pts.map(function (p) { return p[1]; }))) + 0.3, bot = Math.min(0, Math.min.apply(null, pts.map(function (p) { return p[1]; })) - 0.2);
    var x = function (t) { return padL + (t - t0) / DAY * (W - padL - padR); }, y = function (h) { return padT + (top - h) / (top - bot) * (H - padT - padB); };
    var g = '<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#28A7C4" stop-opacity=".45"/><stop offset="1" stop-color="#28A7C4" stop-opacity=".04"/></linearGradient></defs>';
    for (var m = Math.ceil(bot); m <= top; m++) g += '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(m) + '" y2="' + y(m) + '"/><text class="ax" x="' + (padL - 6) + '" y="' + (y(m) + 4) + '" text-anchor="end">' + m + '</text>';
    for (var hh = 0; hh <= 24; hh += 3) { var tx = x(t0 + hh * HOUR); g += '<line class="grid" x1="' + tx + '" x2="' + tx + '" y1="' + padT + '" y2="' + (H - padB) + '"/><text class="ax" x="' + tx + '" y="' + (H - 6) + '" text-anchor="middle">' + p2(hh) + '</text>'; }
    [['MHWS', L.MHWS], ['MLWS', L.MLWS]].forEach(function (r) { if (r[1] != null) g += '<line class="ref" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(r[1]) + '" y2="' + y(r[1]) + '"/><text class="refl" x="' + (W - padR - 2) + '" y="' + (y(r[1]) - 3) + '" text-anchor="end">' + r[0] + '</text>'; });
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join(' ');
    g += '<path class="area" d="' + path + ' L' + x(pts[pts.length - 1][0]).toFixed(1) + ' ' + (H - padB) + ' L' + x(pts[0][0]).toFixed(1) + ' ' + (H - padB) + 'Z"/>';
    g += '<path class="curve" d="' + path + '"/>';
    d.extremes.filter(function (e) { return e.t >= t0 && e.t < t1; }).forEach(function (e) {
      var ex = Math.min(W - padR - 24, Math.max(padL + 24, x(e.t)));
      var cls = e.type === 'HW' ? ' hw' : '';
      g += '<circle class="exd' + cls + '" cx="' + x(e.t).toFixed(1) + '" cy="' + y(e.h).toFixed(1) + '" r="4"/>' +
        '<text class="ext' + cls + '" x="' + ex + '" y="' + (e.type === 'HW' ? y(e.h) - 9 : y(e.h) + 18) + '">' + hm(e.t) + ' ' + m2(e.h) + '</text>';
    });
    var now = Date.now(); if (now >= t0 && now < t1) g += '<line class="nowl" x1="' + x(now) + '" x2="' + x(now) + '" y1="' + padT + '" y2="' + (H - padB) + '"/>';
    var ts = t0 + S.sel * 10 * MIN, hs = heightAt(ts);
    if (hs) g += '<line class="sel" x1="' + x(ts) + '" x2="' + x(ts) + '" y1="' + padT + '" y2="' + (H - padB) + '"/><circle class="seld" cx="' + x(ts) + '" cy="' + y(hs.h) + '" r="6"/>';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '<desc id="chartDesc">Height of tide through ' + esc(dayLabel(t0 + HOUR)) + '</desc>' + g;
    $('tslider').value = String(S.sel);
    $('readH').textContent = hs ? hs.h.toFixed(2) + ' m' : '—';
    $('readT').textContent = hs ? hm(ts) + ' ' + dayLabel(ts) + ' · ' + (hs.rising ? 'rising' : 'falling') + ' · ' + S.data.datum.label : '';
    S.chart = { x0: padL, w: W - padL - padR };
  }
  function pickFromChart(ev) {
    var r = $('chart').getBoundingClientRect(), c = S.chart; if (!c) return;
    var px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left, f = (px * ((($('chart').viewBox.baseVal || {}).width || r.width) / r.width) - c.x0) / c.w;
    S.sel = Math.max(0, Math.min(143, Math.round(f * 144))); renderChart();
  }

  /* ---------------------------------------------------------------- table */
  function renderTable() {
    var d = S.data, now = Date.now(), t0 = midnight(now), rows = '', day = '', isSec = d.port.kind === 'sec';
    d.extremes.filter(function (e) { return e.t >= t0 && e.t < t0 + 7 * DAY; }).forEach(function (e) {
      var dl = dayLabel(e.t);
      if (dl !== day) { day = dl; rows += '<tr class="day"><td colspan="3">' + esc(dl) + '</td></tr>'; }
      var det = isSec && e.std ? '<span class="det">' + esc(d.port.std.name) + ' ' + hm(e.std.t) + ' ' + m2(e.std.h) + ' m, ' + (e.dt >= 0 ? '+' : '−') + Math.abs(e.dt) + ' min, ' + (e.dh >= 0 ? '+' : '−') + Math.abs(e.dh).toFixed(2) + ' m</span>' : '';
      rows += '<tr class="' + (e.t < now ? 'past' : '') + '"><td class="' + (e.type === 'HW' ? 'hw' : '') + '">' + (e.type === 'HW' ? 'High' : 'Low') + '</td><td>' + hm(e.t) + det + '</td><td>' + m2(e.h) + ' m</td></tr>';
    });
    $('table').innerHTML = '<thead><tr><th>Water</th><th>Time</th><th>Height</th></tr></thead><tbody>' + rows + '</tbody>';
    $('tableSub').textContent = 'Next 7 days, your local time. Heights ' + d.datum.label + '.';
  }
  function renderAbout() {
    var d = S.data, q = d.quality, std = d.port.kind === 'sec' ? d.port.std.name : d.port.name;
    $('about').innerHTML = (S.place && d.port.kind === 'std' ? esc(S.place.name) + ' has no tide gauge: these are ' + esc(d.port.name) + '’s tides, the nearest gauge. Place search: GeoNames via Open-Meteo (CC BY 4.0). ' : '') + (d.port.kind === 'sec' ? esc(d.port.name) + ' is predicted from ' + esc(std) + ' by the Admiralty method, using the differences you entered (' + esc(d.secondary.notes || 'your almanac') + '). ' : '') +
      esc(std) + ' predictions come from ' + q.days + ' days of its tide-gauge record (' + q.readings.toLocaleString('en-GB') + ' readings, UK National Tide Gauge Network via the IOC), analysed into tidal constants on ' + new Date(q.analysedAt).toLocaleDateString('en-GB') + '. ' +
      'Fit to the record: ' + Math.round(q.rmsM * 100) + ' cm, which is mostly weather. ' + esc(d.datum.note) + ' ' +
      '<b>Astronomical tide only:</b> wind and pressure can raise or lower the sea by 0.3 m or more and shift times. Not an official tide table: for navigation, check against the Admiralty Tide Tables or your almanac.';
  }

  /* ---------------------------------------------------------------- secondary ports */
  var LV = [['MHWS', 'MHWS'], ['MHWN', 'MHWN'], ['MLWN', 'MLWN'], ['MLWS', 'MLWS']];
  function renderSecList() {
    $('secList').innerHTML = S.secs.length ? S.secs.map(function (p) {
      return '<li><div><b>' + esc(p.name) + '</b><span>on ' + esc((S.ports.standard.find(function (s) { return s.id === p.std; }) || {}).name || p.std) + (p.notes ? ' · ' + esc(p.notes) : '') + '</span></div><button type="button" class="h-link" data-edit="' + esc(p.id) + '">Edit</button></li>';
    }).join('') : '<li><span>None yet.</span></li>';
  }
  function diffText(min) { var a = Math.abs(min); return (min < 0 ? '-' : '+') + p2(Math.floor(a / 60)) + p2(a % 60); }
  function parseDiff(s) {   // "+0010", "-0:15", "-15", "+1:05" -> minutes
    var m = String(s || '').trim().replace(/[−–]/g, '-').match(/^([+-]?)(\d{1,2})?:?(\d{2})$|^([+-]?)(\d{1,3})$/);
    if (!m) return NaN;
    if (m[5] != null) return (m[4] === '-' ? -1 : 1) * +m[5];
    return (m[1] === '-' ? -1 : 1) * ((+m[2] || 0) * 60 + +m[3]);
  }
  function openForm(p, pre) {   // pre: { name, std, lat, lon } from a searched place
    S.editing = p ? p.id : null;
    $('secForm').hidden = false; $('secAdd').hidden = true; $('sDel').hidden = !p; $('sErr').innerHTML = '';
    var std = p ? p.std : (S.data && S.data.port.kind === 'std' ? S.data.port.id : $('sStd').value);
    $('sName').value = p ? p.name : ''; $('sStd').value = std;
    var hw = p ? p.hwTimes : [['0000', ''], ['0600', '']], lw = p ? p.lwTimes : [['0000', ''], ['0600', '']];
    $('hw1t').value = hw[0][0]; $('hw1d').value = p ? diffText(hw[0][1]) : ''; $('hw2t').value = hw[1][0]; $('hw2d').value = p ? diffText(hw[1][1]) : '';
    $('lw1t').value = lw[0][0]; $('lw1d').value = p ? diffText(lw[0][1]) : ''; $('lw2t').value = lw[1][0]; $('lw2d').value = p ? diffText(lw[1][1]) : '';
    $('lvGrid').innerHTML = LV.map(function (k) {
      return '<div class="h-fld"><label for="sl' + k[0] + '">' + k[1] + ' (std)</label><input class="h-in" id="sl' + k[0] + '" inputmode="decimal" value="' + (p ? p.stdLevels[k[0]] : '') + '"></div>' +
        '<div class="h-fld"><label for="sd' + k[0] + '">difference</label><input class="h-in" id="sd' + k[0] + '" inputmode="decimal" placeholder="-0.3" value="' + (p ? (p.diffs[k[0]] >= 0 ? '+' : '') + p.diffs[k[0]] : '') + '"></div>';
    }).join('');
    if (pre) { $('sName').value = pre.name; $('sStd').value = pre.std; }
    if (!p) prefillStd();
    $('sLat').value = p && p.lat != null ? p.lat : pre ? pre.lat.toFixed(4) : ''; $('sLon').value = p && p.lon != null ? p.lon : pre ? pre.lon.toFixed(4) : ''; $('sNotes').value = p ? p.notes : '';
    $('sName').focus();
  }
  async function prefillStd() {   // suggest the standard port's heights from its analysis; the almanac's own figures are better
    try {
      var r = await api('/api/tides/predict?port=' + encodeURIComponent($('sStd').value) + '&days=1');
      if (r.status === 200) LV.forEach(function (k) { var el = $('sl' + k[0]); if (el && !el.value) el.value = r.d.levels[k[0]].toFixed(1); });
    } catch (e) {}
  }
  function closeForm() { $('secForm').hidden = true; $('secAdd').hidden = false; S.editing = null; }
  async function saveForm(ev) {
    ev.preventDefault();
    var num = function (id) { return parseFloat(String($(id).value).replace(/[−–]/g, '-').replace('+', '')); };
    var body = {
      name: $('sName').value.trim(), std: $('sStd').value, lat: $('sLat').value.trim(), lon: $('sLon').value.trim(), notes: $('sNotes').value.trim(),
      hwTimes: [[$('hw1t').value.trim(), parseDiff($('hw1d').value)], [$('hw2t').value.trim(), parseDiff($('hw2d').value)]],
      lwTimes: [[$('lw1t').value.trim(), parseDiff($('lw1d').value)], [$('lw2t').value.trim(), parseDiff($('lw2d').value)]],
      stdLevels: {}, diffs: {}
    };
    LV.forEach(function (k) { body.stdLevels[k[0]] = num('sl' + k[0]); body.diffs[k[0]] = num('sd' + k[0]); });
    if ([body.hwTimes, body.lwTimes].some(function (x) { return x.some(function (y) { return !isFinite(y[1]); }); })) { $('sErr').innerHTML = '<div class="h-err">Time differences like +0010 or -0015.</div>'; return; }
    try {
      var r = await api('/api/tides/secondary' + (S.editing ? '/' + S.editing : ''), { method: S.editing ? 'PUT' : 'POST', body: body });
      S.secs = (await api('/api/tides/secondary')).d;
      closeForm(); toast(r.d.name + ' saved');
      S.port = 'sec:' + r.d.id; lsSet(PORT_KEY, S.port);
      S.place = null; lsSet(PLACE_KEY, '');
      await loadPorts(); load();
    } catch (e) { $('sErr').innerHTML = '<div class="h-err">' + esc(e.message.charAt(0).toUpperCase() + e.message.slice(1)) + '.</div>'; }
  }

  /* ---------------------------------------------------------------- events */
  $('days').addEventListener('click', function (e) { var b = e.target.closest('button[data-d]'); if (!b) return; S.day = +b.getAttribute('data-d'); buildDays(); if (S.day !== 0) S.sel = 72; renderChart(); });
  $('tslider').addEventListener('input', function () { S.sel = +this.value; renderChart(); });
  $('chart').addEventListener('click', pickFromChart);
  $('chart').addEventListener('touchmove', function (e) { pickFromChart(e); }, { passive: true });
  $('secAdd').addEventListener('click', function () { openForm(null); });
  $('sCancel').addEventListener('click', closeForm);
  $('sStd').addEventListener('change', function () { LV.forEach(function (k) { $('sl' + k[0]).value = ''; }); prefillStd(); });
  $('secForm').addEventListener('submit', saveForm);
  $('sDel').addEventListener('click', async function () {
    if (!S.editing || !window.confirm('Delete this secondary port?')) return;
    await api('/api/tides/secondary/' + S.editing, { method: 'DELETE' });
    S.secs = (await api('/api/tides/secondary')).d; closeForm();
    if (S.port === 'sec:' + S.editing) { S.port = S.ports.standard[0].id; lsSet(PORT_KEY, S.port); }
    await loadPorts(); load();
  });
  $('sHere').addEventListener('click', function () { if (S.lat != null) { $('sLat').value = S.lat.toFixed(4); $('sLon').value = S.lon.toFixed(4); } });
  $('secList').addEventListener('click', function (e) { var b = e.target.closest('[data-edit]'); if (b) openForm(S.secs.find(function (p) { return p.id === b.getAttribute('data-edit'); })); });
  window.addEventListener('resize', function () { if (S.data) renderChart(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.data) load(); });

  (async function start() {
    var f = await findPosition();
    if (f) { S.lat = f.lat; S.lon = f.lon; }
    try { await loadPorts(); } catch (e) { $('nowBox').innerHTML = '<p class="t-msg">Ports unavailable (' + esc(e.message) + ').</p>'; return; }
    load();
    setInterval(function () { if (!document.hidden && S.data) { renderNow(); renderChart(); } }, 60000);
  })();
})();
