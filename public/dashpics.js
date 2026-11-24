// Dashboard pictures (24 Nov 2026): one large, distinct picture per feature, drawn by the app itself as SVG (no image files, no
// map downloads: they work offline and take the day/night colours from CSS variables). Pure functions that return SVG strings,
// plus the coastline for the Position chart (public/assets/coast.json, Natural Earth, public domain; make with scripts/make-coast.js).
(function () {
  'use strict';
  var BF_LIMITS = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
  function force(kn) { var i = 0; while (i < BF_LIMITS.length && kn >= BF_LIMITS[i]) i++; return i; }
  var FORCE_WORD = ['calm', 'light air', 'light breeze', 'gentle breeze', 'moderate breeze', 'fresh breeze', 'strong breeze', 'near gale', 'gale', 'strong gale', 'storm', 'violent storm', 'hurricane force'];
  var f1 = function (n) { return (Math.round(n * 10) / 10).toFixed(1); };

  // ---- Wind: compass, arrow pointing the way the wind BLOWS (from + 180), Force strip with today's Force lit
  function wind(dirFrom, kn) {
    var fr = force(kn), cells = '';
    for (var i = 0; i < 12; i++) cells += '<rect x="' + (i * 17) + '" width="15" height="14" rx="4" fill="var(--acc)" fill-opacity="' + (i + 1 === fr ? 1 : i + 1 < fr ? 0.5 : 0.16) + '"/>';
    var ticks = ''; for (var t = 0; t < 36; t++) ticks += '<line y1="-92" y2="' + (t % 9 ? -85 : -77) + '" transform="rotate(' + t * 10 + ')" stroke="var(--tx)" stroke-opacity="' + (t % 9 ? 0.4 : 0.9) + '" stroke-width="' + (t % 9 ? 2 : 4) + '"/>';
    var lets = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(function (a) { return '<text x="' + (Math.sin(a[1] * Math.PI / 180) * 62).toFixed(1) + '" y="' + (-Math.cos(a[1] * Math.PI / 180) * 62 + 7).toFixed(1) + '" text-anchor="middle" font-size="19" font-weight="900" fill="var(--tx)" fill-opacity=".85">' + a[0] + '</text>'; }).join('');
    var rot = dirFrom == null || !isFinite(dirFrom) ? null : (dirFrom + 180) % 360;
    return '<svg viewBox="0 0 220 250" role="img" aria-label="Wind compass" style="width:100%;height:100%"><g transform="translate(110,102)"><circle r="92" fill="var(--sea)" stroke="var(--tx)" stroke-opacity=".5" stroke-width="3"/>' + ticks + lets +
      (rot == null ? '' : '<g transform="rotate(' + rot.toFixed(0) + ')"><path d="M0 -70 L22 22 L5 14 L5 66 L-5 66 L-5 14 L-22 22Z" fill="var(--acc)" stroke="#0008" stroke-width="2"/></g>') +
      '<circle r="9" fill="var(--bg)" stroke="var(--tx)" stroke-width="3"/></g><g transform="translate(8,224)">' + cells + '<text y="-6" font-size="12" font-weight="900" fill="var(--tx)" fill-opacity=".85">FORCE ' + fr + ' · ' + FORCE_WORD[fr] + '</text></g></svg>';
  }

  // ---- Tides: a tide pole. Water level, marker, and the next high and low water as dashed lines.
  function tide(now, events) {
    var hs = (events || []).map(function (e) { return e.heightM; }); if (now != null) hs.push(now);
    var lo = Math.min(0, Math.floor(Math.min.apply(null, hs.length ? hs : [0]))), hi = Math.max(1, Math.ceil(Math.max.apply(null, hs.length ? hs : [1]) + 0.2));
    var H = 330, top = 18, m = function (v) { return top + (H - top * 2) * (1 - (v - lo) / (hi - lo)); };
    var marks = ''; for (var v = lo; v <= hi; v++) marks += '<line x1="110" x2="124" y1="' + m(v) + '" y2="' + m(v) + '" stroke="var(--tx)" stroke-width="3"/><text x="132" y="' + (m(v) + 6) + '" font-size="17" font-weight="900" fill="var(--tx)">' + v + '</text>';
    var lines = '', seenH = false, seenL = false;
    (events || []).forEach(function (e) { var hw = e.type === 'high'; if (hw ? seenH : seenL) return; if (hw) seenH = true; else seenL = true;
      lines += '<line x1="46" x2="128" y1="' + m(e.heightM) + '" y2="' + m(e.heightM) + '" stroke="' + (hw ? 'var(--acc)' : 'var(--tx)') + '" stroke-opacity="' + (hw ? 1 : 0.6) + '" stroke-width="3" stroke-dasharray="6 5"/><text x="150" y="' + (m(e.heightM) + (hw ? 14 : -4)) + '" font-size="14" font-weight="900" fill="' + (hw ? 'var(--acc)' : 'var(--tx)') + '">' + (hw ? 'HW' : 'LW') + '</text>'; });
    var wl = now == null ? '' : '<rect x="46" y="' + m(now) + '" width="64" height="' + H + '" fill="var(--rest)"/><path d="M46 ' + m(now) + ' q16 -9 32 0 t32 0" stroke="var(--tx)" stroke-width="3" fill="none"/>';
    return '<svg id="tideSvg" viewBox="0 0 200 ' + H + '" role="img" aria-label="Tide height" style="width:100%;height:100%"><clipPath id="tpc"><rect x="46" y="' + top + '" width="64" height="' + (H - top * 2) + '" rx="14"/></clipPath>' +
      '<rect x="46" y="' + top + '" width="64" height="' + (H - top * 2) + '" rx="14" fill="var(--sea)" stroke="var(--tx)" stroke-opacity=".5" stroke-width="3"/><g clip-path="url(#tpc)">' + wl + '</g>' + marks + lines +
      (now == null ? '' : '<g transform="translate(26,' + m(now) + ')"><path d="M0 0 L14 -9 L14 9Z" fill="var(--acc)"/></g>') + '</svg>';
  }

  // ---- Weather: a cloud picture that follows the WMO weather code
  function cloudShape(dx, dy, fill) { return '<g fill="' + fill + '" transform="translate(' + dx + ',' + dy + ')"><circle cx="44" cy="62" r="24"/><circle cx="74" cy="48" r="30"/><circle cx="106" cy="64" r="22"/><rect x="22" y="64" width="104" height="26" rx="13"/></g>'; }
  function weather(code) {
    var c = code == null ? 3 : code, sun = '<g stroke="var(--acc)" stroke-width="6" stroke-linecap="round">' + [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) { return '<line x1="0" y1="-34" x2="0" y2="-46" transform="rotate(' + a + ')"/>'; }).join('') + '</g><circle r="24" fill="var(--acc)"/>';
    var body;
    if (c === 0) body = '<g transform="translate(100,65) scale(1.5)">' + sun + '</g>';
    else if (c <= 2) body = '<g transform="translate(62,46) scale(1.05)">' + sun + '</g>' + cloudShape(34, 8, 'var(--cl1)');
    else if (c === 3) body = cloudShape(40, -2, 'var(--cl2)') + cloudShape(8, 16, 'var(--cl1)');
    else if (c <= 48) body = cloudShape(24, 6, 'var(--cl2)') + '<g stroke="var(--cl1)" stroke-width="7" stroke-linecap="round"><line x1="40" y1="104" x2="160" y2="104"/><line x1="56" y1="120" x2="146" y2="120"/></g>';
    else if (c >= 95) body = cloudShape(24, -6, 'var(--cl2)') + '<path d="M104 78 L84 112 H104 L94 138 L128 98 H108 L120 78Z" fill="var(--acc)"/>';
    else if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) body = cloudShape(24, -6, 'var(--cl2)') + [60, 90, 120, 150].map(function (x, i) { return '<circle cx="' + x + '" cy="' + (112 + (i % 2) * 14) + '" r="5" fill="var(--cl1)"/>'; }).join('');
    else body = cloudShape(24, -8, 'var(--cl2)') + '<g stroke="var(--rest)" stroke-width="6" stroke-linecap="round">' + [56, 84, 112, 140].map(function (x, i) { return '<line x1="' + x + '" y1="' + (96 + (i % 2) * 8) + '" x2="' + (x - 8) + '" y2="' + (120 + (i % 2) * 8) + '"/>'; }).join('') + '</g>';
    return '<svg viewBox="0 0 200 140" role="img" aria-label="Weather" style="width:100%;height:100%">' + body + '</svg>';
  }

  // ---- Log: a notebook showing the latest line
  function logbook(text) {
    var t = String(text == null ? '' : text).slice(0, 26).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; });
    return '<svg viewBox="0 0 220 130" role="img" aria-label="Log book" style="width:100%;height:100%"><rect x="14" y="8" width="192" height="116" rx="12" fill="var(--cl1)"/><rect x="14" y="8" width="26" height="116" rx="12" fill="var(--cl2)"/>' +
      [0, 1, 2, 3].map(function (i) { return '<line x1="54" x2="194" y1="' + (38 + i * 24) + '" y2="' + (38 + i * 24) + '" stroke="var(--land)" stroke-width="3" stroke-linecap="round"' + (i === 3 ? ' stroke-dasharray="40 100"' : '') + '/>'; }).join('') +
      (t ? '<text x="54" y="30" font-size="14" font-weight="900" fill="var(--land)">' + t + '</text>' : '') + [0, 1, 2].map(function (i) { return '<circle cx="27" cy="' + (30 + i * 34) + '" r="5" fill="var(--bg)"/>'; }).join('') + '</svg>';
  }

  // ---- Atlantic: a decorative ocean chart (the real forecast is one tap away)
  function atlantic() {
    var barbs = [[30, 28], [90, 22], [150, 30], [205, 26], [40, 70], [100, 66], [160, 72], [212, 64], [28, 108], [92, 104], [152, 110]].map(function (p) { return '<g transform="translate(' + p[0] + ',' + p[1] + ') rotate(65)" fill="var(--tx)"><path d="M0 -12 L5 4 L1.6 2 L1.6 12 L-1.6 12 L-1.6 2 L-5 4Z"/></g>'; }).join('');
    return '<svg viewBox="0 0 240 130" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Atlantic chart" style="width:100%;height:100%;border-radius:14px"><defs><linearGradient id="atg" x1="0" x2="1"><stop offset="0" stop-color="var(--w1)"/><stop offset=".5" stop-color="var(--w2)"/><stop offset="1" stop-color="var(--w3)"/></linearGradient></defs><rect width="240" height="130" fill="url(#atg)"/>' + barbs +
      '<path d="M16 112 Q90 80 140 70 T226 24" stroke="#fff" stroke-width="5" stroke-dasharray="1 10" stroke-linecap="round" fill="none"/><circle cx="140" cy="70" r="9" fill="var(--acc)" stroke="#0009" stroke-width="3"/></svg>';
  }

  // ---- Voyage: the whole track as a sketch, start (green) and latest (amber)
  function voyage(path) {
    if (!path || path.length < 2) return '<svg viewBox="0 0 240 130" role="img" aria-label="Voyage" style="width:100%;height:100%"><path d="M20 100 Q70 40 120 70 T220 30" fill="none" stroke="var(--tx)" stroke-opacity=".3" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 12"/></svg>';
    var lat0 = path.reduce(function (a, p) { return a + p[0]; }, 0) / path.length, k = Math.cos(lat0 * Math.PI / 180);
    var xs = path.map(function (p) { return p[1] * k; }), ys = path.map(function (p) { return -p[0]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var w = 220, h = 110, sc = Math.min(w / ((maxX - minX) || 1e-6), h / ((maxY - minY) || 1e-6)), ox = 10 + (w - (maxX - minX) * sc) / 2, oy = 10 + (h - (maxY - minY) * sc) / 2;
    var pts = path.map(function (p, i) { return [ox + (xs[i] - minX) * sc, oy + (ys[i] - minY) * sc]; }), s = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    return '<svg id="trackSvg" viewBox="0 0 240 130" role="img" aria-label="Voyage track" style="width:100%;height:100%"><polyline points="' + s + '" fill="none" stroke="var(--tx)" stroke-opacity=".25" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><polyline points="' + s + '" fill="none" stroke="var(--rest)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + pts[0][0].toFixed(1) + '" cy="' + pts[0][1].toFixed(1) + '" r="9" fill="var(--ok)" stroke="#0009" stroke-width="3"/><circle cx="' + pts[pts.length - 1][0].toFixed(1) + '" cy="' + pts[pts.length - 1][1].toFixed(1) + '" r="10" fill="var(--acc)" stroke="#0009" stroke-width="3"/></svg>';
  }

  // ---- Position: a chart centred on the boat, in the dashboard colours
  var coast = null, coastLoading = null;
  function loadCoast() {
    if (coast) return Promise.resolve(coast);
    if (!coastLoading) coastLoading = fetch('/assets/coast.json').then(function (r) { if (!r.ok) throw new Error('coast ' + r.status); return r.json(); }).then(function (d) {
      var q = d.q || 1000; coast = d.rings.map(function (r) { var n = (r.length - 4) / 2, a = new Float32Array(n * 2), x = r[4], y = r[5]; a[0] = x / q; a[1] = y / q;
        for (var i = 1; i < n; i++) { x += r[4 + i * 2]; y += r[5 + i * 2]; a[i * 2] = x / q; a[i * 2 + 1] = y / q; } return { bb: [r[0] / q, r[1] / q, r[2] / q, r[3] / q], p: a }; });
      return coast;
    }).catch(function () { coastLoading = null; return null; });
    return coastLoading;
  }
  var NICE = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  function chart(fix, path, w, h, cog) {
    w = w || 400; h = h || 300;
    var tail = (path || []).slice(-24).filter(function (p) { return Math.abs(p[0] - fix.lat) < 3 && Math.abs(p[1] - fix.lon) < 5; });
    var pts = tail.concat([[fix.lat, fix.lon]]);
    var k = Math.cos(fix.lat * Math.PI / 180);
    // view: all the recent trail plus the boat, with room around it; never tighter than 8 nm across, never wider than 120 nm
    var dLat = Math.max.apply(null, pts.map(function (p) { return Math.abs(p[0] - fix.lat); })), dLon = Math.max.apply(null, pts.map(function (p) { return Math.abs(p[1] - fix.lon) * k; }));
    var halfNm = Math.min(60, Math.max(4, Math.max(dLat, dLon) * 60 * 1.5 + 1.5)), halfLat = halfNm / 60 * (h / Math.min(w, h)) , halfLon = halfNm / 60 * (w / Math.min(w, h));
    var sc = Math.min(w, h) / (2 * halfNm / 60);   // px per degree of latitude
    var pr = function (la, lo) { return [w / 2 + (lo - fix.lon) * k * sc, h / 2 - (la - fix.lat) * sc]; };
    var bb = [fix.lon - halfLon / k, fix.lat - halfLat, fix.lon + halfLon / k, fix.lat + halfLat];
    var land = '';
    if (coast) {
      var d = '', last, i, r, j, x, y, px, py;
      for (i = 0; i < coast.length; i++) { r = coast[i]; if (r.bb[2] < bb[0] || r.bb[0] > bb[2] || r.bb[3] < bb[1] || r.bb[1] > bb[3]) continue;
        d += 'M'; px = null;
        for (j = 0; j < r.p.length; j += 2) { var q = pr(r.p[j + 1], r.p[j]); x = q[0]; y = q[1]; if (px !== null && Math.abs(x - px) < 0.7 && Math.abs(y - py) < 0.7 && j < r.p.length - 2) continue; d += (px === null ? '' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1); px = x; py = y; }
        d += 'Z'; }
      if (d) land = '<path d="' + d + '" fill="var(--land)" fill-rule="evenodd" stroke="var(--coast)" stroke-width="2.4" stroke-linejoin="round"/>';
    }
    var step = halfNm > 30 ? 1 : halfNm > 12 ? 0.5 : halfNm > 5 ? 0.25 : 0.1, grid = '', la, lo;
    for (la = Math.ceil(bb[1] / step) * step; la <= bb[3]; la += step) grid += '<line x1="0" x2="' + w + '" y1="' + pr(la, 0)[1].toFixed(1) + '" y2="' + pr(la, 0)[1].toFixed(1) + '"/>';
    for (lo = Math.ceil(bb[0] / step) * step; lo <= bb[2]; lo += step) grid += '<line y1="0" y2="' + h + '" x1="' + pr(0, lo)[0].toFixed(1) + '" x2="' + pr(0, lo)[0].toFixed(1) + '"/>';
    var trail = tail.length ? '<polyline points="' + tail.concat([[fix.lat, fix.lon]]).map(function (p) { return pr(p[0], p[1]).map(function (v) { return v.toFixed(1); }).join(','); }).join(' ') + '" fill="none" stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-dasharray="1 11" opacity=".95"/>' : '';
    var head = cog;
    if (head == null && tail.length) { var a = tail[tail.length - 1], dx = (fix.lon - a[1]) * k, dy = fix.lat - a[0]; if (Math.abs(dx) + Math.abs(dy) > 1e-5) head = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; }
    var nm = NICE.filter(function (n) { return n / 60 * sc < w * 0.3; }).pop() || NICE[0], bar = nm / 60 * sc;
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Chart of your position" style="width:100%;height:100%;border-radius:16px"><rect width="' + w + '" height="' + h + '" fill="var(--sea)"/><g stroke="var(--grid)" stroke-width="1">' + grid + '</g>' + land + trail +
      (fix.none ? '' : '<g transform="translate(' + (w / 2) + ',' + (h / 2) + ')"><circle r="30" fill="var(--acc)" opacity=".22"/><circle r="17" fill="none" stroke="var(--acc)" stroke-width="3"/><g transform="rotate(' + (head == null ? 0 : Math.round(head)) + ')"><path d="M0 -13 L9 11 L0 6 L-9 11Z" fill="var(--acc)" stroke="#0009" stroke-width="2"/></g></g>') +
      '<g transform="translate(' + (w - 30) + ',30)" fill="var(--tx)"><circle r="19" fill="#0006"/><path d="M0 -13 L5 4 L0 1 L-5 4Z" fill="var(--acc)"/><text y="-21" text-anchor="middle" font-size="12" font-weight="900">N</text></g>' +
      '<g transform="translate(16,' + (h - 16) + ')" fill="var(--tx)" font-size="13" font-weight="900"><rect y="-4" width="' + bar.toFixed(1) + '" height="4" fill="var(--tx)"/><text y="-9">' + nm + ' nm</text></g></svg>';
  }
  window.CNPics = { wind: wind, tide: tide, weather: weather, logbook: logbook, atlantic: atlantic, voyage: voyage, chart: chart, loadCoast: loadCoast, force: force, coastReady: function () { return !!coast; } };
})();
