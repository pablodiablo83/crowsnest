// Crow's Nest - wind page: hourly forecast from a chosen model, a dial for any chosen time, and a side-by-side of models.
// Arrows point DOWNWIND (the way the wind blows); "From SW" names where it comes from (meteorological direction).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var HOUR = 3600000;
  var MODEL_KEY = 'cn_windModel';
  var S = { lat: null, lon: null, data: null, idx: 0, rows: [], cmp: null, cmpFor: null };

  // Beaufort scale (knots, upper bound inclusive) - WMO
  var BFT = [[0, 'Calm'], [3, 'Light air'], [6, 'Light breeze'], [10, 'Gentle breeze'], [16, 'Moderate breeze'], [21, 'Fresh breeze'],
    [27, 'Strong breeze'], [33, 'Near gale'], [40, 'Gale'], [47, 'Strong gale'], [55, 'Storm'], [63, 'Violent storm'], [Infinity, 'Hurricane force']];
  function beaufort(kn) { var k = Math.round(kn); for (var i = 0; i < BFT.length; i++) if (k <= BFT[i][0]) return { force: i, name: BFT[i][1] }; return { force: 12, name: 'Hurricane force' }; }
  // colour bands (knots) for a quick read of the table, sailing-oriented
  var BANDS = [[4, '#B9E3F2'], [10, '#7FD3E6'], [16, '#8FE3B0'], [21, '#F2E36B'], [27, '#F5B041'], [33, '#FF8A7A'], [40, '#E879B0'], [Infinity, '#B58CFF']];
  function colour(kn) { for (var i = 0; i < BANDS.length; i++) if (kn <= BANDS[i][0]) return BANDS[i][1]; return BANDS[BANDS.length - 1][1]; }
  var DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(d) { return d == null ? '—' : DIRS[Math.round(d / 22.5) % 16]; }
  function r(v) { return v == null ? '—' : String(Math.round(v)); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function hm(ms) { var t = new Date(ms); return p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function dayLabel(ms) { return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function rel(ms) {
    var h = Math.round((ms - Date.now()) / HOUR);
    if (h === 0) return 'now';
    return h > 0 ? 'in ' + (h < 48 ? h + ' h' : Math.round(h / 24) + ' days') : Math.abs(h) + ' h ago';
  }
  // small downwind arrow, rotated to the wind
  function arrowSvg(dir, size, fill) {
    if (dir == null) return '';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(' + ((dir + 180) % 360) + 'deg)">' +
      '<path d="M12 2 L19 11 L14 10 L14 22 L10 22 L10 10 L5 11 Z" fill="' + (fill || '#fff') + '"/></svg>';
  }

  /* ---------------------------------------------------------------- position */
  function lastFix() { try { var f = JSON.parse(lsGet('cn_fix') || 'null'); if (f && isFinite(f.lat) && isFinite(f.lon)) return f; } catch (e) {} return null; }
  async function findPosition() {
    var f = lastFix();
    if (f) return { lat: f.lat, lon: f.lon, how: f.source === 'gps' ? 'your position' : 'last known position' };
    try {
      var r = await fetch('/api/positions/latest', { cache: 'no-store' });
      if (r.ok) { var p = await r.json(); if (p && isFinite(p.lat)) return { lat: p.lat, lon: p.lon, how: 'vessel’s last recorded position' }; }
    } catch (e) {}
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(function (p) { resolve({ lat: p.coords.latitude, lon: p.coords.longitude, how: 'your position' }); },
        function () { resolve(null); }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
    });
  }
  function ddm(v, pos, neg) { var a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return d + '°' + m.toFixed(1).padStart(4, '0') + '′' + (v >= 0 ? pos : neg); }

  /* ---------------------------------------------------------------- data */
  function model() { return lsGet(MODEL_KEY) || ''; }
  async function load() {
    var msg = $('msg'); msg.hidden = true;
    var url = '/api/wind?lat=' + S.lat.toFixed(3) + '&lon=' + S.lon.toFixed(3) + '&days=7' + (model() ? '&model=' + encodeURIComponent(model()) : '');
    var d = null;
    try {
      var r = await fetch(url, { cache: 'no-store' });
      d = await r.json();
      if (!r.ok || d.error) throw Object.assign(new Error((d && (d.detail || d.error)) || 'unavailable'), { data: d });
    } catch (e) {
      if (e.data && e.data.models) fillModels(e.data.models, e.data.model);
      msg.textContent = 'Wind forecast unavailable' + (e.message ? ' (' + e.message + ')' : '') + '. ' + (S.data ? 'Showing the last forecast.' : 'Try again when connected, or pick another model.');
      msg.hidden = false;
      if (!S.data) return;
      d = S.data;
    }
    S.data = d; S.cmp = null; S.cmpFor = null; $('cmpOut').innerHTML = '';
    fillModels(d.models, d.model);
    buildRows();
    var now = Date.now(), best = 0;
    S.rows.forEach(function (row, i) { if (Math.abs(row.t - now) < Math.abs(S.rows[best].t - now)) best = i; });
    if (!S.picked) S.idx = best;
    $('slider').max = String(S.rows.length - 1);
    renderList(); select(Math.min(S.idx, S.rows.length - 1), false);
    $('srcNote').textContent = 'Source: Open-Meteo, ' + d.model.label + ' model (' + d.model.detail + '). Updated ' + hm(Date.parse(d.fetchedAt)) +
      '. Grid point ' + d.gridLat.toFixed(2) + ', ' + d.gridLon.toFixed(2) + '. Computer model forecasts, not an official marine forecast: read them with the Met Office inshore waters forecast on this page.';
  }
  function fillModels(models, cur) {
    var sel = $('modelSel');
    sel.innerHTML = (models || []).map(function (m) { return '<option value="' + esc(m.id) + '"' + (cur && cur.id === m.id ? ' selected' : '') + '>' + esc(m.label) + '</option>'; }).join('');
    $('modelDetail').textContent = cur ? cur.detail : '';
  }
  // hourly for the first 48 h from now, then every 3 h (like XC Weather): light, but detailed where it matters
  function buildRows() {
    var d = S.data, start = Date.now() - HOUR, rows = [];
    for (var i = 0; i < d.t.length; i++) {
      var t = d.t[i];
      if (t < start || d.kn[i] == null) continue;
      if (t > start + 49 * HOUR && new Date(t).getHours() % 3 !== 0) continue;
      rows.push({ i: i, t: t, kn: d.kn[i], dir: d.dir[i], gust: d.gust[i] });
    }
    S.rows = rows;
  }

  /* ---------------------------------------------------------------- render */
  function pct(kn) { return Math.max(2, Math.min(100, kn / S.scale * 100)).toFixed(1); }
  function renderList() {
    var html = '', day = '';
    S.scale = Math.max(25, Math.ceil(Math.max.apply(null, S.rows.map(function (x) { return x.gust != null ? x.gust : x.kn; })) / 5) * 5);   // bar full width = strongest gust (min 25 kn)
    S.rows.forEach(function (row, k) {
      var dl = dayLabel(row.t);
      if (dl !== day) {
        day = dl;
        var dayRows = S.rows.filter(function (x) { return dayLabel(x.t) === dl; }), mx = Math.max.apply(null, dayRows.map(function (x) { return x.gust != null ? x.gust : x.kn; }));
        html += '<div class="w-day" role="presentation">' + esc(dl) + '<span>max ' + r(mx) + ' kn</span></div>';
      }
      var c = colour(row.kn);
      html += '<button type="button" class="w-row" role="listitem" data-k="' + k + '" aria-pressed="false" aria-label="' + esc(dl + ' ' + hm(row.t) + ': from ' + compass(row.dir) + ', ' + r(row.kn) + ' knots, gusts ' + r(row.gust)) + '">' +
        '<span class="t">' + hm(row.t) + '</span>' + arrowSvg(row.dir, 24, c) + '<span class="d">' + compass(row.dir) + '</span>' +
        '<span class="k"><span class="w-pill" style="background:' + c + '">' + r(row.kn) + '</span></span>' +
        '<span class="g">' + (row.gust != null ? '<b>' + r(row.gust) + '</b>' : '—') + '</span>' +
        '<span class="w-bar" aria-hidden="true">' + (row.gust != null ? '<i class="gu" style="width:' + pct(row.gust) + '%;background:' + colour(row.gust) + '"></i>' : '') +
        '<i style="width:' + pct(row.kn) + '%;background:' + c + '"></i></span></button>';
    });
    $('list').innerHTML = html;
  }
  function select(k, scroll) {
    if (!S.rows.length) return;
    k = Math.max(0, Math.min(S.rows.length - 1, k));
    S.idx = k;
    var row = S.rows[k], bf = beaufort(row.kn), c = colour(row.kn);
    $('whenText').textContent = dayLabel(row.t) + ' ' + hm(row.t);
    $('whenRel').textContent = rel(row.t);
    $('dSpeed').textContent = r(row.kn);
    spin(row.dir);
    $('dArrowPath').setAttribute('fill', c);
    $('fDir').textContent = compass(row.dir);
    $('fDeg').textContent = row.dir == null ? '' : p2(row.dir).padStart(3, '0') + '°';
    $('fKn').textContent = r(row.kn);
    $('fGust').textContent = r(row.gust);
    $('fBft').textContent = 'Force ' + bf.force + ' · ' + bf.name;
    $('slider').value = String(k);
    $('slider').setAttribute('aria-valuetext', dayLabel(row.t) + ' ' + hm(row.t) + ', ' + r(row.kn) + ' knots from ' + compass(row.dir));
    Array.prototype.forEach.call(document.querySelectorAll('.w-row'), function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-k') === k)); });
    if (scroll) followInList(k);
    if (S.cmp) renderCompare();
  }
  // turn the dial arrow to the new direction the short way round (350 -> 10 turns 20 degrees, not 340)
  function spin(dir) {
    if (dir == null) return;
    var target = (dir + 180) % 360;   // downwind
    if (S.rot == null) S.rot = target;
    else S.rot += ((target - S.rot) % 360 + 540) % 360 - 180;
    $('dArrow').style.transform = 'rotate(' + S.rot + 'deg)';
  }
  // keep the chosen row in view INSIDE the table when the table scrolls on its own (desktop); never scroll the page
  function followInList(k) {
    var list = $('list'), b = list.querySelector('.w-row[data-k="' + k + '"]');
    if (!b || list.scrollHeight <= list.clientHeight + 2) return;
    var top = b.offsetTop, bottom = top + b.offsetHeight;
    if (top < list.scrollTop + 40) list.scrollTop = top - 40;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
  }
  function renderKey() {
    var lo = 0;
    $('key').innerHTML = BANDS.map(function (b) { var s = '<span style="background:' + b[1] + '">' + (b[0] === Infinity ? lo + '+' : lo + '–' + b[0]) + '</span>'; lo = b[0] + 1; return s; }).join('') +
      '<span style="background:none;color:var(--muted);font-weight:700">knots</span>';
  }
  function renderTicks() {
    var g = '';
    for (var i = 0; i < 16; i++) {
      var a = i * 22.5 * Math.PI / 180, maj = i % 4 === 0, r1 = maj ? 80 : 86, r2 = 94;
      if (maj) continue;   // cardinal letters sit there
      g += '<line class="tick" x1="' + (110 + r1 * Math.sin(a)).toFixed(1) + '" y1="' + (110 - r1 * Math.cos(a)).toFixed(1) + '" x2="' + (110 + r2 * Math.sin(a)).toFixed(1) + '" y2="' + (110 - r2 * Math.cos(a)).toFixed(1) + '"/>';
    }
    $('ticks').innerHTML = g;
  }

  /* ---------------------------------------------------------------- models side by side */
  async function compare() {
    var btn = $('cmpBtn'); btn.disabled = true; btn.textContent = 'Loading models…';
    try {
      var url = '/api/wind?lat=' + S.lat.toFixed(3) + '&lon=' + S.lon.toFixed(3) + '&days=7&compare=1' + (model() ? '&model=' + encodeURIComponent(model()) : '');
      var r = await fetch(url, { cache: 'no-store' }); var d = await r.json();
      if (!r.ok || d.error) throw new Error((d && (d.detail || d.error)) || 'unavailable');
      S.cmp = [{ model: d.model, t: d.t, kn: d.kn, dir: d.dir, gust: d.gust }].concat(d.compare || []);
      renderCompare();
    } catch (e) { $('cmpOut').innerHTML = '<p class="w-msg">Could not load the other models (' + esc(e.message) + ').</p>'; }
    btn.disabled = false; btn.textContent = 'Compare all models at this time';
  }
  function renderCompare() {
    var row = S.rows[S.idx]; if (!row) return;
    var vals = [];
    var trs = S.cmp.map(function (m, n) {
      if (m.error) return '<tr><td class="n">' + esc(m.model.label) + '</td><td colspan="3" style="color:var(--muted)">not available here</td></tr>';
      var i = m.t.indexOf(row.t);
      if (i < 0 || m.kn[i] == null) return '<tr><td class="n">' + esc(m.model.label) + '</td><td colspan="3" style="color:var(--muted)">no forecast for this time</td></tr>';
      vals.push(m.kn[i]);
      return '<tr' + (n === 0 ? ' class="cur"' : '') + '><td class="n">' + esc(m.model.label) + (n === 0 ? '<small>selected</small>' : '') + '</td>' +
        '<td>' + arrowSvg(m.dir[i], 22, colour(m.kn[i])) + ' ' + compass(m.dir[i]) + '</td><td><span class="w-pill" style="background:' + colour(m.kn[i]) + '">' + r(m.kn[i]) + '</span></td><td>' + r(m.gust[i]) + '</td></tr>';
    });
    var spread = vals.length > 1 ? '<p class="w-spread">At ' + hm(row.t) + ' the models range ' + r(Math.min.apply(null, vals)) + '–' + r(Math.max.apply(null, vals)) + ' kn.' +
      (Math.max.apply(null, vals) - Math.min.apply(null, vals) >= 8 ? ' They disagree: treat this time with caution.' : '') + '</p>' : '';
    $('cmpOut').innerHTML = spread + '<table class="w-cmp"><thead><tr><th>Model</th><th>From</th><th>Wind</th><th>Gusts</th></tr></thead><tbody>' + trs.join('') + '</tbody></table>';
  }

  /* ---------------------------------------------------------------- Met Office inshore waters */
  var AREA_KEY = 'cn_inshoreArea', IN = null;
  var WARN_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5M12 18v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // "06:00 (UTC) on Wed 7 Oct 2026" -> ms
  function metTime(s) {
    var m = String(s || '').match(/(\d{1,2}):(\d{2})\s*\(UTC\)\s*on\s*\w+\s+(\d{1,2})\s+(\w{3})\w*\s+(\d{4})/i);
    if (!m) return null;
    var mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[4].toLowerCase());
    return mon < 0 ? null : Date.UTC(+m[5], mon, +m[3], +m[1], +m[2]);
  }
  function areaChoice() { return lsGet(AREA_KEY) || 'auto'; }
  async function loadInshore() {
    var d = null;
    try {
      var q = S.lat != null ? '?lat=' + S.lat.toFixed(3) + '&lon=' + S.lon.toFixed(3) : '';
      var r = await fetch('/api/inshore' + q, { cache: 'no-store' });
      d = await r.json();
      if (!r.ok) { IN = Object.assign({ failed: (d && d.detail) || 'unavailable' }, d || {}); }
      else IN = d;
    } catch (e) { if (!IN) IN = { failed: 'no connection', areas: [] }; }
    renderInshore();
  }
  function renderInshore() {
    var d = IN || { areas: [] }, sel = $('areaSel'), choice = areaChoice();
    var near = d.nearest, autoLabel = near ? 'Automatic: nearest is ' + near.n + '. ' + near.name : 'Automatic (no area within 60 miles)';
    sel.innerHTML = '<option value="auto">' + esc(autoLabel) + '</option>' + (d.areas || []).map(function (a) {
      return '<option value="' + esc(a.key) + '">' + esc(a.n + '. ' + a.name) + (a.warning ? '  ⚠' : '') + '</option>';
    }).join('');
    sel.value = (d.areas || []).some(function (a) { return a.key === choice; }) ? choice : 'auto';
    var key = sel.value === 'auto' ? (near ? near.key : null) : sel.value;
    var a = (d.areas || []).find(function (x) { return x.key === key; });
    var issued = metTime(d.issued);
    $('inIssued').textContent = d.failed && !a ? 'Met Office forecast unavailable (' + d.failed + ')' :
      issued ? 'Issued ' + hm(issued) + ' ' + dayLabel(issued) + ' (' + p2(new Date(issued).getUTCHours()) + ':' + p2(new Date(issued).getUTCMinutes()) + ' UTC)' : (d.issued || '');
    var html = '';
    // never show "no warning" when we simply have no forecast
    if (d.failed) html = '<p class="in-old">The Met Office forecast could not be loaded (' + esc(d.failed) + '). Check it on the Met Office site or by VHF/Navtex.</p>';
    else if (!a) html = '<p class="in-meta">' + (key ? 'No forecast found for this area in the latest issue.' : 'Choose a sea area.') + '</p>';
    else {
      html += '<h3 class="in-name">' + esc(a.n + '. ' + a.name) + '</h3>';
      if (a.warning) html += '<div class="in-warn" role="alert">' + WARN_SVG + '<span>Strong wind warning in force for this area</span></div>';
      else html += '<p class="in-ok">No strong wind warning for this area</p>';
      (a.notes || []).filter(function (t) { return !/^strong winds are forecast/i.test(t); }).forEach(function (t) { html += '<p class="in-meta">' + esc(t) + '</p>'; });
      if (a.situation) html += '<p class="in-meta"><b>General situation:</b> ' + esc(a.situation) + '</p>';
      (a.blocks || []).forEach(function (b) {
        html += '<div class="in-block"><h3>' + esc(b.title) + '</h3>' + (b.items.length ? '<dl class="in-dl">' + b.items.map(function (it) {
          return '<dt>' + esc(it[0]) + '</dt><dd' + (/^wind$/i.test(it[0]) ? ' class="wind"' : '') + '>' + esc(it[1]) + '</dd>';
        }).join('') + '</dl>' : '<p>' + esc(b.text) + '</p>') + '</div>';
      });
    }
    if (issued && Date.now() - issued > 7 * HOUR) html += '<p class="in-old">This issue is more than 7 hours old: a newer one should be out (they are issued every 6 hours).</p>';
    if (d.stale) html += '<p class="in-old">Could not reach the Met Office just now: showing the last forecast fetched.</p>';
    if (d.period) html += '<p class="in-meta">' + esc(d.period) + '</p>';
    $('inBody').innerHTML = html;
    $('inSitWrap').hidden = !d.situation;
    $('inSit').textContent = d.situation || '';
  }
  $('areaSel').addEventListener('change', function () { lsSet(AREA_KEY, this.value); renderInshore(); });

  /* ---------------------------------------------------------------- events */
  $('list').addEventListener('click', function (e) { var b = e.target.closest('.w-row'); if (b) { S.picked = true; select(+b.getAttribute('data-k'), false); } });
  $('slider').addEventListener('input', function () { S.picked = true; select(+this.value, true); });
  $('prevH').addEventListener('click', function () { S.picked = true; select(S.idx - 1, true); });
  $('nextH').addEventListener('click', function () { S.picked = true; select(S.idx + 1, true); });
  $('nowBtn').addEventListener('click', function () {
    S.picked = false; var now = Date.now(), best = 0;
    S.rows.forEach(function (row, i) { if (Math.abs(row.t - now) < Math.abs(S.rows[best].t - now)) best = i; });
    select(best, true);
  });
  $('modelSel').addEventListener('change', function () { lsSet(MODEL_KEY, this.value); load(); });
  $('cmpBtn').addEventListener('click', compare);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.lat != null) { load(); loadInshore(); } });

  (async function start() {
    renderTicks(); renderKey();
    var p = await findPosition();
    if (!p) { loadInshore(); $('place').textContent = 'No position yet'; var m = $('msg'); m.textContent = 'No position: open the dashboard once with location allowed, or log a position on the voyage map.'; m.hidden = false; return; }
    S.lat = p.lat; S.lon = p.lon;
    $('place').textContent = ddm(p.lat, 'N', 'S') + ' ' + ddm(p.lon, 'E', 'W') + ' · ' + p.how;
    load(); loadInshore();
    setInterval(function () { if (!document.hidden) { load(); loadInshore(); } }, 30 * 60000);
  })();
})();
