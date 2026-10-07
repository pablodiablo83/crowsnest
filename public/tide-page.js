// Crow's Nest - tides page: port choice (nearest first), now, curve with a time slider, HW/LW table, secondary ports.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var MIN = 60000, HOUR = 3600000, DAY = 86400000, PORT_KEY = 'cn_tidePort';
  var S = { lat: null, lon: null, ports: null, port: null, data: null, day: 0, sel: null, secs: [], editing: null, poll: null };
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
  async function loadPorts() {
    var q = S.lat != null ? '?lat=' + S.lat.toFixed(3) + '&lon=' + S.lon.toFixed(3) : '';
    S.ports = (await api('/api/tides/stations' + q)).d;
    var sel = $('portSel'), std = S.ports.standard, sec = S.ports.secondary;
    var dist = function (p) { return p.distanceNm != null ? ' · ' + Math.round(p.distanceNm) + ' nm' : ''; };
    sel.innerHTML = (sec.length ? '<optgroup label="Your secondary ports">' + sec.map(function (p) { return '<option value="sec:' + esc(p.id) + '">' + esc(p.name) + dist(p) + '</option>'; }).join('') + '</optgroup>' : '') +
      '<optgroup label="Standard ports (tide gauges)">' + std.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + dist(p) + '</option>'; }).join('') + '</optgroup>';
    $('sStd').innerHTML = std.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
    // choice: remembered, else the nearest secondary port within 5 nm, else the nearest standard port
    var saved = lsGet(PORT_KEY), all = std.map(function (p) { return p.id; }).concat(sec.map(function (p) { return 'sec:' + p.id; }));
    var near = sec.filter(function (p) { return p.distanceNm != null && p.distanceNm <= 5; })[0];
    S.port = saved && all.indexOf(saved) >= 0 ? saved : near ? 'sec:' + near.id : (std[0] ? std[0].id : 'mill');
    sel.value = S.port;
    S.secs = (await api('/api/tides/secondary')).d;
    renderSecList();
  }

  /* ---------------------------------------------------------------- predictions */
  async function load() {
    clearTimeout(S.poll);
    var from = midnight(Date.now()) - 6 * HOUR;
    var r;
    try { r = await api('/api/tides/predict?port=' + encodeURIComponent(S.port) + '&from=' + from + '&days=8'); }
    catch (e) { $('nowBox').innerHTML = '<p class="t-msg">Tide predictions unavailable (' + esc(e.message) + ').</p>'; return; }
    if (r.status === 202) {   // first use of this gauge: a year of readings is being fetched and analysed
      var d = r.d, pr = d.progress;
      $('nowBox').innerHTML = d.status === 'failed' ? '<p class="t-msg">Could not analyse ' + esc(d.station.name) + ': ' + esc(d.error || '') + '. Choose another port.</p>' :
        '<div class="t-wait"><div class="cn-wave lg" role="status" aria-label="Analysing"></div><p class="h-sub">First use of ' + esc(d.station.name) + ': reading a year of tide-gauge data and working out its tidal constants' +
        (pr ? ' (' + Math.min(pr.done, pr.total) + ' of ' + pr.total + ' months)' : '') + '. This takes about a minute, once.</p></div>';
      if (d.status !== 'failed') S.poll = setTimeout(load, 4000);
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
        return '<div class="t-ev"><div class="k">Next ' + (e.type === 'HW' ? 'high' : 'low') + ' water</div><div class="v">' + hm(e.t) + ' · ' + m2(e.h) + ' m</div><div class="s">in ' + dur(e.t - now) + '</div></div>';
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
      g += '<text class="ext" x="' + ex + '" y="' + (e.type === 'HW' ? y(e.h) - 8 : y(e.h) + 16) + '">' + hm(e.t) + ' ' + m2(e.h) + '</text>';
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
    $('about').innerHTML = (d.port.kind === 'sec' ? esc(d.port.name) + ' is predicted from ' + esc(std) + ' by the Admiralty method, using the differences you entered (' + esc(d.secondary.notes || 'your almanac') + '). ' : '') +
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
  function openForm(p) {
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
    if (!p) prefillStd();
    $('sLat').value = p && p.lat != null ? p.lat : ''; $('sLon').value = p && p.lon != null ? p.lon : ''; $('sNotes').value = p ? p.notes : '';
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
      await loadPorts(); $('portSel').value = S.port; load();
    } catch (e) { $('sErr').innerHTML = '<div class="h-err">' + esc(e.message.charAt(0).toUpperCase() + e.message.slice(1)) + '.</div>'; }
  }

  /* ---------------------------------------------------------------- events */
  $('portSel').addEventListener('change', function () { S.port = this.value; lsSet(PORT_KEY, S.port); load(); });
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
    var std = S.ports.standard[0];
    $('place').textContent = f ? 'Nearest gauge: ' + std.name + (std.distanceNm != null ? ' (' + Math.round(std.distanceNm) + ' nm)' : '') : 'No position yet: choose a port';
    load();
    setInterval(function () { if (!document.hidden && S.data) { renderNow(); renderChart(); } }, 60000);
  })();
})();
