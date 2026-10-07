/* Crow's Nest - voyage map. A small self-contained slippy map (no map library): OpenStreetMap + OpenSeaMap tiles,
   with the track drawn over them as SVG. Works with no tiles at all (offline): you still get the track on a lat/lon grid. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var J = { 'Content-Type': 'application/json' };
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

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
    this.el = el; this.lat = 56.5; this.lon = -5.5; this.z = 6; this.sea = true;
    this.tiles = {}; this.pending = 0; this.loaded = 0; this.failed = 0;
    this.data = null; this.sel = null; this.hits = [];
    this.w = el.clientWidth; this.h = el.clientHeight;
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
      '<button type="button" data-m="sea" aria-pressed="true" aria-label="Sea marks (buoys, lights, harbours)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M7 8h10M5 17c2 2 4 2 7 0s5-2 7 0"/></svg></button>';
    this.attr = document.createElement('div'); this.attr.className = 'tm-attr';
    this.attr.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · <a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a>';
    el.appendChild(this.gridSvg); el.appendChild(this.tileDiv); el.appendChild(this.trackSvg); el.appendChild(this.msg); el.appendChild(this.ctrl); el.appendChild(this.attr);
    this.bind();
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(el);
    window.addEventListener('resize', function () { self.resize(); });
    window.addEventListener('beforeprint', function () { self.resize(); });
    window.addEventListener('afterprint', function () { self.resize(); });
  }
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
    var offline = this.failed > 0 && this.loaded === 0;
    this.msg.hidden = !offline;
    if (offline) this.msg.textContent = 'No map tiles. The track is still drawn on the grid. The chart comes back when the phone is online.';
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
  MapView.prototype.setTrack = function (data) { this.data = data; this.sel = null; this.drawTrack(); };
  MapView.prototype.drawTrack = function () {
    var d = this.data, svg = this.trackSvg, self = this;
    this.hits = []; this.trackSvg.setAttribute('viewBox', '0 0 ' + this.w + ' ' + this.h);
    if (!d) { svg.innerHTML = ''; return; }
    var used = d.points.filter(function (p) { return p.used; }), byId = {};
    used.forEach(function (p) { byId[p.id] = self.px(p.lat, p.lon); });
    var solid = '', dashed = '', arrows = '', dots = '', run = [];
    function flush() { if (run.length > 1) solid += '<polyline points="' + run.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '"/>'; run = []; }
    d.legs.forEach(function (lg, i) {
      var a = byId[lg.from], b = byId[lg.to]; if (!a || !b) return;
      if (lg.gap) { flush(); dashed += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '"/>'; }
      else { if (!run.length) run.push(a); run.push(b); }
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 46) {
        var ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 90;
        arrows += '<path d="M-5,4 L0,-6 L5,4 L0,1.5 Z" transform="translate(' + ((a[0] + b[0]) / 2).toFixed(1) + ' ' + ((a[1] + b[1]) / 2).toFixed(1) + ') rotate(' + ang.toFixed(0) + ')"/>';
      }
    });
    flush();
    used.forEach(function (p, i) {
      var q = byId[p.id]; if (q[0] < -20 || q[1] < -20 || q[0] > self.w + 20 || q[1] > self.h + 20) return;
      self.hits.push({ p: p, x: q[0], y: q[1] });
      var first = i === 0, last = i === used.length - 1 && used.length > 1;
      if (!first && !last) dots += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3.4"/>';
    });
    var ends = '', f = used[0], l = used[used.length - 1];
    if (f) { var a0 = byId[f.id]; ends += '<circle cx="' + a0[0].toFixed(1) + '" cy="' + a0[1].toFixed(1) + '" r="8" fill="#8FE3B0" stroke="#00154C" stroke-width="3"/><text x="' + (a0[0] + 12).toFixed(1) + '" y="' + (a0[1] + 4).toFixed(1) + '">Start</text>'; }
    if (l && l !== f) { var a1 = byId[l.id]; ends += '<circle cx="' + a1[0].toFixed(1) + '" cy="' + a1[1].toFixed(1) + '" r="9" fill="#F5B041" stroke="#00154C" stroke-width="3"/><text x="' + (a1[0] + 13).toFixed(1) + '" y="' + (a1[1] + 4).toFixed(1) + '">' + (d.voyage.end ? 'End' : 'Latest') + '</text>'; }
    var selSvg = '';
    if (this.sel && byId[this.sel]) { var s = byId[this.sel]; selSvg = '<circle cx="' + s[0].toFixed(1) + '" cy="' + s[1].toFixed(1) + '" r="13" fill="none" stroke="#fff" stroke-width="3"/><circle cx="' + s[0].toFixed(1) + '" cy="' + s[1].toFixed(1) + '" r="13" fill="none" stroke="#00154C" stroke-width="1" stroke-dasharray="4 4"/>'; }
    var me = '';
    if (this.me) { var m = this.px(this.me.lat, this.me.lon); me = '<circle cx="' + m[0].toFixed(1) + '" cy="' + m[1].toFixed(1) + '" r="9" fill="#2F80ED" stroke="#fff" stroke-width="3"/>'; }
    svg.innerHTML =
      '<g fill="none" stroke="#00154C" stroke-opacity=".75" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' + solid + dashed.replace(/<line /g, '<line stroke-dasharray="1 11" ') + '</g>' +
      '<g fill="none" stroke="#7FD3E6" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">' + solid + '</g>' +
      '<g fill="none" stroke="#7FD3E6" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="1 11">' + dashed + '</g>' +
      '<g fill="#00154C" fill-opacity=".9" stroke="#fff" stroke-width="1.2">' + arrows + '</g>' +
      '<g fill="#7FD3E6" stroke="#00154C" stroke-width="1.6">' + dots + '</g>' + selSvg + ends + me;
  };
  MapView.prototype.redraw = function () { this.updateTiles(); this.drawGrid(); this.drawTrack(); };
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
      el.setPointerCapture(e.pointerId); ptrs[e.pointerId] = rel(e); moved = 0; start = rel(e); last = null;
      el.classList.add('drag');
    });
    el.addEventListener('pointermove', function (e) {
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
    else if (m === 'sea') { var on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); map.setSea(on); try { localStorage.setItem('cn_sea', on ? '1' : '0'); } catch (x) {} }
    else if (m === 'here') locate(true);
  });
  try { if (localStorage.getItem('cn_sea') === '0') { map.sea = false; map.ctrl.querySelector('[data-m=sea]').setAttribute('aria-pressed', 'false'); } } catch (x) {}
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
    renderStats(); renderFixes(); map.setTrack(d);
    if (fit) {
      if (d.stats.bbox) map.fit(d.stats.bbox);
      else { var k = lastKnown(); map.setView(k ? k.lat : 56.5, k ? k.lon : -5.5, k ? 10 : 6); }
    }
    say('');
  }
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
  map.redraw();
  init();
  window.__cnMap = map;   // for testing
})();
