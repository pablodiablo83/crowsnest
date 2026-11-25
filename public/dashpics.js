// Dashboard pictures (24 Nov 2026): one large, distinct picture per feature, drawn by the app itself as SVG (no image files, no
// map downloads: they work offline and take the day/night colours from CSS variables). Pure functions that return SVG strings,
// plus the coastline for the Position chart (public/assets/coast.json, Natural Earth, public domain; make with scripts/make-coast.js).
(function () {
  'use strict';
  var BF_LIMITS = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
  function force(kn) { var i = 0; while (i < BF_LIMITS.length && kn >= BF_LIMITS[i]) i++; return i; }
  var FORCE_WORD = ['calm', 'light air', 'light breeze', 'gentle breeze', 'moderate breeze', 'fresh breeze', 'strong breeze', 'near gale', 'gale', 'strong gale', 'storm', 'violent storm', 'hurricane force'];
  var f1 = function (n) { return (Math.round(n * 10) / 10).toFixed(1); };

  // ---- Wind: a big compass. The arrow points the way the wind BLOWS (from + 180); the speed sits in a badge at the centre so the number and the
  // direction both read from across the cockpit. (Force, gusts and the direction in words are in the caption under the picture.)
  function wind(dirFrom, kn) {
    var ticks = ''; for (var t = 0; t < 36; t++) ticks += '<line y1="-100" y2="' + (t % 9 ? -91 : -80) + '" transform="rotate(' + t * 10 + ')" stroke="var(--tx)" stroke-opacity="' + (t % 9 ? 0.45 : 1) + '" stroke-width="' + (t % 9 ? 2.5 : 5) + '"/>';
    var lets = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(function (a) { return '<text x="' + (Math.sin(a[1] * Math.PI / 180) * 66).toFixed(1) + '" y="' + (-Math.cos(a[1] * Math.PI / 180) * 66 + 10).toFixed(1) + '" text-anchor="middle" font-size="30" font-weight="900" fill="var(--tx)">' + a[0] + '</text>'; }).join('');
    var rot = dirFrom == null || !isFinite(dirFrom) ? null : (dirFrom + 180) % 360, has = kn != null && isFinite(kn) && kn > 0 || kn === 0 && rot != null;
    var arrow = rot == null ? '' : '<g transform="rotate(' + rot.toFixed(0) + ')"><path d="M0 -92 L30 -34 L11 -40 L11 92 L-11 92 L-11 -40 L-30 -34Z" fill="var(--acc)" stroke="#0009" stroke-width="3" stroke-linejoin="round"/></g>';
    var num = !has ? '&mdash;' : String(Math.round(kn));
    return '<svg viewBox="-110 -110 220 220" role="img" aria-label="Wind compass" style="width:100%;height:100%"><circle r="104" fill="var(--sea)" stroke="var(--tx)" stroke-opacity=".5" stroke-width="3"/>' + ticks + lets + arrow +
      '<circle r="41" fill="var(--bg)" stroke="var(--tx)" stroke-width="3.5"/><text y="' + (has ? 13 : 11) + '" text-anchor="middle" font-size="' + (has ? 42 : 36) + '" font-weight="900" fill="var(--tx)">' + num + '</text>' + (has ? '<text y="31" text-anchor="middle" font-size="16" font-weight="900" fill="var(--tx)" fill-opacity=".8">kn</text>' : '') + '</svg>';
  }

  // ---- Tides: the curve, 2 h back to 12 h ahead. Water is shaded under the line, now is a dot on it, high and low water are marked with their times.
  function hhmm(ms) { var d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function tide(d) {
    var W = 240, H = 160, c = d && d.curve || [];
    if (c.length < 5) return '<svg id="tideSvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Tide curve" style="width:100%;height:100%"><path d="M8 100 C50 40 90 40 120 80 S190 120 232 60" fill="none" stroke="var(--tx)" stroke-opacity=".3" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12"/></svg>';
    var t0 = c[0][0], t1 = c[c.length - 1][0], hs = c.map(function (p) { return p[1]; }), lo = Math.min.apply(null, hs), hi = Math.max.apply(null, hs), pad = (hi - lo) * 0.28 + 0.1;
    var X = function (t) { return 10 + (t - t0) / (t1 - t0) * (W - 20); }, Y = function (h) { return 18 + (H - 52) * (1 - (h - (lo - pad * 0.35)) / ((hi + pad * 0.6) - (lo - pad * 0.35))); };
    var line = c.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(' ');
    var area = line + ' L' + X(t1).toFixed(1) + ' ' + (H - 24) + ' L' + X(t0).toFixed(1) + ' ' + (H - 24) + ' Z';
    var now = Date.now(), nx = X(Math.max(t0, Math.min(t1, now))), ny = Y((d.now && d.now.h != null) ? d.now.h : hs[0]);
    // high and low water that fall inside the picture: the curve's own turning points, so they are always on the line
    var marks = '';
    for (var i = 1; i < c.length - 1; i++) {
      var up = c[i][1] > c[i - 1][1] && c[i][1] >= c[i + 1][1], dn = c[i][1] < c[i - 1][1] && c[i][1] <= c[i + 1][1];
      if (!up && !dn) continue;
      var x = X(c[i][0]), y = Y(c[i][1]), lx = Math.max(48, Math.min(W - 48, x));
      marks += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5" fill="var(--bg)" stroke="var(--tx)" stroke-width="3"/><text x="' + lx.toFixed(1) + '" y="' + (up ? y - 11 : y + 25).toFixed(1) + '" text-anchor="middle" font-size="19" font-weight="900" fill="var(--tx)" stroke="var(--bg)" stroke-width="5" stroke-linejoin="round" paint-order="stroke">' + (up ? 'HW ' : 'LW ') + hhmm(c[i][0]) + '</text>';
    }
    return '<svg id="tideSvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Tide curve" style="width:100%;height:100%"><path d="' + area + '" fill="var(--rest)" fill-opacity=".28"/><path d="' + line + '" fill="none" stroke="var(--rest)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<line x1="' + nx.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y1="8" y2="' + (H - 24) + '" stroke="var(--acc)" stroke-width="3" stroke-dasharray="5 5"/>' + marks +
      '<circle cx="' + nx.toFixed(1) + '" cy="' + ny.toFixed(1) + '" r="9" fill="var(--acc)" stroke="#0009" stroke-width="3"/>' +
      '<line x1="10" x2="' + (W - 10) + '" y1="' + (H - 24) + '" y2="' + (H - 24) + '" stroke="var(--tx)" stroke-opacity=".35" stroke-width="2"/><text x="' + Math.max(18, Math.min(W - 18, nx)).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="17" font-weight="900" fill="var(--acc)" stroke="var(--bg)" stroke-width="4" paint-order="stroke">now</text></svg>';
  }


  // ---- Sea ice: the local 25 km grid (concentration), turned so north is up, the boat in the middle, "N" fixed. Land / no data = dark.
  function ice(d) {
    var g = d && d.grid, n = g ? g.length : 0;
    if (!n) return '<svg viewBox="0 0 200 200" role="img" aria-label="Sea ice" style="width:100%;height:100%"><circle cx="100" cy="100" r="70" fill="none" stroke="var(--tx)" stroke-opacity=".3" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round"/></svg>';
    var c = 8, S = n * c, cells = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var v = g[y][x];
      cells += v == null ? '<rect x="' + x * c + '" y="' + y * c + '" width="' + c + '.4" height="' + c + '.4" fill="#000" fill-opacity=".45"/>'
        : v >= 3 ? '<rect x="' + x * c + '" y="' + y * c + '" width="' + c + '.4" height="' + c + '.4" fill="#fff" fill-opacity="' + (0.25 + 0.75 * v / 100).toFixed(2) + '"/>' : '';
    }
    var m = S / 2, rot = +d.rot || 0;
    return '<svg viewBox="-14 -14 ' + (S + 28) + ' ' + (S + 28) + '" role="img" aria-label="Sea ice around the boat" style="width:100%;height:100%">' +
      '<defs><clipPath id="iceClip"><circle cx="' + m + '" cy="' + m + '" r="' + m + '"/></clipPath></defs>' +
      '<circle cx="' + m + '" cy="' + m + '" r="' + m + '" fill="var(--sea)"/><g clip-path="url(#iceClip)"><g transform="rotate(' + rot + ' ' + m + ' ' + m + ')">' + cells + '</g></g>' +
      '<circle cx="' + m + '" cy="' + m + '" r="' + m + '" fill="none" stroke="var(--tx)" stroke-opacity=".55" stroke-width="3"/>' +
      '<circle cx="' + m + '" cy="' + m + '" r="8" fill="var(--acc)" stroke="#0009" stroke-width="3"/>' +
      '<g transform="translate(' + m + ',-1)"><path d="M0 -10 L7 4 L0 0 L-7 4Z" fill="var(--tx)"/></g></svg>';
  }

  // ---- Speed over ground: a half-circle dial, needle and the number in the middle. Scale grows with the speed (10, 15, 20, 30 kn).
  function sog(kn) {
    var has = kn != null && isFinite(kn), v = has ? Math.max(0, kn) : 0, max = v <= 9 ? 10 : v <= 14 ? 15 : v <= 19 ? 20 : 30;
    var pol = function (r, a) { var rad = (180 + a * 180) * Math.PI / 180; return [(Math.cos(rad) * r).toFixed(1), (Math.sin(rad) * r).toFixed(1)]; };
    var arc = function (a0, a1, r) { var p0 = pol(r, a0), p1 = pol(r, a1); return 'M' + p0[0] + ' ' + p0[1] + ' A' + r + ' ' + r + ' 0 0 1 ' + p1[0] + ' ' + p1[1]; };
    var k = Math.min(1, v / max), ticks = '';
    for (var i = 0; i <= max; i += max / 10) { var q = pol(98, i / max), r2 = pol(i % (max / 2) === 0 ? 76 : 86, i / max); ticks += '<line x1="' + q[0] + '" y1="' + q[1] + '" x2="' + r2[0] + '" y2="' + r2[1] + '" stroke="var(--tx)" stroke-opacity=".6" stroke-width="3"/>'; }
    var nd = pol(84, k), lab = function (val, a) { var p = pol(66, a); return '<text x="' + p[0] + '" y="' + (+p[1] + 6) + '" text-anchor="middle" font-size="16" font-weight="900" fill="var(--tx)" fill-opacity=".75">' + val + '</text>'; };
    return '<svg viewBox="-115 -115 230 140" role="img" aria-label="Speed over ground" style="width:100%;height:100%"><path d="' + arc(0, 1, 98) + '" fill="none" stroke="var(--tx)" stroke-opacity=".18" stroke-width="16" stroke-linecap="round"/>' +
      (has && k > 0.005 ? '<path d="' + arc(0, k, 98) + '" fill="none" stroke="var(--acc)" stroke-width="16" stroke-linecap="round"/>' : '') + ticks + lab(0, 0.02) + lab(max / 2, 0.5) + lab(max, 0.98) +
      (has ? '<line x1="0" y1="0" x2="' + nd[0] + '" y2="' + nd[1] + '" stroke="var(--tx)" stroke-width="6" stroke-linecap="round"/>' : '') + '<circle r="9" fill="var(--bg)" stroke="var(--tx)" stroke-width="4"/>' +
      '</svg>';
  }

  // ---- Course over ground: the boat on a compass, pointing where it is really going (the number is in the badge, the cardinal in the caption)
  function cog(deg) {
    var has = deg != null && isFinite(deg), ticks = ''; for (var t = 0; t < 36; t++) ticks += '<line y1="-100" y2="' + (t % 9 ? -91 : -80) + '" transform="rotate(' + t * 10 + ')" stroke="var(--tx)" stroke-opacity="' + (t % 9 ? 0.45 : 1) + '" stroke-width="' + (t % 9 ? 2.5 : 5) + '"/>';
    var lets = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(function (a) { return '<text x="' + (Math.sin(a[1] * Math.PI / 180) * 66).toFixed(1) + '" y="' + (-Math.cos(a[1] * Math.PI / 180) * 66 + 10).toFixed(1) + '" text-anchor="middle" font-size="30" font-weight="900" fill="var(--tx)">' + a[0] + '</text>'; }).join('');
    var boat = !has ? '' : '<g transform="rotate(' + Math.round(deg) + ')"><path d="M0 -94 C26 -62 30 -22 22 40 L0 28 L-22 40 C-30 -22 -26 -62 0 -94Z" fill="var(--rest)" stroke="#0009" stroke-width="3" stroke-linejoin="round"/></g>';
    return '<svg viewBox="-110 -110 220 220" role="img" aria-label="Course over ground" style="width:100%;height:100%"><circle r="104" fill="var(--sea)" stroke="var(--tx)" stroke-opacity=".5" stroke-width="3"/>' + ticks + lets + boat +
      '<circle r="39" fill="var(--bg)" stroke="var(--tx)" stroke-width="3.5"/><text y="' + (has ? 12 : 11) + '" text-anchor="middle" font-size="' + (has ? 32 : 32) + '" font-weight="900" fill="var(--tx)">' + (has ? String(Math.round(deg)).padStart(3, '0') + '°' : '&mdash;') + '</text></svg>';
  }

  // ---- Boat data (NMEA / Signal K): a placeholder picture, a boat with signal arcs
  // ---- Boat data (NMEA placeholder): a plan-view hull with a data bus and four instrument nodes. Technical line drawing, no cartoon.
  function boatdata() {
    var nodes = [[52, 65, 'ENG', -1], [86, 65, 'DEPTH', 1], [120, 65, 'WIND', -1], [152, 65, 'GPS', 1]];
    var ns = nodes.map(function (n) {
      var y = n[1] + n[3] * 20;
      return '<line x1="' + n[0] + '" y1="65" x2="' + n[0] + '" y2="' + y + '" stroke="var(--tx)" stroke-opacity=".5" stroke-width="1.6"/>' +
        '<rect x="' + (n[0] - 9) + '" y="' + (y - 7) + '" width="18" height="14" rx="3.5" fill="var(--bg)" stroke="var(--tx)" stroke-opacity=".8" stroke-width="2" stroke-dasharray="3 2.5"/>' +
        '<text x="' + n[0] + '" y="' + (y + (n[3] > 0 ? 19 : -11)) + '" text-anchor="middle" font-size="9.5" font-weight="900" letter-spacing=".06em" fill="var(--tx)" fill-opacity=".7">' + n[2] + '</text>' +
        '<circle cx="' + n[0] + '" cy="65" r="2.8" fill="var(--tx)" fill-opacity=".8"/>';
    }).join('');
    return '<svg viewBox="0 0 200 130" role="img" aria-label="Boat instruments, not connected" style="width:100%;height:100%">' +
      '<path d="M14 65 C14 42 34 24 62 24 L120 24 C152 24 176 50 188 65 C176 80 152 106 120 106 L62 106 C34 106 14 88 14 65 Z" fill="var(--tx)" fill-opacity=".06" stroke="var(--tx)" stroke-opacity=".75" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<line x1="30" y1="65" x2="176" y2="65" stroke="var(--acc)" stroke-width="2.4" stroke-dasharray="6 4" stroke-linecap="round"/>' + ns + '</svg>';
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
      '<g transform="translate(16,' + (h - 16) + ')" fill="var(--tx)" font-size="13" font-weight="900"><rect y="-4" width="' + bar.toFixed(1) + '" height="4" fill="var(--tx)"/><text y="-9" stroke="var(--land)" stroke-width="4" stroke-linejoin="round" paint-order="stroke">' + nm + ' nm</text></g></svg>';
  }
  window.CNPics = { forceWord: function (kn) { return FORCE_WORD[force(kn)]; }, wind: wind, tide: tide, sog: sog, cog: cog, ice: ice, boatdata: boatdata, weather: weather, logbook: logbook, atlantic: atlantic, voyage: voyage, chart: chart, loadCoast: loadCoast, force: force, coastReady: function () { return !!coast; } };
})();
