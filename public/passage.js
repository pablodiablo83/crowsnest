// Crow's Nest - passage pack: tides (curves, HW/LW, hourly heights), wind and the Met Office inshore forecast laid out
// for A4, to print or save as a PDF before sailing. Settings live in the URL so the app's "open in Safari to print"
// (net.js) lands on the same pack.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var MIN = 60000, HOUR = 3600000, DAY = 86400000, MAXP = 4;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function hm(ms) { var t = new Date(ms); return p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function dayLong(ms) { return new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function dayShort(ms) { return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function midnight(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(ms, n) { var d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }   // local days (BST/GMT change safe)
  function tzName(ms) { var m = new Date(ms).toLocaleTimeString('en-GB', { timeZoneName: 'short' }).match(/[A-Z]{2,5}|GMT[+-]\d+/); return m ? m[0] : 'local time'; }
  function m1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  async function api(path) {
    var r = await fetch(path, { cache: 'no-store' }), d = null;
    try { d = await r.json(); } catch (e) {}
    if (!r.ok && r.status !== 202) throw new Error((d && (d.detail || d.error)) || ('failed (' + r.status + ')'));
    return { status: r.status, d: d };
  }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------------------------------------------------------------- settings (URL first, then the other pages' choices) */
  var Q = new URLSearchParams(location.search);
  var S = { pos: null, ports: null, models: [], areas: [] };
  function lastFix() { try { var f = JSON.parse(lsGet('cn_fix') || 'null'); if (f && isFinite(f.lat) && isFinite(f.lon)) return f; } catch (e) {} return null; }
  async function findPosition() {
    var f = lastFix(); if (f) return { lat: +f.lat, lon: +f.lon };
    try { var r = await api('/api/positions/latest'); if (r.d && isFinite(r.d.lat)) return { lat: +r.d.lat, lon: +r.d.lon }; } catch (e) {}
    return null;
  }
  function portName(id) {
    var p = S.ports.secondary.find(function (x) { return 'sec:' + x.id === id; }) || (S.ports.ukho || []).find(function (x) { return 'ukho:' + x.id === id; }) || S.ports.standard.find(function (x) { return x.id === id; });
    return p ? p.name : id;
  }
  function portPos(id) {
    var sec = S.ports.secondary.find(function (x) { return 'sec:' + x.id === id; }) || (S.ports.ukho || []).find(function (x) { return 'ukho:' + x.id === id; });
    if (sec && sec.lat != null && sec.lon != null) return { lat: +sec.lat, lon: +sec.lon };
    var st = S.ports.standard.find(function (x) { return x.id === (sec ? sec.std : id); });
    return st ? { lat: st.lat, lon: st.lon } : null;
  }
  function portOptions() {
    var sec = S.ports.secondary, std = S.ports.standard;
    var dist = function (p) { return p.distanceNm != null ? ' · ' + Math.round(p.distanceNm) + ' nm' : ''; };
    return (sec.length ? '<optgroup label="Your secondary ports">' + sec.map(function (p) { return '<option value="sec:' + esc(p.id) + '">' + esc(p.name) + dist(p) + '</option>'; }).join('') + '</optgroup>' : '') +
      (function () {   // UKHO stations: the nearest 25 (and any already chosen)
        var want = (Q.get('p') || lsGet('cn_tidePort') || '').split(',');
        var uk = (S.ports.ukho || []).filter(function (p, i) { return i < 25 || want.indexOf('ukho:' + p.id) >= 0; });
        return uk.length ? '<optgroup label="UKHO stations (ADMIRALTY)">' + uk.map(function (p) { return '<option value="ukho:' + esc(p.id) + '">' + esc(p.name) + dist(p) + '</option>'; }).join('') + '</optgroup>' : '';
      })() +
      '<optgroup label="Standard ports (tide gauges)">' + std.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + dist(p) + '</option>'; }).join('') + '</optgroup>';
  }
  function addPortRow(val) {
    var box = $('ports'); if (box.children.length >= MAXP) return;
    var row = document.createElement('div'); row.className = 'p-port';
    var n = box.children.length + 1;
    row.innerHTML = '<select class="h-in" aria-label="Tide port ' + n + '">' + portOptions() + '</select><button type="button" class="h-btn ghost" aria-label="Remove this port">✕</button>';
    box.appendChild(row);
    var sel = row.querySelector('select'); sel.value = val || S.ports.standard[0].id;
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    sel.addEventListener('change', changed);
    row.querySelector('button').addEventListener('click', function () { if (box.children.length > 1) { row.remove(); changed(); } });
    syncPortUi();
  }
  function syncPortUi() {
    var n = $('ports').children.length;
    $('addPort').hidden = n >= MAXP;
    [].forEach.call($('ports').querySelectorAll('button'), function (b) { b.hidden = n < 2; });
    // wind at: here, or any chosen port
    var cur = $('oWat').value || Q.get('wat') || 'here';
    var ids = chosenPorts();
    $('oWat').innerHTML = (S.pos ? '<option value="here">Here (your position)</option>' : '') + ids.map(function (id) { return '<option value="' + esc(id) + '">' + esc(portName(id)) + '</option>'; }).join('');
    $('oWat').value = cur; if ($('oWat').selectedIndex < 0) $('oWat').selectedIndex = 0;
  }
  function chosenPorts() {
    var seen = {};
    return [].map.call($('ports').querySelectorAll('select'), function (s) { return s.value; }).filter(function (v) { if (!v || seen[v]) return false; seen[v] = 1; return true; });
  }
  function settings() {
    var start = Date.parse($('oStart').value + 'T00:00:00');   // local midnight
    return {
      start: isFinite(start) ? start : midnight(Date.now()), days: +$('oDays').value || 3,
      tides: $('iT').checked, wind: $('iW').checked, inshore: $('iI').checked,
      ports: chosenPorts(), wat: $('oWat').value, model: $('oModel').value, step: +$('oStep').value || 3, area: $('oArea').value || 'auto'
    };
  }
  function writeUrl(o) {
    var q = new URLSearchParams({ start: ymd(o.start), days: o.days, inc: (o.tides ? 't' : '') + (o.wind ? 'w' : '') + (o.inshore ? 'i' : ''),
      p: o.ports.join(','), wat: o.wat, model: o.model, step: o.step, area: o.area });
    history.replaceState(null, '', location.pathname + '?' + q.toString());
  }
  function syncSections() { $('fPorts').hidden = !$('iT').checked; $('fWind').hidden = !$('iW').checked; $('fWind2').hidden = !$('iW').checked && !$('iI').checked;
    $('oStep').parentNode.hidden = !$('iW').checked; $('fArea').hidden = !$('iI').checked; }

  /* ---------------------------------------------------------------- build */
  var gen = 0, debounce = null, ready = false;
  function changed() { ready = false; syncPortUi(); syncSections(); clearTimeout(debounce); debounce = setTimeout(build, 250); }
  async function build() {
    clearTimeout(debounce); ready = false;
    var my = ++gen, o = settings(); writeUrl(o);
    var end = addDays(o.start, o.days);
    $('status').textContent = 'Preparing…';
    var vessel = ''; try { vessel = ((await api('/api/vessel')).d || {}).vessel || ''; } catch (e) {}
    var parts = [], now = Date.now();
    var dates = dayShort(o.start) + (o.days > 1 ? ' to ' + dayShort(addDays(end, -1)) : '');
    var B = window.CNBrand;
    document.title = B.docTitle('Passage pack ' + dates);
    parts.push('<header>' + B.letterhead('Passage pack' + (vessel ? '<br>' + esc(vessel) : '')) + '<p class="meta">' + esc(dates) +
      ' · times ' + esc(tzName(o.start)) + (tzName(o.start) !== tzName(end - 1) ? ' / ' + esc(tzName(end - 1)) : '') + ' · prepared ' + esc(hm(now) + ' ' + dayShort(now)) + '</p></header>');
    // each later section starts a new page: repeat a short brand line at its top
    var run = '<div class="cn-run">' + esc(B.NAME) + ' · Passage pack' + (vessel ? ' · ' + esc(vessel) : '') + ' · ' + esc(dates) + '</div>';
    var push = function (html) { parts.push(parts.length > 1 ? html.replace(/^(<section[^>]*>)/, '$1' + run) : html); };
    var first = true;
    if (o.tides) {
      for (var i = 0; i < o.ports.length; i++) {
        $('status').textContent = 'Tides: ' + portName(o.ports[i]) + '…';
        push(await tideSection(o.ports[i], o, end, first)); first = false;
        if (my !== gen) return;
      }
    }
    if (o.wind) { $('status').textContent = 'Wind…'; push(await windSection(o, end, first)); first = false; if (my !== gen) return; }
    if (o.inshore) { $('status').textContent = 'Inshore forecast…'; push(await inshoreSection(o, first)); first = false; if (my !== gen) return; }
    if (!o.tides && !o.wind && !o.inshore) parts.push('<p class="msg">Choose at least one section.</p>');
    parts.push('<p class="note"><b>Planning aid, not an official publication.</b> Tides are astronomical predictions from tide-gauge records: wind and pressure can change heights by 0.3 m or more and shift times. ' +
      'Wind is computer model output. Check the Admiralty Tide Tables or your almanac, and the latest Met Office forecasts (VHF, Navtex), before and during the passage.</p>');
    parts.push(B.footer('Third-party material remains its owners’ copyright: inshore waters forecast © Crown copyright, Met Office; wind data from Open-Meteo.com (CC BY 4.0) and the national weather services whose models it serves; ' +
      'tide-gauge data from the UK National Tide Gauge Network via the IOC Sea Level Station Monitoring Facility; UKHO tidal predictions © Crown copyright, UK Hydrographic Office (ADMIRALTY UK Tidal API), where shown; secondary port differences from your own almanac, © its publisher.', now));
    if (my !== gen) return;
    $('doc').innerHTML = parts.join('');
    $('status').textContent = 'Ready. This is what will print.'; ready = true;
  }

  /* ---------------------------------------------------------------- tides */
  async function tideSection(port, o, end, first) {
    var head = '<section class="sec' + (first ? '' : ' newp') + '"><h2>Tides: ' + esc(portName(port)) + '</h2>';
    var r = null;
    for (var tries = 0; tries < 40; tries++) {
      try { r = await api('/api/tides/predict?port=' + encodeURIComponent(port) + '&from=' + o.start + '&days=' + Math.ceil((end - o.start) / DAY)); }
      catch (e) { return head + '<p class="msg">Tide predictions unavailable (' + esc(e.message) + ').</p></section>'; }
      if (r.status !== 202) break;
      if (r.d.status === 'failed') return head + '<p class="msg">Could not read this port’s gauge data (' + esc(r.d.error || '') + '). Try again on the Tides page.</p></section>';
      $('status').textContent = 'Tides: first use of ' + portName(port) + ', analysing a year of gauge data…';
      await sleep(4000);
    }
    if (!r || r.status === 202) return head + '<p class="msg">Still analysing this port’s gauge data: try again in a minute.</p></section>';
    var d = r.d, L = d.levels || {}, cur = d.curve.filter(function (p) { return p[0] < end; });
    var hs = cur.map(function (p) { return p[1]; });
    var step = Math.max.apply(null, hs) - Math.min(0, Math.min.apply(null, hs)) > 6 ? 1 : 0.5;
    var lo = Math.floor(Math.min(0, Math.min.apply(null, hs)) / step) * step, hi = Math.ceil((Math.max.apply(null, hs) + 0.1) / step) * step;
    var sub = (d.port.kind === 'sec' ? 'Secondary port on ' + esc(d.port.std.name) + ' (Admiralty method, your almanac differences' + (d.secondary.notes ? ': ' + esc(d.secondary.notes) : '') + '). ' : '') +
      (d.port.kind === 'ukho' ? 'UK Hydrographic Office predictions (ADMIRALTY UK Tidal API); curve between them drawn by Crow’s Nest, shape approximate. ' : '') +
      'Heights in metres ' + esc(d.datum.label) + '.' + (d.levels ? ' MHWS ' + m1(L.MHWS) + ' · MHWN ' + m1(L.MHWN) + ' · MLWN ' + m1(L.MLWN) + ' · MLWS ' + m1(L.MLWS) + (L.HAT != null ? ' · HAT ' + m1(L.HAT) : '') + '.' : '');
    var html = head + '<p class="meta">' + sub + '</p>';
    for (var t0 = o.start; t0 < end; t0 = addDays(t0, 1)) {
      var t1 = addDays(t0, 1);
      var pts = d.curve.filter(function (p) { return p[0] >= t0 && p[0] <= t1; });
      var ex = d.extremes.filter(function (e) { return e.t >= t0 && e.t < t1; });
      var hw = ex.filter(function (e) { return e.type === 'HW'; }), lw = ex.filter(function (e) { return e.type === 'LW'; });
      var range = hw.length && lw.length ? Math.max.apply(null, hw.map(function (e) { return e.h; })) - Math.min.apply(null, lw.map(function (e) { return e.h; })) : null;
      var sn = range != null && d.levels && L.MHWS - L.MLWS > 0 ? Math.round(range / (L.MHWS - L.MLWS) * 100) : null;
      html += '<div class="day"><div class="dayh"><h3>' + esc(dayLong(t0)) + '</h3><span>' + (range != null ? 'Range ' + m1(range) + ' m' + (sn != null ? ' · ' + sn + '% of springs' + (sn >= 85 ? ' (springs)' : sn <= 55 ? ' (neaps)' : '') : '') : '') + '</span></div>';
      html += tideSvg(pts, ex, t0, t1, lo, hi, step);
      html += '<table class="ext"><tr>' + ex.map(function (e) {
        return '<td><b>' + e.type + ' ' + hm(e.t) + '</b><br>' + m1(e.h) + ' m' + (e.std ? '<div class="det">' + esc(d.port.std.name) + ' ' + hm(e.std.t) + ' ' + m1(e.std.h) + ' m, ' + (e.dt >= 0 ? '+' : '−') + Math.abs(e.dt) + ' min, ' + (e.dh >= 0 ? '+' : '−') + Math.abs(e.dh).toFixed(2) + ' m</div>' : '') + '</td>';
      }).join('') + '</tr></table>';
      // hourly heights in rows of 12 hours, so the table fits a phone and A4 (a clock-change day has 23 or 25 hours)
      var hrs = []; for (var h = t0; h < t1; h += HOUR) hrs.push(h);
      html += '<table class="hrs">';
      for (var j = 0; j < hrs.length; j += 12) {
        var row = hrs.slice(j, j + 12), pad = new Array(12 - row.length + 1).join('<td></td>');
        html += '<tr><th class="l">Time</th>' + row.map(function (t) { return '<th>' + p2(new Date(t).getHours()) + '</th>'; }).join('') + pad.replace(/td/g, 'th') + '</tr>' +
          '<tr><td class="l">m</td>' + row.map(function (t) { var v = heightAt(d.curve, t); return '<td>' + (v == null ? '' : m1(v)) + '</td>'; }).join('') + pad + '</tr>';
      }
      html += '</table></div>';
    }
    html += '<p class="note">' + (d.quality ? 'Predicted from ' + d.quality.days + ' days of the ' + esc(d.port.kind === 'sec' ? d.port.std.name : d.port.name) + ' tide-gauge record (UK National Tide Gauge Network via the IOC), analysed ' + esc(new Date(d.quality.analysedAt).toLocaleDateString('en-GB')) + '. ' : '') + esc(d.datum.note) + (d.attribution ? ' ' + esc(d.attribution) : '') + '</p>';
    return html + '</section>';
  }
  function heightAt(c, t) {
    for (var i = 1; i < c.length; i++) if (c[i][0] >= t) { var a = c[i - 1], b = c[i]; return a[1] + (t - a[0]) / (b[0] - a[0]) * (b[1] - a[1]); }
    return null;
  }
  function tideSvg(pts, ex, t0, t1, lo, hi, step) {
    var W = 720, H = 210, L = 30, R = 8, T = 16, B = 20, w = W - L - R, h = H - T - B;
    var X = function (t) { return L + (t - t0) / (t1 - t0) * w; }, Y = function (v) { return T + (hi - v) / (hi - lo) * h; };
    var s = '<svg class="tc" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Tidal curve">';
    for (var v = lo; v <= hi + 1e-9; v += step) {
      var major = Math.abs(v - Math.round(v)) < 1e-9;
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="' + (major ? '#999' : '#ddd') + '" stroke-width="' + (major ? 0.8 : 0.6) + '"/>';
      if (major) s += '<text x="' + (L - 4) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" font-size="10" text-anchor="end" fill="#333">' + v + '</text>';
    }
    for (var t = t0; t <= t1; t += HOUR) {
      var hr = Math.round((t - t0) / HOUR), maj = hr % 3 === 0;
      s += '<line x1="' + X(t).toFixed(1) + '" x2="' + X(t).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="' + (maj ? '#999' : '#e2e2e2') + '" stroke-width="' + (maj ? 0.8 : 0.6) + '"/>';
      if (maj && t < t1) s += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="#333">' + p2(new Date(t).getHours()) + '</text>';
    }
    if (pts.length > 1) s += '<path d="' + pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(' ') + '" fill="none" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/>';
    ex.forEach(function (e) {
      var x = X(e.t), y = Y(e.h), up = e.type === 'HW';
      s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.6" fill="#111"/>' +
        '<text x="' + Math.min(W - R - 40, Math.max(L + 40, x)).toFixed(1) + '" y="' + (up ? y - 5 : y + 13).toFixed(1) + '" font-size="10.5" font-weight="700" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">' +
        e.type + ' ' + hm(e.t) + ' ' + m1(e.h) + '</text>';
    });
    return s + '</svg>';
  }

  /* ---------------------------------------------------------------- wind */
  var CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function bft(kn) { var lim = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64], f = 0; while (f < 12 && kn >= lim[f]) f++; return f; }
  function arrow(dir) {   // points downwind, like the rest of Crow's Nest
    return dir == null ? '' : '<svg width="14" height="14" viewBox="0 0 24 24" style="transform:rotate(' + ((dir + 180) % 360) + 'deg);vertical-align:middle"><path d="M12 2 L19 11 L14 10 L14 22 L10 22 L10 10 L5 11 Z" fill="#111"/></svg>';
  }
  async function windSection(o, end, first) {
    var where = o.wat === 'here' ? S.pos : portPos(o.wat), label = o.wat === 'here' ? 'your position' : portName(o.wat);
    var head = '<section class="sec' + (first ? '' : ' newp') + '"><h2>Wind: ' + esc(label) + '</h2>';
    if (!where) return head + '<p class="msg">No position for the wind forecast.</p></section>';
    var days = Math.max(1, Math.min(10, Math.ceil((end - Date.now()) / DAY) + 1));
    var d;
    try { d = (await api('/api/wind?lat=' + where.lat.toFixed(3) + '&lon=' + where.lon.toFixed(3) + '&days=' + days + (o.model ? '&model=' + encodeURIComponent(o.model) : ''))).d; }
    catch (e) { return head + '<p class="msg">Wind forecast unavailable (' + esc(e.message) + ').</p></section>'; }
    var rows = d.t.map(function (t, i) { return { t: t, kn: d.kn[i], g: d.gust[i], dir: d.dir[i] }; }).filter(function (r) { return r.t >= o.start && r.t < end && r.kn != null; });
    var lastT = d.t.length ? d.t[d.t.length - 1] : 0;
    var html = head + '<p class="meta">' + esc(d.model.label) + ' (' + esc(d.model.detail) + '), via Open-Meteo, fetched ' + esc(hm(Date.parse(d.fetchedAt)) + ' ' + dayShort(Date.parse(d.fetchedAt))) +
      '. Model grid point ' + (+d.gridLat).toFixed(2) + ', ' + (+d.gridLon).toFixed(2) + '. Knots at 10 m; arrows point the way the wind blows; "from" is where it comes from.</p>';
    if (!rows.length) return html + '<p class="msg">No forecast for these dates yet (this model runs to ' + esc(dayShort(lastT)) + ').</p></section>';
    html += windChart(rows, o.start, end);
    for (var t0 = o.start; t0 < end; t0 = addDays(t0, 1)) {
      var t1 = addDays(t0, 1), day = rows.filter(function (r) { return r.t >= t0 && r.t < t1 && (new Date(r.t).getHours() % o.step === 0); });
      if (!day.length) { html += '<div class="day"><div class="dayh"><h3>' + esc(dayLong(t0)) + '</h3></div><p class="meta">Beyond this model’s forecast range.</p></div>'; continue; }
      var mx = Math.max.apply(null, rows.filter(function (r) { return r.t >= t0 && r.t < t1; }).map(function (r) { return r.kn; }));
      var mg = Math.max.apply(null, rows.filter(function (r) { return r.t >= t0 && r.t < t1 && r.g != null; }).map(function (r) { return r.g; }).concat([0]));
      html += '<div class="day"><div class="dayh"><h3>' + esc(dayLong(t0)) + '</h3><span>Max ' + Math.round(mx) + ' kn (F' + bft(mx) + '), gusts ' + Math.round(mg) + ' kn</span></div>';
      for (var k = 0; k < day.length; k += 8) {   // 8 columns a row: every 3 hours is one row, hourly is three
        var c = day.slice(k, k + 8), fill = new Array(8 - c.length + 1).join('<td></td>');
        html += '<table class="wnd"><tr><th class="l">' + esc(tzName(t0)) + '</th>' + c.map(function (r) { return '<th>' + hm(r.t) + '</th>'; }).join('') + fill.replace(/td/g, 'th') + '</tr>' +
          '<tr><td class="l">From</td>' + c.map(function (r) { return '<td>' + arrow(r.dir) + '<br>' + (r.dir == null ? '' : CARD[Math.round(r.dir / 22.5) % 16] + '<br>' + String(r.dir).padStart(3, '0') + '°') + '</td>'; }).join('') + fill + '</tr>' +
          '<tr><td class="l">Mean</td>' + c.map(function (r) { return '<td' + (r.kn >= 22 ? ' class="big"' : '') + '>' + Math.round(r.kn) + '</td>'; }).join('') + fill + '</tr>' +
          '<tr><td class="l">Gust</td>' + c.map(function (r) { return '<td' + (r.g >= 28 ? ' class="big"' : '') + '>' + (r.g == null ? '' : Math.round(r.g)) + '</td>'; }).join('') + fill + '</tr>' +
          '<tr><td class="l">Force</td>' + c.map(function (r) { return '<td>' + bft(r.kn) + '</td>'; }).join('') + fill + '</tr></table>';
      }
      html += '</div>';
    }
    return html + '</section>';
  }
  function windChart(rows, t0, t1) {
    var W = 720, H = 150, L = 30, R = 8, T = 10, B = 20, w = W - L - R, h = H - T - B;
    var top = Math.max(20, Math.ceil(Math.max.apply(null, rows.map(function (r) { return Math.max(r.kn, r.g || 0); })) / 10) * 10);
    var X = function (t) { return L + (t - t0) / (t1 - t0) * w; }, Y = function (v) { return T + (top - v) / top * h; };
    var s = '<svg class="tc" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Wind speed and gusts">';
    for (var v = 0; v <= top; v += 10) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#ccc" stroke-width="0.7"/><text x="' + (L - 4) + '" y="' + (Y(v) + 3.5) + '" font-size="10" text-anchor="end" fill="#333">' + v + '</text>';
    [22, 34].forEach(function (v) { if (v < top) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#111" stroke-width="0.7" stroke-dasharray="4 3"/><text x="' + (W - R - 2) + '" y="' + (Y(v) - 3) + '" font-size="9" text-anchor="end" fill="#111">F' + (v === 22 ? 6 : 8) + '</text>'; });
    for (var d = t0; d <= t1; d = addDays(d, 1)) {
      s += '<line x1="' + X(d).toFixed(1) + '" x2="' + X(d).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#999" stroke-width="0.8"/>';
      if (d < t1) s += '<text x="' + (X(d) + 4).toFixed(1) + '" y="' + (H - 6) + '" font-size="10" fill="#333">' + esc(dayShort(d)) + '</text>';
    }
    var line = function (key) { var ps = rows.filter(function (r) { return r[key] != null; }); return ps.map(function (r, i) { return (i ? 'L' : 'M') + X(r.t).toFixed(1) + ' ' + Y(r[key]).toFixed(1); }).join(' '); };
    s += '<path d="' + line('g') + '" fill="none" stroke="#777" stroke-width="1.2" stroke-dasharray="3 2"/><path d="' + line('kn') + '" fill="none" stroke="#111" stroke-width="1.8"/>';
    s += '<text x="' + (L + 4) + '" y="' + (T + 10) + '" font-size="10" fill="#111">— mean  - - gust (kn)</text>';
    return s + '</svg>';
  }

  /* ---------------------------------------------------------------- inshore waters */
  function metTime(s) {   // "06:00 (UTC) on Wed 7 Oct 2026" -> ms
    var m = String(s || '').match(/(\d{1,2}):(\d{2})\s*\(UTC\)\s*on\s*\w+\s+(\d{1,2})\s+(\w{3})\w*\s+(\d{4})/i);
    if (!m) return null;
    var mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[4].toLowerCase());
    return mon < 0 ? null : Date.UTC(+m[5], mon, +m[3], +m[1], +m[2]);
  }
  async function inshoreSection(o, first) {
    var head = '<section class="sec' + (first ? '' : ' newp') + '"><h2>Met Office inshore waters forecast</h2>';
    var where = o.wat === 'here' || !o.wat ? S.pos : portPos(o.wat) || S.pos, d;
    try { d = (await api('/api/inshore' + (where ? '?lat=' + where.lat.toFixed(3) + '&lon=' + where.lon.toFixed(3) : ''))).d; }
    catch (e) { return head + '<p class="msg">The Met Office forecast could not be loaded (' + esc(e.message) + '). Get it by VHF or Navtex before sailing.</p></section>'; }
    var key = o.area === 'auto' ? (d.nearest ? d.nearest.key : null) : o.area;
    var a = (d.areas || []).find(function (x) { return x.key === key; });
    var issued = metTime(d.issued);
    var html = head + '<p class="meta">' + (issued ? 'Issued ' + esc(hm(issued) + ' ' + dayShort(issued)) + ' (' + p2(new Date(issued).getUTCHours()) + ':' + p2(new Date(issued).getUTCMinutes()) + ' UTC). ' : esc(d.issued || '')) +
      esc(d.period || '') + ' Issued every 6 hours: this copy will be out of date.' + (d.stale ? ' <b>Met Office unreachable when prepared: this is the last copy fetched.</b>' : '') + '</p>';
    if (!a) return html + '<p class="msg">' + (key ? 'No forecast for this area in the latest issue.' : 'No inshore area within 60 miles: choose one.') + '</p></section>';
    html += '<h3 style="margin-top:8px">' + esc(a.n + '. ' + a.name) + '</h3>';
    html += a.warning ? '<div class="warn">STRONG WIND WARNING IN FORCE FOR THIS AREA</div>' : '<p class="meta">No strong wind warning for this area at the time of issue.</p>';
    (a.notes || []).filter(function (t) { return !/^strong winds are forecast/i.test(t); }).forEach(function (t) { html += '<p class="meta">' + esc(t) + '</p>'; });
    var sit = a.situation || d.situation;
    if (sit) html += '<p style="margin-top:6px"><b>General situation:</b> ' + esc(sit) + '</p>';
    (a.blocks || []).forEach(function (b) {
      html += '<div class="blk"><h3>' + esc(b.title) + '</h3>' + (b.items && b.items.length ? '<dl>' + b.items.map(function (it) { return '<dt>' + esc(it[0]) + '</dt><dd>' + esc(it[1]) + '</dd>'; }).join('') + '</dl>' : '<p>' + esc(b.text) + '</p>') + '</div>';
    });
    return html + '<p class="note">' + esc(d.copyright || '© Crown copyright, Met Office') + '. ' + esc(d.url || '') + '</p></section>';
  }

  /* ---------------------------------------------------------------- start */
  (async function start() {
    for (var n = 1; n <= 7; n++) $('oDays').insertAdjacentHTML('beforeend', '<option value="' + n + '">' + n + (n === 1 ? ' day' : ' days') + '</option>');
    var qs = Q.get('start'), st = qs && /^\d{4}-\d\d-\d\d$/.test(qs) ? qs : ymd(Date.now());
    $('oStart').value = st; $('oDays').value = String(Math.min(7, Math.max(1, +Q.get('days') || 3)));
    var inc = Q.get('inc'); if (inc != null) { $('iT').checked = /t/.test(inc); $('iW').checked = /w/.test(inc); $('iI').checked = /i/.test(inc); }
    $('oStep').value = Q.get('step') === '1' ? '1' : '3';
    S.pos = await findPosition();
    try { S.ports = (await api('/api/tides/stations' + (S.pos ? '?lat=' + S.pos.lat.toFixed(3) + '&lon=' + S.pos.lon.toFixed(3) : ''))).d; }
    catch (e) { $('status').textContent = 'Ports unavailable (' + e.message + ').'; return; }
    var want = (Q.get('p') || lsGet('cn_tidePort') || '').split(',').filter(Boolean);
    if (!want.length) want = [S.ports.standard[0].id];
    want.slice(0, MAXP).forEach(addPortRow);
    if (Q.get('wat')) { syncPortUi(); $('oWat').value = Q.get('wat'); if ($('oWat').selectedIndex < 0) $('oWat').selectedIndex = 0; }
    // wind models and inshore areas (lists come with the data)
    try {
      var w = S.pos ? (await api('/api/wind?lat=' + S.pos.lat.toFixed(3) + '&lon=' + S.pos.lon.toFixed(3) + '&days=1')).d : null;
      S.models = (w && w.models) || [];
    } catch (e) {}
    var model = Q.get('model') || lsGet('cn_windModel') || '';
    $('oModel').innerHTML = S.models.length ? S.models.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>'; }).join('') : '<option value="">Default</option>';
    if (model) $('oModel').value = model; if ($('oModel').selectedIndex < 0) $('oModel').selectedIndex = 0;
    try {
      var ins = (await api('/api/inshore')).d;
      $('oArea').insertAdjacentHTML('beforeend', (ins.areas || []).map(function (a) { return '<option value="' + esc(a.key) + '">' + esc(a.n + '. ' + a.name) + '</option>'; }).join(''));
    } catch (e) {}
    var area = Q.get('area') || lsGet('cn_inshoreArea') || 'auto';
    $('oArea').value = area; if ($('oArea').selectedIndex < 0) $('oArea').value = 'auto';
    syncSections();
    ['oStart', 'oDays', 'iT', 'iW', 'iI', 'oWat', 'oModel', 'oStep', 'oArea'].forEach(function (id) { $(id).addEventListener('change', changed); });
    $('addPort').addEventListener('click', function () { addPortRow(null); changed(); });
    $('opts').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!ready) await build();
      if (ready) window.print();
    });
    build();
  })();
})();
