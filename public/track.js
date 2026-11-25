/* Crow's Nest - voyage map. A small self-contained slippy map (no map library). Default "Chart" look = the dashboard's Position picture: sea navy,
   real coastline (public/coast.js, Natural Earth) in slate, the track as an amber dotted trail with the boat riding its head; it works offline. "Detail"
   switches to OpenStreetMap + OpenSeaMap tiles (needs a connection). The track draws itself on when a voyage opens (skippable, off for reduced motion). */
(function () {
  'use strict';
  try { if (localStorage.getItem('cn_theme') === 'night') document.documentElement.classList.add('night'); } catch (e) {}   // same red-light mode as the dashboard
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var J = { 'Content-Type': 'application/json' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

  /* ------------------------------------------------------------ formatting */
  function ddm(v, pos, neg) {
    var a = Math.abs(v), deg = Math.floor(a), min = (a - deg) * 60;
    if (min >= 59.9995) { deg += 1; min = 0; }
    return String(deg).padStart(pos === 'N' ? 2 : 3, '0') + '°' + min.toFixed(3).padStart(6, '0') + '′' + (v >= 0 ? pos : neg);
  }
  function ddmShort(v, pos, neg) {   // for grid labels
    var a = Math.abs(v), deg = Math.floor(a + 1e-9), min = Math.round((a - deg) * 60);
    if (min === 60) { deg += 1; min = 0; }
    return deg + '°' + (min ? p2(min) + '′' : '') + (v >= 0 ? pos : neg);
  }
  function posText(p) { return ddm(p.lat, 'N', 'S') + ' ' + ddm(p.lon, 'E', 'W'); }
  function dt(iso) { var t = new Date(iso); return t.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function day(iso) { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  function dur(ms) {
    var m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    if (d) return d + 'd ' + h + 'h';
    return h + 'h ' + p2(m % 60) + 'm';
  }
  function nm1(x) { return x == null ? '—' : x.toFixed(1); }
  var SRC = { auto: 'timer', tap: 'work/rest tap', end: 'voyage end', manual: 'logged by hand', typed: 'typed in', device: 'boat device', background: 'phone (background)' };

  /* ------------------------------------------------------------ api + toast */
  async function api(url, opt) {
    var r = await fetch(url, Object.assign({ cache: 'no-store' }, opt || {}));
    if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; try { e.body = await r.json(); } catch (x) {} throw e; }
    return r.json();
  }
  var toastTimer = null, toastUndo = null;
  function toast(text, undo) {
    $('#toastText').textContent = text; toastUndo = undo || null;
    $('#toastUndo').style.display = undo ? '' : 'none';
    $('#toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { $('#toast').classList.remove('show'); toastUndo = null; }, undo ? 9000 : 4000);
  }
  $('#toastUndo').addEventListener('click', function () { var u = toastUndo; $('#toast').classList.remove('show'); toastUndo = null; if (u) u(); });
  function say(text, err) { var s = $('#status'); s.textContent = text || ''; s.className = 't-status' + (err ? ' err' : ''); }

  /* ------------------------------------------------------------ the map */
  var TILE = 256, MINZ = 2, MAXZ = 17;
  var SOURCES = {
    base: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, z: 1 },
    sea: { url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', max: 18, z: 2 }
  };
  function lonToX(lon, z) { return (lon + 180) / 360 * TILE * Math.pow(2, z); }
  function latToY(lat, z) {
    var s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z);
  }
  function xToLon(x, z) { return x / (TILE * Math.pow(2, z)) * 360 - 180; }
  function yToLat(y, z) { var n = Math.PI - 2 * Math.PI * y / (TILE * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }
  var NS = 'http://www.w3.org/2000/svg';

  function MapView(el) {
    this.el = el; this.lat = 56.5; this.lon = -5.5; this.z = 6; this.sea = true; this.mode = 'chart'; this.reveal = 1; this.anim = null; this.route = null; this.headAng = null;
    this.tiles = {}; this.pending = 0; this.loaded = 0; this.failed = 0;
    this.data = null; this.sel = null; this.hits = [];
    this.w = el.clientWidth; this.h = el.clientHeight;
    this.landSvg = document.createElementNS(NS, 'svg'); this.landSvg.setAttribute('class', 'tm-land'); this.landSvg.setAttribute('aria-hidden', 'true');
    this.gridSvg = document.createElementNS(NS, 'svg'); this.gridSvg.setAttribute('class', 'tm-grid'); this.gridSvg.setAttribute('aria-hidden', 'true');
    this.tileDiv = document.createElement('div'); this.tileDiv.className = 'tm-tiles'; this.tileDiv.setAttribute('aria-hidden', 'true');
    this.trackSvg = document.createElementNS(NS, 'svg'); this.trackSvg.setAttribute('class', 'tm-track'); this.trackSvg.setAttribute('aria-hidden', 'true');
    this.msg = document.createElement('div'); this.msg.className = 'tm-msg'; this.msg.hidden = true;
    this.ctrl = document.createElement('div'); this.ctrl.className = 'tm-ctrl';
    this.ctrl.innerHTML =
      '<button type="button" data-m="in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-m="out" aria-label="Zoom out">−</button>' +
      '<button type="button" data-m="fit" aria-label="Show the whole track"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>' +
      '<button type="button" data-m="here" aria-label="Go to my position"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg></button>' +
      '<button type="button" data-m="detail" aria-pressed="false" aria-label="Detailed map: streets and sea marks (needs a connection)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg></button>' +
      '<button type="button" data-m="sea" aria-pressed="true" aria-label="Sea marks (buoys, lights, harbours)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M7 8h10M5 17c2 2 4 2 7 0s5-2 7 0"/></svg></button>';
    this.attr = document.createElement('div'); this.attr.className = 'tm-attr';
    this.hint = document.createElement('div'); this.hint.className = 'tm-hint'; this.hint.hidden = true; this.hint.textContent = 'The coastline is approximate at this zoom. Tap Detail for streets and sea marks.';
    this.setAttr();
    el.classList.add('chart'); el.appendChild(this.landSvg); el.appendChild(this.gridSvg); el.appendChild(this.tileDiv); el.appendChild(this.trackSvg); el.appendChild(this.msg); el.appendChild(this.hint); el.appendChild(this.ctrl); el.appendChild(this.attr);
    this.bind();
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(el);
    window.addEventListener('resize', function () { self.resize(); });
    window.addEventListener('beforeprint', function () { self.resize(); });
    window.addEventListener('afterprint', function () { self.resize(); });
  }
  MapView.prototype.setAttr = function () {
    this.attr.innerHTML = this.mode === 'detail'
      ? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · <a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a>'
      : 'Coastline: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a>';
  };
  MapView.prototype.setMode = function (m) {
    this.mode = m === 'detail' ? 'detail' : 'chart';
    this.el.classList.toggle('chart', this.mode === 'chart'); this.el.classList.toggle('detail', this.mode === 'detail');
    var d = this.ctrl.querySelector('[data-m=detail]'), sea = this.ctrl.querySelector('[data-m=sea]');
    d.setAttribute('aria-pressed', String(this.mode === 'detail')); sea.hidden = this.mode !== 'detail';
    this.msg.hidden = true; this.setAttr(); this.redraw();
  };
  /* the land: the bundled coastline in Web Mercator, scaled to this zoom with a multiply and a subtract; points closer than a pixel are skipped */
  MapView.prototype.drawLand = function () {
    var svg = this.landSvg, rings = window.CNCoast && window.CNCoast.rings();
    svg.setAttribute('viewBox', '0 0 ' + this.w + ' ' + this.h);
    if (this.mode !== 'chart' || !rings) { svg.innerHTML = ''; return; }
    var sc = Math.pow(2, this.z), ox = lonToX(this.lon, this.z) - this.w / 2, oy = latToY(this.lat, this.z) - this.h / 2, pad = 40, d = [];
    var x0 = (ox - pad) / sc, x1 = (ox + this.w + pad) / sc, y0 = (oy - pad) / sc, y1 = (oy + this.h + pad) / sc;
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i]; if (r.bb[2] < x0 || r.bb[0] > x1 || r.bb[3] < y0 || r.bb[1] > y1) continue;
      var X = r.x, Y = r.y, n = X.length, px = 0, py = 0, seg = '', cnt = 0;
      for (var j = 0; j < n; j++) {
        var x = X[j] * sc - ox, y = Y[j] * sc - oy;
        if (cnt && Math.abs(x - px) < 0.8 && Math.abs(y - py) < 0.8 && j < n - 1) continue;
        seg += (cnt ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); px = x; py = y; cnt++;
      }
      if (cnt > 2) d.push(seg + 'Z');
    }
    svg.innerHTML = d.length ? '<path d="' + d.join('') + '" fill="var(--land)" fill-rule="evenodd" stroke="var(--coast)" stroke-width="2" stroke-linejoin="round"/>' : '';
  };
  // the "coastline is approximate" note shows for 7 s when you zoom in past the data's detail, then gets out of the way
  MapView.prototype.updateHint = function () {
    var self = this, want = this.mode === 'chart' && this.z >= 10.5;
    if (want && !this.hintOn) { this.hintOn = true; this.hint.hidden = false; clearTimeout(this.hintT); this.hintT = setTimeout(function () { self.hint.hidden = true; }, 7000); }
    else if (!want) { this.hintOn = false; clearTimeout(this.hintT); this.hint.hidden = true; }
  };
  MapView.prototype.resize = function () {
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h || (w === this.w && h === this.h)) return;
    this.w = w; this.h = h; this.redraw();
  };
  MapView.prototype.px = function (lat, lon) {   // lat/lon -> pixels inside the map box
    return [lonToX(lon, this.z) - (lonToX(this.lon, this.z) - this.w / 2), latToY(lat, this.z) - (latToY(this.lat, this.z) - this.h / 2)];
  };
  MapView.prototype.unpx = function (x, y) {
    var cx = lonToX(this.lon, this.z), cy = latToY(this.lat, this.z);
    return { lat: yToLat(cy - this.h / 2 + y, this.z), lon: xToLon(cx - this.w / 2 + x, this.z) };
  };
  MapView.prototype.panBy = function (dx, dy) {
    var cx = lonToX(this.lon, this.z) - dx, cy = latToY(this.lat, this.z) - dy;
    this.lon = xToLon(cx, this.z); this.lat = Math.max(-84, Math.min(84, yToLat(cy, this.z)));
    this.redraw();
  };
  MapView.prototype.zoomAt = function (dz, x, y) {
    var nz = Math.max(MINZ, Math.min(MAXZ + 1, this.z + dz));
    if (nz === this.z) return;
    var at = this.unpx(x, y); this.z = nz;
    var wx = lonToX(at.lon, nz), wy = latToY(at.lat, nz);
    this.lon = xToLon(wx - (x - this.w / 2), nz); this.lat = Math.max(-84, Math.min(84, yToLat(wy - (y - this.h / 2), nz)));
    this.redraw();
  };
  MapView.prototype.setView = function (lat, lon, z) { this.lat = lat; this.lon = lon; this.z = Math.max(MINZ, Math.min(MAXZ + 1, z)); this.redraw(); };
  MapView.prototype.fit = function (bbox) {
    if (!bbox) return;
    var pad = 44, w = Math.max(100, this.w - 2 * pad - 64), h = Math.max(100, this.h - 2 * pad);
    var spanX = (bbox[3] - bbox[1]) / 360 * TILE, spanY = latToY(bbox[0], 0) - latToY(bbox[2], 0), z;
    if (spanX < 1e-7 && spanY < 1e-7) z = 13; else z = Math.min(Math.log2(w / Math.max(spanX, 1e-9)), Math.log2(h / Math.max(spanY, 1e-9)), 14);
    z = Math.max(MINZ, z);
    var cy = (latToY(bbox[0], 0) + latToY(bbox[2], 0)) / 2;
    this.setView(yToLat(cy, 0), (bbox[1] + bbox[3]) / 2, z);
  };
  MapView.prototype.setSea = function (on) { this.sea = on; this.updateTiles(); };

  /* tiles */
  MapView.prototype.tileUrl = function (src, z, x, y) { return SOURCES[src].url.replace('{z}', z).replace('{x}', x).replace('{y}', y); };
  MapView.prototype.updateTiles = function () {
    if (this.mode !== 'detail') {   // the chart needs no tiles at all
      for (var k in this.tiles) { this.tiles[k].img.remove(); }
      this.tiles = {}; this.pending = 0; return;
    }
    var self = this, z = this.z, zi = Math.max(MINZ, Math.min(MAXZ, Math.round(z))), s = Math.pow(2, z - zi), ts = TILE * s;
    var ox = lonToX(this.lon, z) - this.w / 2, oy = latToY(this.lat, z) - this.h / 2, n = Math.pow(2, zi);
    var need = {}, x0 = Math.floor(ox / ts), x1 = Math.floor((ox + this.w) / ts), y0 = Math.floor(oy / ts), y1 = Math.floor((oy + this.h) / ts);
    var layers = this.sea ? ['base', 'sea'] : ['base'];
    layers.forEach(function (L) {
      if (zi > SOURCES[L].max) return;
      for (var tx = x0; tx <= x1; tx++) for (var ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= n) continue;
        var key = L + '/' + zi + '/' + tx + '/' + ty; need[key] = 1;
        if (!self.tiles[key]) self.addTile(key, L, zi, tx, ty);
      }
    });
    Object.keys(this.tiles).forEach(function (key) {
      var t = self.tiles[key], keep = need[key] || (t.L === 'sea' && !self.sea ? false : (t.zi !== zi && self.pending > 0));
      if (!keep) { t.img.remove(); delete self.tiles[key]; return; }
      var sz = TILE * Math.pow(2, z - t.zi), st = t.img.style;
      st.left = (t.tx * sz - ox).toFixed(2) + 'px'; st.top = (t.ty * sz - oy).toFixed(2) + 'px'; st.width = st.height = (sz + 0.6).toFixed(2) + 'px';
    });
  };
  MapView.prototype.addTile = function (key, L, zi, tx, ty) {
    var self = this, n = Math.pow(2, zi), img = new Image();
    img.alt = ''; img.draggable = false; img.decoding = 'async'; img.style.zIndex = SOURCES[L].z;
    this.pending++;
    img.onload = function () { self.pending--; self.loaded++; img.classList.add('in'); self.afterTiles(); };
    img.onerror = function () { self.pending--; self.failed++; if (self.tiles[key]) { self.tiles[key].bad = true; img.style.display = 'none'; } self.afterTiles(); };   // keep the entry so it is not requested again in a loop
    img.src = this.tileUrl(L, zi, ((tx % n) + n) % n, ty);
    this.tiles[key] = { img: img, L: L, zi: zi, tx: tx, ty: ty };
    this.tileDiv.appendChild(img);
  };
  MapView.prototype.retryTiles = function () {   // back online: forget the tiles that failed and ask again
    var self = this;
    Object.keys(this.tiles).forEach(function (k) { if (self.tiles[k].bad) { self.tiles[k].img.remove(); delete self.tiles[k]; } });
    this.failed = 0; this.updateTiles();
  };
  MapView.prototype.afterTiles = function () {
    if (this.pending > 0) return;
    this.updateTiles();   // drop tiles left over from the previous zoom level
    var offline = this.mode === 'detail' && this.failed > 0 && this.loaded === 0;
    this.msg.hidden = !offline;
    if (offline) this.msg.textContent = 'Detail needs a connection. The track is still drawn. Tap Detail again to go back to the chart, which works offline.';
  };

  /* graticule (shows wherever tiles are missing) */
  MapView.prototype.drawGrid = function () {
    var steps = [20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 1 / 12, 1 / 30, 1 / 60, 1 / 120, 1 / 300], pxPerDegX = lonToX(1, this.z) - lonToX(0, this.z), step = steps[0];
    for (var i = 0; i < steps.length; i++) { step = steps[i]; if (steps[i + 1] === undefined || steps[i + 1] * pxPerDegX < 110) break; }
    var tl = this.unpx(0, 0), br = this.unpx(this.w, this.h), out = '', k;
    for (k = Math.ceil(tl.lon / step); k * step <= br.lon; k++) { var lon = k * step, x = this.px(0, lon)[0]; out += '<line x1="' + x.toFixed(1) + '" y1="0" x2="' + x.toFixed(1) + '" y2="' + this.h + '"/><text x="' + (x + 4).toFixed(1) + '" y="' + (this.h - 24) + '">' + ddmShort(lon, 'E', 'W') + '</text>'; }
    for (k = Math.ceil(br.lat / step); k * step <= tl.lat; k++) { var lat = k * step, y = this.px(lat, 0)[1]; out += '<line x1="0" y1="' + y.toFixed(1) + '" x2="' + this.w + '" y2="' + y.toFixed(1) + '"/><text x="4" y="' + (y - 4).toFixed(1) + '">' + ddmShort(lat, 'N', 'S') + '</text>'; }
    this.gridSvg.innerHTML = out;
  };

  /* the track */
  MapView.prototype.setTrack = function (data, animate) {
    this.data = data; this.sel = null;
    if (this.anim && !animate) { this.drawTrack(); return; }   // a refresh while the line is drawing on: new data, same animation
    this.stopAnim();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var used = data ? data.points.filter(function (p) { return p.used; }) : [];
    this.reveal = animate && !reduce && used.length > 1 ? 0 : 1;
    this.fx = !!animate && !reduce;   // markers pop in on this first draw only (a pan redraws the same markers without popping again)
    this.drawTrack(); this.fx = false;
    if (this.reveal === 0) this.playAnim(data);
  };
  /* the draw-on: a mask along the route is drawn from the start, the boat rides its head, a tap skips it */
  MapView.prototype.stopAnim = function () { if (this.anim) { cancelAnimationFrame(this.anim.raf); clearTimeout(this.anim.to); this.anim = null; } };
  MapView.prototype.finishAnim = function () { if (!this.anim) return; this.stopAnim(); this.reveal = 1; this.applyReveal(false); };
  MapView.prototype.playAnim = function (data) {
    var self = this, nm = (data && data.stats && data.stats.distanceNm) || 30, dur = Math.max(1500, Math.min(3400, 1200 + nm * 6)), a = this.anim = { raf: 0, to: 0, t0: 0 };
    a.to = setTimeout(function () {   // a short beat so the chart settles before the line is drawn
      function frame(t) {
        if (self.anim !== a) return;
        if (!a.t0) a.t0 = t;
        var k = Math.min(1, (t - a.t0) / dur); self.reveal = 0.5 - Math.cos(Math.PI * k) / 2;
        if (k < 1) { self.applyReveal(false); a.raf = requestAnimationFrame(frame); } else { self.anim = null; self.reveal = 1; self.applyReveal(true); }
      }
      a.raf = requestAnimationFrame(frame);
    }, 450);
  };
  MapView.prototype.applyReveal = function (natural) {
    var svg = this.trackSvg, mp = svg.querySelector('#trMaskPath'), hd = svg.querySelector('#trHead'), lb = svg.querySelector('#trHeadLbl');
    if (!hd || !this.route || this.route.length < 2) return;
    var done = this.reveal >= 1, x, y, ang = null;
    if (mp && !done) {
      mp.style.strokeDashoffset = String(1000 * (1 - this.reveal));   // the style wins over the attribute
      var L = mp.getTotalLength(), dd = L * this.reveal, p = mp.getPointAtLength(dd), p0 = mp.getPointAtLength(Math.max(0, dd - 12)), p1 = mp.getPointAtLength(Math.min(L, dd + 12));
      x = p.x; y = p.y; if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.5) ang = Math.atan2(p1.x - p0.x, -(p1.y - p0.y)) * 180 / Math.PI;
    } else { var e = this.route[this.route.length - 1]; x = e[0]; y = e[1]; ang = this.headAng; }
    hd.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    var ar = hd.querySelector('#trArrow'); if (ar && ang != null) ar.setAttribute('transform', 'rotate(' + Math.round(ang) + ')');
    if (lb) lb.style.opacity = done ? '' : '0';
    if (done) {
      var m = svg.querySelector('g[mask]'); if (m) m.removeAttribute('mask');
      if (natural) { var pu = hd.querySelector('#trPulse'); if (pu) pu.classList.add('pulse'); if (lb) lb.classList.add('tm-fadein'); }
    }
  };
  MapView.prototype.drawTrack = function () {
    var d = this.data, svg = this.trackSvg, self = this;
    this.hits = []; svg.setAttribute('viewBox', '0 0 ' + this.w + ' ' + this.h);
    if (!d) { svg.innerHTML = ''; this.route = null; return; }
    var used = d.points.filter(function (p) { return p.used; }), byId = {}, f1 = function (n) { return n.toFixed(1); }, pt = function (q) { return f1(q[0]) + ',' + f1(q[1]); };
    used.forEach(function (p) { byId[p.id] = self.px(p.lat, p.lon); });
    var solid = '', gaps = '', arrows = '', marks = '', run = [];
    function flush() { if (run.length > 1) solid += '<polyline points="' + run.map(pt).join(' ') + '"/>'; run = []; }
    d.legs.forEach(function (lg) {
      var a = byId[lg.from], b = byId[lg.to]; if (!a || !b) return;
      if (lg.gap) { flush(); gaps += '<line x1="' + f1(a[0]) + '" y1="' + f1(a[1]) + '" x2="' + f1(b[0]) + '" y2="' + f1(b[1]) + '"/>'; }
      else { if (!run.length) run.push(a); run.push(b); }
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 46) {
        var ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 90;
        arrows += '<path d="M-5,4 L0,-6 L5,4 L0,1.5 Z" transform="translate(' + f1((a[0] + b[0]) / 2) + ' ' + f1((a[1] + b[1]) / 2) + ') rotate(' + ang.toFixed(0) + ')"/>';
      }
    });
    flush();
    // every fix can be tapped; only one marker per 14 px is drawn, so a long track stays calm
    var lastM = null;
    used.forEach(function (p, i) {
      var q = byId[p.id]; if (q[0] < -20 || q[1] < -20 || q[0] > self.w + 20 || q[1] > self.h + 20) return;
      self.hits.push({ p: p, x: q[0], y: q[1] });
      if (i === 0 || (i === used.length - 1 && used.length > 1)) return;
      if (lastM && Math.hypot(q[0] - lastM[0], q[1] - lastM[1]) < 14) return;
      lastM = q; marks += '<circle cx="' + f1(q[0]) + '" cy="' + f1(q[1]) + '" r="4.2"/>';
    });
    var f = used[0], l = used[used.length - 1], open = !d.voyage.end, route = used.map(function (p) { return byId[p.id]; });
    this.route = route; this.headAng = null;
    if (route.length > 1) {   // the boat points the way it is going: the fix's course when it is moving, else the last leg
      var q1 = route[route.length - 2], q2 = route[route.length - 1];
      this.headAng = l.cog != null && (l.sog == null || l.sog >= 0.5) ? l.cog : Math.atan2(q2[0] - q1[0], -(q2[1] - q1[1])) * 180 / Math.PI;
    }
    var revealing = this.reveal < 1 && route.length > 1;
    var defs = revealing ? '<defs><mask id="trMask" maskUnits="userSpaceOnUse" x="0" y="0" width="' + this.w + '" height="' + this.h + '"><polyline id="trMaskPath" points="' + route.map(pt).join(' ') + '" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" pathLength="1000" stroke-dasharray="1000" stroke-dashoffset="' + (1000 * (1 - this.reveal)).toFixed(1) + '"/></mask></defs>' : '';
    var ends = '', pop = this.fx ? ' class="tm-pop"' : '';
    if (f) {
      var a0 = this.dragAt || byId[f.id];
      if (this.editStart) ends += '<circle cx="' + f1(a0[0]) + '" cy="' + f1(a0[1]) + '" r="18" fill="none" stroke="var(--tx)" stroke-width="2" stroke-dasharray="4 3"/>';
      this.startPx = a0;
      ends += '<circle' + pop + ' cx="' + f1(a0[0]) + '" cy="' + f1(a0[1]) + '" r="8" fill="var(--ok)" stroke="var(--sea)" stroke-width="3"/><text x="' + f1(a0[0] + 12) + '" y="' + f1(a0[1] + 4) + '">Start</text>';
    }
    if (l && l !== f) {   // the boat on an open voyage (same marker as the dashboard's Position picture), a plain disc once it has ended
      var shape = open
        ? '<g transform="scale(.85)"><circle r="30" fill="var(--acc)" opacity=".22"/><circle id="trPulse" r="17" fill="none" stroke="var(--acc)" stroke-width="3" opacity="0"/><circle r="17" fill="none" stroke="var(--acc)" stroke-width="3"/><g id="trArrow" transform="rotate(' + Math.round(this.headAng || 0) + ')"><path d="M0 -13 L9 11 L0 6 L-9 11Z" fill="var(--acc)" stroke="#0009" stroke-width="2"/></g></g>'
        : '<circle r="10" fill="var(--acc)" stroke="var(--sea)" stroke-width="3"/>';
      var a1 = byId[l.id];
      ends += '<g id="trHead" class="tm-boat" transform="translate(' + f1(a1[0]) + ' ' + f1(a1[1]) + ')">' + shape + '<text id="trHeadLbl" x="' + (open ? 24 : 15) + '" y="4"' + (revealing ? ' style="opacity:0"' : '') + '>' + (open ? 'Latest' : 'End') + '</text></g>';
    }
    var selSvg = '';
    if (this.sel && byId[this.sel]) { var s = byId[this.sel]; selSvg = '<circle cx="' + f1(s[0]) + '" cy="' + f1(s[1]) + '" r="13" fill="none" stroke="var(--tx)" stroke-width="3"/><circle cx="' + f1(s[0]) + '" cy="' + f1(s[1]) + '" r="13" fill="none" stroke="var(--sea)" stroke-width="1" stroke-dasharray="4 4"/>'; }
    var me = '';
    if (this.me) { var m = this.px(this.me.lat, this.me.lon); me = '<circle cx="' + f1(m[0]) + '" cy="' + f1(m[1]) + '" r="9" fill="var(--me)" stroke="var(--tx)" stroke-width="3"/>'; }
    svg.innerHTML = defs +
      '<g' + (revealing ? ' mask="url(#trMask)"' : '') + '>' +
      '<g fill="none" stroke="var(--sea)" stroke-opacity=".8" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 11">' + solid + '</g>' +   // a dark halo keeps the dots readable on light Detail tiles
      '<g fill="none" stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 11">' + solid + '</g>' +
      '<g fill="none" stroke="var(--acc)" stroke-opacity=".5" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 17">' + gaps + '</g>' +
      '<g fill="var(--tx)" stroke="var(--sea)" stroke-width="1.2">' + arrows + '</g>' +
      '<g fill="var(--sea)" stroke="var(--acc)" stroke-width="2">' + marks + '</g></g>' + selSvg + ends + me;
    this.applyReveal(false);
  };
  MapView.prototype.redraw = function () { this.updateTiles(); this.drawGrid(); this.drawLand(); this.drawTrack(); this.updateHint(); };
  MapView.prototype.pick = function (x, y) {
    var best = null, bd = 22;
    this.hits.forEach(function (h) { var dd = Math.hypot(h.x - x, h.y - y); if (dd < bd) { bd = dd; best = h; } });
    this.sel = best ? best.p.id : null; this.drawTrack();
    if (this.onpick) this.onpick(best ? best.p : null);
  };

  /* gestures */
  MapView.prototype.bind = function () {
    var self = this, el = this.el, ptrs = {}, last = null, moved = 0, start = null;
    function list() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
    function rel(e) { var r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.tm-ctrl,.tm-attr,.tm-msg')) return;
      self.finishAnim();   // touching the map skips the draw-on
      if (self.editStart && self.startPx && !Object.keys(ptrs).length) {
        var q0 = rel(e);
        if (Math.hypot(q0[0] - self.startPx[0], q0[1] - self.startPx[1]) < 32) { el.setPointerCapture(e.pointerId); self.mk = e.pointerId; self.dragAt = q0; self.drawTrack(); e.preventDefault(); return; }
      }
      el.setPointerCapture(e.pointerId); ptrs[e.pointerId] = rel(e); moved = 0; start = rel(e); last = null;
      el.classList.add('drag');
    });
    el.addEventListener('pointermove', function (e) {
      if (self.mk === e.pointerId) { self.dragAt = rel(e); self.drawTrack(); return; }
      if (!ptrs[e.pointerId]) return;
      var now = rel(e), prev = ptrs[e.pointerId], ids = Object.keys(ptrs);
      if (ids.length === 1) { var dx = now[0] - prev[0], dy = now[1] - prev[1]; moved += Math.abs(dx) + Math.abs(dy); ptrs[e.pointerId] = now; self.panBy(dx, dy); }
      else if (ids.length === 2) {
        var o = ids.find(function (k) { return +k !== e.pointerId; }), other = ptrs[o];
        var d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]), d1 = Math.hypot(now[0] - other[0], now[1] - other[1]);
        var mx0 = (prev[0] + other[0]) / 2, my0 = (prev[1] + other[1]) / 2, mx1 = (now[0] + other[0]) / 2, my1 = (now[1] + other[1]) / 2;
        ptrs[e.pointerId] = now; moved += 99;
        if (d0 > 8 && d1 > 8) self.zoomAt(Math.log2(d1 / d0), mx1, my1);
        self.panBy(mx1 - mx0, my1 - my0);
      }
    });
    function up(e) {
      if (self.mk === e.pointerId) {
        var at = self.dragAt, ok = e.type === 'pointerup' && at; self.mk = null; self.dragAt = null;
        if (ok) { var ll = self.unpx(at[0], at[1]); if (self.onmove) self.onmove(ll.lat !== undefined ? ll.lat : ll[0], ll.lon !== undefined ? ll.lon : ll[1]); }
        self.drawTrack(); return;
      }
      if (!ptrs[e.pointerId]) return;
      var wasOne = Object.keys(ptrs).length === 1; delete ptrs[e.pointerId];
      if (!Object.keys(ptrs).length) el.classList.remove('drag');
      if (wasOne && moved < 8 && start && e.type === 'pointerup') self.pick(start[0], start[1]);
    }
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', function (e) { e.preventDefault(); var p = rel(e); self.zoomAt(-Math.sign(e.deltaY) * 0.6, p[0], p[1]); }, { passive: false });
    el.addEventListener('dblclick', function (e) { if (e.target.closest('.tm-ctrl')) return; var p = rel(e); self.zoomAt(1, p[0], p[1]); });
    el.addEventListener('keydown', function (e) {
      var k = e.key, step = 80;
      if (k === 'ArrowLeft') self.panBy(step, 0); else if (k === 'ArrowRight') self.panBy(-step, 0);
      else if (k === 'ArrowUp') self.panBy(0, step); else if (k === 'ArrowDown') self.panBy(0, -step);
      else if (k === '+' || k === '=') self.zoomAt(1, self.w / 2, self.h / 2); else if (k === '-' || k === '_') self.zoomAt(-1, self.w / 2, self.h / 2);
      else return;
      e.preventDefault();
    });
  };

  /* ------------------------------------------------------------ page */
  var S = { voyages: [], id: null, data: null, timer: null, settings: null };
  var map = new MapView($('#map'));
  map.ctrl.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var m = b.getAttribute('data-m');
    if (m === 'in') map.zoomAt(1, map.w / 2, map.h / 2);
    else if (m === 'out') map.zoomAt(-1, map.w / 2, map.h / 2);
    else if (m === 'fit') { if (S.data && S.data.stats.bbox) map.fit(S.data.stats.bbox); }
    else if (m === 'detail') { var dm = map.mode === 'detail' ? 'chart' : 'detail'; map.setMode(dm); try { localStorage.setItem('cn_mapmode', dm); } catch (x) {} }
    else if (m === 'sea') { var on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); map.setSea(on); try { localStorage.setItem('cn_sea', on ? '1' : '0'); } catch (x) {} }
    else if (m === 'here') locate(true);
  });
  try { if (localStorage.getItem('cn_sea') === '0') { map.sea = false; map.ctrl.querySelector('[data-m=sea]').setAttribute('aria-pressed', 'false'); } } catch (x) {}
  try { map.setMode(localStorage.getItem('cn_mapmode') === 'detail' ? 'detail' : 'chart'); } catch (x) { map.setMode('chart'); }
  if (window.CNCoast) window.CNCoast.load().then(function (r) { if (r) map.redraw(); });
  map.onpick = function (p) {
    var el = $('#picked');
    if (!p) { el.textContent = 'Tap a point on the track for its time and position.'; return; }
    el.innerHTML = '<b>' + esc(dt(p.ts)) + '</b> · ' + esc(posText(p)) + (p.acc != null ? ' · ±' + Math.round(p.acc) + ' m' : '') + (p.sog != null ? ' · SOG ' + p.sog.toFixed(1) + ' kn' : '') + (p.cog != null ? ' · COG ' + p2(Math.round(p.cog)).padStart(3, '0') + '°' : '') + ' · ' + esc(SRC[p.source] || p.source);
  };

  function lastKnown() { try { var f = JSON.parse(localStorage.getItem('cn_fix') || 'null'); if (f && isFinite(f.lat) && isFinite(f.lon)) return f; } catch (e) {} return null; }
  function geo(opts) { return new Promise(function (ok, no) { if (!navigator.geolocation) return no({ code: 0 }); navigator.geolocation.getCurrentPosition(ok, no, opts); }); }
  function geoError(e) {
    if (e && e.code === 1) return 'Location is switched off for this site. On iPhone: Settings, Privacy and Security, Location Services, Safari Websites (or Crow\'s Nest) and choose While Using.';
    if (e && e.code === 3) return 'No GPS fix yet. Try again with a clear view of the sky.';
    if (e && e.code === 0) return 'This browser cannot give a position.';
    return 'Position not available right now. Try again in a moment.';
  }
  async function locate(centre) {
    try {
      var pos = await geo({ enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
      map.me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (centre) map.setView(map.me.lat, map.me.lon, Math.max(map.z, 11)); else map.drawTrack();
      return pos;
    } catch (e) { var k = lastKnown(); if (k && centre) { map.me = { lat: k.lat, lon: k.lon }; map.setView(k.lat, k.lon, Math.max(map.z, 10)); say('Showing your last known position (' + dt(k.ts || Date.now()) + ').'); } else say(geoError(e), true); return null; }
  }

  function renderSelect() {
    var sel = $('#voySel');
    $('#pickWrap').hidden = !S.voyages.length;
    sel.innerHTML = S.voyages.map(function (v) {
      var open = !v.end;
      return '<option value="' + esc(v.id) + '"' + (v.id === S.id ? ' selected' : '') + '>' + (open ? 'Current' : 'Voyage') + ' · ' + day(v.start) + ' – ' + (open ? 'now' : day(v.end)) + ' · ' + Math.round(v.distanceNm) + ' NM</option>';
    }).join('');
  }
  function stat(k, v, s, cls) { return '<div class="t-stat ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
  function renderStats() {
    var d = S.data, s = d.stats, v = d.voyage, open = !v.end;
    var endMs = open ? Date.now() : Date.parse(v.end), used = d.points.filter(function (p) { return p.used; });
    var first = used[0], lastp = used[used.length - 1];
    $('#statsSub').textContent = dt(v.start) + ' to ' + (open ? 'now (voyage open)' : dt(v.end));
    $('#stats').innerHTML =
      stat('Distance', nm1(s.distanceNm) + ' <small>NM</small>', 'approximate') +
      stat('Time on voyage', dur(endMs - Date.parse(v.start)), open ? 'so far' : '') +
      stat('Average under way', s.avgKn == null ? '—' : s.avgKn.toFixed(1) + ' <small>kn</small>', 'not counting time at anchor') +
      stat('Fastest leg', s.maxLegKn == null ? '—' : s.maxLegKn.toFixed(1) + ' <small>kn</small>', 'between two positions') +
      stat('Positions', String(s.used) + (s.ignored ? ' <small>(' + s.ignored + ' ignored)</small>' : ''), s.gaps ? s.gaps + ' gap' + (s.gaps === 1 ? '' : 's') + ' over ' + d.margin.gapHours + ' h' : 'no long gaps') +
      stat('Start', first ? esc(ddm(first.lat, 'N', 'S')) + '<br>' + esc(ddm(first.lon, 'E', 'W')) : '—', first ? esc(dt(first.ts)) : 'no position yet', 'pos') +
      stat(open ? 'Latest' : 'End', lastp && lastp !== first ? esc(ddm(lastp.lat, 'N', 'S')) + '<br>' + esc(ddm(lastp.lon, 'E', 'W')) : '—', lastp && lastp !== first ? esc(dt(lastp.ts)) : '', 'pos');
    var note = '';
    if (!s.used) note = 'No positions yet for this voyage. One is recorded each time you tap Work or Rest, and on a timer while Crow’s Nest is open. You can also add one below.';
    else if (s.used === 1) note = 'One position so far. The track appears when there are two or more.';
    else note = 'Straight lines between ' + s.used + ' positions, so the distance is approximate. Fixes less accurate than ' + d.margin.maxAccuracyM + ' m or that jump faster than 45 kn are ignored.';
    $('#statsNote').textContent = note;
    var ves = d.vessel, who = [v.crewName, v.crewRole].filter(Boolean).join(', ');
    $('#vesselLine').textContent = [ves.vessel, who].filter(Boolean).join(' · ') || ' ';
    $('#printHead').innerHTML = window.CNBrand.letterhead('Voyage track') + '<h1>Voyage track' + (ves.vessel ? ' – ' + esc(ves.vessel) : '') + '</h1><p>' + [ves.officialNumber ? 'Official number ' + esc(ves.officialNumber) : '', ves.flag ? esc(ves.flag) : '', who ? esc(who) : ''].filter(Boolean).join(' · ') + '</p><p>' + esc(dt(v.start)) + ' to ' + (open ? 'now' : esc(dt(v.end))) + ' · printed ' + esc(dt(new Date().toISOString())) + '</p>';
  }
  function renderFixes() {
    var d = S.data, pts = d.points.slice().reverse(), shown = pts.slice(0, 120);
    $('#fixSub').textContent = d.points.length ? d.points.length + ' position' + (d.points.length === 1 ? '' : 's') + ' recorded, newest first.' : 'Nothing recorded yet.';
    $('#fixList').innerHTML = shown.map(function (p) {
      return '<li class="t-fix' + (p.used ? '' : ' off') + '"><div class="m"><b>' + esc(dt(p.ts)) + '</b><span>' + esc(posText(p)) + ' · ' + esc(SRC[p.source] || p.source) + (p.acc != null ? ' · ±' + Math.round(p.acc) + ' m' : '') + (p.used ? '' : ' · ignored: ' + (p.why === 'jump' ? 'jumped too far' : 'not accurate enough')) + '</span></div>' +
        '<button type="button" data-rm="' + esc(p.id) + '" aria-label="Remove the position at ' + esc(dt(p.ts)) + '">Remove</button></li>';
    }).join('') + (pts.length > shown.length ? '<li class="t-fix"><div class="m"><span>The ' + (pts.length - shown.length) + ' oldest are in the CSV download.</span></div></li>' : '');
  }
  $('#fixList').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-rm]'); if (!b) return;
    var id = b.getAttribute('data-rm');
    try {
      await api('/api/positions/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadVoyage(false);
      toast('Position removed', async function () { try { await api('/api/positions/' + encodeURIComponent(id) + '/restore', { method: 'POST' }); await loadVoyage(false); toast('Position restored'); } catch (x) { toast('Could not restore it'); } });
    } catch (x) { toast('Could not remove it. Check the connection.'); }
  });

  async function loadVoyage(fit) {
    var d;
    try { d = await api('/api/voyages/' + encodeURIComponent(S.id) + '/track'); }
    catch (e) { say('Could not load the track. Check the connection.', true); return; }
    S.data = d;
    $('#gpxLink').href = '/api/voyages/' + encodeURIComponent(S.id) + '/track.gpx';
    $('#csvLink').href = '/api/voyages/' + encodeURIComponent(S.id) + '/track.csv';
    renderStats(); renderFixes(); map.setTrack(d, fit);   // opening a voyage draws the track on; the minute-by-minute refresh does not
    if (fit) {
      if (d.stats.bbox) map.fit(d.stats.bbox);
      else { var k = lastKnown(); map.setView(k ? k.lat : 56.5, k ? k.lon : -5.5, k ? 10 : 6); }
    }
    say('');
    refreshStart();
  }

  /* ------------------------------------------------------------ amend the start */
  function parseCoord(str, isLat) {   // "55 52.123 N", 55°52'07"N, 55.8687, -4.76 -> degrees, or NaN
    var s = String(str || '').trim().toUpperCase().replace(/[′’']/g, "'").replace(/[″”"]/g, '"').replace(/,/g, '.');
    if (!s) return NaN;
    var hem = s.match(/[NSEW]/g);
    if (hem && hem.length !== 1) return NaN;
    var h = hem ? hem[0] : null;
    if (h && (isLat ? 'NS' : 'EW').indexOf(h) < 0) return NaN;
    var nums = s.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length > 3 || /[^0-9.\-\s°'"]/.test(s.replace(/[NSEW]/g, ''))) return NaN;
    var d = Math.abs(parseFloat(nums[0])), m = nums[1] != null ? parseFloat(nums[1]) : 0, sec = nums[2] != null ? parseFloat(nums[2]) : 0;
    if (nums.length > 1 && (m < 0 || m >= 60)) return NaN;
    if (nums.length > 2 && (sec < 0 || sec >= 60)) return NaN;
    if (nums.length > 1 && nums[0].indexOf('.') >= 0) return NaN;   // 55.5 12 is ambiguous
    var v = d + m / 60 + sec / 3600;
    if (nums[0].charAt(0) === '-' || h === 'S' || h === 'W') v = -v;
    return Math.abs(v) <= (isLat ? 90 : 180) ? v : NaN;
  }
  function firstUsed() { return S.data ? S.data.points.find(function (p) { return p.used; }) : null; }
  function refreshStart() {
    var f = firstUsed(), card = $('#startCard');
    card.hidden = !f; if (!f) return;
    $('#stLat').value = ddm(f.lat, 'N', 'S'); $('#stLon').value = ddm(f.lon, 'E', 'W');
  }
  async function saveStart(lat, lon) {
    var f = firstUsed(); if (!f) return;
    var old = { lat: f.lat, lon: f.lon };
    try {
      await api('/api/positions/' + encodeURIComponent(f.id), { method: 'PUT', headers: J, body: JSON.stringify({ lat: lat, lon: lon }) });
    } catch (e) { say(e && e.body && e.body.error ? 'Not saved: ' + e.body.error : 'Not saved. Moving the start needs a connection.', true); return; }
    await loadVoyage(false);
    toast('Start moved', async function () {
      try { await api('/api/positions/' + encodeURIComponent(f.id), { method: 'PUT', headers: J, body: JSON.stringify(old) }); await loadVoyage(false); toast('Start put back'); }
      catch (x) { toast('Could not undo. Check the connection.'); }
    });
  }
  map.onmove = function (lat, lon) { setMove(false); saveStart(Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6); };
  function setMove(on) { map.editStart = on; $('#moveBtn').setAttribute('aria-pressed', String(on)); $('#moveBtn').textContent = on ? 'Drag the Start marker (tap to cancel)' : 'Move start on map'; map.drawTrack(); }
  $('#moveBtn').addEventListener('click', function () { setMove(!map.editStart); });
  $('#stSave').addEventListener('click', function () {
    var la = parseCoord($('#stLat').value, true), lo = parseCoord($('#stLon').value, false);
    if (isNaN(la) || isNaN(lo)) { say('Check the coordinates. Use degrees and minutes like 55 52.123 N and 004 45.678 W, or decimal like 55.8687 and -4.7613.', true); return; }
    if (la === 0 && lo === 0) { say('0,0 is not accepted.', true); return; }
    saveStart(Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6);
  });
  window.__cnParseCoord = parseCoord;   // for testing
  async function init() {
    try { S.settings = await api('/api/track/settings'); } catch (e) { S.settings = { intervalMin: 15, intervals: [0, 5, 10, 15, 30, 60] }; }
    $('#intSel').innerHTML = S.settings.intervals.map(function (n) { return '<option value="' + n + '"' + (n === S.settings.intervalMin ? ' selected' : '') + '>' + (n ? 'Every ' + n + ' minutes' : 'Off (taps and manual only)') + '</option>'; }).join('');
    try { S.voyages = await api('/api/track/voyages'); } catch (e) { say('Could not load voyages. Check the connection.', true); return; }
    if (!S.voyages.length) {
      $('#statsCard').querySelector('.t-stats').innerHTML = '';
      $('#statsSub').textContent = 'No voyage yet';
      $('#statsNote').textContent = 'The track is recorded during a voyage. The first WORK tap on the dashboard starts one.';
      $('#fixesCard').hidden = true; $('#logBtn').disabled = false;
      var k = lastKnown(); map.setView(k ? k.lat : 56.5, k ? k.lon : -5.5, k ? 10 : 6);
      return;
    }
    var q = new URLSearchParams(location.search).get('voyage');
    var pick = S.voyages.find(function (v) { return v.id === q; }) || S.voyages.find(function (v) { return !v.end; }) || S.voyages[0];
    S.id = pick.id; renderSelect(); await loadVoyage(true);
    clearInterval(S.timer);
    S.timer = setInterval(function () { if (!document.hidden && S.data && !S.data.voyage.end) loadVoyage(false); }, 60000);
  }
  $('#voySel').addEventListener('change', function (e) {
    S.id = e.target.value;
    try { history.replaceState(null, '', '/track.html?voyage=' + encodeURIComponent(S.id)); } catch (x) {}
    loadVoyage(true);
  });
  $('#intSel').addEventListener('change', async function (e) {
    var n = +e.target.value;
    try { await api('/api/track/settings', { method: 'PUT', headers: J, body: JSON.stringify({ intervalMin: n }) }); toast(n ? 'Recording every ' + n + ' minutes while the app is open' : 'Timed recording is off'); }
    catch (x) { toast('Not saved. Check the connection.'); }
  });
  $('#printBtn').addEventListener('click', function () {
    var B = window.CNBrand, was = document.title;
    $('#printFoot').innerHTML = B.footer('Map tiles and data © their providers as credited on the map.');
    document.title = B.docTitle('Voyage track');
    window.addEventListener('afterprint', function back() { document.title = was; window.removeEventListener('afterprint', back); });
    map.resize(); setTimeout(function () { window.print(); }, 200);
  });
  $('#logBtn').addEventListener('click', async function () {
    var b = $('#logBtn'); b.disabled = true; say('Getting a position…');
    try {
      var pos = await geo({ enableHighAccuracy: true, timeout: 25000, maximumAge: 10000 });
      var c = pos.coords, body = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ts: new Date(pos.timestamp).toISOString(), lat: c.latitude, lon: c.longitude, acc: Math.round(c.accuracy), source: 'manual' };
      if (isFinite(c.speed) && c.speed >= 0) body.sog = Math.round(c.speed * 19.43844) / 10;
      if (isFinite(c.heading) && c.heading >= 0) body.cog = Math.round(c.heading);
      await api('/api/positions', { method: 'POST', headers: J, body: JSON.stringify(body) });
      map.me = { lat: c.latitude, lon: c.longitude };
      if (!S.voyages.length) { say('Position saved. It will appear on the map of your next voyage.'); }
      else { await loadVoyage(false); say('Position logged at ' + dt(new Date(pos.timestamp).toISOString()) + '.'); }
    } catch (e) { say(e && e.status ? 'Could not save the position. Check the connection.' : geoError(e), true); }
    b.disabled = false;
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.id) loadVoyage(false); });

  window.addEventListener('online', function () { map.retryTiles(); });
  window.addEventListener('beforeprint', function () { map.finishAnim(); });   // paper gets the whole track
  map.redraw();
  init();
  window.__cnMap = map;   // for testing
})();
